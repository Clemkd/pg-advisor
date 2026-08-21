using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using PgAdvisor.Api.Data;
using PgAdvisor.Api.Findings;
using PgAdvisor.Api.Rules;

namespace PgAdvisor.Tests;

/// <summary>
/// Two writers compete for a finding's status: the engine, which resolves what it no longer
/// detects, and the operator, who ignores what they have decided to live with. The engine works
/// from a read taken before the analysis started, so without a concurrency token its resolution
/// silently undid a decision taken in between.
/// </summary>
public sealed class FindingConcurrencyTests : IAsyncLifetime
{
    private SqliteConnection _connection = null!;
    private AdvisorDbContext _engineDb = null!;
    private AdvisorDbContext _operatorDb = null!;
    private FindingService _engine = null!;
    private FindingService _operator = null!;
    private int _connectionId;

    public async Task InitializeAsync()
    {
        _connection = new SqliteConnection("Filename=:memory:");
        await _connection.OpenAsync();

        _engineDb = NewContext();
        _operatorDb = NewContext();

        await _engineDb.Database.EnsureCreatedAsync();

        var instance = new PostgresConnection
        {
            Name = "test",
            Host = "localhost",
            Database = "test",
            Username = "test",
            CreatedAt = DateTimeOffset.UtcNow,
        };

        _engineDb.PostgresConnections.Add(instance);
        await _engineDb.SaveChangesAsync();
        _connectionId = instance.Id;

        _engine = new FindingService(_engineDb, NullLogger<FindingService>.Instance);
        _operator = new FindingService(_operatorDb, NullLogger<FindingService>.Instance);
    }

    private AdvisorDbContext NewContext() =>
        new(new DbContextOptionsBuilder<AdvisorDbContext>().UseSqlite(_connection).Options);

    public async Task DisposeAsync()
    {
        await _engineDb.DisposeAsync();
        await _operatorDb.DisposeAsync();
        await _connection.DisposeAsync();
    }

    private static FindingCandidate Candidate() => new()
    {
        RuleId = "vacuum.test",
        RuleVersion = 1,
        TargetKey = "public/orders",
        Category = "vacuum",
        Severity = Severities.Critical,
        Title = "Title",
        Message = "Message",
    };

    [Fact]
    public async Task IgnoringAFindingSurvivesAnAnalysisThatWasAlreadyRunning()
    {
        // The finding exists and is active.
        await _engine.ReconcileAsync(_connectionId, ["vacuum.test"], [Candidate()], default);
        var id = await _engineDb.Findings.Select(f => f.Id).SingleAsync();

        // The engine's context still holds the finding as it read it: active. That stale read is
        // exactly what an analysis carries while it works through an instance — no timing needed
        // to reproduce it, and none to make this test deterministic.
        Assert.Equal(FindingStatus.Active, _engineDb.Findings.Local.Single().Status);

        // The operator ignores it in the meantime, from their own context.
        await _operator.ChangeStatusAsync(id, FindingStatus.Ignored, "operator", null, default);

        // The analysis finishes and no longer detects it, so it would resolve it.
        await _engine.ReconcileAsync(_connectionId, ["vacuum.test"], [], default);

        // The decision stands: the engine yielded rather than resolving it from a stale read.
        using var check = NewContext();
        var stored = await check.Findings.SingleAsync(f => f.Id == id);
        Assert.Equal(FindingStatus.Ignored, stored.Status);
    }

    [Fact]
    public async Task TheEngineStillResolvesWhatNobodyTouched()
    {
        await _engine.ReconcileAsync(_connectionId, ["vacuum.test"], [Candidate()], default);
        _engineDb.ChangeTracker.Clear();

        await _engine.ReconcileAsync(_connectionId, ["vacuum.test"], [], default);

        using var check = NewContext();
        var stored = await check.Findings.SingleAsync();
        Assert.Equal(FindingStatus.Resolved, stored.Status);
    }

    [Fact]
    public async Task ASecondOperatorGetsTheStoredStatusRatherThanAPhantomTransition()
    {
        await _engine.ReconcileAsync(_connectionId, ["vacuum.test"], [Candidate()], default);
        var id = await _engineDb.Findings.Select(f => f.Id).SingleAsync();

        // Both read the finding as active, then both act on it.
        var first = await _operatorDb.Findings.SingleAsync(f => f.Id == id);
        Assert.Equal(FindingStatus.Active, first.Status);

        using var otherDb = NewContext();
        var other = new FindingService(otherDb, NullLogger<FindingService>.Instance);
        await other.ChangeStatusAsync(id, FindingStatus.Ignored, "someone else", null, default);

        var result = await _operator.ChangeStatusAsync(id, FindingStatus.Resolved, "operator", null, default);

        Assert.NotNull(result);
        Assert.Equal(FindingStatus.Ignored, result.Status);
    }
}
