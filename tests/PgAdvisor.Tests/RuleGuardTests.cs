using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using PgAdvisor.Api;
using PgAdvisor.Api.Data;
using PgAdvisor.Api.Findings;
using PgAdvisor.Api.Postgres;
using PgAdvisor.Api.Rules;
using PgAdvisor.Api.Rules.Handlers;
using PgAdvisor.Api.Scheduler;

namespace PgAdvisor.Tests;

/// <summary>
/// Comptage des exécutions coûteuses et franchissement des deux seuils. C'est cette logique qui
/// décide qu'une règle cesse de peser sur une base observée, et à quel moment l'exploitant en
/// est averti : elle est vérifiée sans base ni PostgreSQL.
/// </summary>
public class RuleGuardTests
{
    private const int Timeout = 30;

    private static readonly DateTimeOffset Origin = new(2026, 8, 15, 12, 0, 0, TimeSpan.Zero);

    private static RuleGuard Guard(
        int warning = 3,
        int quarantine = 5,
        double slowRunRatio = 0.8,
        bool enabled = true,
        TimeSpan? quarantineDuration = null) =>
        new(Options.Create(new AdvisorOptions
        {
            Scheduler = new SchedulerOptions
            {
                QueryTimeout = TimeSpan.FromSeconds(Timeout),
                RuleGuard = new RuleGuardOptions
                {
                    Enabled = enabled,
                    WarningThreshold = warning,
                    QuarantineThreshold = quarantine,
                    SlowRunRatio = slowRunRatio,
                    QuarantineDuration = quarantineDuration ?? TimeSpan.FromHours(6),
                },
            },
        }));

    private static RuleHealth State() => RuleGuard.NewState(1, "vacuum.test", Origin);

    private static RuleRunOutcome Timeout_() =>
        RuleRunOutcome.Failure(RuleFailureKinds.Timeout, $"Timed out after {Timeout}s.", TimeSpan.FromSeconds(Timeout), Timeout);

    private static RuleRunOutcome SqlError() =>
        RuleRunOutcome.Failure(RuleFailureKinds.Error, "42P01 : relation \"pg_stat_x\" does not exist", TimeSpan.FromMilliseconds(12), Timeout);

    private static RuleRunOutcome FastSuccess() =>
        RuleRunOutcome.Success(TimeSpan.FromMilliseconds(120), Timeout);

    /// <summary>25 s sous un délai de 30 : réussie, et déjà un problème.</summary>
    private static RuleRunOutcome SlowSuccess() =>
        RuleRunOutcome.Success(TimeSpan.FromSeconds(25), Timeout);

    // --- Comptage -----------------------------------------------------------

    [Fact]
    public void EchecsConsecutifsSaccumulent()
    {
        var guard = Guard();
        var state = State();

        guard.Record(state, SqlError(), Origin);
        guard.Record(state, SqlError(), Origin.AddMinutes(5));

        Assert.Equal(2, state.ConsecutiveFailures);
        Assert.Equal(2, state.Strikes);
        Assert.Equal(RuleHealthStates.Healthy, state.State);
        Assert.Equal(Origin, state.IncidentsSince);
    }

    [Fact]
    public void DepassementDeDelaiEtErreurSqlSontConsignesDifferemment()
    {
        var guard = Guard();

        var timedOut = State();
        guard.Record(timedOut, Timeout_(), Origin);

        var failed = State();
        guard.Record(failed, SqlError(), Origin);

        // Sans cette distinction, l'exploitant ne sait pas s'il doit corriger sa règle ou
        // s'inquiéter de sa base.
        Assert.Equal(RuleFailureKinds.Timeout, timedOut.LastFailureKind);
        Assert.Equal(RuleFailureKinds.Error, failed.LastFailureKind);
        Assert.Contains("does not exist", failed.LastFailureMessage);
    }

