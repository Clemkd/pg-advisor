using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Npgsql;
using PgAdvisor.Api.Data;
using PgAdvisor.Api.Postgres;
using PgAdvisor.Api.Rules.Expressions;
using PgAdvisor.Api.Rules.Handlers;

namespace PgAdvisor.Api.Rules;

/// <summary>Finding produit par une exécution, avant confrontation à l'état persisté.</summary>
public sealed record FindingCandidate
{
    public required string RuleId { get; init; }
    public required int RuleVersion { get; init; }
    public required string TargetKey { get; init; }
    public required string Category { get; init; }
    public required string Severity { get; init; }
    public required string Title { get; init; }
    public required string Message { get; init; }
    public string? Impact { get; init; }
    public string? Confidence { get; init; }
    public string? RemediationSql { get; init; }
    public string? Documentation { get; init; }
    public Dictionary<string, object?> Evidence { get; init; } = [];
}

public sealed record RuleExecutionResult
{
    public required string RuleId { get; init; }
    public bool Executed { get; init; }

    /// <summary>Renseigné quand la règle a été écartée (capability manquante, règle désactivée).</summary>
    public string? SkipReason { get; init; }

    public string? Error { get; init; }
    public int RowCount { get; init; }
    public IReadOnlyList<FindingCandidate> Findings { get; init; } = [];
    public TimeSpan Duration { get; init; }

    /// <summary>Lignes brutes, uniquement renseignées en mode aperçu depuis l'IHM.</summary>
    public IReadOnlyList<Dictionary<string, object?>> Rows { get; init; } = [];
}

/// <summary>
/// Exécute une règle contre une instance : YAML → prérequis → SQL → condition → finding.
/// Aucune écriture n'est possible, la session PostgreSQL étant forcée en lecture seule.
/// </summary>
public sealed class RuleEngine(RuleHandlerRegistry handlers, ILogger<RuleEngine> logger)
{
    private const int DefaultLimit = 100;

    public async Task<RuleExecutionResult> ExecuteAsync(
        EffectiveRule effective,
        NpgsqlConnection connection,
        PgCapabilities capabilities,
        PostgresConnection instance,
        CancellationToken cancellationToken,
        bool includeRows = false)
    {
        var rule = effective.Rule;
        var stopwatch = Stopwatch.StartNew();

        if (!effective.Enabled)
        {
            return new RuleExecutionResult { RuleId = rule.Id, SkipReason = "Règle désactivée." };
        }

        var applicability = rule.EvaluateApplicability(capabilities);
        if (!applicability.IsApplicable)
        {
            return new RuleExecutionResult { RuleId = rule.Id, SkipReason = applicability.Reason };
        }

        IReadOnlyList<RuleRow> rows;
        try
        {
            rows = await FetchRowsAsync(effective, connection, capabilities, instance, cancellationToken);
        }
        catch (Exception ex) when (ex is PostgresException or NpgsqlException or TimeoutException or InvalidOperationException)
        {
            logger.LogWarning("Règle {RuleId} en échec sur l'instance {Instance} : {Message}",
                rule.Id, instance.Name, ex.Message);

            return new RuleExecutionResult
            {
                RuleId = rule.Id,
                Error = ex.Message,
                Duration = stopwatch.Elapsed,
            };
        }

        var limit = Math.Clamp(rule.Definition.Limit ?? DefaultLimit, 1, 1_000);
        var candidates = new List<FindingCandidate>();
        var truncated = false;

        foreach (var row in rows)
        {
            var variables = BuildVariables(effective, row);

            try
            {
                if (rule.Condition is not null && !ValueOps.ToBool(rule.Condition.Evaluate(variables)))
                {
                    continue;
                }
            }
            catch (ExpressionException ex)
            {
                // Erreur d'évaluation sur une ligne : la règle est signalée, pas silencieusement ignorée.
                return new RuleExecutionResult
                {
                    RuleId = rule.Id,
                    Error = $"Évaluation de la condition impossible : {ex.Message}",
                    RowCount = rows.Count,
                    Duration = stopwatch.Elapsed,
                };
            }

            if (candidates.Count >= limit)
            {
                truncated = true;
                break;
            }

            candidates.Add(BuildCandidate(effective, row, variables));
        }

        if (truncated)
        {
            logger.LogInformation(
                "Règle {RuleId} : {Limit} findings retenus sur l'instance {Instance}, résultats suivants ignorés (limit).",
                rule.Id, limit, instance.Name);
        }

        return new RuleExecutionResult
        {
            RuleId = rule.Id,
            Executed = true,
            RowCount = rows.Count,
            Findings = candidates,
            Duration = stopwatch.Elapsed,
            Rows = includeRows
                ? rows.Take(limit).Select(r => r.ToDictionary(p => p.Key, p => NormalizeForJson(p.Value))).ToList()
                : [],
        };
    }

    private async Task<IReadOnlyList<RuleRow>> FetchRowsAsync(
        EffectiveRule effective,
        NpgsqlConnection connection,
        PgCapabilities capabilities,
        PostgresConnection instance,
        CancellationToken cancellationToken)
    {
        var rule = effective.Rule;

        if (!string.IsNullOrWhiteSpace(rule.Definition.Handler))
        {
            var handler = handlers.Find(rule.Definition.Handler!)
                ?? throw new InvalidOperationException($"Handler « {rule.Definition.Handler} » introuvable.");

            var context = new RuleHandlerContext(effective, connection, capabilities, instance);
            return await handler.ExecuteAsync(context, cancellationToken);
        }

        if (string.IsNullOrWhiteSpace(rule.Definition.Query))
        {
            // Règle purement fondée sur les capabilities : une ligne, sans colonne.
            return [new RuleRow()];
        }

        return await ReadQueryAsync(effective, connection, cancellationToken);
    }

