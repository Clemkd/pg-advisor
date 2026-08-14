using Npgsql;

namespace PgAdvisor.Api.Rules.Handlers;

/// <summary>
/// Détecte les index redondants : un index dont la liste de colonnes est un préfixe de celle
/// d'un autre index de la même table est couvert par ce dernier. La comparaison croisée entre
/// lignes se prête mal au « SQL + condition » déclaratif, d'où un handler.
/// </summary>
public sealed class RedundantIndexHandler : IRuleHandler
{
    public string Name => "indexes.redundant";

    public string Description =>
        "Indexes covered by another index on the same table (columns: schemaname, tablename, " +
        "indexname, covering_index, index_bytes, columns).";

    private const string Sql = """
        SELECT
          n.nspname                                AS schemaname,
          t.relname                                AS tablename,
          i.relname                                AS indexname,
          ix.indkey::text                          AS indkey,
          ix.indisunique                           AS is_unique,
          ix.indisprimary                          AS is_primary,
          ix.indpred IS NOT NULL                   AS is_partial,
          COALESCE(ix.indpred::text, '')           AS predicate,
          am.amname                                AS access_method,
          pg_relation_size(i.oid)                  AS index_bytes,
          COALESCE(s.idx_scan, 0)                  AS idx_scan
        FROM pg_index ix
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_class t ON t.oid = ix.indrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN pg_am am ON am.oid = i.relam
        LEFT JOIN pg_stat_all_indexes s ON s.indexrelid = ix.indexrelid
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
          AND ix.indisvalid
        """;

    public async Task<IReadOnlyList<RuleRow>> ExecuteAsync(
        RuleHandlerContext context, CancellationToken cancellationToken)
    {
        var indexes = new List<IndexInfo>();

        await using var command = new NpgsqlCommand(Sql, context.Connection);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            indexes.Add(new IndexInfo(
                Schema: reader.GetString(0),
                Table: reader.GetString(1),
                Index: reader.GetString(2),
                Columns: reader.GetString(3).Split(' ', StringSplitOptions.RemoveEmptyEntries),
                IsUnique: reader.GetBoolean(4),
                IsPrimary: reader.GetBoolean(5),
                IsPartial: reader.GetBoolean(6),
                Predicate: reader.GetString(7),
                AccessMethod: reader.GetString(8),
                SizeBytes: reader.GetInt64(9),
                Scans: reader.GetInt64(10)));
        }

        var rows = new List<RuleRow>();

        // Le regroupement par table, méthode d'accès et prédicat garantit que seuls des index
        // réellement interchangeables sont comparés.
        foreach (var group in indexes.GroupBy(i => (i.Schema, i.Table, i.AccessMethod, i.Predicate)))
        {
            var candidates = group.ToList();

            foreach (var candidate in candidates)
            {
                // Un index unique ou de clé primaire porte une contrainte : il n'est pas supprimable.
                if (candidate.IsUnique || candidate.IsPrimary || candidate.Columns.Length == 0)
                {
                    continue;
                }

                var covering = candidates.FirstOrDefault(other =>
                    !ReferenceEquals(other, candidate) &&
                    other.Columns.Length > candidate.Columns.Length &&
                    IsPrefix(candidate.Columns, other.Columns));

                if (covering is null)
                {
                    continue;
                }

                rows.Add(new RuleRow
                {
                    ["schemaname"] = candidate.Schema,
                    ["tablename"] = candidate.Table,
                    ["indexname"] = candidate.Index,
                    ["covering_index"] = covering.Index,
                    ["index_bytes"] = candidate.SizeBytes,
                    ["idx_scan"] = candidate.Scans,
                    ["columns"] = candidate.Columns.Length,
                    ["access_method"] = candidate.AccessMethod,
                    ["is_partial"] = candidate.IsPartial,
                });
            }
        }

        return rows;
    }

    private static bool IsPrefix(string[] shorter, string[] longer)
    {
        for (var i = 0; i < shorter.Length; i++)
        {
            if (shorter[i] != longer[i])
            {
                return false;
            }
        }

        return true;
    }

    private sealed record IndexInfo(
        string Schema,
        string Table,
        string Index,
        string[] Columns,
        bool IsUnique,
        bool IsPrimary,
        bool IsPartial,
        string Predicate,
        string AccessMethod,
        long SizeBytes,
        long Scans);
}
