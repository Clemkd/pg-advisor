using Microsoft.EntityFrameworkCore;
using PgAdvisor.Api.Data;
using PgAdvisor.Api.Rules;

namespace PgAdvisor.Api.Findings;

public sealed record ReconciliationResult
{
    /// <summary>Findings nouveaux ou réapparus après résolution : ils déclenchent une notification.</summary>
    public List<Finding> Created { get; init; } = [];

    public List<Finding> Resolved { get; init; } = [];
    public List<Finding> Updated { get; init; } = [];

    public bool HasChanges => Created.Count > 0 || Resolved.Count > 0;
}

/// <summary>
/// Cycle de vie des findings. Le rapprochement se fait règle par règle : seules les règles
/// réellement exécutées peuvent résoudre leurs findings, si bien qu'une capability devenue
/// indisponible ou une erreur SQL ne fait pas disparaître à tort un diagnostic.
/// </summary>
public sealed class FindingService(AdvisorDbContext db, ILogger<FindingService> logger)
{
    public async Task<ReconciliationResult> ReconcileAsync(
        int connectionId,
        IReadOnlyCollection<string> executedRuleIds,
        IReadOnlyCollection<FindingCandidate> candidates,
        CancellationToken cancellationToken)
    {
        var result = new ReconciliationResult();

        if (executedRuleIds.Count == 0)
        {
            return result;
        }

        var ruleIds = executedRuleIds.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var now = DateTimeOffset.UtcNow;

        var existing = await db.Findings
            .Where(f => f.ConnectionId == connectionId && ruleIds.Contains(f.RuleId))
            .ToListAsync(cancellationToken);

        var index = existing.ToDictionary(
            f => (f.RuleId, f.TargetKey),
            f => f,
            TupleComparer);

        var seen = new HashSet<(string, string)>(TupleComparer);

        foreach (var candidate in candidates)
        {
            if (!ruleIds.Contains(candidate.RuleId))
            {
                // Ne devrait pas arriver ; garde-fou contre une résolution erronée en aval.
                logger.LogWarning("Finding produit par la règle {RuleId} non déclarée comme exécutée : ignoré.",
                    candidate.RuleId);
                continue;
            }

            seen.Add((candidate.RuleId, candidate.TargetKey));

            if (!index.TryGetValue((candidate.RuleId, candidate.TargetKey), out var finding))
            {
                finding = Create(connectionId, candidate, now);
                db.Findings.Add(finding);
                db.FindingHistory.Add(History(finding, null, FindingStatus.Active, now, "Détecté"));
                result.Created.Add(finding);
                continue;
            }

            var wasResolved = finding.Status == FindingStatus.Resolved;
            Apply(finding, candidate, now);

            if (wasResolved)
            {
                // Réapparition : nouveau cycle de vie, donc nouvelle notification.
                finding.Status = FindingStatus.Active;
                finding.ResolvedAt = null;
                finding.DetectedAt = now;
                db.FindingHistory.Add(History(finding, FindingStatus.Resolved, FindingStatus.Active, now, "Réapparu"));
                result.Created.Add(finding);
            }
            else if (finding.Status == FindingStatus.Active)
            {
                result.Updated.Add(finding);
            }

            // Un finding ignoré reste ignoré : ses preuves sont rafraîchies, sans notification.
        }

        foreach (var finding in existing)
        {
            if (finding.Status != FindingStatus.Active || seen.Contains((finding.RuleId, finding.TargetKey)))
            {
                continue;
            }

            finding.Status = FindingStatus.Resolved;
            finding.ResolvedAt = now;
            db.FindingHistory.Add(History(finding, FindingStatus.Active, FindingStatus.Resolved, now, "Plus détecté"));
            result.Resolved.Add(finding);
        }

        await db.SaveChangesAsync(cancellationToken);
        return result;
    }

