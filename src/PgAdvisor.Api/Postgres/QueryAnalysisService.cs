using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;
using Npgsql;
using PgAdvisor.Api.Data;
using PgAdvisor.Api.Rules;

namespace PgAdvisor.Api.Postgres;

public sealed record TopQuery
{
    /// <summary>Instance d'où vient la requête : un classement peut en agréger plusieurs.</summary>
    public int ConnectionId { get; init; }

    public string ConnectionName { get; init; } = string.Empty;

    public string QueryId { get; init; } = string.Empty;
    public string Query { get; init; } = string.Empty;
    public long Calls { get; init; }
    public double TotalExecMs { get; init; }
    public double MeanExecMs { get; init; }
    public double MinExecMs { get; init; }
    public double MaxExecMs { get; init; }
    public double StddevExecMs { get; init; }
    public long Rows { get; init; }
    public double RowsPerCall { get; init; }
    public long SharedBlksHit { get; init; }
    public long SharedBlksRead { get; init; }
    public long SharedBlksWritten { get; init; }
    public double? CacheHitRatio { get; init; }
    public long TempBlksWritten { get; init; }

    /// <summary>Part du temps d'exécution cumulé de la base, 0 à 1.</summary>
    public double ShareOfTotal { get; init; }

    /// <summary>Vrai si le texte contient des paramètres $1 : EXPLAIN a alors besoin d'un plan générique.</summary>
    public bool HasParameters { get; init; }

    /// <summary>
    /// Requête exécutée par l'Advisor lui-même — règles, collecteurs, analyses — reconnue au
    /// rôle qui l'a lancée. Sans distinction, la supervision finirait par occuper son propre
    /// classement.
    /// </summary>
    public bool FromAdvisor { get; init; }
}

public sealed record QueryAnalysisResult
{
    public string Sql { get; init; } = string.Empty;
    public string PlanText { get; init; } = string.Empty;
    public string PlanJson { get; init; } = string.Empty;
    public ExplainPlan Plan { get; init; } = new();
    public IReadOnlyList<string> Notes { get; init; } = [];
}

/// <summary>
/// Levée lorsqu'une requête normalisée réclame des valeurs de paramètres. Le contrôleur la
/// traduit en réponse exploitable par l'interface, qui demande alors les valeurs manquantes.
/// </summary>
public sealed class MissingQueryParametersException(int required, int supplied)
    : Exception($"This query expects {required} parameter value(s); {supplied} supplied.")
{
    public int Required { get; } = required;
    public int Supplied { get; } = supplied;
}