    [Fact]
    public void SuccesTropLentCompteCommeUnIncident()
    {
        var guard = Guard();
        var state = State();

        var transition = guard.Record(state, SlowSuccess(), Origin);

        Assert.Equal(RuleGuardTransition.None, transition);
        Assert.Equal(1, state.ConsecutiveSlowRuns);
        Assert.Equal(0, state.ConsecutiveFailures);
        Assert.Equal(RuleFailureKinds.Slow, state.LastFailureKind);
        Assert.Equal(25_000, state.LastDurationMs);
        Assert.NotNull(state.LastSuccessAt);
    }

    [Fact]
    public void SuccesRapideNestPasUnIncident()
    {
        var guard = Guard();
        var state = State();

        Assert.Equal(RuleGuardTransition.None, guard.Record(state, FastSuccess(), Origin));
        Assert.Equal(0, state.Strikes);
        Assert.Null(state.IncidentsSince);
        Assert.Equal(120, state.MaxDurationMs);
    }

    [Fact]
    public void LenteursEtEchecsSeCumulentVersLesSeuils()
    {
        var guard = Guard();
        var state = State();

        guard.Record(state, SlowSuccess(), Origin);
        guard.Record(state, Timeout_(), Origin.AddMinutes(5));
        var transition = guard.Record(state, SlowSuccess(), Origin.AddMinutes(10));

        Assert.Equal(3, state.Strikes);
        Assert.Equal(RuleGuardTransition.Degraded, transition);
    }

    // --- Premier seuil : avertissement --------------------------------------

    [Fact]
    public void PremierSeuilSignaleSansEcarterLaRegle()
    {
        var guard = Guard(warning: 3, quarantine: 5);
        var state = State();

        Assert.Equal(RuleGuardTransition.None, guard.Record(state, Timeout_(), Origin));
        Assert.Equal(RuleGuardTransition.None, guard.Record(state, Timeout_(), Origin.AddMinutes(5)));

        var transition = guard.Record(state, Timeout_(), Origin.AddMinutes(10));

        Assert.Equal(RuleGuardTransition.Degraded, transition);
        Assert.Equal(RuleHealthStates.Degraded, state.State);
        // La règle continue de s'exécuter.
        Assert.False(guard.IsQuarantined(state, Origin.AddMinutes(10)));
    }

    [Fact]
    public void UnMemeEpisodeNestSignaleQuUneFois()
    {
        var guard = Guard(warning: 3, quarantine: 10);
        var state = State();

        for (var i = 0; i < 3; i++)
        {
            guard.Record(state, SqlError(), Origin.AddMinutes(5 * i));
        }

        // Quatrième incident du même épisode : rien de neuf à notifier.
        Assert.Equal(RuleGuardTransition.None, guard.Record(state, SqlError(), Origin.AddMinutes(20)));
        Assert.Equal(RuleHealthStates.Degraded, state.State);
    }

    // --- Second seuil : quarantaine -----------------------------------------

    [Fact]
    public void SecondSeuilMetLaRegleEnQuarantaine()
    {
        var guard = Guard(warning: 3, quarantine: 5, quarantineDuration: TimeSpan.FromHours(6));
        var state = State();

        RuleGuardTransition last = RuleGuardTransition.None;
        for (var i = 0; i < 5; i++)
        {
            last = guard.Record(state, Timeout_(), Origin.AddMinutes(5 * i));
        }

        Assert.Equal(RuleGuardTransition.Quarantined, last);
        Assert.Equal(RuleHealthStates.Quarantined, state.State);
        Assert.Equal(Origin.AddMinutes(20).AddHours(6), state.QuarantinedUntil);
        Assert.Equal(1, state.QuarantineCount);
        Assert.True(guard.IsQuarantined(state, Origin.AddMinutes(30)));

        // Le motif nomme la nature de l'incident, pas seulement son nombre.
        Assert.Contains("statement timeout", state.QuarantineReason);
    }