    /// <summary>Supprime les findings des règles qui n'existent plus, afin qu'ils ne pèsent plus sur le score.</summary>
    public async Task<int> PurgeOrphansAsync(IReadOnlyCollection<string> knownRuleIds, CancellationToken cancellationToken)
    {
        if (knownRuleIds.Count == 0)
        {
            return 0;
        }

        var orphans = await db.Findings
            .Where(f => !knownRuleIds.Contains(f.RuleId))
            .ToListAsync(cancellationToken);

        if (orphans.Count == 0)
        {
            return 0;
        }

        db.Findings.RemoveRange(orphans);
        await db.SaveChangesAsync(cancellationToken);

        logger.LogInformation("{Count} findings supprimés : leur règle n'existe plus.", orphans.Count);
        return orphans.Count;
    }

    public async Task<IReadOnlyList<FindingWeight>> ActiveWeightsAsync(int connectionId, CancellationToken cancellationToken)
    {
        var rows = await db.Findings
            .Where(f => f.ConnectionId == connectionId && f.Status == FindingStatus.Active)
            .Select(f => new { f.Category, f.Severity })
            .ToListAsync(cancellationToken);

        return rows.Select(r => new FindingWeight(r.Category, r.Severity)).ToList();
    }

    public async Task<Finding?> ChangeStatusAsync(
        int findingId, string status, string? actor, string? note, CancellationToken cancellationToken)
    {
        var finding = await db.Findings.FirstOrDefaultAsync(f => f.Id == findingId, cancellationToken);
        if (finding is null)
        {
            return null;
        }

        if (finding.Status == status)
        {
            return finding;
        }

        var now = DateTimeOffset.UtcNow;
        var previous = finding.Status;

        finding.Status = status;
        finding.ResolvedAt = status == FindingStatus.Resolved ? now : null;

        db.FindingHistory.Add(History(finding, previous, status, now, note, actor));
        await db.SaveChangesAsync(cancellationToken);

        logger.LogInformation("Finding {FindingId} passé de {From} à {To} par {Actor}.",
            findingId, previous, status, actor ?? "le système");

        return finding;
    }

    private static Finding Create(int connectionId, FindingCandidate candidate, DateTimeOffset now) => new()
    {
        ConnectionId = connectionId,
        RuleId = candidate.RuleId,
        RuleVersion = candidate.RuleVersion,
        TargetKey = candidate.TargetKey,
        Category = candidate.Category,
        Severity = candidate.Severity,
        Title = candidate.Title,
        Message = candidate.Message,
        EvidenceJson = RuleEngine.SerializeEvidence(candidate.Evidence),
        Impact = candidate.Impact,
        Confidence = candidate.Confidence,
        RemediationSql = candidate.RemediationSql,
        Documentation = candidate.Documentation,
        Status = FindingStatus.Active,
        DetectedAt = now,
        LastSeenAt = now,
        OccurrenceCount = 1,
    };

    private static void Apply(Finding finding, FindingCandidate candidate, DateTimeOffset now)
    {
        finding.RuleVersion = candidate.RuleVersion;
        finding.Severity = candidate.Severity;
        finding.Title = candidate.Title;
        finding.Message = candidate.Message;
        finding.EvidenceJson = RuleEngine.SerializeEvidence(candidate.Evidence);
        finding.Impact = candidate.Impact;
        finding.Confidence = candidate.Confidence;
        finding.RemediationSql = candidate.RemediationSql;
        finding.Documentation = candidate.Documentation;
        finding.LastSeenAt = now;
        finding.OccurrenceCount++;
    }

    private static FindingHistoryEntry History(
        Finding finding, string? from, string to, DateTimeOffset at, string? note, string? actor = null) => new()
    {
        Finding = finding,
        FindingId = finding.Id,
        At = at,
        FromStatus = from,
        ToStatus = to,
        Severity = finding.Severity,
        Note = note,
        Actor = actor,
    };

    private static readonly IEqualityComparer<(string, string)> TupleComparer =
        new RuleTargetComparer();

    private sealed class RuleTargetComparer : IEqualityComparer<(string, string)>
    {
        public bool Equals((string, string) left, (string, string) right) =>
            string.Equals(left.Item1, right.Item1, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(left.Item2, right.Item2, StringComparison.Ordinal);

        public int GetHashCode((string, string) value) => HashCode.Combine(
            StringComparer.OrdinalIgnoreCase.GetHashCode(value.Item1),
            StringComparer.Ordinal.GetHashCode(value.Item2));
    }
}
