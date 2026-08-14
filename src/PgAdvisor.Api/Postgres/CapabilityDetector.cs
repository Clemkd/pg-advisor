using Npgsql;

namespace PgAdvisor.Api.Postgres;

/// <summary>
/// Détecte ce qui est réellement exploitable sur une instance, sans rien y installer.
/// Une capacité absente n'est pas une erreur : elle désactive les règles qui en dépendent.
/// </summary>
public sealed class CapabilityDetector(ILogger<CapabilityDetector> logger)
{
    /// <summary>Vues et relations système interrogées par les règles fournies.</summary>
    public static readonly string[] CandidateViews =
    [
        "pg_stat_activity",
        "pg_stat_database",
        "pg_stat_database_conflicts",
        "pg_stat_user_tables",
        "pg_stat_user_indexes",
        "pg_stat_all_tables",
        "pg_stat_all_indexes",
        "pg_stat_bgwriter",
        "pg_stat_checkpointer",
        "pg_stat_replication",
        "pg_stat_wal",
        "pg_stat_io",
        "pg_stats",
        "pg_prepared_xacts",
        "pg_hba_file_rules",
        "pg_statio_user_tables",
        "pg_statio_user_indexes",
        "pg_locks",
        "pg_settings",
        "pg_class",
        "pg_index",
        "pg_constraint",
        "pg_roles",
        "pg_tablespace",
        "pg_stat_statements",
        "pg_stat_progress_vacuum",
        "information_schema.tables",
        "information_schema.columns",
        "timescaledb_information.hypertables",
        "timescaledb_information.chunks",
        "timescaledb_information.jobs",
        "timescaledb_information.job_stats",
        "timescaledb_information.compression_settings",
        "timescaledb_information.continuous_aggregates",
    ];

    /// <summary>Extensions dont la présence ou l'absence est signalée dans le dashboard.</summary>
    public static readonly string[] NotableExtensions =
    [
        "pg_stat_statements",
        "timescaledb",
        "hypopg",
        "pg_buffercache",
        "pgstattuple",
        "pg_trgm",
        "pg_prewarm",
        "auto_explain",
        "postgis",
    ];

    public async Task<PgCapabilities> DetectAsync(NpgsqlConnection connection, CancellationToken cancellationToken)
    {
        var identity = await ReadIdentityAsync(connection, cancellationToken);
        var extensions = await ReadInstalledExtensionsAsync(connection, cancellationToken);
        var available = await ReadAvailableExtensionsAsync(connection, cancellationToken);
        var views = await ReadReadableViewsAsync(connection, cancellationToken);

        return new PgCapabilities
        {
            ServerVersion = identity.Version,
            ServerVersionNum = identity.VersionNum,
            InRecovery = identity.InRecovery,
            CurrentUser = identity.User,
            IsSuperuser = identity.IsSuperuser,
            HasPgMonitor = identity.HasPgMonitor,
            Extensions = extensions,
            AvailableExtensions = available,
            Views = views,
            DetectedAt = DateTimeOffset.UtcNow,
        };
    }

    private static async Task<(string Version, int VersionNum, bool InRecovery, string User, bool IsSuperuser, bool HasPgMonitor)>
        ReadIdentityAsync(NpgsqlConnection connection, CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT
              current_setting('server_version')                       AS version,
              current_setting('server_version_num')::int              AS version_num,
              pg_is_in_recovery()                                     AS in_recovery,
              current_user                                            AS current_user_name,
              COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false) AS is_superuser,
              COALESCE((
                SELECT pg_has_role(current_user, 'pg_monitor', 'member')
                WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pg_monitor')
              ), false)                                               AS has_pg_monitor
            """;

        await using var command = new NpgsqlCommand(sql, connection);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            throw new InvalidOperationException("The instance returned no identity information.");
        }

        return (
            reader.GetString(0),
            reader.GetInt32(1),
            reader.GetBoolean(2),
            reader.GetString(3),
            reader.GetBoolean(4),
            reader.GetBoolean(5));
    }

    private static async Task<Dictionary<string, string>> ReadInstalledExtensionsAsync(
        NpgsqlConnection connection, CancellationToken cancellationToken)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        await using var command = new NpgsqlCommand(
            "SELECT extname, extversion FROM pg_extension ORDER BY extname", connection);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result[reader.GetString(0)] = reader.IsDBNull(1) ? string.Empty : reader.GetString(1);
        }

        return result;
    }

    private async Task<List<string>> ReadAvailableExtensionsAsync(
        NpgsqlConnection connection, CancellationToken cancellationToken)
    {
        var result = new List<string>();

        try
        {
            await using var command = new NpgsqlCommand(
                """
                SELECT name FROM pg_available_extensions
                WHERE installed_version IS NULL
                ORDER BY name
                """, connection);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                result.Add(reader.GetString(0));
            }
        }
        catch (PostgresException ex)
        {
            // Certaines offres managées restreignent cette vue : information simplement absente.
            logger.LogDebug(ex, "pg_available_extensions is not accessible; the installable extension list is skipped.");
        }

        return result;
    }

    /// <summary>
    /// Une vue n'est retenue que si elle existe ET que l'utilisateur courant a le droit de la lire :
    /// une règle ne doit jamais échouer sur un « permission denied » évitable.
    /// </summary>
    private static async Task<HashSet<string>> ReadReadableViewsAsync(
        NpgsqlConnection connection, CancellationToken cancellationToken)
    {
        var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        const string sql = """
            SELECT candidate
            FROM unnest(@names::text[]) AS candidate
            WHERE to_regclass(candidate) IS NOT NULL
              AND has_table_privilege(to_regclass(candidate), 'SELECT')
            """;

        await using var command = new NpgsqlCommand(sql, connection);
        command.Parameters.AddWithValue("names", CandidateViews);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var name = reader.GetString(0);
            result.Add(name);

            // Une règle peut référencer indifféremment le nom court ou le nom qualifié.
            var separator = name.IndexOf('.');
            if (separator > 0)
            {
                result.Add(name[(separator + 1)..]);
            }
        }

        return result;
    }
}