    [Fact]
    public void MotifDeQuarantaineDistingueLaRegleFautiveDeLInstanceEnSouffrance()
    {
        var guard = Guard(warning: 1, quarantine: 2);

        var timedOut = State();
        guard.Record(timedOut, Timeout_(), Origin);
        guard.Record(timedOut, Timeout_(), Origin.AddMinutes(5));

        var failed = State();
        guard.Record(failed, SqlError(), Origin);
        guard.Record(failed, SqlError(), Origin.AddMinutes(5));

        Assert.Contains("instance is struggling", timedOut.QuarantineReason);
        Assert.Contains("rule itself", failed.QuarantineReason);
    }

    [Fact]
    public void QuarantaineDesactiveeParConfiguration()
    {
        var guard = Guard(enabled: false, quarantine: 2);
        var state = State();

        guard.Record(state, Timeout_(), Origin);
        guard.Record(state, Timeout_(), Origin.AddMinutes(5));

        // Les compteurs tournent toujours, mais rien n'est écarté.
        Assert.Equal(2, state.Strikes);
        Assert.NotEqual(RuleHealthStates.Quarantined, state.State);
        Assert.False(guard.IsQuarantined(state, Origin.AddMinutes(5)));
    }

    // --- Expiration ---------------------------------------------------------

    [Fact]
    public void QuarantaineExpireeRendLaRegleAuPlanificateur()
    {
        var guard = Guard(warning: 1, quarantine: 2, quarantineDuration: TimeSpan.FromHours(6));
        var state = State();

        guard.Record(state, Timeout_(), Origin);
        guard.Record(state, Timeout_(), Origin.AddMinutes(5));

        var beforeDeadline = Origin.AddHours(3);
        Assert.True(guard.IsQuarantined(state, beforeDeadline));
        Assert.False(guard.TryRelease(state, beforeDeadline));

        var afterDeadline = Origin.AddHours(7);
        Assert.True(guard.TryRelease(state, afterDeadline));
        Assert.False(guard.IsQuarantined(state, afterDeadline));
        Assert.Equal(RuleHealthStates.Degraded, state.State);
    }

    [Fact]
    public void UnEssaiRateApresExpirationRemetEnQuarantaineSansAttendre()
    {
        var guard = Guard(warning: 1, quarantine: 2, quarantineDuration: TimeSpan.FromHours(6));
        var state = State();

        guard.Record(state, Timeout_(), Origin);
        guard.Record(state, Timeout_(), Origin.AddMinutes(5));

        var retry = Origin.AddHours(7);
        guard.TryRelease(state, retry);

        // Une règle définitivement fautive ne doit pas coûter un seuil complet à chaque échéance.
        Assert.Equal(RuleGuardTransition.Quarantined, guard.Record(state, Timeout_(), retry));
        Assert.Equal(2, state.QuarantineCount);
        Assert.Equal(retry.AddHours(6), state.QuarantinedUntil);
    }

    [Fact]
    public void UnEssaiReussiApresExpirationEfface()
    {
        var guard = Guard(warning: 1, quarantine: 2, quarantineDuration: TimeSpan.FromHours(6));
        var state = State();

        guard.Record(state, Timeout_(), Origin);
        guard.Record(state, Timeout_(), Origin.AddMinutes(5));

        var retry = Origin.AddHours(7);
        guard.TryRelease(state, retry);

        Assert.Equal(RuleGuardTransition.Recovered, guard.Record(state, FastSuccess(), retry));
        Assert.Equal(RuleHealthStates.Healthy, state.State);
        Assert.Equal(0, state.QuarantineCount);
    }

    // --- Remise à zéro par un succès ----------------------------------------

    [Fact]
    public void SuccesRapideEffaceLArdoise()
    {
        var guard = Guard(warning: 3, quarantine: 5);
        var state = State();

        guard.Record(state, SqlError(), Origin);
        guard.Record(state, SqlError(), Origin.AddMinutes(5));
        guard.Record(state, SqlError(), Origin.AddMinutes(10));
        Assert.Equal(RuleHealthStates.Degraded, state.State);

        var transition = guard.Record(state, FastSuccess(), Origin.AddMinutes(15));

        Assert.Equal(RuleGuardTransition.Recovered, transition);
        Assert.Equal(0, state.Strikes);
        Assert.Equal(0, state.ConsecutiveFailures);
        Assert.Equal(0, state.ConsecutiveSlowRuns);
        Assert.Equal(RuleHealthStates.Healthy, state.State);
        Assert.Null(state.IncidentsSince);
        Assert.Null(state.QuarantinedUntil);
    }

