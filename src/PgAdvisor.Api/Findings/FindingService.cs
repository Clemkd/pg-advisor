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
                logger.LogWarning("Finding produced by rule {RuleId}, which was not reported as executed: ignored.",
                    candidate.RuleId);
                continue;
            }

            seen.Add((candidate.RuleId, candidate.TargetKey));

            if (!index.TryGetValue((candidate.RuleId, candidate.TargetKey), out var finding))
            {
                finding = Create(connectionId, candidate, now);
                db.Findings.Add(finding);
                db.FindingHistory.Add(History(finding, null, FindingStatus.Active, now, "Detected"));
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
                db.FindingHistory.Add(History(finding, FindingStatus.Resolved, FindingStatus.Active, now, "Reappeared"));
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
            db.FindingHistory.Add(History(finding, FindingStatus.Active, FindingStatus.Resolved, now, "No longer detected"));
            result.Resolved.Add(finding);
        }

        await SaveYieldingToConcurrentStatusChangesAsync(result, cancellationToken);
        return result;
    }

    /// <summary>
    /// Enregistre le bilan en cédant sur les diagnostics dont le statut a changé depuis la lecture.
    /// Le cas concret : l'exploitant ignore un diagnostic pendant que l'analyse tourne, et
    /// l'analyse, partie d'une lecture antérieure, s'apprêtait à le résoudre. C'est sa décision
    /// qui vaut — le moteur repassera au cycle suivant.
    /// </summary>
    private async Task SaveYieldingToConcurrentStatusChangesAsync(
        ReconciliationResult result, CancellationToken cancellationToken)
    {
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException conflict)
        {
            foreach (var entry in conflict.Entries)
            {
                var current = await entry.GetDatabaseValuesAsync(cancellationToken);

                if (current is null)
                {
                    // Supprimé entre-temps : plus rien à écrire, et rien à annoncer.
                    entry.State = EntityState.Detached;
                }
                else
                {
                    entry.OriginalValues.SetValues(current);
                    entry.CurrentValues.SetValues(current);
                }

                if (entry.Entity is Finding finding)
                {
                    logger.LogInformation(
                        "Finding {FindingId} changed status while the analysis was running: the stored value wins.",
                        finding.Id);

                    result.Resolved.Remove(finding);
                    result.Updated.Remove(finding);
                    result.Created.Remove(finding);
                }
            }

            await db.SaveChangesAsync(cancellationToken);
        }
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

        // La mémoire du garde-fou suit le même sort : une règle supprimée ne peut plus jamais
        // sortir de quarantaine, et sa ligne resterait là sans que rien ne puisse l'effacer.
        var staleHealth = await db.RuleHealth
            .Where(h => !knownRuleIds.Contains(h.RuleId))
            .ToListAsync(cancellationToken);

        if (orphans.Count == 0 && staleHealth.Count == 0)
        {
            return 0;
        }

        db.Findings.RemoveRange(orphans);
        db.RuleHealth.RemoveRange(staleHealth);
        await db.SaveChangesAsync(cancellationToken);

        if (orphans.Count > 0)
        {
            logger.LogInformation("{Count} findings deleted: their rule no longer exists.", orphans.Count);
        }

        if (staleHealth.Count > 0)
        {
            logger.LogInformation("{Count} rule health records deleted: their rule no longer exists.", staleHealth.Count);
        }

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

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Quelqu'un d'autre — un autre exploitant, ou le moteur — a changé ce statut entre la
            // lecture et l'écriture. On rend l'état réellement enregistré plutôt que de prétendre
            // avoir appliqué une transition qui n'a pas eu lieu.
            db.ChangeTracker.Clear();

            logger.LogInformation(
                "Finding {FindingId} was changed concurrently; the stored status is returned.", findingId);

            return await db.Findings.FirstOrDefaultAsync(f => f.Id == findingId, cancellationToken);
        }

        logger.LogInformation("Finding {FindingId} moved from {From} to {To} by {Actor}.",
            findingId, previous, status, actor ?? "the system");

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
