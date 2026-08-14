using Npgsql;
using PgAdvisor.Api.Postgres;

namespace PgAdvisor.Api.Collectors;

/// <summary>
/// Collecte en lecture seule de l'instantané d'une instance. Chaque bloc est conditionné aux
/// capabilities : une vue non lisible produit une métrique absente, jamais une erreur.
/// </summary>
public sealed class InstanceCollector(ILogger<InstanceCollector> logger)
{
    public async Task<InstanceMetrics> CollectAsync(
        NpgsqlConnection connection,
        PgCapabilities capabilities,
        CancellationToken cancellationToken)
    {
        var metrics = new InstanceMetrics();

        if (capabilities.HasView("pg_settings"))
        {
            metrics = metrics with
            {
                MaxConnections = await ReadIntSettingAsync(connection, "max_connections", cancellationToken),
                ReservedConnections = await ReadIntSettingAsync(connection, "superuser_reserved_connections", cancellationToken),
            };
        }

        if (capabilities.HasView("pg_stat_activity"))
        {
            metrics = await AddActivityAsync(connection, metrics, cancellationToken);
        }

        if (capabilities.HasView("pg_stat_database"))
        {
            metrics = await AddDatabaseStatsAsync(connection, metrics, cancellationToken);
        }

        metrics = metrics with { DatabaseSizeBytes = await ReadDatabaseSizeAsync(connection, cancellationToken) };

        return metrics with { CollectedAt = DateTimeOffset.UtcNow };
    }

    private async Task<InstanceMetrics> AddActivityAsync(
        NpgsqlConnection connection, InstanceMetrics metrics, CancellationToken cancellationToken)
    {
        // pg_blocking_pids() est disponible depuis PostgreSQL 9.6 et ne requiert pas de privilège
        // particulier ; les requêtes des autres sessions restent masquées sans pg_monitor, ce qui
        // n'affecte pas les comptages.
        const string sql = """
            SELECT
              count(*)                                                                     AS total,
              count(*) FILTER (WHERE state = 'active')                                     AS active,
              count(*) FILTER (WHERE state = 'idle in transaction')                         AS idle_in_transaction,
              count(*) FILTER (WHERE wait_event_type = 'Lock')                              AS waiting,
              count(*) FILTER (WHERE cardinality(pg_blocking_pids(pid)) > 0)                AS blocked,
              COALESCE(MAX(EXTRACT(EPOCH FROM (now() - xact_start))), 0)                    AS longest_xact,
              COALESCE(MAX(EXTRACT(EPOCH FROM (now() - query_start)))
                       FILTER (WHERE state = 'active'), 0)                                 AS longest_query
            FROM pg_stat_activity
            WHERE pid <> pg_backend_pid()
              AND backend_type = 'client backend'
            """;

        try
        {
            await using var command = new NpgsqlCommand(sql, connection);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken))
            {
                return metrics;
            }

            return metrics with
            {
                Connections = (int)reader.GetInt64(0),
                ActiveQueries = (int)reader.GetInt64(1),
                IdleInTransaction = (int)reader.GetInt64(2),
                WaitingSessions = (int)reader.GetInt64(3),
                BlockedSessions = (int)reader.GetInt64(4),
                LongestTransactionSeconds = Convert.ToDouble(reader.GetValue(5)),
                LongestQuerySeconds = Convert.ToDouble(reader.GetValue(6)),
            };
        }
        catch (PostgresException ex)
        {
            logger.LogDebug(ex, "Cannot collect pg_stat_activity; activity metrics skipped.");
            return metrics;
        }
    }

    private async Task<InstanceMetrics> AddDatabaseStatsAsync(
        NpgsqlConnection connection, InstanceMetrics metrics, CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT
              COALESCE(xact_commit, 0),
              COALESCE(xact_rollback, 0),
              COALESCE(deadlocks, 0),
              COALESCE(temp_bytes, 0),
              CASE WHEN COALESCE(blks_hit, 0) + COALESCE(blks_read, 0) > 0
                   THEN blks_hit::float / (blks_hit + blks_read)
                   ELSE NULL END
            FROM pg_stat_database
            WHERE datname = current_database()
            """;

        try
        {
            await using var command = new NpgsqlCommand(sql, connection);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken))
            {
                return metrics;
            }

            return metrics with
            {
                Commits = reader.GetInt64(0),
                Rollbacks = reader.GetInt64(1),
                Deadlocks = reader.GetInt64(2),
                TempBytes = reader.GetInt64(3),
                CacheHitRatio = reader.IsDBNull(4) ? null : reader.GetDouble(4),
            };
        }
        catch (PostgresException ex)
        {
            logger.LogDebug(ex, "Cannot collect pg_stat_database; database statistics skipped.");
            return metrics;
        }
    }

    private async Task<long> ReadDatabaseSizeAsync(NpgsqlConnection connection, CancellationToken cancellationToken)
    {
        try
        {
            await using var command = new NpgsqlCommand(
                "SELECT pg_database_size(current_database())", connection);
            var result = await command.ExecuteScalarAsync(cancellationToken);
            return result is long size ? size : 0;
        }
        catch (PostgresException ex)
        {
            logger.LogDebug(ex, "pg_database_size is unavailable; database size skipped.");
            return 0;
        }
    }

    private static async Task<int> ReadIntSettingAsync(
        NpgsqlConnection connection, string name, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            "SELECT COALESCE((SELECT setting::int FROM pg_settings WHERE name = @name), 0)", connection);
        command.Parameters.AddWithValue("name", name);
        var result = await command.ExecuteScalarAsync(cancellationToken);
        return result is int value ? value : 0;
    }
}
