using System.Text.Json;
using PgAdvisor.Api.Data;
using PgAdvisor.Api.Models;
using PgAdvisor.Api.Postgres;
using PgAdvisor.Api.State;

namespace PgAdvisor.Api.Services;

/// <summary>
/// Assemble la vue d'une connexion à partir de l'entité persistée et de son état volatil.
/// Point de passage unique, ce qui garantit que le secret ne fuit par aucune réponse.
/// </summary>
public sealed class ConnectionPresenter(InstanceStateStore states, ILogger<ConnectionPresenter> logger)
{
    /// <summary>
    /// Capabilities de l'instance : celles détectées à chaud si disponibles, sinon celles
    /// persistées au dernier passage — le dashboard reste renseigné après un redémarrage.
    /// </summary>
    public PgCapabilities? CapabilitiesFor(PostgresConnection connection)
    {
        var live = states.Get(connection.Id).Capabilities;
        if (live is not null)
        {
            return live;
        }

        if (string.IsNullOrEmpty(connection.CapabilitiesJson))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<PgCapabilities>(connection.CapabilitiesJson);
        }
        catch (JsonException ex)
        {
            logger.LogDebug(ex, "Capabilities persistées illisibles pour l'instance {ConnectionId}.", connection.Id);
            return null;
        }
    }

    public ConnectionResponse ToResponse(PostgresConnection connection, HealthScore? health = null)
    {
        var state = states.Get(connection.Id);

        return new ConnectionResponse
        {
            Id = connection.Id,
            Name = connection.Name,
            Host = connection.Host,
            Port = connection.Port,
            Database = connection.Database,
            Username = connection.Username,
            SslMode = connection.SslMode,
            CollectionIntervalSeconds = connection.CollectionIntervalSeconds,
            Enabled = connection.Enabled,
            CreatedAt = connection.CreatedAt,
            LastCollectedAt = state.LastCollectedAt ?? connection.LastCollectedAt,
            LastError = state.LastError ?? connection.LastError,
            ServerVersion = state.Capabilities?.ServerVersion ?? connection.ServerVersion,
            TimescaleVersion = state.Capabilities?.TimescaleVersion ?? connection.TimescaleVersion,
            CollectionState = connection.Enabled ? state.CollectionState : CollectionStates.Disabled,
            AnalysisProgress = state.AnalysisProgress,
            Health = health ?? state.Health,
            Metrics = state.Metrics,
        };
    }
}
