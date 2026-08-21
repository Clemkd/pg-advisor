using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PgAdvisor.Api.Data;
using PgAdvisor.Api.Findings;
using PgAdvisor.Api.Models;
using PgAdvisor.Api.Rules;
using PgAdvisor.Api.Scheduler;
using PgAdvisor.Api.Services;
using PgAdvisor.Api.State;

namespace PgAdvisor.Api.Controllers;

[ApiController]
[Route("api/dashboard")]
public sealed class DashboardController(
    AdvisorDbContext db,
    ConnectionPresenter presenter,
    InstanceHealthService health,
    InstanceStateStore states,
    RuleGuard guard,
    RuleStore ruleStore) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<DashboardResponse>> Get(CancellationToken ct)
    {
        var connections = await db.PostgresConnections.OrderBy(c => c.Name).ToListAsync(ct);

        var weights = await db.Findings
            .Where(f => f.Status == FindingStatus.Active)
            .Select(f => new { f.ConnectionId, f.Category, f.Severity })
            .ToListAsync(ct);

        var byConnection = weights
            .GroupBy(w => w.ConnectionId)
            .ToDictionary(g => g.Key, g => g.Select(w => new FindingWeight(w.Category, w.Severity)).ToList());

        // Quarantines come from the database: they survived the last restart, unlike the
        // instances' volatile state.
        var now = DateTimeOffset.UtcNow;
        var quarantined = (await db.RuleHealth
                .AsNoTracking()
                .Where(h => h.State == RuleHealthStates.Quarantined)
                .ToListAsync(ct))
            .Where(h => guard.IsQuarantined(h, now))
            .GroupBy(h => h.ConnectionId)
            .ToDictionary(
                g => g.Key,
                g => (IReadOnlySet<string>)g.Select(h => h.RuleId).ToHashSet(StringComparer.OrdinalIgnoreCase));

        var instances = new List<ConnectionResponse>(connections.Count);

        foreach (var connection in connections)
        {
            var excluded = quarantined.GetValueOrDefault(connection.Id);

            // Le score du scheduler fait référence ; à froid, il est recalculé à l'identique.
            var score = states.Get(connection.Id).Health
                ?? health.Compute(
                    byConnection.GetValueOrDefault(connection.Id) ?? [],
                    presenter.CapabilitiesFor(connection),
                    excluded);

            instances.Add(presenter.ToResponse(connection, score, excluded?.ToList()));
        }

        var scored = instances
            .Where(i => i.Enabled && i.Health is not null && i.LastCollectedAt is not null)
            .Select(i => i.Health!.Global)
            .ToList();

        return Ok(new DashboardResponse
        {
            GlobalHealth = scored.Count == 0 ? null : (int)Math.Round(scored.Average(), MidpointRounding.AwayFromZero),
            Instances = instances,
            Summary = await BuildSummaryAsync(ct),
            Rules = BuildRulesStatus(),
        });
    }

    private async Task<FindingSummaryResponse> BuildSummaryAsync(CancellationToken ct)
    {
        var counts = await db.Findings
            .GroupBy(f => f.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToListAsync(ct);

        var severities = await db.Findings
            .Where(f => f.Status == FindingStatus.Active)
            .GroupBy(f => f.Severity)
            .Select(g => new { Severity = g.Key, Count = g.Count() })
            .ToListAsync(ct);

        var categories = await db.Findings
            .Where(f => f.Status == FindingStatus.Active)
            .GroupBy(f => f.Category)
            .Select(g => new { Category = g.Key, Count = g.Count() })
            .ToListAsync(ct);

        return new FindingSummaryResponse
        {
            Active = counts.FirstOrDefault(c => c.Status == FindingStatus.Active)?.Count ?? 0,
            Resolved = counts.FirstOrDefault(c => c.Status == FindingStatus.Resolved)?.Count ?? 0,
            Ignored = counts.FirstOrDefault(c => c.Status == FindingStatus.Ignored)?.Count ?? 0,
            Critical = severities.FirstOrDefault(s => s.Severity == Severities.Critical)?.Count ?? 0,
            Warning = severities.FirstOrDefault(s => s.Severity == Severities.Warning)?.Count ?? 0,
            Info = severities.FirstOrDefault(s => s.Severity == Severities.Info)?.Count ?? 0,
            ByCategory = categories
                .OrderBy(c => c.Category, StringComparer.Ordinal)
                .ToDictionary(c => c.Category, c => c.Count),
        };
    }

    private RulesStatusResponse BuildRulesStatus() => RulesStatusResponse.From(ruleStore.Current);
}
