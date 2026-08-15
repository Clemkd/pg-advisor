using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Npgsql;
using PgAdvisor.Api.Collectors;
using PgAdvisor.Api.Data;
using PgAdvisor.Api.Findings;
using PgAdvisor.Api.Models;
using PgAdvisor.Api.Notifications;
using PgAdvisor.Api.Postgres;
using PgAdvisor.Api.Rules;
using PgAdvisor.Api.Sse;
using PgAdvisor.Api.State;

namespace PgAdvisor.Api.Scheduler;

/// <summary>
/// Analyse d'une instance : collecte, détection des capabilities, exécution des règles du ou
/// des groupes demandés, rapprochement des findings, score et notifications. Une instance est
/// traitée indépendamment des autres — une base lente ou injoignable n'affecte qu'elle-même.
/// </summary>
public sealed class AnalysisService(
    IServiceScopeFactory scopeFactory,
    PgConnectionFactory connectionFactory,
    CapabilityDetector detector,
    InstanceCollector collector,
    RuleStore ruleStore,
    RuleEngine engine,
    RuleGuard guard,
    InstanceHealthService healthService,
    InstanceStateStore states,
    EventBus bus,
    NotificationQueue notifications,
    IOptions<AdvisorOptions> options,
    ILogger<AnalysisService> logger)
{
    private static readonly TimeSpan CapabilityRefresh = TimeSpan.FromMinutes(5);

    private readonly SchedulerOptions _scheduler = options.Value.Scheduler;

    /// <summary>Dernière exécution par règle et par instance, pour honorer les périodicités propres.</summary>
    private readonly ConcurrentDictionary<(int ConnectionId, string RuleId), DateTimeOffset> _lastRuleRun = new();

    public async Task RunAsync(int connectionId, IReadOnlyCollection<string> groups, CancellationToken cancellationToken)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AdvisorDbContext>();
        var findingService = scope.ServiceProvider.GetRequiredService<FindingService>();

        var connection = await db.PostgresConnections.FirstOrDefaultAsync(c => c.Id == connectionId, cancellationToken);
        if (connection is null)
        {
            states.Remove(connectionId);
            return;
        }

        if (!connection.Enabled)
        {
            SetState(connectionId, state => state with { CollectionState = CollectionStates.Disabled });
            return;
        }

        NpgsqlConnection? pg = null;

        try
        {
            SetState(connectionId, state => state with
            {
                CollectionState = CollectionStates.Collecting,
                AnalysisProgress = null,
            });

            pg = await connectionFactory.OpenAsync(connection, cancellationToken);

            var capabilities = await ResolveCapabilitiesAsync(connection, pg, db, cancellationToken);

            if (groups.Contains(RuleGroups.Health, StringComparer.OrdinalIgnoreCase))
            {
                var metrics = await collector.CollectAsync(pg, capabilities, cancellationToken);
                SetState(connectionId, state => state with { Metrics = metrics });
            }

            var executed = await RunRulesAsync(db, findingService, connection, pg, capabilities, groups, cancellationToken);

            connection.LastCollectedAt = DateTimeOffset.UtcNow;
            connection.LastError = null;
            await db.SaveChangesAsync(cancellationToken);

            SetState(connectionId, state => state with
            {
                CollectionState = CollectionStates.Idle,
                LastError = null,
                LastCollectedAt = connection.LastCollectedAt,
                LastAnalyzedAt = executed ? DateTimeOffset.UtcNow : state.LastAnalyzedAt,
                AnalysisProgress = null,
            });

            PublishCollectionState(connectionId, CollectionStates.Idle, null);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            SetState(connectionId, state => state with { CollectionState = CollectionStates.Idle, AnalysisProgress = null });
        }
        catch (Exception ex)
        {
            var message = Describe(ex);
            logger.LogWarning("Analysis of instance {Name} failed: {Message}", connection.Name, message);

            connection.LastError = message;
            connection.LastCollectedAt = DateTimeOffset.UtcNow;

            try
            {
                await db.SaveChangesAsync(cancellationToken);
            }
            catch (Exception saveError)
            {
                logger.LogError(saveError, "Cannot persist the analysis error for instance {Id}.", connectionId);
            }

            SetState(connectionId, state => state with
            {
                CollectionState = CollectionStates.Error,
                LastError = message,
                AnalysisProgress = null,
            });

            PublishCollectionState(connectionId, CollectionStates.Error, message);
        }
        finally
        {
            if (pg is not null)
            {
                await pg.DisposeAsync();
            }
        }
    }

    /// <summary>Exécute une règle sans rien persister : sert à l'aperçu depuis l'éditeur de règles.</summary>
    public async Task<RuleExecutionResult> DryRunAsync(
        int connectionId, LoadedRule rule, CancellationToken cancellationToken)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AdvisorDbContext>();

        var connection = await db.PostgresConnections.FirstOrDefaultAsync(c => c.Id == connectionId, cancellationToken)
            ?? throw new InvalidOperationException("Unknown instance.");

        await using var pg = await connectionFactory.OpenAsync(connection, cancellationToken);
        var capabilities = await detector.DetectAsync(pg, cancellationToken);

        var overrides = await LoadOverridesAsync(db, connectionId, rule.Id, cancellationToken);
        var effective = rule.ApplyOverrides(overrides.Global, overrides.PerInstance);

        // L'aperçu ignore la désactivation : l'auteur veut voir ce que la règle produirait.
        effective = effective with { Enabled = true };

        return await engine.ExecuteAsync(effective, pg, capabilities, connection, cancellationToken, includeRows: true);
    }

    private async Task<bool> RunRulesAsync(
        AdvisorDbContext db,
        FindingService findingService,
        PostgresConnection connection,
        NpgsqlConnection pg,
        PgCapabilities capabilities,
        IReadOnlyCollection<string> groups,
        CancellationToken cancellationToken)
    {
        var snapshot = ruleStore.Current;

        var candidates = snapshot.Rules
            .Where(rule => groups.Contains(rule.Group, StringComparer.OrdinalIgnoreCase))
            .ToList();

        if (candidates.Count == 0)
        {
            return false;
        }

        var overrides = await db.RuleOverrides
            .Where(o => o.ConnectionId == null || o.ConnectionId == connection.Id)
            .ToListAsync(cancellationToken);

        var globalOverrides = overrides
            .Where(o => o.ConnectionId is null)
            .ToDictionary(o => o.RuleId, StringComparer.OrdinalIgnoreCase);

        var instanceOverrides = overrides
            .Where(o => o.ConnectionId == connection.Id)
            .ToDictionary(o => o.RuleId, StringComparer.OrdinalIgnoreCase);

        SetState(connection.Id, state => state with
        {
            CollectionState = CollectionStates.Analyzing,
            AnalysisProgress = 0,
        });

        PublishCollectionState(connection.Id, CollectionStates.Analyzing, null);

        // Mémoire des exécutions passées : elle vient de SQLite, donc elle a survécu au dernier
        // redémarrage — sans quoi un redémarrage remettrait les compteurs à zéro et le
        // garde-fou ne se déclencherait jamais.
        var ruleHealth = (await db.RuleHealth
                .Where(h => h.ConnectionId == connection.Id)
                .ToListAsync(cancellationToken))
            .ToDictionary(h => h.RuleId, StringComparer.OrdinalIgnoreCase);

        var now = DateTimeOffset.UtcNow;
        var executedRuleIds = new List<string>();
        var produced = new List<FindingCandidate>();
        var transitions = new List<(RuleHealth State, RuleGuardTransition Transition, string RuleName)>();
        var processed = 0;

        foreach (var rule in candidates)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var effective = rule.ApplyOverrides(
                globalOverrides.GetValueOrDefault(rule.Id),
                instanceOverrides.GetValueOrDefault(rule.Id));

            processed++;
            ReportProgress(connection.Id, processed, candidates.Count);

            if (!IsDue(connection.Id, effective, now))
            {
                continue;
            }

            var state = ruleHealth.GetValueOrDefault(rule.Id);

            // Écartée de cette instance seulement, et jamais en silence : l'identifiant remonte
            // ensuite à l'état d'instance et à l'API pour que l'IHM puisse le montrer.
            if (guard.IsQuarantined(state, now) && !guard.TryRelease(state!, now))
            {
                continue;
            }

            var result = await engine.ExecuteAsync(effective, pg, capabilities, connection, cancellationToken);

            if (result.Executed)
            {
                _lastRuleRun[(connection.Id, rule.Id)] = now;
                executedRuleIds.Add(rule.Id);
                produced.AddRange(result.Findings);
            }
            else if (result.Error is not null)
            {
                // Erreur d'exécution : on ne résout pas les findings de cette règle, ils sont
                // simplement laissés en l'état jusqu'au prochain passage réussi.
                logger.LogDebug("Rule {RuleId} did not run on {Instance}: {Error}",
                    rule.Id, connection.Name, result.Error);
            }
            else
            {
                // Règle désactivée ou prérequis non satisfaits : ce n'est pas un incident, et
                // cela ne doit rien coûter au compteur.
                continue;
            }

            if (state is null)
            {
                state = RuleGuard.NewState(connection.Id, rule.Id, now);
                db.RuleHealth.Add(state);
                ruleHealth[rule.Id] = state;
            }

            var transition = guard.Record(state, ToOutcome(result), now);

            if (transition is not RuleGuardTransition.None)
            {
                transitions.Add((state, transition, rule.Definition.Name ?? rule.Id));
            }
        }

        // La liste est reconstruite depuis la mémoire complète de l'instance, et non depuis les
        // seules règles de ce passage : les groupes ne s'exécutent pas au même rythme, et un
        // passage « santé » effacerait sinon les quarantaines des autres groupes.
        var quarantined = ruleHealth.Values
            .Where(h => guard.IsQuarantined(h, now))
            .Select(h => h.RuleId)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        SetState(connection.Id, s => s with { QuarantinedRuleIds = quarantined });

        // Les états sont persistés avant toute notification : une notification renvoie
        // l'identifiant de la ligne, qui doit exister.
        await db.SaveChangesAsync(cancellationToken);
        PublishGuardEvents(connection, transitions);

        if (executedRuleIds.Count == 0)
        {
            return false;
        }

        var reconciliation = await findingService.ReconcileAsync(connection.Id, executedRuleIds, produced, cancellationToken);

        PublishFindingEvents(connection, reconciliation);
        await UpdateHealthAsync(findingService, connection, capabilities, quarantined, cancellationToken);

        return true;
    }

    /// <summary>Traduit le résultat d'exécution en ce que le garde-fou sait consigner.</summary>
    private static RuleRunOutcome ToOutcome(RuleExecutionResult result) => result.Executed
        ? RuleRunOutcome.Success(result.Duration, result.TimeoutSeconds)
        : RuleRunOutcome.Failure(
            result.FailureKind ?? RuleFailureKinds.Error,
            result.Error,
            result.Duration,
            result.TimeoutSeconds);

    /// <summary>
    /// Diffuse et notifie les franchissements de seuil. Une quarantaine fait cesser un
    /// diagnostic : elle ne doit jamais passer inaperçue.
    /// </summary>
    private void PublishGuardEvents(
        PostgresConnection connection,
        IReadOnlyList<(RuleHealth State, RuleGuardTransition Transition, string RuleName)> transitions)
    {
        foreach (var (state, transition, ruleName) in transitions)
        {
            var payload = new
            {
                connectionId = connection.Id,
                connectionName = connection.Name,
                ruleId = state.RuleId,
                ruleName,
                state = state.State,
                strikes = state.Strikes,
                failureKind = state.LastFailureKind,
                message = state.LastFailureMessage,
                quarantinedUntil = state.QuarantinedUntil,
                reason = state.QuarantineReason,
            };

            bus.Publish(
                transition == RuleGuardTransition.Recovered
                    ? AdvisorEventTypes.RuleRecovered
                    : AdvisorEventTypes.RuleGuardChanged,
                payload,
                connection.Id);

            if (RuleGuardNotifications.Event(transition) is not string @event)
            {
                continue;
            }

            logger.LogWarning(
                "Rule {RuleId} on instance {Instance}: {Transition} after {Strikes} incident(s), last one {Kind} — {Message}",
                state.RuleId, connection.Name, transition, state.Strikes,
                state.LastFailureKind, state.LastFailureMessage);

            notifications.Enqueue(new NotificationRequest(
                connection.Id,
                NotificationSubjects.Rule,
                state.Id,
                @event,
                RuleGuardNotifications.Cycle(state, transition),
                RuleGuardNotifications.Severity(transition)));
        }
    }

    private async Task UpdateHealthAsync(
        FindingService findingService,
        PostgresConnection connection,
        PgCapabilities capabilities,
        IReadOnlySet<string> quarantinedRuleIds,
        CancellationToken cancellationToken)
    {
        var weights = await findingService.ActiveWeightsAsync(connection.Id, cancellationToken);
        var score = healthService.Compute(weights, capabilities, quarantinedRuleIds);
        var previous = states.Get(connection.Id).Health;

        SetState(connection.Id, state => state with { Health = score });

        if (previous is null ||
            previous.Global != score.Global ||
            previous.Critical != score.Critical ||
            previous.Warning != score.Warning ||
            previous.Info != score.Info)
        {
            bus.Publish(AdvisorEventTypes.HealthChanged, new
            {
                connectionId = connection.Id,
                connectionName = connection.Name,
                health = score,
            }, connection.Id);
        }
    }

    private void PublishFindingEvents(PostgresConnection connection, ReconciliationResult reconciliation)
    {
        foreach (var finding in reconciliation.Created)
        {
            bus.Publish(AdvisorEventTypes.FindingCreated, Describe(connection, finding), connection.Id);
            notifications.Enqueue(new NotificationRequest(
                connection.Id, NotificationSubjects.Finding, finding.Id,
                NotificationEvents.NewFinding, Cycle(finding), finding.Severity));
        }

        foreach (var finding in reconciliation.Resolved)
        {
            bus.Publish(AdvisorEventTypes.FindingResolved, Describe(connection, finding), connection.Id);
            notifications.Enqueue(new NotificationRequest(
                connection.Id, NotificationSubjects.Finding, finding.Id,
                NotificationEvents.FindingResolved, Cycle(finding), finding.Severity));
        }

        if (reconciliation.Updated.Count > 0)
        {
            bus.Publish(AdvisorEventTypes.FindingUpdated, new
            {
                connectionId = connection.Id,
                count = reconciliation.Updated.Count,
            }, connection.Id);
        }
    }

    /// <summary>Identifiant d'épisode : la déduplication autorise une nouvelle notification après réapparition.</summary>
    private static long Cycle(Finding finding) => finding.DetectedAt.ToUnixTimeSeconds();

    private static object Describe(PostgresConnection connection, Finding finding) => new
    {
        connectionId = connection.Id,
        connectionName = connection.Name,
        findingId = finding.Id,
        ruleId = finding.RuleId,
        category = finding.Category,
        severity = finding.Severity,
        title = finding.Title,
        status = finding.Status,
    };

    private bool IsDue(int connectionId, EffectiveRule effective, DateTimeOffset now)
    {
        if (effective.IntervalSeconds is not int interval)
        {
            return true;
        }

        if (!_lastRuleRun.TryGetValue((connectionId, effective.Id), out var last))
        {
            return true;
        }

        return now - last >= TimeSpan.FromSeconds(interval);
    }

    private async Task<PgCapabilities> ResolveCapabilitiesAsync(
        PostgresConnection connection,
        NpgsqlConnection pg,
        AdvisorDbContext db,
        CancellationToken cancellationToken)
    {
        var cached = states.Get(connection.Id).Capabilities;
        if (cached is not null && DateTimeOffset.UtcNow - cached.DetectedAt < CapabilityRefresh)
        {
            return cached;
        }

        var capabilities = await detector.DetectAsync(pg, cancellationToken);
        SetState(connection.Id, state => state with { Capabilities = capabilities });

        var serialized = JsonSerializer.Serialize(capabilities);
        var changed =
            connection.ServerVersion != capabilities.ServerVersion ||
            connection.TimescaleVersion != capabilities.TimescaleVersion ||
            connection.CapabilitiesJson != serialized;

        if (changed)
        {
            connection.ServerVersion = capabilities.ServerVersion;
            connection.ServerVersionNum = capabilities.ServerVersionNum;
            connection.TimescaleVersion = capabilities.TimescaleVersion;
            connection.CapabilitiesJson = serialized;
            await db.SaveChangesAsync(cancellationToken);

            bus.Publish(AdvisorEventTypes.InstanceChanged, new
            {
                connectionId = connection.Id,
                serverVersion = capabilities.ServerVersion,
                timescaleVersion = capabilities.TimescaleVersion,
            }, connection.Id);
        }

        return capabilities;
    }

    private void ReportProgress(int connectionId, int processed, int total)
    {
        var progress = total == 0 ? 1 : (double)processed / total;
        SetState(connectionId, state => state with { AnalysisProgress = progress });

        // Un événement tous les cinq pas suffit à animer la barre sans inonder le flux SSE.
        if (processed == total || processed % 5 == 0)
        {
            bus.Publish(AdvisorEventTypes.AnalysisProgress, new
            {
                connectionId,
                processed,
                total,
                progress,
            }, connectionId);
        }
    }

    private void SetState(int connectionId, Func<InstanceState, InstanceState> mutate) =>
        states.Update(connectionId, mutate);

    private void PublishCollectionState(int connectionId, string state, string? error) =>
        bus.Publish(AdvisorEventTypes.CollectionState, new { connectionId, state, error }, connectionId);

    private static async Task<(RuleOverride? Global, RuleOverride? PerInstance)> LoadOverridesAsync(
        AdvisorDbContext db, int connectionId, string ruleId, CancellationToken cancellationToken)
    {
        var rows = await db.RuleOverrides
            .Where(o => o.RuleId == ruleId && (o.ConnectionId == null || o.ConnectionId == connectionId))
            .ToListAsync(cancellationToken);

        return (rows.FirstOrDefault(o => o.ConnectionId is null),
                rows.FirstOrDefault(o => o.ConnectionId == connectionId));
    }

    private static string Describe(Exception exception) => exception switch
    {
        PostgresException pg => $"{pg.SqlState} : {pg.MessageText}",
        NpgsqlException npgsql => npgsql.InnerException?.Message ?? npgsql.Message,
        TimeoutException => "Timed out.",
        _ => exception.Message,
    };
}
