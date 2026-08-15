using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using PgAdvisor.Api.Data;
using PgAdvisor.Api.Models;
using PgAdvisor.Api.Postgres;
using PgAdvisor.Api.Rules;
using PgAdvisor.Api.Rules.Expressions;
using PgAdvisor.Api.Rules.Handlers;
using PgAdvisor.Api.Scheduler;
using PgAdvisor.Api.Services;
using PgAdvisor.Api.Sse;

namespace PgAdvisor.Api.Controllers;

/// <summary>
/// Gestion des règles depuis l'IHM : consultation, validation, création, modification,
/// suppression, surcharges par instance et exécution d'essai. Les écritures produisent des
/// fichiers YAML dans le volume de données — le format fichier reste la référence.
/// </summary>
[ApiController]
[Route("api/rules")]
public sealed class RulesController(
    AdvisorDbContext db,
    RuleStore store,
    RuleLoader loader,
    RuleFileService files,
    RuleHandlerRegistry handlers,
    AnalysisService analysis,
    RuleGuard guard,
    ConnectionPresenter presenter,
    IOptions<AdvisorOptions> options,
    EventBus bus,
    ILogger<RulesController> logger) : ControllerBase
{
    private readonly SchedulerOptions _scheduler = options.Value.Scheduler;

    [HttpGet]
    public async Task<ActionResult<IEnumerable<RuleSummaryResponse>>> List(
        [FromQuery] string? category,
        [FromQuery] string? origin,
        [FromQuery] string? search,
        CancellationToken ct = default)
    {
        var snapshot = store.Current;
        var overrides = await LoadOverridesAsync(ct);
        var health = await LoadHealthAsync(ct);

        var rules = snapshot.Rules.AsEnumerable();

        if (!string.IsNullOrWhiteSpace(category))
        {
            rules = rules.Where(r => string.Equals(r.Category, category, StringComparison.OrdinalIgnoreCase));
        }

        if (!string.IsNullOrWhiteSpace(origin))
        {
            rules = rules.Where(r => string.Equals(r.Origin.ToString(), origin, StringComparison.OrdinalIgnoreCase));
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var needle = search.Trim();
            rules = rules.Where(r =>
                r.Id.Contains(needle, StringComparison.OrdinalIgnoreCase) ||
                (r.Definition.Name ?? string.Empty).Contains(needle, StringComparison.OrdinalIgnoreCase) ||
                (r.Definition.Description ?? string.Empty).Contains(needle, StringComparison.OrdinalIgnoreCase));
        }

        return Ok(rules.Select(rule => ToSummary(rule, snapshot, overrides, health)).ToList());
    }

    /// <summary>
    /// État du garde-fou pour toutes les règles suivies. C'est ce que consulte l'IHM pour
    /// avertir globalement, sans avoir à ouvrir chaque règle.
    /// </summary>
    [HttpGet("health")]
    public async Task<ActionResult<IEnumerable<RuleHealthResponse>>> Health(
        [FromQuery] int? connectionId,
        [FromQuery] string? state,
        CancellationToken ct = default)
    {
        var names = await ConnectionNamesAsync(ct);
        var rows = await LoadHealthAsync(ct);
        var now = DateTimeOffset.UtcNow;

        var responses = rows
            .Where(h => connectionId is null || h.ConnectionId == connectionId)
            .Select(h => ToHealth(h, names.GetValueOrDefault(h.ConnectionId) ?? string.Empty, now))
            .Where(h => state is null || string.Equals(h.State, state, StringComparison.OrdinalIgnoreCase))
            .OrderBy(h => h.RuleId, StringComparer.Ordinal)
            .ThenBy(h => h.ConnectionName, StringComparer.Ordinal)
            .ToList();

        return Ok(responses);
    }

    [HttpGet("schema")]
    public ActionResult<RuleSchemaResponse> Schema() => Ok(new RuleSchemaResponse
    {
        Categories = RuleCategories.All,
        Severities = [Severities.Info, Severities.Warning, Severities.Critical],
        Groups = RuleGroups.All,
        Filters = Template.FilterNames,
        Functions = ExpressionParser.FunctionNames,
        KnownViews = CapabilityDetector.CandidateViews,
        NotableExtensions = CapabilityDetector.NotableExtensions,
        Handlers = handlers.All.Select(h => new RuleHandlerResponse(h.Name, h.Description)).ToList(),
        Template = NewRuleTemplate,
    });

    [HttpGet("errors")]
    public ActionResult<IEnumerable<RuleErrorResponse>> Errors() => Ok(store.Current.Errors
        .Select(e => new RuleErrorResponse(
            Path.GetFileName(e.Path), e.RuleId, e.Message, e.Origin.ToString().ToLowerInvariant()))
        .ToList());

    [HttpGet("{id}")]
    public async Task<ActionResult<RuleDetailResponse>> Get(string id, CancellationToken ct)
    {
        var snapshot = store.Current;
        var rule = snapshot.Find(id);
        if (rule is null)
        {
            return NotFound();
        }

        var overrides = await LoadOverridesAsync(ct);
        var health = await LoadHealthAsync(ct);
        var connections = await db.PostgresConnections.OrderBy(c => c.Name).ToListAsync(ct);
        var now = DateTimeOffset.UtcNow;

        var applicability = connections.Select(connection =>
        {
            var result = rule.EvaluateApplicability(presenter.CapabilitiesFor(connection));
            var effective = rule.ApplyOverrides(
                overrides.FirstOrDefault(o => Matches(o, id) && o.ConnectionId is null),
                overrides.FirstOrDefault(o => Matches(o, id) && o.ConnectionId == connection.Id));

            var state = health.FirstOrDefault(h =>
                h.ConnectionId == connection.Id && string.Equals(h.RuleId, rule.Id, StringComparison.OrdinalIgnoreCase));

            return new RuleApplicabilityResponse
            {
                ConnectionId = connection.Id,
                ConnectionName = connection.Name,
                Applicable = result.IsApplicable,
                Reason = result.Reason,
                TimeoutSeconds = effective.ResolveTimeoutSeconds(_scheduler.QueryTimeout),
                // La quarantaine se lit ici : elle ne doit jamais faire disparaître un
                // diagnostic en silence.
                Health = state is null ? null : ToHealth(state, connection.Name, now),
            };
        }).ToList();

        return Ok(new RuleDetailResponse
        {
            Rule = ToSummary(rule, snapshot, overrides, health),
            Yaml = rule.RawYaml,
            Applicability = applicability,
        });
    }

    /// <summary>
    /// Réactivation manuelle immédiate d'une règle mise en quarantaine, sur une instance ou sur
    /// toutes. L'exploitant a corrigé la cause : on n'attend pas l'échéance.
    /// </summary>
    [HttpPost("{id}/reactivate")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<IEnumerable<RuleHealthResponse>>> Reactivate(
        string id, ReleaseQuarantineRequest request, CancellationToken ct)
    {
        if (store.Current.Find(id) is null)
        {
            return NotFound();
        }

        var rows = await db.RuleHealth
            .Where(h => h.RuleId == id && (request.ConnectionId == null || h.ConnectionId == request.ConnectionId))
            .ToListAsync(ct);

        var now = DateTimeOffset.UtcNow;
        foreach (var row in rows)
        {
            RuleGuard.Reactivate(row, now);
        }

        await db.SaveChangesAsync(ct);

        var names = await ConnectionNamesAsync(ct);

        foreach (var row in rows)
        {
            logger.LogInformation("Rule {RuleId} reactivated on instance {ConnectionId} by an operator.",
                row.RuleId, row.ConnectionId);

            bus.Publish(AdvisorEventTypes.RuleRecovered, new
            {
                connectionId = row.ConnectionId,
                connectionName = names.GetValueOrDefault(row.ConnectionId),
                ruleId = row.RuleId,
                state = row.State,
            }, row.ConnectionId);
        }

        return Ok(rows
            .Select(row => ToHealth(row, names.GetValueOrDefault(row.ConnectionId) ?? string.Empty, now))
            .ToList());
    }

    /// <summary>Valide un YAML sans rien écrire : utilisé à la frappe dans l'éditeur.</summary>
    [HttpPost("validate")]
    public ActionResult<ValidateRuleResponse> Validate(SaveRuleRequest request)
    {
        var compilation = loader.Compile(request.Yaml, "(editor)", RuleOrigin.User);

        return Ok(new ValidateRuleResponse(
            compilation.Rule is not null,
            compilation.Errors,
            compilation.Rule is null ? null : ToSummary(compilation.Rule, store.Current, [], [])));
    }

    [HttpPost]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<RuleDetailResponse>> Create(SaveRuleRequest request, CancellationToken ct)
    {
        var compilation = loader.Compile(request.Yaml, "(editor)", RuleOrigin.User);
        if (compilation.Rule is null)
        {
            return ValidationProblem(compilation.Errors);
        }

        if (store.Current.Find(compilation.Rule.Id) is not null)
        {
            return Problem(statusCode: StatusCodes.Status409Conflict,
                title: $"A rule named \"{compilation.Rule.Id}\" already exists. Edit it, or pick another identifier.");
        }

        return await SaveAsync(request.Yaml, expectedId: null, ct);
    }

    /// <summary>
    /// Enregistre une règle. Modifier une règle fournie crée une version utilisateur qui la
    /// masque, sans jamais toucher au répertoire monté en lecture seule.
    /// </summary>
    [HttpPut("{id}")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<RuleDetailResponse>> Update(string id, SaveRuleRequest request, CancellationToken ct)
    {
        if (store.Current.Find(id) is null)
        {
            return NotFound();
        }

        return await SaveAsync(request.Yaml, expectedId: id, ct);
    }

    [HttpDelete("{id}")]
    [Authorize(Roles = Roles.Admin)]
    public ActionResult Delete(string id)
    {
        if (!files.HasUserFile(id))
        {
            var rule = store.Current.Find(id);
            if (rule is null)
            {
                return NoContent();
            }

            return Problem(statusCode: StatusCodes.Status400BadRequest,
                title: "This rule ships with the application and cannot be deleted. " +
                       "Disable it with an override, or replace it with a user-defined version.");
        }

        files.DeleteUserRule(id);
        bus.Publish(AdvisorEventTypes.RulesReloaded, BuildReloadPayload());
        return NoContent();
    }

    [HttpPost("reload")]
    [Authorize(Roles = Roles.Admin)]
    public ActionResult<RulesStatusResponse> Reload()
    {
        var snapshot = store.Reload();
        bus.Publish(AdvisorEventTypes.RulesReloaded, BuildReloadPayload());

        return Ok(new RulesStatusResponse
        {
            Total = snapshot.Rules.Count,
            Enabled = snapshot.Rules.Count(r => r.Definition.Enabled),
            Provided = snapshot.Rules.Count(r => r.Origin == RuleOrigin.Provided),
            User = snapshot.Rules.Count(r => r.Origin == RuleOrigin.User),
            LoadedAt = snapshot.LoadedAt,
            Errors = snapshot.Errors
                .Select(e => new RuleErrorResponse(
                    Path.GetFileName(e.Path), e.RuleId, e.Message, e.Origin.ToString().ToLowerInvariant()))
                .ToList(),
            ByCategory = snapshot.Rules
                .GroupBy(r => r.Category)
                .OrderBy(g => g.Key, StringComparer.Ordinal)
                .ToDictionary(g => g.Key, g => g.Count()),
        });
    }

    /// <summary>Exécute la règle sur une instance et retourne le résultat sans rien persister.</summary>
    [HttpPost("{id}/dry-run")]
    public async Task<ActionResult<DryRunResponse>> DryRun(string id, DryRunRequest request, CancellationToken ct)
    {
        LoadedRule? rule;

        if (!string.IsNullOrWhiteSpace(request.Yaml))
        {
            // Aperçu du YAML en cours d'édition, pas nécessairement enregistré.
            var compilation = loader.Compile(request.Yaml, "(editor)", RuleOrigin.User);
            if (compilation.Rule is null)
            {
                return ValidationProblem(compilation.Errors);
            }

            rule = compilation.Rule;
        }
        else
        {
            rule = store.Current.Find(id);
            if (rule is null)
            {
                return NotFound();
            }
        }

        if (!await db.PostgresConnections.AnyAsync(c => c.Id == request.ConnectionId, ct))
        {
            return Problem(statusCode: StatusCodes.Status400BadRequest, title: "Unknown instance.");
        }

        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(60));

            var result = await analysis.DryRunAsync(request.ConnectionId, rule, timeout.Token);

            return Ok(new DryRunResponse
            {
                Executed = result.Executed,
                SkipReason = result.SkipReason,
                Error = result.Error,
                RowCount = result.RowCount,
                DurationMs = result.Duration.TotalMilliseconds,
                Rows = result.Rows,
                Findings = result.Findings
                    .Select(f => new DryRunFinding(f.TargetKey, f.Severity, f.Title, f.Message, f.RemediationSql, f.Evidence))
                    .ToList(),
            });
        }
        catch (Exception ex) when (ex is InvalidOperationException or OperationCanceledException)
        {
            logger.LogWarning("Cannot preview rule {RuleId}: {Message}", id, ex.Message);
            return Ok(new DryRunResponse { Error = ex.Message });
        }
    }

    /// <summary>Crée ou remplace une surcharge : activation, sévérité, seuils, périodicité.</summary>
    [HttpPut("{id}/override")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<RuleOverrideResponse>> SaveOverride(
        string id, SaveRuleOverrideRequest request, CancellationToken ct)
    {
        var rule = store.Current.Find(id);
        if (rule is null)
        {
            return NotFound();
        }

        if (request.Severity is not null && !Severities.IsValid(request.Severity.ToLowerInvariant()))
        {
            return Problem(statusCode: StatusCodes.Status400BadRequest, title: "Unknown severity.");
        }

        if (request.ConnectionId is int connectionId &&
            !await db.PostgresConnections.AnyAsync(c => c.Id == connectionId, ct))
        {
            return Problem(statusCode: StatusCodes.Status400BadRequest, title: "Unknown instance.");
        }

        var unknownParameters = (request.Parameters ?? [])
            .Keys
            .Where(key => !(rule.Definition.Parameters ?? []).ContainsKey(key))
            .ToList();

        if (unknownParameters.Count > 0)
        {
            return Problem(statusCode: StatusCodes.Status400BadRequest,
                title: $"Unknown thresholds for this rule: {string.Join(", ", unknownParameters)}.");
        }

        var existing = await db.RuleOverrides
            .FirstOrDefaultAsync(o => o.RuleId == id && o.ConnectionId == request.ConnectionId, ct);

        if (existing is null)
        {
            existing = new RuleOverride { RuleId = id, ConnectionId = request.ConnectionId };
            db.RuleOverrides.Add(existing);
        }

        existing.Enabled = request.Enabled;
        existing.Severity = request.Severity?.ToLowerInvariant();
        existing.IntervalSeconds = request.IntervalSeconds;
        existing.TimeoutSeconds = request.TimeoutSeconds;
        existing.ParametersJson = request.Parameters is null || request.Parameters.Count == 0
            ? null
            : RuleParameterSerializer.Serialize(request.Parameters);
        existing.UpdatedAt = DateTimeOffset.UtcNow;

        await db.SaveChangesAsync(ct);

        var connectionName = request.ConnectionId is null
            ? null
            : await db.PostgresConnections
                .Where(c => c.Id == request.ConnectionId)
                .Select(c => c.Name)
                .FirstOrDefaultAsync(ct);

        return Ok(ToOverride(existing, connectionName));
    }

    [HttpDelete("{id}/override")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> DeleteOverride(string id, [FromQuery] int? connectionId, CancellationToken ct)
    {
        var existing = await db.RuleOverrides
            .FirstOrDefaultAsync(o => o.RuleId == id && o.ConnectionId == connectionId, ct);

        if (existing is null)
        {
            return NoContent();
        }

        db.RuleOverrides.Remove(existing);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    private async Task<ActionResult<RuleDetailResponse>> SaveAsync(string yaml, string? expectedId, CancellationToken ct)
    {
        var result = await files.SaveAsync(yaml, expectedId, ct);
        if (!result.Success || result.Rule is null)
        {
            return ValidationProblem(result.Errors);
        }

        bus.Publish(AdvisorEventTypes.RulesReloaded, BuildReloadPayload());

        var snapshot = store.Current;
        var overrides = await LoadOverridesAsync(ct);
        var health = await LoadHealthAsync(ct);

        return Ok(new RuleDetailResponse
        {
            Rule = ToSummary(result.Rule, snapshot, overrides, health),
            Yaml = result.Rule.RawYaml,
        });
    }

    private object BuildReloadPayload()
    {
        var snapshot = store.Current;
        return new
        {
            total = snapshot.Rules.Count,
            errors = snapshot.Errors.Count,
            loadedAt = snapshot.LoadedAt,
        };
    }

    private ActionResult ValidationProblem(IReadOnlyList<string> errors)
    {
        foreach (var error in errors)
        {
            ModelState.AddModelError("yaml", error);
        }

        return ValidationProblem(ModelState);
    }

    private async Task<List<RuleOverride>> LoadOverridesAsync(CancellationToken ct) =>
        await db.RuleOverrides.AsNoTracking().ToListAsync(ct);

    private async Task<List<RuleHealth>> LoadHealthAsync(CancellationToken ct) =>
        await db.RuleHealth.AsNoTracking().ToListAsync(ct);

    private async Task<Dictionary<int, string>> ConnectionNamesAsync(CancellationToken ct) =>
        await db.PostgresConnections.AsNoTracking().ToDictionaryAsync(c => c.Id, c => c.Name, ct);

    private static bool Matches(RuleOverride source, string ruleId) =>
        string.Equals(source.RuleId, ruleId, StringComparison.OrdinalIgnoreCase);

    private RuleHealthResponse ToHealth(RuleHealth source, string connectionName, DateTimeOffset now) => new()
    {
        ConnectionId = source.ConnectionId,
        ConnectionName = connectionName,
        RuleId = source.RuleId,
        State = source.State,
        Quarantined = guard.IsQuarantined(source, now),
        Strikes = source.Strikes,
        ConsecutiveFailures = source.ConsecutiveFailures,
        ConsecutiveSlowRuns = source.ConsecutiveSlowRuns,
        FailureKind = source.LastFailureKind,
        FailureMessage = source.LastFailureMessage,
        LastFailureAt = source.LastFailureAt,
        LastSuccessAt = source.LastSuccessAt,
        LastDurationMs = source.LastDurationMs,
        MaxDurationMs = source.MaxDurationMs,
        LastTimeoutSeconds = source.LastTimeoutSeconds,
        QuarantinedAt = source.QuarantinedAt,
        QuarantinedUntil = source.QuarantinedUntil,
        QuarantineReason = source.QuarantineReason,
        QuarantineCount = source.QuarantineCount,
        WarningThreshold = guard.WarningThreshold,
        QuarantineThreshold = guard.QuarantineThreshold,
        UpdatedAt = source.UpdatedAt,
    };

    private RuleSummaryResponse ToSummary(
        LoadedRule rule, RuleSnapshot snapshot, List<RuleOverride> overrides, List<RuleHealth> health)
    {
        var requires = rule.Definition.Requires;
        var connectionNames = db.PostgresConnections
            .AsNoTracking()
            .ToDictionary(c => c.Id, c => c.Name);

        var now = DateTimeOffset.UtcNow;
        var states = health
            .Where(h => string.Equals(h.RuleId, rule.Id, StringComparison.OrdinalIgnoreCase))
            .ToList();

        return new RuleSummaryResponse
        {
            Id = rule.Id,
            Name = rule.Definition.Name ?? rule.Id,
            Description = rule.Definition.Description,
            Category = rule.Category,
            Severity = rule.Severity,
            Group = rule.Group,
            Version = rule.Definition.Version,
            Enabled = rule.Definition.Enabled,
            Origin = rule.Origin.ToString().ToLowerInvariant(),
            Editable = rule.IsEditable,
            OverridesProvided = snapshot.Shadowed.Contains(rule.Id),
            File = Path.GetFileName(rule.SourcePath),
            Handler = rule.Definition.Handler,
            HasQuery = !string.IsNullOrWhiteSpace(rule.Definition.Query),
            IntervalSeconds = rule.Definition.IntervalSeconds,
            TimeoutSeconds = rule.Definition.TimeoutSeconds,
            DefaultTimeoutSeconds = (int)Math.Ceiling(_scheduler.QueryTimeout.TotalSeconds),
            DegradedInstances = states.Count(h => h.State == RuleHealthStates.Degraded),
            QuarantinedInstances = states.Count(h => guard.IsQuarantined(h, now)),
            Requires = new RuleRequirementsResponse
            {
                Views = requires?.Views ?? [],
                Extensions = requires?.Extensions ?? [],
                MissingExtensions = requires?.MissingExtensions ?? [],
                MinVersion = requires?.MinVersion,
                MaxVersion = requires?.MaxVersion,
                MonitorRole = requires?.MonitorRole,
                Primary = requires?.Primary,
            },
            Parameters = new Dictionary<string, object?>(rule.Definition.Parameters ?? [], StringComparer.OrdinalIgnoreCase),
            Overrides = overrides
                .Where(o => string.Equals(o.RuleId, rule.Id, StringComparison.OrdinalIgnoreCase))
                .Select(o => ToOverride(o, o.ConnectionId is null ? null : connectionNames.GetValueOrDefault(o.ConnectionId.Value)))
                .ToList(),
        };
    }

    private static RuleOverrideResponse ToOverride(RuleOverride source, string? connectionName) => new()
    {
        ConnectionId = source.ConnectionId,
        ConnectionName = connectionName,
        Enabled = source.Enabled,
        Severity = source.Severity,
        IntervalSeconds = source.IntervalSeconds,
        TimeoutSeconds = source.TimeoutSeconds,
        Parameters = RuleParameterSerializer.Deserialize(source.ParametersJson),
        UpdatedAt = source.UpdatedAt,
    };

    private const string NewRuleTemplate = """
        id: category.subject
        version: 1

        name: Short rule title
        category: performance
        severity: warning
        group: recommendations
        # intervalSeconds: 300   # own schedule, 5 to 86400; defaults to the group's
        # timeoutSeconds: 30     # own timeout, 1 to 300; defaults to Scheduler:QueryTimeout

        requires:
          views:
            - pg_stat_user_tables

        parameters:
          threshold: 0.2

        query: |
          SELECT
            schemaname,
            relname,
            n_dead_tup,
            n_live_tup,
            n_dead_tup::float / NULLIF(n_live_tup, 0) AS ratio
          FROM pg_stat_user_tables
          WHERE n_live_tup > 10000

        condition: ratio > threshold

        key:
          - schemaname
          - relname

        recommendation:
          title: "Finding title"
          message: "{{ relname }} holds {{ ratio | percent }} dead rows."
          impact: medium
          confidence: high
          sql: "VACUUM (ANALYZE) {{ schemaname }}.{{ relname }};"
          documentation: https://www.postgresql.org/docs/current/routine-vacuuming.html
        """;
}
