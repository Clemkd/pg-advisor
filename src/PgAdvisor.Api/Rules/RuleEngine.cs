using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
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

    /// <summary>
    /// Nature de l'échec : « timeout » quand le délai a été dépassé, « error » pour une erreur
    /// SQL ordinaire. La distinction dit à l'exploitant s'il doit corriger sa règle ou
    /// s'inquiéter de sa base.
    /// </summary>
    public string? FailureKind { get; init; }

    public int RowCount { get; init; }
    public IReadOnlyList<FindingCandidate> Findings { get; init; } = [];
    public TimeSpan Duration { get; init; }

    /// <summary>Délai réellement appliqué à cette exécution, en secondes.</summary>
    public int TimeoutSeconds { get; init; }

    /// <summary>Lignes brutes, uniquement renseignées en mode aperçu depuis l'IHM.</summary>
    public IReadOnlyList<Dictionary<string, object?>> Rows { get; init; } = [];

    /// <summary>
    /// Colonnes numériques de chaque ligne, par cible. L'appelant les conserve pour que la
    /// prochaine exécution puisse raisonner sur ce qui a bougé.
    /// </summary>
    public IReadOnlyDictionary<string, IReadOnlyDictionary<string, double>> Samples { get; init; } =
        new Dictionary<string, IReadOnlyDictionary<string, double>>();
}

/// <summary>
/// Ce que la règle avait observé la fois précédente, et quand. Sert aux règles qui lisent des
/// compteurs cumulés : sans point de comparaison, leur valeur ne redescend jamais et le
/// diagnostic qu'elles produisent ne peut plus se résoudre.
/// </summary>
public sealed record RulePreviousSample(
    IReadOnlyDictionary<string, IReadOnlyDictionary<string, double>> ByTarget,
    DateTimeOffset At);

