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
            logger.LogWarning("Analyse de l'instance « {Name} » en échec : {Message}", connection.Name, message);

            connection.LastError = message;
            connection.LastCollectedAt = DateTimeOffset.UtcNow;

            try
            {
                await db.SaveChangesAsync(cancellationToken);
            }
            catch (Exception saveError)
            {
                logger.LogError(saveError, "Enregistrement de l'erreur d'analyse impossible pour l'instance {Id}.", connectionId);
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
            ?? throw new InvalidOperationException("Instance inconnue.");

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

        var now = DateTimeOffset.UtcNow;
        var executedRuleIds = new List<string>();
        var produced = new List<FindingCandidate>();
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
                logger.LogDebug("Règle {RuleId} non exécutée sur {Instance} : {Error}",
                    rule.Id, connection.Name, result.Error);
            }
        }

        if (executedRuleIds.Count == 0)
        {
            return false;
        }

        var reconciliation = await findingService.ReconcileAsync(connection.Id, executedRuleIds, produced, cancellationToken);

        PublishFindingEvents(connection, reconciliation);
        await UpdateHealthAsync(findingService, connection, capabilities, cancellationToken);

        return true;
    }

    private async Task UpdateHealthAsync(
        FindingService findingService,
        PostgresConnection connection,
        PgCapabilities capabilities,
        CancellationToken cancellationToken)
    {
        var weights = await findingService.ActiveWeightsAsync(connection.Id, cancellationToken);
        var score = healthService.Compute(weights, capabilities);
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
                connection.Id, finding.Id, NotificationEvents.NewFinding, Cycle(finding), finding.Severity));
        }

        foreach (var finding in reconciliation.Resolved)
        {
            bus.Publish(AdvisorEventTypes.FindingResolved, Describe(connection, finding), connection.Id);
            notifications.Enqueue(new NotificationRequest(
                connection.Id, finding.Id, NotificationEvents.FindingResolved, Cycle(finding), finding.Severity));
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
        TimeoutException => "Délai d'attente dépassé.",
        _ => exception.Message,
    };
}
