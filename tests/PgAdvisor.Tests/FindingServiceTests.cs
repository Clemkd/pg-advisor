using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using PgAdvisor.Api.Data;
using PgAdvisor.Api.Findings;
using PgAdvisor.Api.Rules;

namespace PgAdvisor.Tests;

/// <summary>
/// Cycle de vie des findings, sur une base SQLite en mémoire : c'est la logique qui décide
/// ce que voit l'opérateur et ce qui déclenche une notification.
/// </summary>
public sealed class FindingServiceTests : IAsyncLifetime
{
    private SqliteConnection _connection = null!;
    private AdvisorDbContext _db = null!;
    private FindingService _service = null!;
    private int _connectionId;

    public async Task InitializeAsync()
    {
        _connection = new SqliteConnection("Filename=:memory:");
        await _connection.OpenAsync();

        _db = new AdvisorDbContext(
            new DbContextOptionsBuilder<AdvisorDbContext>().UseSqlite(_connection).Options);

        await _db.Database.EnsureCreatedAsync();

        var instance = new PostgresConnection
        {
            Name = "test",
            Host = "localhost",
            Database = "test",
            Username = "test",
            CreatedAt = DateTimeOffset.UtcNow,
        };

        _db.PostgresConnections.Add(instance);
        await _db.SaveChangesAsync();
        _connectionId = instance.Id;

        _service = new FindingService(_db, NullLogger<FindingService>.Instance);
    }

    public async Task DisposeAsync()
    {
        await _db.DisposeAsync();
        await _connection.DisposeAsync();
    }

    private static FindingCandidate Candidate(string target = "public/orders", string severity = Severities.Warning) => new()
    {
        RuleId = "vacuum.test",
        RuleVersion = 1,
        TargetKey = target,
        Category = "vacuum",
        Severity = severity,
        Title = "Titre",
        Message = "Message",
        Evidence = new Dictionary<string, object?> { ["n_dead_tup"] = 5000 },
    };

    [Fact]
    public async Task PremierPassageCreeLeFinding()
    {
        var result = await _service.ReconcileAsync(_connectionId, ["vacuum.test"], [Candidate()], default);

        Assert.Single(result.Created);
        Assert.Empty(result.Resolved);

        var finding = await _db.Findings.SingleAsync();
        Assert.Equal(FindingStatus.Active, finding.Status);
        Assert.Equal(1, finding.OccurrenceCount);
        Assert.Contains("n_dead_tup", finding.EvidenceJson);

        var history = await _db.FindingHistory.SingleAsync();
        Assert.Equal(FindingStatus.Active, history.ToStatus);
    }

    [Fact]
    public async Task SecondPassageMetAJourSansRecreer()
    {
        await _service.ReconcileAsync(_connectionId, ["vacuum.test"], [Candidate()], default);
        var result = await _service.ReconcileAsync(_connectionId, ["vacuum.test"], [Candidate()], default);

        Assert.Empty(result.Created);
        Assert.Single(result.Updated);

        var finding = await _db.Findings.SingleAsync();
        Assert.Equal(2, finding.OccurrenceCount);
    }

    [Fact]
    public async Task DisparitionResoutLeFinding()
    {
        await _service.ReconcileAsync(_connectionId, ["vacuum.test"], [Candidate()], default);
        var result = await _service.ReconcileAsync(_connectionId, ["vacuum.test"], [], default);

        Assert.Single(result.Resolved);

        var finding = await _db.Findings.SingleAsync();
        Assert.Equal(FindingStatus.Resolved, finding.Status);
        Assert.NotNull(finding.ResolvedAt);
    }

    [Fact]
    public async Task RegleNonExecuteeNeResoutPasSesFindings()
    {
        await _service.ReconcileAsync(_connectionId, ["vacuum.test"], [Candidate()], default);

        // La règle a échoué ou a été écartée : elle n'est pas dans la liste des règles exécutées.
        var result = await _service.ReconcileAsync(_connectionId, ["indexes.autre"], [], default);

        Assert.Empty(result.Resolved);
        Assert.Equal(FindingStatus.Active, (await _db.Findings.SingleAsync()).Status);
    }

    [Fact]
    public async Task ReapparitionRelanceUnNouveauCycle()
    {
        await _service.ReconcileAsync(_connectionId, ["vacuum.test"], [Candidate()], default);
        await _service.ReconcileAsync(_connectionId, ["vacuum.test"], [], default);

        var result = await _service.ReconcileAsync(_connectionId, ["vacuum.test"], [Candidate()], default);

        // Réapparition traitée comme une création : elle doit être notifiée à nouveau.
        Assert.Single(result.Created);

        var finding = await _db.Findings.SingleAsync();
        Assert.Equal(FindingStatus.Active, finding.Status);
        Assert.Null(finding.ResolvedAt);

        var statuses = await _db.FindingHistory.OrderBy(h => h.Id).Select(h => h.ToStatus).ToListAsync();
        Assert.Equal([FindingStatus.Active, FindingStatus.Resolved, FindingStatus.Active], statuses);
    }

