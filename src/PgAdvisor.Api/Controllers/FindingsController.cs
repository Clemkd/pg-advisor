using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PgAdvisor.Api.Data;
using PgAdvisor.Api.Findings;
using PgAdvisor.Api.Models;
using PgAdvisor.Api.Rules;
using PgAdvisor.Api.Scheduler;
using PgAdvisor.Api.Sse;

namespace PgAdvisor.Api.Controllers;

[ApiController]
[Route("api/findings")]
public sealed class FindingsController(
    AdvisorDbContext db,
    FindingService findings,
    RuleStore ruleStore,
    AnalysisService analysis,
    EventBus bus,
    ILogger<FindingsController> logger) : ControllerBase
{
    // La liste est virtualisée côté interface : elle demande tout le périmètre filtré d'un coup.
    private const int MaxPageSize = 2_000;

    [HttpGet]
    public async Task<ActionResult<FindingPageResponse>> List(
        [FromQuery] int? connectionId,
        [FromQuery] string? status,
        [FromQuery] string? severity,
        [FromQuery] string? category,
        [FromQuery] string? ruleId,
        [FromQuery] string? search,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        CancellationToken ct = default)
    {
        var query = db.Findings.Include(f => f.Connection).AsNoTracking();

        if (connectionId is int id)
        {
            query = query.Where(f => f.ConnectionId == id);
        }

        // Par défaut, seuls les findings actifs : c'est ce que l'opérateur doit traiter.
        var effectiveStatus = string.IsNullOrWhiteSpace(status) ? FindingStatus.Active : status;
        if (!string.Equals(effectiveStatus, "all", StringComparison.OrdinalIgnoreCase))
        {
            query = query.Where(f => f.Status == effectiveStatus);
        }

        if (!string.IsNullOrWhiteSpace(severity))
        {
            query = query.Where(f => f.Severity == severity);
        }

        if (!string.IsNullOrWhiteSpace(category))
        {
            query = query.Where(f => f.Category == category);
        }

        if (!string.IsNullOrWhiteSpace(ruleId))
        {
            query = query.Where(f => f.RuleId == ruleId);
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search.Trim()}%";
            query = query.Where(f =>
                EF.Functions.Like(f.Title, pattern) ||
                EF.Functions.Like(f.Message, pattern) ||
                EF.Functions.Like(f.TargetKey, pattern) ||
                EF.Functions.Like(f.RuleId, pattern));
        }

        var total = await query.CountAsync(ct);
        var size = Math.Clamp(pageSize, 1, MaxPageSize);
        var current = Math.Max(1, page);

        var rows = await query
            // Le plus grave et le plus récent d'abord.
            .OrderByDescending(f => f.Severity == Severities.Critical)
            .ThenByDescending(f => f.Severity == Severities.Warning)
            .ThenByDescending(f => f.LastSeenAt)
            .Skip((current - 1) * size)
            .Take(size)
            .ToListAsync(ct);

        return Ok(new FindingPageResponse
        {
            Items = rows.Select(ToResponse).ToList(),
            Total = total,
            Page = current,
            PageSize = size,
        });
    }

    [HttpGet("summary")]
    public async Task<ActionResult<FindingSummaryResponse>> Summary([FromQuery] int? connectionId, CancellationToken ct)
    {
        var query = db.Findings.AsNoTracking();
        if (connectionId is int id)
        {
            query = query.Where(f => f.ConnectionId == id);
        }

        var rows = await query
            .Select(f => new { f.Status, f.Severity, f.Category })
            .ToListAsync(ct);

        var active = rows.Where(r => r.Status == FindingStatus.Active).ToList();

        return Ok(new FindingSummaryResponse
        {
            Active = active.Count,
            Resolved = rows.Count(r => r.Status == FindingStatus.Resolved),
            Ignored = rows.Count(r => r.Status == FindingStatus.Ignored),
            Critical = active.Count(r => r.Severity == Severities.Critical),
            Warning = active.Count(r => r.Severity == Severities.Warning),
            Info = active.Count(r => r.Severity == Severities.Info),
            ByCategory = active
                .GroupBy(r => r.Category)
                .OrderBy(g => g.Key, StringComparer.Ordinal)
                .ToDictionary(g => g.Key, g => g.Count()),
        });
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<FindingDetailResponse>> Get(int id, CancellationToken ct)
    {
        var finding = await db.Findings
            .Include(f => f.Connection)
            .AsNoTracking()
            .FirstOrDefaultAsync(f => f.Id == id, ct);

        if (finding is null)
        {
            return NotFound();
        }

        var history = await db.FindingHistory
            .Where(h => h.FindingId == id)
            .OrderByDescending(h => h.At)
            .Select(h => new FindingHistoryResponse(h.At, h.FromStatus, h.ToStatus, h.Severity, h.Note, h.Actor))
            .ToListAsync(ct);

        var notifications = await db.NotificationHistory
            .Where(h => h.FindingId == id)
            .OrderByDescending(h => h.At)
            .Join(db.NotificationConfigurations, h => h.ConfigurationId, c => c.Id, (h, c) => new NotificationHistoryResponse(
                h.At, c.Key, h.Event, h.Severity, h.Success, h.Attempts, h.StatusCode, h.Error))
            .ToListAsync(ct);

        return Ok(new FindingDetailResponse
        {
            Finding = ToResponse(finding),
            History = history,
            Notifications = notifications,
        });
    }

    /// <summary>
    /// Passe un finding à ignored ou active. Un finding ignoré n'est plus notifié ni compté dans
    /// le score, et repasser à active revient à le reconsidérer.
    ///
    /// `resolved` est délibérément refusé ici : un finding décrit un fait constaté sur l'instance,
    /// il n'est pas une tâche à cocher. Sa résolution appartient au moteur — à la prochaine
    /// exécution de la règle, ou à la vérification à la demande, qui rejoue la règle et conclut.
    /// </summary>
    [HttpPost("{id:int}/status")]
    public async Task<ActionResult<FindingResponse>> ChangeStatus(
        int id, ChangeFindingStatusRequest request, CancellationToken ct)
    {
        var status = request.Status.ToLowerInvariant();
        if (status is FindingStatus.Resolved)
        {
            return Problem(statusCode: StatusCodes.Status400BadRequest,
                title: "A finding cannot be resolved by hand. It is resolved when the rule no longer reports it: wait for the next run, or verify it on demand.");
        }

        if (status is not (FindingStatus.Active or FindingStatus.Ignored))
        {
            return Problem(statusCode: StatusCodes.Status400BadRequest,
                title: $"Unknown status. Accepted values: {FindingStatus.Active}, {FindingStatus.Ignored}.");
        }

        var actor = User.FindFirstValue(ClaimTypes.Name);
        var finding = await findings.ChangeStatusAsync(id, status, actor, request.Note, ct);
        if (finding is null)
        {
            return NotFound();
        }

        var connection = await db.PostgresConnections
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == finding.ConnectionId, ct);

        // Le score dépend des findings actifs : le dashboard doit se rafraîchir.
        bus.Publish(AdvisorEventTypes.FindingUpdated, new
        {
            connectionId = finding.ConnectionId,
            findingId = finding.Id,
            status = finding.Status,
        }, finding.ConnectionId);

        finding.Connection = connection;
        return Ok(ToResponse(finding));
    }

    /// <summary>
    /// Rejoue la règle à l'origine du finding sur son instance, pour vérifier si le problème
    /// persiste. S'il a disparu, le finding est marqué résolu sans attendre le prochain passage
    /// du scheduler.
    /// </summary>
    [HttpPost("{id:int}/verify")]
    public async Task<ActionResult<VerifyFindingResponse>> Verify(int id, CancellationToken ct)
    {
        var finding = await db.Findings
            .Include(f => f.Connection)
            .FirstOrDefaultAsync(f => f.Id == id, ct);

        if (finding is null)
        {
            return NotFound();
        }

        var rule = ruleStore.Current.Find(finding.RuleId);
        if (rule is null)
        {
            return Ok(new VerifyFindingResponse
            {
                Message = $"Rule \"{finding.RuleId}\" is no longer loaded: this finding cannot be verified.",
                Finding = ToResponse(finding),
            });
        }

        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(90));

            var result = await analysis.DryRunAsync(finding.ConnectionId, rule, timeout.Token);

            if (result.SkipReason is not null)
            {
                return Ok(new VerifyFindingResponse
                {
                    SkipReason = result.SkipReason,
                    Message = $"The rule cannot run on this instance: {result.SkipReason}",
                    Finding = ToResponse(finding),
                });
            }

            if (result.Error is not null)
            {
                return Ok(new VerifyFindingResponse
                {
                    Error = result.Error,
                    Message = $"Verification failed: {result.Error}",
                    Finding = ToResponse(finding),
                });
            }

            // Le diagnostic porte sur une cible précise : on cherche cette cible, pas la règle entière.
            var stillPresent = result.Findings.Any(candidate =>
                string.Equals(candidate.TargetKey, finding.TargetKey, StringComparison.Ordinal));

            if (stillPresent)
            {
                return Ok(new VerifyFindingResponse
                {
                    Verified = true,
                    StillPresent = true,
                    DurationMs = result.Duration.TotalMilliseconds,
                    Message = "The finding is still present on the instance.",
                    Finding = ToResponse(finding),
                });
            }

            var actor = User.FindFirstValue(ClaimTypes.Name);
            var resolved = await findings.ChangeStatusAsync(
                finding.Id, FindingStatus.Resolved, actor, "Verified: the finding is no longer present", ct);

            bus.Publish(AdvisorEventTypes.FindingResolved, new
            {
                connectionId = finding.ConnectionId,
                findingId = finding.Id,
                ruleId = finding.RuleId,
                status = FindingStatus.Resolved,
            }, finding.ConnectionId);

            logger.LogInformation(
                "Finding {FindingId} ({RuleId}) verified by {Actor}: no longer present, marked as resolved.",
                finding.Id, finding.RuleId, actor ?? "?");

            if (resolved is not null)
            {
                resolved.Connection = finding.Connection;
            }

            return Ok(new VerifyFindingResponse
            {
                Verified = true,
                StillPresent = false,
                Resolved = true,
                DurationMs = result.Duration.TotalMilliseconds,
                Message = "The finding is no longer present: the recommendation is marked as resolved.",
                Finding = ToResponse(resolved ?? finding),
            });
        }
        catch (Exception ex) when (ex is InvalidOperationException or OperationCanceledException)
        {
            return Ok(new VerifyFindingResponse
            {
                Error = ex.Message,
                Message = $"Verification did not complete: {ex.Message}",
                Finding = ToResponse(finding),
            });
        }
    }

    private FindingResponse ToResponse(Finding finding)
    {
        var rule = ruleStore.Current.Find(finding.RuleId);

        return new FindingResponse
        {
            Id = finding.Id,
            ConnectionId = finding.ConnectionId,
            ConnectionName = finding.Connection?.Name ?? string.Empty,
            RuleId = finding.RuleId,
            RuleVersion = finding.RuleVersion,
            Target = finding.TargetKey,
            Category = finding.Category,
            Severity = finding.Severity,
            Title = finding.Title,
            Message = finding.Message,
            Impact = finding.Impact,
            Confidence = finding.Confidence,
            RemediationSql = finding.RemediationSql,
            Documentation = finding.Documentation,
            Status = finding.Status,
            DetectedAt = finding.DetectedAt,
            LastSeenAt = finding.LastSeenAt,
            ResolvedAt = finding.ResolvedAt,
            Occurrences = finding.OccurrenceCount,
            Evidence = ParseEvidence(finding.EvidenceJson),
            RuleName = rule?.Definition.Name,
            RuleMissing = rule is null,
        };
    }

    private static JsonElement? ParseEvidence(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            return document.RootElement.Clone();
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
