using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;
using Npgsql;
using PgAdvisor.Api.Data;

namespace PgAdvisor.Api.Postgres;

/// <summary>Valeur proposée pour un paramètre d'une requête normalisée.</summary>
public sealed record ParameterSuggestion
{
    /// <summary>Numéro du paramètre : 1 pour $1.</summary>
    public int Index { get; init; }

    /// <summary>Colonne à laquelle le paramètre est comparé, telle qu'écrite dans la requête.</summary>
    public string? Column { get; init; }

    /// <summary>Relation qualifiée résolue pour cette colonne.</summary>
    public string? Relation { get; init; }

    /// <summary>Valeur proposée, ou null si rien n'a pu être trouvé.</summary>
    public string? Value { get; init; }

    /// <summary>« statistics » (valeur la plus fréquente) ou « sample » (première ligne lue).</summary>
    public string? Source { get; init; }
}

/// <summary>
/// Propose des valeurs plausibles pour les paramètres $1, $2… d'une requête normalisée par
/// pg_stat_statements, à partir de ce que contient réellement la base.
///
/// La valeur est cherchée d'abord dans les statistiques du planificateur — `pg_stats` connaît
/// les valeurs les plus fréquentes de chaque colonne sans lire une seule ligne — et seulement
/// à défaut par une lecture d'une ligne. Un plan obtenu sur une valeur courante ressemble à
/// celui de la production, ce qu'une valeur inventée ne garantit pas.
/// </summary>
public sealed partial class QueryParameterSuggester(
    PgConnectionFactory factory,
    IOptions<AdvisorOptions> options,
    ILogger<QueryParameterSuggester> logger)
{
    private readonly SchedulerOptions _scheduler = options.Value.Scheduler;

    /// <summary>« colonne op $n », la forme qui relie un paramètre à une colonne.</summary>
    [GeneratedRegex(
        @"(?<column>[A-Za-z_][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_$]*)?)\s*(?:=|<>|!=|<=|>=|<|>|(?i:like|ilike|in))\s*\(?\s*\$(?<index>\d+)",
        RegexOptions.None)]
    private static partial Regex ComparisonPattern { get; }

    /// <summary>Relations citées par la requête, avec leur éventuel alias.</summary>
    [GeneratedRegex(
        @"(?i:from|join|update|into)\s+(?<relation>[A-Za-z_][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_$]*)?)(?:\s+(?:(?i:as)\s+)?(?<alias>(?!(?i:on|where|group|order|limit|offset|having|join|inner|left|right|full|cross|natural|using|set|values|returning|window|fetch|for|union|except|intersect|and|or)\b)[A-Za-z_][A-Za-z0-9_$]*))?",
        RegexOptions.None)]
    private static partial Regex RelationPattern { get; }

    public async Task<IReadOnlyList<ParameterSuggestion>> SuggestAsync(
        PostgresConnection connection,
        string sql,
        CancellationToken cancellationToken)
    {
        var placeholders = QueryAnalysisService.PlaceholderCount(sql);
        if (placeholders == 0)
        {
            return [];
        }

        var sources = ReadRelations(sql);
        var byIndex = ReadComparisons(sql);

        await using var pg = await factory.OpenAsync(connection, cancellationToken);

        var suggestions = new List<ParameterSuggestion>(placeholders);

        for (var index = 1; index <= placeholders; index++)
        {
            if (!byIndex.TryGetValue(index, out var reference))
            {
                suggestions.Add(new ParameterSuggestion { Index = index });
                continue;
            }

            var (qualifier, column) = reference;
            var resolved = await ResolveColumnAsync(pg, sources, qualifier, column, cancellationToken);

            if (resolved is null)
            {
                suggestions.Add(new ParameterSuggestion
                {
                    Index = index,
                    Column = qualifier is null ? column : $"{qualifier}.{column}",
                });
                continue;
            }

            var (schema, table) = resolved.Value;
            var (value, source) = await SampleAsync(pg, schema, table, column, cancellationToken);

            suggestions.Add(new ParameterSuggestion
            {
                Index = index,
                Column = qualifier is null ? column : $"{qualifier}.{column}",
                Relation = $"{schema}.{table}",
                Value = value,
                Source = value is null ? null : source,
            });
        }

        return suggestions;
    }

    /// <summary>Associe chaque paramètre à la colonne qui lui est comparée.</summary>
    public static Dictionary<int, (string? Qualifier, string Column)> ReadComparisons(string sql)
    {
        var byIndex = new Dictionary<int, (string?, string)>();

        foreach (Match match in ComparisonPattern.Matches(sql))
        {
            var index = int.Parse(match.Groups["index"].Value);
            if (byIndex.ContainsKey(index))
            {
                continue;
            }

            var parts = match.Groups["column"].Value.Split('.');
            byIndex[index] = parts.Length == 2 ? (parts[0], parts[1]) : (null, parts[0]);
        }

        return byIndex;
    }

    /// <summary>Relations citées par la requête, avec leur éventuel alias, dans l'ordre.</summary>
    public static List<(string? Schema, string Table, string? Alias)> ReadRelations(string sql)
    {
        var relations = new List<(string?, string, string?)>();

        foreach (Match match in RelationPattern.Matches(sql))
        {
            var parts = match.Groups["relation"].Value.Split('.');
            var alias = match.Groups["alias"].Success ? match.Groups["alias"].Value : null;

            relations.Add(parts.Length == 2 ? (parts[0], parts[1], alias) : (null, parts[0], alias));
        }

        return relations;
    }

    /// <summary>
    /// Trouve la relation qui porte réellement la colonne. Le qualificatif de la requête est un
    /// alias : seul le catalogue dit quelle table possède la colonne, et c'est aussi lui qui
    /// valide les identifiants avant qu'ils ne servent à construire une requête.
    /// </summary>
    private async Task<(string Schema, string Table)?> ResolveColumnAsync(
        NpgsqlConnection pg,
        List<(string? Schema, string Table, string? Alias)> relations,
        string? qualifier,
        string column,
        CancellationToken cancellationToken)
    {
        var candidates = qualifier is null
            ? relations
            : relations
                .Where(r =>
                    string.Equals(r.Alias, qualifier, StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(r.Table, qualifier, StringComparison.OrdinalIgnoreCase))
                .ToList();

        foreach (var (schema, table, _) in candidates.Count > 0 ? candidates : relations)
        {
            const string sql = """
                SELECT c.table_schema, c.table_name
                FROM information_schema.columns c
                WHERE c.table_name = @table
                  AND c.column_name = @column
                  AND (@schema::text IS NULL OR c.table_schema = @schema::text)
                  AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
                ORDER BY (c.table_schema = ANY (current_schemas(false))) DESC
                LIMIT 1
                """;

            await using var command = new NpgsqlCommand(sql, pg)
            {
                CommandTimeout = (int)_scheduler.QueryTimeout.TotalSeconds,
            };
            command.Parameters.AddWithValue("table", table);
            command.Parameters.AddWithValue("column", column);
            command.Parameters.AddWithValue("schema", (object?)schema ?? DBNull.Value);

            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            if (await reader.ReadAsync(cancellationToken))
            {
                return (reader.GetString(0), reader.GetString(1));
            }
        }

        return null;
    }

    /// <summary>
    /// Valeur la plus fréquente d'après les statistiques ; à défaut, la première valeur non nulle
    /// rencontrée. Les deux lectures restent bornées par le délai des règles.
    /// </summary>
    private async Task<(string? Value, string Source)> SampleAsync(
        NpgsqlConnection pg,
        string schema,
        string table,
        string column,
        CancellationToken cancellationToken)
    {
        try
        {
            const string statistics = """
                SELECT (most_common_vals::text::text[])[1]
                FROM pg_stats
                WHERE schemaname = @schema AND tablename = @table AND attname = @column
                  AND most_common_vals IS NOT NULL
                """;

            await using var command = new NpgsqlCommand(statistics, pg)
            {
                CommandTimeout = (int)_scheduler.QueryTimeout.TotalSeconds,
            };
            command.Parameters.AddWithValue("schema", schema);
            command.Parameters.AddWithValue("table", table);
            command.Parameters.AddWithValue("column", column);

            if (await command.ExecuteScalarAsync(cancellationToken) is string frequent)
            {
                return (frequent, "statistics");
            }

            // Identifiants issus du catalogue, échappés malgré tout : une relation peut porter
            // un nom qui a besoin de guillemets.
            var sample = $"""
                SELECT {Quote(column)}::text
                FROM {Quote(schema)}.{Quote(table)}
                WHERE {Quote(column)} IS NOT NULL
                LIMIT 1
                """;

            await using var fallback = new NpgsqlCommand(sample, pg)
            {
                CommandTimeout = (int)_scheduler.QueryTimeout.TotalSeconds,
            };

            return (await fallback.ExecuteScalarAsync(cancellationToken) as string, "sample");
        }
        catch (PostgresException ex)
        {
            // Droits manquants ou type sans représentation textuelle : l'opérateur saisira la
            // valeur lui-même, ce n'est pas une raison d'échouer sur toute la requête.
            logger.LogDebug(ex, "No value can be suggested for {Schema}.{Table}.{Column}.", schema, table, column);
            return (null, "statistics");
        }
    }

    private static string Quote(string identifier) =>
        '"' + identifier.Replace("\"", "\"\"", StringComparison.Ordinal) + '"';
}