    [Fact]
    public async Task FindingIgnoreResteIgnoreEtNestPasNotifie()
    {
        await _service.ReconcileAsync(_connectionId, ["vacuum.test"], [Candidate()], default);
        var finding = await _db.Findings.SingleAsync();
        await _service.ChangeStatusAsync(finding.Id, FindingStatus.Ignored, "operateur", "bruit connu", default);

        var result = await _service.ReconcileAsync(_connectionId, ["vacuum.test"], [Candidate()], default);

        Assert.Empty(result.Created);
        Assert.Empty(result.Updated);
        Assert.Equal(FindingStatus.Ignored, (await _db.Findings.SingleAsync()).Status);
    }

    [Fact]
    public async Task CiblesDistinctesDonnentDesFindingsDistincts()
    {
        await _service.ReconcileAsync(
            _connectionId,
            ["vacuum.test"],
            [Candidate("public/orders"), Candidate("public/clients")],
            default);

        Assert.Equal(2, await _db.Findings.CountAsync());
    }

    [Fact]
    public async Task ChangementDeSeveriteEstRepercute()
    {
        await _service.ReconcileAsync(_connectionId, ["vacuum.test"], [Candidate()], default);
        await _service.ReconcileAsync(
            _connectionId, ["vacuum.test"], [Candidate(severity: Severities.Critical)], default);

        Assert.Equal(Severities.Critical, (await _db.Findings.SingleAsync()).Severity);
    }

    [Fact]
    public async Task PoidsActifsExcluentResolusEtIgnores()
    {
        await _service.ReconcileAsync(
            _connectionId,
            ["vacuum.test"],
            [Candidate("a"), Candidate("b"), Candidate("c")],
            default);

        var findings = await _db.Findings.OrderBy(f => f.TargetKey).ToListAsync();
        await _service.ChangeStatusAsync(findings[0].Id, FindingStatus.Ignored, null, null, default);
        await _service.ChangeStatusAsync(findings[1].Id, FindingStatus.Resolved, null, null, default);

        var weights = await _service.ActiveWeightsAsync(_connectionId, default);

        Assert.Single(weights);
        Assert.Equal("vacuum", weights[0].Category);
    }

    [Fact]
    public async Task TriParHorodatageEstTraduitParSqlite()
    {
        // SQLite refuse l'ORDER BY sur un DateTimeOffset stocké en texte : ce test verrouille
        // la conversion en ticks, sans laquelle la liste des recommandations renvoie une 500.
        await _service.ReconcileAsync(
            _connectionId,
            ["vacuum.test"],
            [Candidate("a"), Candidate("b", Severities.Critical), Candidate("c", Severities.Info)],
            default);

        var page = await _db.Findings
            .OrderByDescending(f => f.Severity == Severities.Critical)
            .ThenByDescending(f => f.LastSeenAt)
            .ThenByDescending(f => f.DetectedAt)
            .Skip(0)
            .Take(2)
            .ToListAsync();

        Assert.Equal(2, page.Count);
        Assert.Equal(Severities.Critical, page[0].Severity);

        var history = await _db.FindingHistory.OrderByDescending(h => h.At).ToListAsync();
        Assert.Equal(3, history.Count);
    }

    [Fact]
    public async Task ComparaisonDHorodatageEstTraduiteParSqlite()
    {
        await _service.ReconcileAsync(_connectionId, ["vacuum.test"], [Candidate()], default);

        var seuil = DateTimeOffset.UtcNow.AddMinutes(-5);
        Assert.Equal(1, await _db.Findings.CountAsync(f => f.DetectedAt > seuil));
        Assert.Equal(0, await _db.Findings.CountAsync(f => f.DetectedAt < seuil));
    }

    [Fact]
    public async Task PurgeSupprimeLesFindingsDeReglesDisparues()
    {
        await _service.ReconcileAsync(_connectionId, ["vacuum.test"], [Candidate()], default);

        var removed = await _service.PurgeOrphansAsync(["une.autre.regle"], default);

        Assert.Equal(1, removed);
        Assert.Equal(0, await _db.Findings.CountAsync());
    }

    [Fact]
    public async Task PurgeConserveLesFindingsDeReglesConnues()
    {
        await _service.ReconcileAsync(_connectionId, ["vacuum.test"], [Candidate()], default);

        Assert.Equal(0, await _service.PurgeOrphansAsync(["vacuum.test"], default));
        Assert.Equal(1, await _db.Findings.CountAsync());
    }

    [Fact]
    public async Task SuppressionDeLInstanceSupprimeSesFindings()
    {
        await _service.ReconcileAsync(_connectionId, ["vacuum.test"], [Candidate()], default);

        _db.PostgresConnections.Remove(await _db.PostgresConnections.SingleAsync());
        await _db.SaveChangesAsync();

        Assert.Equal(0, await _db.Findings.CountAsync());
    }
}