    [Fact]
    public void UnIncidentAncienNeCondamnePasUneRegleRedevenueSaine()
    {
        var guard = Guard(warning: 3, quarantine: 5);
        var state = State();

        // Quatre incidents espacés d'un succès : le seuil de quarantaine n'est jamais atteint.
        for (var i = 0; i < 4; i++)
        {
            guard.Record(state, SqlError(), Origin.AddMinutes(10 * i));
            guard.Record(state, FastSuccess(), Origin.AddMinutes(10 * i + 5));
        }

        Assert.Equal(RuleHealthStates.Healthy, state.State);
        Assert.Equal(0, state.Strikes);
    }

    [Fact]
    public void SuccesTropLentNeffacePasLArdoise()
    {
        var guard = Guard(warning: 3, quarantine: 5);
        var state = State();

        guard.Record(state, SqlError(), Origin);
        guard.Record(state, SlowSuccess(), Origin.AddMinutes(5));

        Assert.Equal(2, state.Strikes);
        Assert.NotNull(state.IncidentsSince);
    }

    [Fact]
    public void ReactivationManuelleLeveLaQuarantaineImmediatement()
    {
        var guard = Guard(warning: 1, quarantine: 2);
        var state = State();

        guard.Record(state, Timeout_(), Origin);
        guard.Record(state, Timeout_(), Origin.AddMinutes(5));
        Assert.True(guard.IsQuarantined(state, Origin.AddMinutes(10)));

        RuleGuard.Reactivate(state, Origin.AddMinutes(10));

        Assert.False(guard.IsQuarantined(state, Origin.AddMinutes(10)));
        Assert.Equal(RuleHealthStates.Healthy, state.State);
        Assert.Equal(0, state.Strikes);
        Assert.Null(state.QuarantineReason);
    }

    // --- Seuils et ratio ----------------------------------------------------

    [Fact]
    public void SeuilDeQuarantaineJamaisInferieurAuSeuilDAvertissement()
    {
        var guard = Guard(warning: 5, quarantine: 2);
        Assert.Equal(5, guard.QuarantineThreshold);
    }

    [Theory]
    [InlineData(29_000, true)]
    [InlineData(24_000, true)]
    [InlineData(23_999, false)]
    [InlineData(500, false)]
    public void RatioDeLenteurBorneLeBudgetAcceptable(double durationMs, bool slow)
    {
        var guard = Guard(slowRunRatio: 0.8);
        var outcome = RuleRunOutcome.Success(TimeSpan.FromMilliseconds(durationMs), Timeout);

        Assert.Equal(slow, guard.IsSlow(outcome));
    }

    [Fact]
    public void RatioNulDesactiveLaDetectionDeLenteur()
    {
        var guard = Guard(slowRunRatio: 0);
        Assert.False(guard.IsSlow(RuleRunOutcome.Success(TimeSpan.FromSeconds(29), Timeout)));
    }

    // --- Notifications ------------------------------------------------------

    [Fact]
    public void ChaqueSeuilPorteSonEvenementEtSaSeverite()
    {
        Assert.Equal(NotificationEvents.RuleDegraded, RuleGuardNotifications.Event(RuleGuardTransition.Degraded));
        Assert.Equal(NotificationEvents.RuleQuarantined, RuleGuardNotifications.Event(RuleGuardTransition.Quarantined));
        Assert.Null(RuleGuardNotifications.Event(RuleGuardTransition.Recovered));

        Assert.Equal(Severities.Warning, RuleGuardNotifications.Severity(RuleGuardTransition.Degraded));
        Assert.Equal(Severities.Critical, RuleGuardNotifications.Severity(RuleGuardTransition.Quarantined));
    }

