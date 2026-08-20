using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PgAdvisor.Api.Data;
using PgAdvisor.Api.Models;
using PgAdvisor.Api.Notifications;

namespace PgAdvisor.Api.Controllers;

[ApiController]
[Route("api/notifications")]
public sealed class NotificationsController(
    AdvisorDbContext db,
    IHttpClientFactory httpClientFactory,
    ILogger<NotificationsController> logger) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IEnumerable<NotificationConfigurationResponse>>> List(CancellationToken ct)
    {
        var rows = await db.NotificationConfigurations
            .OrderBy(c => c.Key)
            .Select(c => new
            {
                Configuration = c,
                ConnectionName = c.ConnectionId == null
                    ? null
                    : db.PostgresConnections.Where(p => p.Id == c.ConnectionId).Select(p => p.Name).FirstOrDefault(),
            })
            .ToListAsync(ct);

        var revealUrl = User.IsInRole(Roles.Admin);

        return Ok(rows.Select(row => ToResponse(row.Configuration, row.ConnectionName, revealUrl)));
    }

    [HttpPost]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<NotificationConfigurationResponse>> Create(SaveNotificationRequest request, CancellationToken ct)
    {
        if (Validate(request) is { } problem)
        {
            return problem;
        }

        if (await db.NotificationConfigurations.AnyAsync(c => c.Key == request.Key, ct))
        {
            return Problem(statusCode: StatusCodes.Status409Conflict, title: "This webhook identifier is already taken.");
        }

        var configuration = new NotificationConfiguration
        {
            Key = request.Key,
            Url = request.Url,
            Enabled = request.Enabled,
            MinimumSeverity = request.MinimumSeverity.ToLowerInvariant(),
            Format = request.Format.ToLowerInvariant(),
            Events = string.Join(',', NormalizeEvents(request.Events)),
            ConnectionId = request.ConnectionId,
            HeadersJson = SerializeHeaders(request.Headers),
            CreatedAt = DateTimeOffset.UtcNow,
        };

        db.NotificationConfigurations.Add(configuration);
        await db.SaveChangesAsync(ct);

        logger.LogInformation("Webhook {Key} created.", configuration.Key);
        return CreatedAtAction(nameof(List), null, ToResponse(configuration, null, revealUrl: true));
    }

    [HttpPut("{id:int}")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<NotificationConfigurationResponse>> Update(
        int id, SaveNotificationRequest request, CancellationToken ct)
    {
        if (Validate(request) is { } problem)
        {
            return problem;
        }

        var configuration = await db.NotificationConfigurations.FirstOrDefaultAsync(c => c.Id == id, ct);
        if (configuration is null)
        {
            return NotFound();
        }

        if (await db.NotificationConfigurations.AnyAsync(c => c.Key == request.Key && c.Id != id, ct))
        {
            return Problem(statusCode: StatusCodes.Status409Conflict, title: "This webhook identifier is already taken.");
        }

        configuration.Key = request.Key;
        configuration.Url = request.Url;
        configuration.Enabled = request.Enabled;
        configuration.MinimumSeverity = request.MinimumSeverity.ToLowerInvariant();
        configuration.Format = request.Format.ToLowerInvariant();
        configuration.Events = string.Join(',', NormalizeEvents(request.Events));
        configuration.ConnectionId = request.ConnectionId;

        // Headers null : on conserve les en-têtes enregistrés, l'IHM ne les recevant jamais.
        if (request.Headers is not null)
        {
            configuration.HeadersJson = SerializeHeaders(request.Headers);
        }

        await db.SaveChangesAsync(ct);
        return Ok(ToResponse(configuration, null, revealUrl: true));
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        var configuration = await db.NotificationConfigurations.FirstOrDefaultAsync(c => c.Id == id, ct);
        if (configuration is null)
        {
            return NoContent();
        }

        db.NotificationConfigurations.Remove(configuration);
        await db.SaveChangesAsync(ct);

        logger.LogInformation("Webhook {Key} deleted.", configuration.Key);
        return NoContent();
    }

    /// <summary>Envoie une charge de test au webhook, sans passer par la file ni l'historique.</summary>
    [HttpPost("{id:int}/test")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<TestWebhookResponse>> Test(int id, CancellationToken ct)
    {
        var configuration = await db.NotificationConfigurations.AsNoTracking().FirstOrDefaultAsync(c => c.Id == id, ct);
        if (configuration is null)
        {
            return NotFound();
        }

        // La charge de test emprunte la forme du format configuré : un test qui passe garantit
        // que les vraies notifications passeront aussi.
        var payload = NotificationPayloadBuilder.BuildTest(configuration.Format, configuration);

        try
        {
            var client = httpClientFactory.CreateClient("webhook");
            using var message = new HttpRequestMessage(HttpMethod.Post, configuration.Url)
            {
                Content = JsonContent.Create(payload),
            };

            foreach (var header in DeserializeHeaders(configuration.HeadersJson))
            {
                message.Headers.TryAddWithoutValidation(header.Key, header.Value);
            }

            using var response = await client.SendAsync(message, ct);

            if (response.IsSuccessStatusCode)
            {
                return Ok(new TestWebhookResponse(true, (int)response.StatusCode, null));
            }

            // Le corps porte le motif exact du refus, indispensable pour un 400.
            var body = await response.Content.ReadAsStringAsync(ct);
            var detail = $"HTTP {(int)response.StatusCode} {response.ReasonPhrase}".Trim();
            if (!string.IsNullOrWhiteSpace(body))
            {
                detail += $" — {Truncate(body.ReplaceLineEndings(" ").Trim(), 300)}";
            }

            return Ok(new TestWebhookResponse(false, (int)response.StatusCode, detail));
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or UriFormatException or InvalidOperationException)
        {
            return Ok(new TestWebhookResponse(false, null, ex.Message));
        }
    }

    [HttpGet("history")]
    public async Task<ActionResult<IEnumerable<NotificationHistoryResponse>>> History(
        [FromQuery] int? configurationId, [FromQuery] int limit = 100, CancellationToken ct = default)
    {
        var query = db.NotificationHistory.AsNoTracking();
        if (configurationId is int id)
        {
            query = query.Where(h => h.ConfigurationId == id);
        }

        var rows = await query
            .OrderByDescending(h => h.At)
            .Take(Math.Clamp(limit, 1, 500))
            .Join(db.NotificationConfigurations, h => h.ConfigurationId, c => c.Id, (h, c) => new NotificationHistoryResponse(
                h.At, c.Key, h.Event, h.Severity, h.Success, h.Attempts, h.StatusCode, h.Error))
            .ToListAsync(ct);

        return Ok(rows);
    }

    private ObjectResult? Validate(SaveNotificationRequest request)
    {
        if (!Severities.IsValid(request.MinimumSeverity.ToLowerInvariant()))
        {
            return Problem(statusCode: StatusCodes.Status400BadRequest,
                title: $"Unknown minimum severity. Accepted values: {Severities.Info}, {Severities.Warning}, {Severities.Critical}.");
        }

        if (!NotificationFormats.IsValid(request.Format?.ToLowerInvariant()))
        {
            return Problem(statusCode: StatusCodes.Status400BadRequest,
                title: $"Unknown format. Accepted values: {string.Join(", ", NotificationFormats.All)}.");
        }

        var events = NormalizeEvents(request.Events);
        if (events.Count == 0)
        {
            return Problem(statusCode: StatusCodes.Status400BadRequest, title: "At least one event must be subscribed.");
        }

        var unknown = events.Where(e => !NotificationEvents.IsValid(e)).ToList();
        if (unknown.Count > 0)
        {
            return Problem(statusCode: StatusCodes.Status400BadRequest,
                title: $"Unknown events: {string.Join(", ", unknown)}.");
        }

        if (!Uri.TryCreate(request.Url, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            return Problem(statusCode: StatusCodes.Status400BadRequest, title: "The URL must be absolute and use http or https.");
        }

        return null;
    }

    private static List<string> NormalizeEvents(IEnumerable<string>? events) =>
        (events ?? [])
        .Select(e => e.Trim().ToLowerInvariant())
        .Where(e => e.Length > 0)
        .Distinct()
        .ToList();

    private static string? SerializeHeaders(Dictionary<string, string>? headers) =>
        headers is null || headers.Count == 0 ? null : JsonSerializer.Serialize(headers);

    private static Dictionary<string, string> DeserializeHeaders(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, string>>(json) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static string Truncate(string value, int max) =>
        value.Length <= max ? value : value[..max] + "…";

    /// <summary>
    /// A Slack, Discord or Teams URL carries its own secret in the path: it is the credential,
    /// not an address. Only an administrator sees it whole — everyone else gets the origin, which
    /// is enough to tell the services apart in the interface.
    /// </summary>
    internal static string MaskUrl(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var parsed))
        {
            return "…";
        }

        return $"{parsed.Scheme}://{parsed.Host}/…";
    }

    private static NotificationConfigurationResponse ToResponse(
        NotificationConfiguration c, string? connectionName, bool revealUrl) => new()
    {
        Id = c.Id,
        Key = c.Key,
        Url = revealUrl ? c.Url : MaskUrl(c.Url),
        Enabled = c.Enabled,
        MinimumSeverity = c.MinimumSeverity,
        Format = c.Format,
        Events = c.EventList.ToList(),
        ConnectionId = c.ConnectionId,
        ConnectionName = connectionName,
        HasHeaders = !string.IsNullOrWhiteSpace(c.HeadersJson),
        CreatedAt = c.CreatedAt,
        LastAttemptAt = c.LastAttemptAt,
        LastAttemptSucceeded = c.LastAttemptSucceeded,
        LastError = c.LastError,
    };
}
