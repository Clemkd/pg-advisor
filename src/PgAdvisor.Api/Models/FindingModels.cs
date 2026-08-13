using System.ComponentModel.DataAnnotations;
using System.Text.Json;

namespace PgAdvisor.Api.Models;

public sealed record FindingResponse
{
    public int Id { get; init; }
    public int ConnectionId { get; init; }
    public string ConnectionName { get; init; } = string.Empty;
    public string RuleId { get; init; } = string.Empty;
    public int RuleVersion { get; init; }
    public string Target { get; init; } = string.Empty;
    public string Category { get; init; } = string.Empty;
    public string Severity { get; init; } = string.Empty;
    public string Title { get; init; } = string.Empty;
    public string Message { get; init; } = string.Empty;
    public string? Impact { get; init; }
    public string? Confidence { get; init; }
    public string? RemediationSql { get; init; }
    public string? Documentation { get; init; }
    public string Status { get; init; } = string.Empty;
    public DateTimeOffset DetectedAt { get; init; }
    public DateTimeOffset LastSeenAt { get; init; }
    public DateTimeOffset? ResolvedAt { get; init; }
    public int Occurrences { get; init; }
    public JsonElement? Evidence { get; init; }

    /// <summary>Nom de la règle ayant déclenché le diagnostic, si elle est toujours chargée.</summary>
    public string? RuleName { get; init; }

    public bool RuleMissing { get; init; }
}

public sealed record FindingDetailResponse
{
    public required FindingResponse Finding { get; init; }
    public IReadOnlyList<FindingHistoryResponse> History { get; init; } = [];
    public IReadOnlyList<NotificationHistoryResponse> Notifications { get; init; } = [];
}

public sealed record FindingHistoryResponse(
    DateTimeOffset At,
    string? FromStatus,
    string ToStatus,
    string? Severity,
    string? Note,
    string? Actor);

public sealed record FindingPageResponse
{
    public IReadOnlyList<FindingResponse> Items { get; init; } = [];
    public int Total { get; init; }
    public int Page { get; init; }
    public int PageSize { get; init; }
}

public sealed record FindingSummaryResponse
{
    public int Active { get; init; }
    public int Resolved { get; init; }
    public int Ignored { get; init; }
    public int Critical { get; init; }
    public int Warning { get; init; }
    public int Info { get; init; }
    public Dictionary<string, int> ByCategory { get; init; } = [];
}

/// <summary>Résultat d'une vérification : la règle a été rejouée sur l'instance concernée.</summary>
public sealed record VerifyFindingResponse
{
    /// <summary>Vrai si la règle a pu être exécutée.</summary>
    public bool Verified { get; init; }

    /// <summary>Vrai si le diagnostic est toujours constaté sur l'instance.</summary>
    public bool StillPresent { get; init; }

    /// <summary>Vrai si le finding vient d'être marqué résolu par cette vérification.</summary>
    public bool Resolved { get; init; }

    public string Message { get; init; } = string.Empty;

    /// <summary>Motif si la règle n'était pas exécutable (capacité manquante, règle désactivée).</summary>
    public string? SkipReason { get; init; }

    public string? Error { get; init; }
    public double DurationMs { get; init; }
    public FindingResponse? Finding { get; init; }
}

public sealed record ChangeFindingStatusRequest
{
    /// <summary>active, resolved ou ignored.</summary>
    [Required]
    public string Status { get; init; } = string.Empty;

    [MaxLength(500)]
    public string? Note { get; init; }
}