    [Fact]
    public void UnNouvelEpisodeChangeDeCycleDeDeduplication()
    {
        var guard = Guard(warning: 2, quarantine: 10);
        var state = State();

        guard.Record(state, SqlError(), Origin);
        guard.Record(state, SqlError(), Origin.AddMinutes(5));
        var first = RuleGuardNotifications.Cycle(state, RuleGuardTransition.Degraded);

        guard.Record(state, FastSuccess(), Origin.AddMinutes(10));

        guard.Record(state, SqlError(), Origin.AddMinutes(15));
        guard.Record(state, SqlError(), Origin.AddMinutes(20));
        var second = RuleGuardNotifications.Cycle(state, RuleGuardTransition.Degraded);

        // Le même épisode n'est jamais renotifié, une rechute après rétablissement l'est.
        Assert.NotEqual(first, second);
    }
}

/// <summary>
/// Le garde-fou n'a de sens que si sa mémoire survit à un redémarrage : sans persistance, le
/// compteur repartirait de zéro à chaque relance et le second seuil ne serait jamais atteint.
/// </summary>
public sealed class RuleHealthPersistenceTests : IAsyncLifetime
{
    private SqliteConnection _connection = null!;
    private AdvisorDbContext _db = null!;
    private int _first;
    private int _second;

    private readonly RuleGuard _guard = new(Options.Create(new AdvisorOptions
    {
        Scheduler = new SchedulerOptions
        {
            RuleGuard = new RuleGuardOptions { WarningThreshold = 2, QuarantineThreshold = 3 },
        },
    }));

    public async Task InitializeAsync()
    {
        _connection = new SqliteConnection("Filename=:memory:");
        await _connection.OpenAsync();

        _db = NewContext();
        await _db.Database.EnsureCreatedAsync();

        _first = await AddInstanceAsync("gros-volume");
        _second = await AddInstanceAsync("petit-volume");
    }

    public async Task DisposeAsync()
    {
        await _db.DisposeAsync();
        await _connection.DisposeAsync();
    }

    private AdvisorDbContext NewContext() =>
        new(new DbContextOptionsBuilder<AdvisorDbContext>().UseSqlite(_connection).Options);

    private async Task<int> AddInstanceAsync(string name)
    {
        var instance = new PostgresConnection
        {
            Name = name,
            Host = "localhost",
            Database = name,
            Username = "advisor",
            CreatedAt = DateTimeOffset.UtcNow,
        };

        _db.PostgresConnections.Add(instance);
        await _db.SaveChangesAsync();
        return instance.Id;
    }

    private static RuleRunOutcome Timeout() =>
        RuleRunOutcome.Failure(RuleFailureKinds.Timeout, "Timed out after 30s.", TimeSpan.FromSeconds(30), 30);

    [Fact]
    public async Task LaMemoireSurvitAUnRedemarrage()
    {
        var now = DateTimeOffset.UtcNow;
        var state = RuleGuard.NewState(_first, "vacuum.test", now);
        _db.RuleHealth.Add(state);

        _guard.Record(state, Timeout(), now);
        _guard.Record(state, Timeout(), now.AddMinutes(5));
        await _db.SaveChangesAsync();

        // Nouveau contexte sur la même base : c'est ce que voit l'Advisor après une relance.
        await using var restarted = NewContext();
        var reloaded = await restarted.RuleHealth.SingleAsync();

        Assert.Equal(2, reloaded.ConsecutiveFailures);
        Assert.Equal(RuleFailureKinds.Timeout, reloaded.LastFailureKind);

        // Le troisième incident, après redémarrage, franchit bien le seuil de quarantaine.
        Assert.Equal(RuleGuardTransition.Quarantined, _guard.Record(reloaded, Timeout(), now.AddMinutes(10)));
    }

