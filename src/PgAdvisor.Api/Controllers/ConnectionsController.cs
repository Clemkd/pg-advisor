using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using PgAdvisor.Api.Data;
using PgAdvisor.Api.Models;
using PgAdvisor.Api.Postgres;
using PgAdvisor.Api.Security;
using PgAdvisor.Api.Services;
using PgAdvisor.Api.State;

namespace PgAdvisor.Api.Controllers;

[ApiController]
[Route("api/connections")]
public sealed class ConnectionsController(
    AdvisorDbContext db,
    SecretProtector protector,
    PgConnectionFactory factory,
    CapabilityDetector detector,
    ConnectionPresenter presenter,
    InstanceStateStore states,
    ILogger<ConnectionsController> logger) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IEnumerable<ConnectionResponse>>> List(CancellationToken ct)
    {
        var connections = await db.PostgresConnections.OrderBy(c => c.Name).ToListAsync(ct);
        return Ok(connections.Select(c => presenter.ToResponse(c)));
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<ConnectionDetailResponse>> Get(int id, CancellationToken ct)
    {
        var connection = await db.PostgresConnections.FirstOrDefaultAsync(c => c.Id == id, ct);
        if (connection is null)
        {
            return NotFound();
        }

        var capabilities = presenter.CapabilitiesFor(connection);

        return Ok(new ConnectionDetailResponse
        {
            Connection = presenter.ToResponse(connection),
            Capabilities = capabilities,
            CapabilitySummary = capabilities?.Describe(CapabilityDetector.NotableExtensions).ToList() ?? [],
        });
    }

    [HttpPost]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<ConnectionResponse>> Create(CreateConnectionRequest request, CancellationToken ct)
    {
        if (await db.PostgresConnections.AnyAsync(c => c.Name == request.Name, ct))
        {
            return Problem(statusCode: StatusCodes.Status409Conflict, title: "Ce nom d'instance est déjà utilisé.");
        }

        var connection = new PostgresConnection
        {
            Name = request.Name.Trim(),
            Host = request.Host.Trim(),
            Port = request.Port,
            Database = request.Database.Trim(),
            Username = request.Username.Trim(),
            EncryptedPassword = protector.Protect(request.Password),
            SslMode = NormalizeSslMode(request.SslMode),
            CollectionIntervalSeconds = request.CollectionIntervalSeconds,
            Enabled = request.Enabled,
            CreatedAt = DateTimeOffset.UtcNow,
        };

        db.PostgresConnections.Add(connection);
        await db.SaveChangesAsync(ct);

        logger.LogInformation("Instance « {Name} » ajoutée ({Host}:{Port}/{Database})",
            connection.Name, connection.Host, connection.Port, connection.Database);

        return CreatedAtAction(nameof(Get), new { id = connection.Id }, presenter.ToResponse(connection));
    }

    [HttpPut("{id:int}")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<ConnectionResponse>> Update(int id, UpdateConnectionRequest request, CancellationToken ct)
    {
        var connection = await db.PostgresConnections.FirstOrDefaultAsync(c => c.Id == id, ct);
        if (connection is null)
        {
            return NotFound();
        }

        if (await db.PostgresConnections.AnyAsync(c => c.Name == request.Name && c.Id != id, ct))
        {
            return Problem(statusCode: StatusCodes.Status409Conflict, title: "Ce nom d'instance est déjà utilisé.");
        }

        var targetChanged =
            connection.Host != request.Host.Trim() ||
            connection.Port != request.Port ||
            connection.Database != request.Database.Trim() ||
            connection.Username != request.Username.Trim();

        connection.Name = request.Name.Trim();
        connection.Host = request.Host.Trim();
        connection.Port = request.Port;
        connection.Database = request.Database.Trim();
        connection.Username = request.Username.Trim();
        connection.SslMode = NormalizeSslMode(request.SslMode);
        connection.CollectionIntervalSeconds = request.CollectionIntervalSeconds;
        connection.Enabled = request.Enabled;

        // Mot de passe absent de la requête : on conserve le secret enregistré.
        if (!string.IsNullOrEmpty(request.Password))
        {
            connection.EncryptedPassword = protector.Protect(request.Password);
        }

        if (targetChanged)
        {
            // La cible a changé : les capabilities détectées ne sont plus fiables.
            connection.CapabilitiesJson = null;
            connection.ServerVersion = null;
            connection.ServerVersionNum = 0;
            connection.TimescaleVersion = null;
            states.Remove(connection.Id);
        }

        await db.SaveChangesAsync(ct);
        return Ok(presenter.ToResponse(connection));
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        var connection = await db.PostgresConnections.FirstOrDefaultAsync(c => c.Id == id, ct);
        if (connection is null)
        {
            return NoContent();
        }

        db.PostgresConnections.Remove(connection);
        await db.SaveChangesAsync(ct);
        states.Remove(id);

        logger.LogInformation("Instance « {Name} » supprimée", connection.Name);
        return NoContent();
    }

    [HttpGet("{id:int}/capabilities")]
    public async Task<ActionResult<IEnumerable<CapabilityStatus>>> Capabilities(int id, CancellationToken ct)
    {
        var connection = await db.PostgresConnections.FirstOrDefaultAsync(c => c.Id == id, ct);
        if (connection is null)
        {
            return NotFound();
        }

        var capabilities = presenter.CapabilitiesFor(connection);
        return Ok(capabilities?.Describe(CapabilityDetector.NotableExtensions).ToList() ?? []);
    }

    /// <summary>Teste une cible avant enregistrement, ou reteste une connexion existante.</summary>
    [HttpPost("test")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<TestConnectionResponse>> Test(TestConnectionRequest request, CancellationToken ct)
    {
        var probe = new PostgresConnection
        {
            Host = request.Host.Trim(),
            Port = request.Port,
            Database = request.Database.Trim(),
            Username = request.Username.Trim(),
            SslMode = NormalizeSslMode(request.SslMode),
        };

        string? password = request.Password;
        if (string.IsNullOrEmpty(password) && request.ConnectionId is int existingId)
        {
            var existing = await db.PostgresConnections
                .AsNoTracking()
                .FirstOrDefaultAsync(c => c.Id == existingId, ct);

            if (existing is null)
            {
                return NotFound();
            }

            probe.EncryptedPassword = existing.EncryptedPassword;
            password = null; // la fabrique déchiffrera le secret enregistré
        }
        else if (string.IsNullOrEmpty(password))
        {
            return Problem(statusCode: StatusCodes.Status400BadRequest, title: "Mot de passe requis pour tester une nouvelle cible.");
        }

        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(20));

            await using var pg = await factory.OpenAsync(probe, timeout.Token, password);
            var capabilities = await detector.DetectAsync(pg, timeout.Token);
            var readOnly = await IsSessionReadOnlyAsync(pg, timeout.Token);

            return Ok(new TestConnectionResponse
            {
                Success = true,
                ServerVersion = capabilities.ServerVersion,
                TimescaleVersion = capabilities.TimescaleVersion,
                ReadOnlyEnforced = readOnly,
                Capabilities = capabilities.Describe(CapabilityDetector.NotableExtensions).ToList(),
                Warnings = BuildWarnings(capabilities),
            });
        }
        catch (Exception ex) when (ex is NpgsqlException or InvalidOperationException or TimeoutException or OperationCanceledException)
        {
            // Le message d'erreur PostgreSQL ne contient pas le secret ; il est utile à l'opérateur.
            logger.LogWarning("Test de connexion vers {Host}:{Port}/{Database} en échec : {Reason}",
                probe.Host, probe.Port, probe.Database, ex.Message);

            return Ok(new TestConnectionResponse { Success = false, Error = ex.Message });
        }
    }

    private static IReadOnlyList<string> BuildWarnings(PgCapabilities capabilities)
    {
        var warnings = new List<string>();

        if (!capabilities.HasView("pg_stat_activity"))
        {
            warnings.Add("pg_stat_activity n'est pas lisible : les règles de connexions et de transactions longues seront désactivées.");
        }

        if (!capabilities.HasView("pg_stat_user_tables"))
        {
            warnings.Add("pg_stat_user_tables n'est pas lisible : les règles de vacuum et d'index seront désactivées.");
        }

        if (!capabilities.HasExtension("pg_stat_statements"))
        {
            warnings.Add("pg_stat_statements n'est pas installée : l'analyse des requêtes restera limitée.");
        }

        if (!capabilities.IsSuperuser && !capabilities.HasPgMonitor)
        {
            warnings.Add("L'utilisateur n'appartient pas à pg_monitor : certaines statistiques des autres sessions resteront masquées.");
        }

        return warnings;
    }

    private static async Task<bool> IsSessionReadOnlyAsync(NpgsqlConnection connection, CancellationToken ct)
    {
        await using var command = new NpgsqlCommand("SELECT current_setting('default_transaction_read_only')", connection);
        var value = await command.ExecuteScalarAsync(ct) as string;
        return string.Equals(value, "on", StringComparison.OrdinalIgnoreCase);
    }

    private static string NormalizeSslMode(string? value) =>
        Enum.TryParse<SslMode>(value, ignoreCase: true, out var mode) ? mode.ToString() : nameof(SslMode.Prefer);
}
