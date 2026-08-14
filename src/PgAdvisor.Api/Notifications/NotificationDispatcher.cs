using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using PgAdvisor.Api.Data;

namespace PgAdvisor.Api.Notifications;

/// <summary>
/// Envoie les notifications webhook, en série et hors du chemin d'analyse. Deux garanties :
/// un même épisode de finding n'est notifié qu'une fois par webhook (déduplication en base),
/// et un webhook injoignable est réessayé sans bloquer la supervision.
/// </summary>
public sealed class NotificationDispatcher(
    NotificationQueue queue,
    IServiceScopeFactory scopeFactory,
    IHttpClientFactory httpClientFactory,
    IOptions<AdvisorOptions> options,
    ILogger<NotificationDispatcher> logger) : BackgroundService
{
    private readonly NotificationOptions _options = options.Value.Notifications;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await foreach (var request in queue.Reader.ReadAllAsync(stoppingToken))
            {
                try
                {
                    await HandleAsync(request, stoppingToken);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    logger.LogError(ex, "Handling of notification {Event} for finding {FindingId} failed.",
                        request.Event, request.FindingId);
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Arrêt normal.
        }
    }

    private async Task HandleAsync(NotificationRequest request, CancellationToken cancellationToken)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AdvisorDbContext>();

        var finding = await db.Findings
            .Include(f => f.Connection)
            .FirstOrDefaultAsync(f => f.Id == request.FindingId, cancellationToken);

        if (finding?.Connection is null)
        {
            // Finding ou instance supprimé entre-temps : plus rien à notifier.
            return;
        }

        var configurations = await db.NotificationConfigurations
            .Where(c => c.Enabled && (c.ConnectionId == null || c.ConnectionId == request.ConnectionId))
            .ToListAsync(cancellationToken);

        foreach (var configuration in configurations)
        {
            if (!configuration.EventList.Contains(request.Event, StringComparer.OrdinalIgnoreCase))
            {
                continue;
            }

            if (!Severities.MeetsMinimum(request.Severity, configuration.MinimumSeverity))
            {
                continue;
            }

            var alreadyNotified = await db.NotificationHistory.AnyAsync(
                h => h.ConfigurationId == configuration.Id &&
                     h.FindingId == finding.Id &&
                     h.Event == request.Event &&
                     h.Cycle == request.Cycle &&
                     h.Success,
                cancellationToken);

            if (alreadyNotified)
            {
                logger.LogDebug("Notification {Event} for finding {FindingId} already sent to {Webhook}: skipped.",
                    request.Event, finding.Id, configuration.Key);
                continue;
            }

            await SendAsync(db, configuration, finding, request, cancellationToken);
        }
    }

    private async Task SendAsync(
        AdvisorDbContext db,
        NotificationConfiguration configuration,
        Finding finding,
        NotificationRequest request,
        CancellationToken cancellationToken)
    {
        var payload = NotificationPayloadBuilder.Build(
            configuration.Format, configuration, finding, finding.Connection!, request.Event);

        var client = httpClientFactory.CreateClient("webhook");

        var attempts = 0;
        var success = false;
        int? statusCode = null;
        string? error = null;

        while (attempts < Math.Max(1, _options.MaxRetries) && !success)
        {
            attempts++;

            try
            {
                using var message = new HttpRequestMessage(HttpMethod.Post, configuration.Url)
                {
                    Content = JsonContent.Create(payload),
                };

                foreach (var header in ParseHeaders(configuration.HeadersJson))
                {
                    message.Headers.TryAddWithoutValidation(header.Key, header.Value);
                }

                using var response = await client.SendAsync(message, cancellationToken);
                statusCode = (int)response.StatusCode;
                success = response.IsSuccessStatusCode;

                if (!success)
                {
                    // Le corps de la réponse porte le motif du refus (Discord et Slack le
                    // détaillent) : sans lui, un 400 reste indéchiffrable pour l'opérateur.
                    var body = await ReadBodyAsync(response, cancellationToken);
                    error = $"HTTP {statusCode} {response.ReasonPhrase}".Trim();
                    if (!string.IsNullOrWhiteSpace(body))
                    {
                        error += $" — {body}";
                    }

                    // Une erreur définitive côté client ne sera pas résolue par un nouvel essai.
                    if (response.StatusCode is >= HttpStatusCode.BadRequest and < HttpStatusCode.InternalServerError &&
                        response.StatusCode != HttpStatusCode.RequestTimeout &&
                        response.StatusCode != HttpStatusCode.TooManyRequests)
                    {
                        break;
                    }
                }
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !cancellationToken.IsCancellationRequested)
            {
                error = ex.Message;
            }

            if (!success && attempts < Math.Max(1, _options.MaxRetries))
            {
                var delay = _options.RetryDelay * attempts;
                logger.LogWarning("Webhook {Webhook} failed ({Error}); retrying in {Delay}.",
                    configuration.Key, error, delay);

                try
                {
                    await Task.Delay(delay, cancellationToken);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }
        }

        var now = DateTimeOffset.UtcNow;

        db.NotificationHistory.Add(new NotificationHistoryEntry
        {
            ConfigurationId = configuration.Id,
            FindingId = finding.Id,
            Event = request.Event,
            Cycle = request.Cycle,
            Severity = request.Severity,
            At = now,
            Success = success,
            Attempts = attempts,
            StatusCode = statusCode,
            Error = Truncate(error, 500),
        });

        var tracked = await db.NotificationConfigurations.FirstOrDefaultAsync(c => c.Id == configuration.Id, cancellationToken);
        if (tracked is not null)
        {
            tracked.LastAttemptAt = now;
            tracked.LastAttemptSucceeded = success;
            tracked.LastError = success ? null : Truncate(error, 500);
        }

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex)
        {
            // Course avec un autre envoi du même événement : la contrainte d'unicité a joué son rôle.
            logger.LogDebug(ex, "Notification history already recorded for finding {FindingId}.", finding.Id);
        }

        if (success)
        {
            logger.LogInformation("Notification {Event} for finding {FindingId} sent to {Webhook}.",
                request.Event, finding.Id, configuration.Key);
        }
        else
        {
            logger.LogWarning("Notification {Event} for finding {FindingId} given up after {Attempts} attempt(s): {Error}",
                request.Event, finding.Id, attempts, error);
        }
    }

    /// <summary>Extrait un extrait du corps de réponse, borné : il finit dans l'historique.</summary>
    private static async Task<string?> ReadBodyAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        try
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            return string.IsNullOrWhiteSpace(body) ? null : Truncate(body.ReplaceLineEndings(" ").Trim(), 300);
        }
        catch (Exception)
        {
            return null;
        }
    }

    private static Dictionary<string, string> ParseHeaders(string? json)
    {
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(json))
        {
            return headers;
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                return headers;
            }

            foreach (var property in document.RootElement.EnumerateObject())
            {
                if (property.Value.ValueKind == JsonValueKind.String)
                {
                    headers[property.Name] = property.Value.GetString() ?? string.Empty;
                }
            }
        }
        catch (JsonException)
        {
            // En-têtes illisibles : la requête part sans eux plutôt que de ne pas partir.
        }

        return headers;
    }

    private static string? Truncate(string? value, int max) =>
        value is null || value.Length <= max ? value : value[..max];
}