    private static async Task<List<RuleRow>> ReadQueryAsync(
        EffectiveRule effective, NpgsqlConnection connection, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(effective.Rule.Definition.Query, connection);

        // Seuls les seuils réellement référencés sont transmis : Npgsql rejette les paramètres orphelins.
        foreach (var parameter in effective.Parameters)
        {
            if (ReferencesParameter(effective.Rule.Definition.Query!, parameter.Key))
            {
                command.Parameters.AddWithValue(parameter.Key, parameter.Value ?? DBNull.Value);
            }
        }

        var rows = new List<RuleRow>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        while (await reader.ReadAsync(cancellationToken))
        {
            var row = new RuleRow();
            for (var i = 0; i < reader.FieldCount; i++)
            {
                var name = reader.GetName(i);
                if (string.IsNullOrEmpty(name))
                {
                    name = $"column{i + 1}";
                }

                row[name] = await reader.IsDBNullAsync(i, cancellationToken)
                    ? null
                    : reader.GetValue(i);
            }

            rows.Add(row);
        }

        return rows;
    }

    private static bool ReferencesParameter(string sql, string name)
    {
        var token = '@' + name;
        var index = sql.IndexOf(token, StringComparison.OrdinalIgnoreCase);

        while (index >= 0)
        {
            var after = index + token.Length;
            // « @seuil » ne doit pas être reconnu dans « @seuil_max ».
            if (after >= sql.Length || (!char.IsLetterOrDigit(sql[after]) && sql[after] != '_'))
            {
                return true;
            }

            index = sql.IndexOf(token, after, StringComparison.OrdinalIgnoreCase);
        }

        return false;
    }

    /// <summary>Contexte d'évaluation : les seuils d'abord, les colonnes ensuite — une colonne masque un seuil homonyme.</summary>
    private static Dictionary<string, object?> BuildVariables(EffectiveRule effective, RuleRow row)
    {
        var variables = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);

        foreach (var parameter in effective.Parameters)
        {
            variables[parameter.Key] = parameter.Value;
        }

        foreach (var column in row)
        {
            variables[column.Key] = column.Value;
        }

        return variables;
    }

    private static FindingCandidate BuildCandidate(
        EffectiveRule effective, RuleRow row, Dictionary<string, object?> variables)
    {
        var rule = effective.Rule;
        var recommendation = rule.Definition.Recommendation!;

        var evidenceColumns = recommendation.Evidence is { Count: > 0 }
            ? recommendation.Evidence
            : row.Keys.ToList();

        var evidence = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        foreach (var column in evidenceColumns)
        {
            if (row.TryGetValue(column, out var value))
            {
                evidence[column] = NormalizeForJson(value);
            }
        }

        return new FindingCandidate
        {
            RuleId = rule.Id,
            RuleVersion = rule.Definition.Version,
            TargetKey = BuildTargetKey(rule, row),
            Category = rule.Category,
            Severity = effective.Severity,
            Title = rule.TitleTemplate.Render(variables),
            Message = rule.MessageTemplate.Render(variables),
            Impact = recommendation.Impact?.ToLowerInvariant(),
            Confidence = recommendation.Confidence?.ToLowerInvariant(),
            RemediationSql = rule.SqlTemplate?.Render(variables),
            Documentation = recommendation.Documentation,
            Evidence = evidence,
        };
    }

    /// <summary>
    /// Identité stable d'un finding à l'intérieur d'une règle : sans clé, la règle produit un
    /// finding unique par instance, ce qui évite les doublons à chaque exécution.
    /// </summary>
    private static string BuildTargetKey(LoadedRule rule, RuleRow row)
    {
        if (rule.KeyColumns.Length == 0)
        {
            return string.Empty;
        }

        var parts = rule.KeyColumns.Select(column =>
            row.TryGetValue(column, out var value) ? ValueOps.ToInvariantString(value) : string.Empty);

        var key = string.Join('/', parts);
        if (key.Length <= 512)
        {
            return key;
        }

        // Clé anormalement longue (texte de requête, par exemple) : on la réduit sans perdre l'unicité.
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key)))[..32];
        return key[..470] + '#' + hash;
    }

    /// <summary>Ramène les valeurs Npgsql à des types sérialisables en JSON pour les preuves.</summary>
    private static object? NormalizeForJson(object? value) => value switch
    {
        null or DBNull => null,
        bool or string or short or int or long or float or double or decimal => value,
        DateTime dateTime => dateTime.ToUniversalTime().ToString("o"),
        DateTimeOffset dateTimeOffset => dateTimeOffset.ToUniversalTime().ToString("o"),
        TimeSpan span => span.ToString(),
        Guid guid => guid.ToString(),
        byte[] bytes => $"({bytes.Length} octets)",
        System.Collections.IEnumerable enumerable => string.Join(", ",
            enumerable.Cast<object?>().Select(item => ValueOps.ToInvariantString(item))),
        _ => ValueOps.ToInvariantString(value),
    };

    public static string SerializeEvidence(Dictionary<string, object?> evidence) =>
        JsonSerializer.Serialize(evidence);
}