/// <summary>
/// Exécute une règle contre une instance : YAML → prérequis → SQL → condition → finding.
/// Aucune écriture n'est possible, la session PostgreSQL étant forcée en lecture seule.
/// </summary>
public sealed class RuleEngine(
    RuleHandlerRegistry handlers,
    IOptions<AdvisorOptions> options,
    ILogger<RuleEngine> logger)
{
    private const int DefaultLimit = 100;

    /// <summary>SQLSTATE 57014 : requête annulée, ce que produit un statement_timeout atteint.</summary>
    private const string QueryCanceled = "57014";

    private readonly SchedulerOptions _scheduler = options.Value.Scheduler;

    public async Task<RuleExecutionResult> ExecuteAsync(
        EffectiveRule effective,
        NpgsqlConnection connection,
        PgCapabilities capabilities,
        PostgresConnection instance,
        CancellationToken cancellationToken,
        bool includeRows = false,
        RulePreviousSample? previous = null)
    {
        var rule = effective.Rule;
        var timeoutSeconds = effective.ResolveTimeoutSeconds(_scheduler.QueryTimeout);
        var stopwatch = Stopwatch.StartNew();

        if (!effective.Enabled)
        {
            return new RuleExecutionResult { RuleId = rule.Id, SkipReason = "Rule is disabled." };
        }

        var applicability = rule.EvaluateApplicability(capabilities);
        if (!applicability.IsApplicable)
        {
            return new RuleExecutionResult { RuleId = rule.Id, SkipReason = applicability.Reason };
        }

        IReadOnlyList<RuleRow> rows;
        try
        {
            await ApplyStatementTimeoutAsync(connection, timeoutSeconds, cancellationToken);
            rows = await FetchRowsAsync(effective, connection, capabilities, instance, timeoutSeconds, cancellationToken);
        }
        catch (Exception ex) when (ex is PostgresException or NpgsqlException or TimeoutException or InvalidOperationException)
        {
            var kind = ClassifyFailure(ex);

            logger.LogWarning("Rule {RuleId} failed on instance {Instance} ({Kind}): {Message}",
                rule.Id, instance.Name, kind, ex.Message);

            return new RuleExecutionResult
            {
                RuleId = rule.Id,
                Error = Describe(ex, kind, timeoutSeconds),
                FailureKind = kind,
                Duration = stopwatch.Elapsed,
                TimeoutSeconds = timeoutSeconds,
            };
        }
        finally
        {
            await RestoreStatementTimeoutAsync(connection, timeoutSeconds, cancellationToken);
        }

        var limit = Math.Clamp(rule.Definition.Limit ?? DefaultLimit, 1, 1_000);
        var candidates = new List<FindingCandidate>();
        var truncated = false;

        var samples = new Dictionary<string, IReadOnlyDictionary<string, double>>(StringComparer.Ordinal);
        var elapsedSeconds = previous is null
            ? (double?)null
            : Math.Max(0, (DateTimeOffset.UtcNow - previous.At).TotalSeconds);

        foreach (var row in rows)
        {
            // La clé se calcule avant la condition : c'est elle qui relie la ligne à ce que la
            // règle avait observé la fois d'avant.
            var targetKey = BuildTargetKey(rule, row);
            samples[targetKey] = NumericColumns(row);

            var variables = BuildVariables(effective, row);
            AddDeltas(variables, row, targetKey, previous, elapsedSeconds);

            try
            {
                if (rule.Condition is not null && !ValueOps.ToBool(rule.Condition.Evaluate(variables)))
                {
                    continue;
                }
            }
            catch (ExpressionException ex)
            {
                // Erreur d'évaluation sur une ligne : la règle est signalée, pas silencieusement
                // ignorée. La faute est dans la règle, pas dans la base : « error », jamais « timeout ».
                return new RuleExecutionResult
                {
                    RuleId = rule.Id,
                    Error = $"Cannot evaluate the condition: {ex.Message}",
                    FailureKind = RuleFailureKinds.Error,
                    RowCount = rows.Count,
                    Duration = stopwatch.Elapsed,
                    TimeoutSeconds = timeoutSeconds,
                };
            }

            if (candidates.Count >= limit)
            {
                truncated = true;
                break;
            }

            candidates.Add(BuildCandidate(effective, row, variables, targetKey));
        }

        if (truncated)
        {
            logger.LogInformation(
                "Rule {RuleId}: {Limit} findings kept on instance {Instance}, remaining rows ignored (limit).",
                rule.Id, limit, instance.Name);
        }

        return new RuleExecutionResult
        {
            RuleId = rule.Id,
            Executed = true,
            RowCount = rows.Count,
            Findings = candidates,
            Duration = stopwatch.Elapsed,
            TimeoutSeconds = timeoutSeconds,
            Rows = includeRows
                ? rows.Take(limit).Select(r => r.ToDictionary(p => p.Key, p => NormalizeForJson(p.Value))).ToList()
                : [],
            Samples = samples,
        };
    }

    /// <summary>
    /// Applique le délai de la règle à la session, et à elle seule : c'est un réglage de session
    /// PostgreSQL, jamais une écriture sur l'instance supervisée. Le délai global posé à
    /// l'ouverture de la connexion reste la valeur de repos.
    /// </summary>
    private async Task ApplyStatementTimeoutAsync(
        NpgsqlConnection connection, int timeoutSeconds, CancellationToken cancellationToken)
    {
        if (timeoutSeconds == GlobalTimeoutSeconds)
        {
            return;
        }

        await SetStatementTimeoutAsync(connection, timeoutSeconds, cancellationToken);
    }

    /// <summary>Rend la session à son délai global : la règle suivante ne doit pas hériter du précédent.</summary>
    /// <remarks>
    /// La restauration ignore délibérément le jeton d'annulation de l'analyse. Les garde-fous de
    /// session sont posés par la chaîne de connexion (<c>Options</c>), donc appliqués une seule
    /// fois à l'ouverture de la connexion physique : une reprise depuis le pool ne les réapplique
    /// pas. Renoncer à restaurer parce que l'analyse vient d'être annulée rendait au pool une
    /// connexion au délai modifié, dont héritait la règle suivante — exactement ce que cette
    /// méthode existe pour empêcher.
    /// </remarks>
    private async Task RestoreStatementTimeoutAsync(
        NpgsqlConnection connection, int timeoutSeconds, CancellationToken cancellationToken)
    {
        if (timeoutSeconds == GlobalTimeoutSeconds)
        {
            return;
        }

        try
        {
            await SetStatementTimeoutAsync(connection, GlobalTimeoutSeconds, CancellationToken.None);
        }
        catch (Exception ex) when (ex is PostgresException or NpgsqlException or TimeoutException
                                      or InvalidOperationException or OperationCanceledException)
        {
            // La connexion est perdue ou cassée : Npgsql ne la rendra pas au pool. Laisser cette
            // exception remonter masquerait celle qui a réellement fait échouer la règle.
            logger.LogDebug("Cannot restore the global statement_timeout: {Message}", ex.Message);
        }
    }

    private static async Task SetStatementTimeoutAsync(
        NpgsqlConnection connection, int seconds, CancellationToken cancellationToken)
    {
        // Paramètre entier calculé, jamais une valeur venue du YAML : aucune interpolation
        // d'entrée utilisateur ne se retrouve dans ce SET.
        await using var command = new NpgsqlCommand($"SET statement_timeout = {seconds * 1000}", connection)
        {
            CommandTimeout = 10,
        };

        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private int GlobalTimeoutSeconds => Math.Clamp(
        (int)Math.Ceiling(_scheduler.QueryTimeout.TotalSeconds),
        RuleLimits.MinTimeoutSeconds,
        RuleLimits.MaxTimeoutSeconds);

    /// <summary>
    /// Sépare le dépassement de délai de l'erreur SQL ordinaire. Le serveur annule la requête
    /// avec le SQLSTATE 57014 lorsque le statement_timeout est atteint ; Npgsql lève un
    /// TimeoutException lorsque c'est le délai côté client qui a joué le premier.
    /// </summary>
    private static string ClassifyFailure(Exception exception) => exception switch
    {
        PostgresException { SqlState: QueryCanceled } => RuleFailureKinds.Timeout,
        TimeoutException => RuleFailureKinds.Timeout,
        NpgsqlException { InnerException: TimeoutException } => RuleFailureKinds.Timeout,
        _ => RuleFailureKinds.Error,
    };

    /// <summary>Message consigné : il doit dire de lui-même lequel des deux problèmes s'est produit.</summary>
    private static string Describe(Exception exception, string kind, int timeoutSeconds)
    {
        if (kind == RuleFailureKinds.Timeout)
        {
            return $"Timed out after {timeoutSeconds}s on the supervised instance.";
        }

        return exception is PostgresException pg
            ? $"{pg.SqlState} : {pg.MessageText}"
            : exception.Message;
    }

    private async Task<IReadOnlyList<RuleRow>> FetchRowsAsync(
        EffectiveRule effective,
        NpgsqlConnection connection,
        PgCapabilities capabilities,
        PostgresConnection instance,
        int timeoutSeconds,
        CancellationToken cancellationToken)
    {
        var rule = effective.Rule;

        if (!string.IsNullOrWhiteSpace(rule.Definition.Handler))
        {
            var handler = handlers.Find(rule.Definition.Handler!)
                ?? throw new InvalidOperationException($"Handler \"{rule.Definition.Handler}\" not found.");

            var context = new RuleHandlerContext(effective, connection, capabilities, instance, timeoutSeconds);
            return await handler.ExecuteAsync(context, cancellationToken);
        }

        if (string.IsNullOrWhiteSpace(rule.Definition.Query))
        {
            // Règle purement fondée sur les capabilities : une ligne, sans colonne.
            return [new RuleRow()];
        }

        return await ReadQueryAsync(effective, connection, timeoutSeconds, cancellationToken);
    }

    private static async Task<List<RuleRow>> ReadQueryAsync(
        EffectiveRule effective, NpgsqlConnection connection, int timeoutSeconds, CancellationToken cancellationToken)
    {
        // Le délai client dépasse celui du serveur : c'est le statement_timeout qui doit couper,
        // lui seul sait nommer le motif et laisse la connexion utilisable.
        await using var command = new NpgsqlCommand(effective.Rule.Definition.Query, connection)
        {
            CommandTimeout = timeoutSeconds + RuleHandlerContext.ClientTimeoutMarginSeconds,
        };

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
        EffectiveRule effective, RuleRow row, Dictionary<string, object?> variables, string targetKey)
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
            TargetKey = targetKey,
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
    /// <summary>Seules les colonnes numériques ont un sens à comparer d'une exécution à l'autre.</summary>
    private static IReadOnlyDictionary<string, double> NumericColumns(RuleRow row)
    {
        var numeric = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);

        foreach (var column in row)
        {
            if (ValueOps.TryToNumber(column.Value, out var value))
            {
                numeric[column.Key] = value;
            }
        }

        return numeric;
    }

    /// <summary>
    /// Expose « colonne_delta » pour chaque compteur qui a bougé, et « elapsed_seconds » depuis la
    /// mesure précédente. Une règle qui lit un compteur cumulé peut alors se résoudre : le total
    /// ne redescend jamais, la variation, si.
    /// </summary>
    private static void AddDeltas(
        Dictionary<string, object?> variables,
        RuleRow row,
        string targetKey,
        RulePreviousSample? previous,
        double? elapsedSeconds)
    {
        if (previous is null || !previous.ByTarget.TryGetValue(targetKey, out var before))
        {
            return;
        }

        variables["elapsed_seconds"] = elapsedSeconds ?? 0d;

        foreach (var column in row)
        {
            if (before.TryGetValue(column.Key, out var earlier) &&
                ValueOps.TryToNumber(column.Value, out var now))
            {
                variables[column.Key + "_delta"] = now - earlier;
            }
        }
    }

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
        byte[] bytes => $"({bytes.Length} bytes)",
        System.Collections.IEnumerable enumerable => string.Join(", ",
            enumerable.Cast<object?>().Select(item => ValueOps.ToInvariantString(item))),
        _ => ValueOps.ToInvariantString(value),
    };

    public static string SerializeEvidence(Dictionary<string, object?> evidence) =>
        JsonSerializer.Serialize(evidence);
}
