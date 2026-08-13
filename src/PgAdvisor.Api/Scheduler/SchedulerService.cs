using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using PgAdvisor.Api.Data;
using PgAdvisor.Api.Findings;
using PgAdvisor.Api.Rules;

namespace PgAdvisor.Api.Scheduler;

/// <summary>
/// Déclencheur périodique des collectes et des analyses. Chaque instance progresse à son
/// rythme : une analyse en cours n'est jamais doublée, une instance lente est bornée par un
/// délai maximal, et le nombre d'instances traitées en parallèle est plafonné.
/// </summary>
public sealed class SchedulerService(
    AnalysisService analysis,
    RuleStore ruleStore,
    IServiceScopeFactory scopeFactory,
    IOptions<AdvisorOptions> options,
    ILogger<SchedulerService> logger) : BackgroundService
{
    private readonly SchedulerOptions _options = options.Value.Scheduler;

    private readonly ConcurrentDictionary<(int ConnectionId, string Group), DateTimeOffset> _lastRun = new();
    private readonly ConcurrentDictionary<int, Task> _running = new();

    private SemaphoreSlim? _slots;
    private volatile bool _purgeRequested;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_options.Enabled)
        {
            logger.LogWarning("Scheduler désactivé par configuration : aucune collecte automatique.");
            return;
        }

        _slots = new SemaphoreSlim(Math.Max(1, _options.MaxConcurrentInstances));

        // Laisse le temps aux migrations et au premier chargement des règles d'aboutir.
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(3), stoppingToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        await PurgeOrphanFindingsAsync(stoppingToken);

        // Une règle supprimée depuis l'IHM laisserait sinon des findings que rien ne peut plus
        // rafraîchir ni résoudre, et qui continueraient de peser sur le score.
        ruleStore.Changed += _ => _purgeRequested = true;

        logger.LogInformation(
            "Scheduler démarré : santé {Health}, statistiques {Statistics}, recommandations {Recommendations}, configuration {Configuration}.",
            _options.Intervals.Health, _options.Intervals.Statistics,
            _options.Intervals.Recommendations, _options.Intervals.Configuration);

        try
        {
            using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                try
                {
                    await TickAsync(stoppingToken);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    logger.LogError(ex, "Cycle du scheduler en échec ; nouvelle tentative au prochain tick.");
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Arrêt normal.
        }

        await Task.WhenAll(_running.Values.ToArray());
    }

    private async Task TickAsync(CancellationToken stoppingToken)
    {
        if (_purgeRequested)
        {
            _purgeRequested = false;
            await PurgeOrphanFindingsAsync(stoppingToken);
        }

        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AdvisorDbContext>();

        var instances = await db.PostgresConnections
            .AsNoTracking()
            .Where(c => c.Enabled)
            .Select(c => new { c.Id, c.Name, c.CollectionIntervalSeconds })
            .ToListAsync(stoppingToken);

        var now = DateTimeOffset.UtcNow;

        foreach (var instance in instances)
        {
            // Une analyse encore en cours a la priorité : on ne superpose jamais deux passages.
            if (_running.TryGetValue(instance.Id, out var pending) && !pending.IsCompleted)
            {
                continue;
            }

            _running.TryRemove(instance.Id, out _);

            var due = DueGroups(instance.Id, instance.CollectionIntervalSeconds, now).ToList();
            if (due.Count == 0)
            {
                continue;
            }

            foreach (var group in due)
            {
                _lastRun[(instance.Id, group)] = now;
            }

            _running[instance.Id] = RunInstanceAsync(instance.Id, instance.Name, due, stoppingToken);
        }

        // Purge des instances supprimées.
        foreach (var key in _lastRun.Keys.Where(k => instances.All(i => i.Id != k.ConnectionId)).ToList())
        {
            _lastRun.TryRemove(key, out _);
        }
    }

    private async Task RunInstanceAsync(
        int connectionId, string name, IReadOnlyCollection<string> groups, CancellationToken stoppingToken)
    {
        var slots = _slots!;
        await slots.WaitAsync(stoppingToken);

        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
            timeout.CancelAfter(_options.PerInstanceTimeout);

            await analysis.RunAsync(connectionId, groups, timeout.Token);
        }
        catch (OperationCanceledException) when (!stoppingToken.IsCancellationRequested)
        {
            logger.LogWarning("Analyse de l'instance « {Name} » interrompue après {Timeout} ; les autres instances continuent.",
                name, _options.PerInstanceTimeout);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "Analyse de l'instance « {Name} » en échec.", name);
        }
        finally
        {
            slots.Release();
        }
    }

    /// <summary>
    /// Groupes dont la périodicité est échue. L'intervalle propre d'une instance remplace celui
    /// du groupe « santé », les autres groupes suivant les périodicités globales.
    /// </summary>
    private IEnumerable<string> DueGroups(int connectionId, int instanceInterval, DateTimeOffset now)
    {
        var intervals = new (string Group, TimeSpan Interval)[]
        {
            (RuleGroups.Health, instanceInterval > 0 ? TimeSpan.FromSeconds(instanceInterval) : _options.Intervals.Health),
            (RuleGroups.Statistics, _options.Intervals.Statistics),
            (RuleGroups.Recommendations, _options.Intervals.Recommendations),
            (RuleGroups.Configuration, _options.Intervals.Configuration),
        };

        foreach (var (group, interval) in intervals)
        {
            if (!_lastRun.TryGetValue((connectionId, group), out var last) || now - last >= interval)
            {
                yield return group;
            }
        }
    }

    /// <summary>
    /// Au démarrage, les findings issus de règles disparues sont supprimés : ils ne pourraient
    /// plus jamais être ni résolus ni rafraîchis.
    /// </summary>
    private async Task PurgeOrphanFindingsAsync(CancellationToken cancellationToken)
    {
        try
        {
            var known = ruleStore.Current.Rules.Select(r => r.Id).ToList();
            if (known.Count == 0)
            {
                return;
            }

            using var scope = scopeFactory.CreateScope();
            var findings = scope.ServiceProvider.GetRequiredService<FindingService>();
            await findings.PurgeOrphansAsync(known, cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Purge des findings orphelins impossible ; poursuite du démarrage.");
        }
    }

    public override void Dispose()
    {
        _slots?.Dispose();
        base.Dispose();
    }
}