    [Fact]
    public async Task LaQuarantaineEstToujoursParCoupleRegleInstance()
    {
        var now = DateTimeOffset.UtcNow;

        var suffocating = RuleGuard.NewState(_first, "vacuum.test", now);
        var healthy = RuleGuard.NewState(_second, "vacuum.test", now);
        _db.RuleHealth.AddRange(suffocating, healthy);

        for (var i = 0; i < 3; i++)
        {
            _guard.Record(suffocating, Timeout(), now.AddMinutes(5 * i));
        }

        _guard.Record(healthy, RuleRunOutcome.Success(TimeSpan.FromMilliseconds(80), 30), now);
        await _db.SaveChangesAsync();

        // Une règle qui suffoque sur une base de 2 To ne doit pas être coupée sur les autres.
        Assert.True(_guard.IsQuarantined(suffocating, now.AddMinutes(20)));
        Assert.False(_guard.IsQuarantined(healthy, now.AddMinutes(20)));
    }

    [Fact]
    public async Task UneSeuleLigneParCoupleRegleInstance()
    {
        var now = DateTimeOffset.UtcNow;
        _db.RuleHealth.Add(RuleGuard.NewState(_first, "vacuum.test", now));
        await _db.SaveChangesAsync();

        _db.RuleHealth.Add(RuleGuard.NewState(_first, "vacuum.test", now));

        await Assert.ThrowsAsync<DbUpdateException>(() => _db.SaveChangesAsync());
    }

    [Fact]
    public async Task SuppressionDeLInstanceSupprimeSaMemoireDeRegles()
    {
        _db.RuleHealth.Add(RuleGuard.NewState(_first, "vacuum.test", DateTimeOffset.UtcNow));
        await _db.SaveChangesAsync();

        _db.PostgresConnections.Remove(await _db.PostgresConnections.SingleAsync(c => c.Id == _first));
        await _db.SaveChangesAsync();

        Assert.Equal(0, await _db.RuleHealth.CountAsync(h => h.ConnectionId == _first));
    }
}

/// <summary>
/// Délai maximal propre à une règle : validation du champ YAML, surcharge par instance, et
/// valeur par défaut reprise du délai global.
/// </summary>
public class RuleTimeoutTests
{
    private static readonly RuleLoader Loader = new(
        new RuleHandlerRegistry([]), NullLogger<RuleLoader>.Instance);

    private static string Yaml(string? timeout = null) => $"""
        id: vacuum.test
        version: 1
        name: Test
        category: vacuum
        severity: warning
        {(timeout is null ? string.Empty : $"timeoutSeconds: {timeout}")}
        query: |
          SELECT relname FROM pg_stat_user_tables
        recommendation:
          title: "Test"
        """;