/// <summary>
/// Analyse de requêtes à la demande. Deux garde-fous permanents : la session est en lecture
/// seule et l'exécution se fait dans une transaction annulée, si bien qu'un EXPLAIN ANALYZE ne
/// peut rien laisser derrière lui sur l'instance supervisée.
/// </summary>
public sealed partial class QueryAnalysisService(
    PgConnectionFactory factory,
    IOptions<AdvisorOptions> options,
    ILogger<QueryAnalysisService> logger)
{
    private readonly SchedulerOptions _scheduler = options.Value.Scheduler;

    [GeneratedRegex(@"\$\d+")]
    private static partial Regex ParameterPattern { get; }

    public static readonly string[] SortKeys =
        ["total_time", "mean_time", "calls", "rows", "io", "temp"];

    /// <summary>
    /// Valeur du critère de tri pour une requête. Chaque instance trie déjà côté serveur ;
    /// fusionner plusieurs classements demande de rejouer le même critère en mémoire, avec
    /// exactement la même définition — sans quoi le classement global serait faux.
    /// </summary>
    public static double SortScore(TopQuery query, string sortKey) => sortKey switch
    {
        "mean_time" => query.MeanExecMs,
        "calls" => query.Calls,
        "rows" => query.Rows,
        "io" => query.SharedBlksRead + query.SharedBlksWritten,
        "temp" => query.TempBlksWritten,
        _ => query.TotalExecMs,
    };

    public async Task<IReadOnlyList<TopQuery>> TopQueriesAsync(
        PostgresConnection connection,
        string sortKey,
        int limit,
        string? search,
        CancellationToken cancellationToken,
        bool includeAdvisor = true)
    {
        var orderBy = sortKey switch
        {
            "mean_time" => "s.mean_exec_time DESC",
            "calls" => "s.calls DESC",
            "rows" => "s.rows DESC",
            "io" => "(s.shared_blks_read + s.shared_blks_written) DESC",
            "temp" => "s.temp_blks_written DESC",
            _ => "s.total_exec_time DESC",
        };

        // Le rôle de supervision est celui de la session : ses propres requêtes se reconnaissent
        // donc à leur `userid`, sans avoir à marquer chaque instruction.
        var advisorFilter = includeAdvisor
            ? string.Empty
            : "AND s.userid <> (SELECT oid FROM pg_roles WHERE rolname = current_user)";

        var sql = $"""
            WITH total AS (
              SELECT NULLIF(SUM(total_exec_time), 0) AS cumul
              FROM pg_stat_statements
              WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
            )
            SELECT
              s.queryid::text,
              s.query,
              s.calls,
              s.total_exec_time,
              s.mean_exec_time,
              s.min_exec_time,
              s.max_exec_time,
              s.stddev_exec_time,
              s.rows,
              s.shared_blks_hit,
              s.shared_blks_read,
              s.temp_blks_written,
              s.total_exec_time / t.cumul AS share,
              s.userid = (SELECT oid FROM pg_roles WHERE rolname = current_user) AS from_advisor,
              s.shared_blks_written
            FROM pg_stat_statements s
            CROSS JOIN total t
            WHERE s.dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
              -- Cast explicite : sans lui, PostgreSQL ne peut pas typer un paramètre NULL.
              AND (@search::text IS NULL OR s.query ILIKE '%' || @search::text || '%')
              {advisorFilter}
            ORDER BY {orderBy}
            LIMIT @limit
            """;

        await using var pg = await factory.OpenAsync(connection, cancellationToken);
        await using var command = new NpgsqlCommand(sql, pg);
        command.Parameters.AddWithValue("search", (object?)search ?? DBNull.Value);
        command.Parameters.AddWithValue("limit", Math.Clamp(limit, 1, 200));

        var results = new List<TopQuery>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        while (await reader.ReadAsync(cancellationToken))
        {
            var query = reader.GetString(1);
            var calls = reader.GetInt64(2);
            var hit = reader.GetInt64(9);
            var read = reader.GetInt64(10);

            results.Add(new TopQuery
            {
                ConnectionId = connection.Id,
                ConnectionName = connection.Name,
                QueryId = reader.GetString(0),
                Query = query,
                Calls = calls,
                TotalExecMs = reader.GetDouble(3),
                MeanExecMs = reader.GetDouble(4),
                MinExecMs = reader.GetDouble(5),
                MaxExecMs = reader.GetDouble(6),
                StddevExecMs = reader.GetDouble(7),
                Rows = reader.GetInt64(8),
                RowsPerCall = calls > 0 ? reader.GetInt64(8) / (double)calls : 0,
                SharedBlksHit = hit,
                SharedBlksRead = read,
                CacheHitRatio = hit + read > 0 ? hit / (double)(hit + read) : null,
                TempBlksWritten = reader.GetInt64(11),
                ShareOfTotal = await reader.IsDBNullAsync(12, cancellationToken) ? 0 : reader.GetDouble(12),
                HasParameters = ParameterPattern.IsMatch(query),
                FromAdvisor = !await reader.IsDBNullAsync(13, cancellationToken) && reader.GetBoolean(13),
                SharedBlksWritten = reader.GetInt64(14),
            });
        }

        return results;
    }

    /// <summary>
    /// Produit le plan mesuré d'une requête, en texte et en JSON. La requête est réellement
    /// exécutée — seul EXPLAIN ANALYZE donne des temps et des lignes réels — ce qui réserve
    /// l'analyse à une demande explicite de l'opérateur.
    /// </summary>
    public async Task<QueryAnalysisResult> ExplainAsync(
        PostgresConnection connection,
        string sql,
        bool buffers,
        IReadOnlyList<string>? parameters,
        CancellationToken cancellationToken)
    {
        var trimmed = sql.Trim().TrimEnd(';');
        var notes = new List<string>();

        // Une requête déjà préfixée d'EXPLAIN ne peut pas être imbriquée dans un second EXPLAIN.
        // Le cas se produit dès qu'on analyse une entrée de pg_stat_statements issue d'un
        // EXPLAIN, ou qu'un opérateur colle une requête copiée depuis psql.
        var withoutExplain = StripExplainPrefix(trimmed);
        if (!ReferenceEquals(withoutExplain, trimmed))
        {
            trimmed = withoutExplain;
            notes.Add("The EXPLAIN prefix was removed from the query before analysis.");
        }

        // Les textes de pg_stat_statements sont normalisés : leurs littéraux sont remplacés par
        // $1, $2… Le protocole étendu de Npgsql lie ces marqueurs, ce qui empêche à la fois
        // l'exécution et le plan générique. On les remplace donc par les valeurs fournies, ce
        // qui produit en prime un plan fidèle aux statistiques de distribution.
        var placeholders = PlaceholderCount(trimmed);
        if (placeholders > 0)
        {
            var supplied = parameters?.Where(p => p is not null).ToList() ?? [];

            if (supplied.Count < placeholders)
            {
                throw new MissingQueryParametersException(placeholders, supplied.Count);
            }

            trimmed = SubstituteParameters(trimmed, supplied);
            notes.Add(
                $"{placeholders} parameter(s) replaced with the supplied values: the plan depends on those values " +
                "and may differ for others.");
        }

        if (!SqlGuard.Validate(trimmed, out var guardError))
        {
            throw new InvalidOperationException(
                $"Query rejected: {guardError} Analysis is limited to read-only queries.");
        }

        await using var pg = await factory.OpenAsync(connection, cancellationToken);

        notes.Add(
            "The query was actually executed to measure timings. The transaction is rolled back " +
            "and the session is read-only: no write is possible.");

        var textPlan = await RunExplainAsync(pg, trimmed, buffers, "TEXT", cancellationToken);
        var jsonPlan = await RunExplainAsync(pg, trimmed, buffers, "JSON", cancellationToken);

        ExplainPlan parsed;
        try
        {
            parsed = ExplainPlanParser.Parse(jsonPlan);
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException)
        {
            // Un plan illisible ne doit pas priver l'opérateur de la vue texte.
            logger.LogWarning(ex, "Unreadable JSON plan for instance {Instance}.", connection.Name);
            parsed = new ExplainPlan();
            notes.Add("The JSON plan could not be parsed; only the text view is available.");
        }

        return new QueryAnalysisResult
        {
            Sql = trimmed,
            PlanText = textPlan,
            PlanJson = jsonPlan,
            Plan = parsed,
            Notes = notes,
        };
    }

    /// <summary>
    /// Retire un éventuel « EXPLAIN (…) » de tête, options comprises. Retourne la chaîne
    /// d'origine si la requête n'en comporte pas.
    /// </summary>
    public static string StripExplainPrefix(string sql)
    {
        var span = sql.AsSpan().TrimStart();
        if (!span.StartsWith("EXPLAIN", StringComparison.OrdinalIgnoreCase))
        {
            return sql;
        }

        var rest = span[7..].TrimStart();

        // Forme parenthésée : EXPLAIN (ANALYZE, BUFFERS) SELECT …
        if (rest.StartsWith("("))
        {
            var depth = 0;
            for (var index = 0; index < rest.Length; index++)
            {
                if (rest[index] == '(')
                {
                    depth++;
                }
                else if (rest[index] == ')')
                {
                    depth--;
                    if (depth == 0)
                    {
                        return rest[(index + 1)..].Trim().ToString();
                    }
                }
            }

            return sql;
        }

        // Forme héritée : EXPLAIN ANALYZE VERBOSE SELECT …
        foreach (var keyword in (string[])["ANALYZE", "VERBOSE", "COSTS", "BUFFERS"])
        {
            while (rest.StartsWith(keyword, StringComparison.OrdinalIgnoreCase))
            {
                rest = rest[keyword.Length..].TrimStart();
            }
        }

        return rest.Trim().ToString();
    }

    /// <summary>Nombre de marqueurs distincts $1, $2… présents dans la requête.</summary>
    public static int PlaceholderCount(string sql) => ParameterPattern
        .Matches(sql)
        .Select(match => int.Parse(match.Value[1..]))
        .DefaultIfEmpty(0)
        .Max();

    /// <summary>
    /// Remplace $1, $2… par les valeurs fournies. Un nombre reste tel quel, tout le reste est
    /// écrit comme littéral texte échappé — la requête part ensuite dans un EXPLAIN, sur une
    /// session en lecture seule.
    /// </summary>
    private static string SubstituteParameters(string sql, IReadOnlyList<string> values)
    {
        // Décroissant : sans cela, $1 remplacerait le début de $12.
        for (var index = values.Count; index >= 1; index--)
        {
            var raw = values[index - 1].Trim();
            var literal = FormatLiteral(raw);
            sql = sql.Replace($"${index}", literal, StringComparison.Ordinal);
        }

        return sql;
    }

    private static string FormatLiteral(string value)
    {
        if (value.Length == 0)
        {
            return "NULL";
        }

        if (string.Equals(value, "null", StringComparison.OrdinalIgnoreCase))
        {
            return "NULL";
        }

        if (bool.TryParse(value, out var boolean))
        {
            return boolean ? "true" : "false";
        }

        if (double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out _))
        {
            return value;
        }

        // Valeur déjà écrite comme littéral SQL par l'opérateur : on la respecte.
        if (value.StartsWith('\'') && value.EndsWith('\'') && value.Length > 1)
        {
            return value;
        }

        return "'" + value.Replace("'", "''", StringComparison.Ordinal) + "'";
    }

    private async Task<string> RunExplainAsync(
        NpgsqlConnection pg,
        string sql,
        bool buffers,
        string format,
        CancellationToken cancellationToken)
    {
        var flags = new List<string> { $"FORMAT {format}", "ANALYZE", "VERBOSE", "COSTS" };

        if (buffers)
        {
            flags.Add("BUFFERS");
        }

        if (pg.PostgreSqlVersion.Major >= 12)
        {
            flags.Add("SETTINGS");
        }

        var statement = $"EXPLAIN ({string.Join(", ", flags)}) {sql}";

        // Transaction explicite annulée : même un EXPLAIN ANALYZE ne laisse aucune trace.
        await using var transaction = await pg.BeginTransactionAsync(cancellationToken);

        try
        {
            await using var command = new NpgsqlCommand(statement, pg, transaction)
            {
                CommandTimeout = (int)_scheduler.QueryTimeout.TotalSeconds,
            };

            await using var reader = await command.ExecuteReaderAsync(cancellationToken);

            var lines = new List<string>();
            while (await reader.ReadAsync(cancellationToken))
            {
                lines.Add(reader.GetString(0));
            }

            await SafeRollbackAsync(transaction, cancellationToken);
            return string.Join('\n', lines);
        }
        catch
        {
            // L'annulation ne doit jamais masquer l'erreur d'origine, seule utile à l'opérateur.
            await SafeRollbackAsync(transaction, cancellationToken);
            throw;
        }
    }

    private async Task SafeRollbackAsync(NpgsqlTransaction transaction, CancellationToken cancellationToken)
    {
        try
        {
            await transaction.RollbackAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            // Transaction déjà terminée ou connexion perdue : sans conséquence, la connexion
            // est de toute façon fermée juste après.
            logger.LogDebug(ex, "Rolling back the analysis transaction had no effect.");
        }
    }
}