    [Fact]
    public void DelaiPropreEstAccepteEtCompile()
    {
        var compilation = Loader.Compile(Yaml("120"), "test.yaml", RuleOrigin.User);

        Assert.True(compilation.Succeeded, string.Join(" / ", compilation.Errors));
        Assert.Equal(120, compilation.Rule!.Definition.TimeoutSeconds);
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-5")]
    [InlineData("600")]
    public void DelaiHorsBornesEstRefuse(string timeout)
    {
        var compilation = Loader.Compile(Yaml(timeout), "test.yaml", RuleOrigin.User);

        Assert.False(compilation.Succeeded);
        Assert.Contains(compilation.Errors, e => e.Contains("timeoutSeconds"));
    }

    [Fact]
    public void SansDelaiPropreLeDelaiGlobalSapplique()
    {
        var rule = Loader.Compile(Yaml(), "test.yaml", RuleOrigin.User).Rule!;
        var effective = rule.ApplyOverrides(null, null);

        Assert.Null(effective.TimeoutSeconds);
        Assert.Equal(30, effective.ResolveTimeoutSeconds(TimeSpan.FromSeconds(30)));
    }

    [Fact]
    public void SurchargeDInstanceLemporteSurLeFichierEtSurLaSurchargeGlobale()
    {
        var rule = Loader.Compile(Yaml("60"), "test.yaml", RuleOrigin.User).Rule!;

        var global = new RuleOverride { RuleId = "vacuum.test", TimeoutSeconds = 90 };
        var perInstance = new RuleOverride { RuleId = "vacuum.test", TimeoutSeconds = 180 };

        Assert.Equal(60, rule.ApplyOverrides(null, null).ResolveTimeoutSeconds(TimeSpan.FromSeconds(30)));
        Assert.Equal(90, rule.ApplyOverrides(global, null).ResolveTimeoutSeconds(TimeSpan.FromSeconds(30)));
        Assert.Equal(180, rule.ApplyOverrides(global, perInstance).ResolveTimeoutSeconds(TimeSpan.FromSeconds(30)));
    }

    [Fact]
    public void DelaiGlobalAberrantResteBorne()
    {
        var rule = Loader.Compile(Yaml(), "test.yaml", RuleOrigin.User).Rule!;
        var effective = rule.ApplyOverrides(null, null);

        Assert.Equal(RuleLimits.MaxTimeoutSeconds, effective.ResolveTimeoutSeconds(TimeSpan.FromHours(1)));
        Assert.Equal(RuleLimits.MinTimeoutSeconds, effective.ResolveTimeoutSeconds(TimeSpan.Zero));
    }
}

/// <summary>
/// Une quarantaine ne doit jamais faire disparaître un diagnostic en silence : la catégorie
/// d'une règle écartée cesse d'être notée, au lieu d'afficher 100 comme si tout allait bien.
/// </summary>
public sealed class QuarantineScoreTests : IDisposable
{
    private readonly string _directory = Directory.CreateTempSubdirectory("pg-advisor-tests").FullName;
    private readonly InstanceHealthService _health;

    private static readonly PgCapabilities Capabilities = new()
    {
        ServerVersion = "17.0",
        ServerVersionNum = 170_000,
        Views = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "pg_stat_user_tables" },
    };

    public QuarantineScoreTests()
    {
        Write("vacuum.dead-tuples", "vacuum");
        Write("indexes.unused", "indexes");

        var options = Options.Create(new AdvisorOptions
        {
            RulesDirectory = _directory,
            DataDirectory = Path.Combine(_directory, "data"),
        });

        var store = new RuleStore(
            new RuleLoader(new RuleHandlerRegistry([]), NullLogger<RuleLoader>.Instance),
            options,
            NullLogger<RuleStore>.Instance);

        store.Reload();
        _health = new InstanceHealthService(new HealthScoreCalculator(), store);
    }

    public void Dispose() => Directory.Delete(_directory, recursive: true);

    private void Write(string id, string category) => File.WriteAllText(
        Path.Combine(_directory, $"{id}.yaml"),
        $"""
        id: {id}
        version: 1
        name: {id}
        category: {category}
        severity: warning
        query: |
          SELECT relname FROM pg_stat_user_tables
        recommendation:
          title: "Test"
        """);

    [Fact]
    public void SansQuarantaineLesDeuxCategoriesSontNotees()
    {
        var score = _health.Compute([], Capabilities);

        Assert.Equal(100, score.Categories["vacuum"]);
        Assert.Equal(100, score.Categories["indexes"]);
    }

    [Fact]
    public void UneRegleEcarteeRetireSaCategorieDuScore()
    {
        var quarantined = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "indexes.unused" };

        var score = _health.Compute([], Capabilities, quarantined);

        // Personne n'a regardé les index : le score ne doit pas affirmer qu'ils vont bien.
        Assert.True(score.Categories.ContainsKey("vacuum"));
        Assert.False(score.Categories.ContainsKey("indexes"));
    }

    [Fact]
    public void UneQuarantaineNeFaitPasDisparaitreUnDiagnosticDejaEtabli()
    {
        var quarantined = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "indexes.unused" };

        var score = _health.Compute(
            [new FindingWeight("indexes", Severities.Critical)], Capabilities, quarantined);

        // Le finding produit avant la quarantaine continue de peser : il n'est pas résolu.
        Assert.Equal(75, score.Categories["indexes"]);
    }
}
