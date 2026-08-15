using System.ComponentModel.DataAnnotations;
using PgAdvisor.Api.Rules;

namespace PgAdvisor.Api.Models;

public sealed record RuleSummaryResponse
{
    public string Id { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string? Description { get; init; }
    public string Category { get; init; } = string.Empty;
    public string Severity { get; init; } = string.Empty;
    public string Group { get; init; } = string.Empty;
    public int Version { get; init; }
    public bool Enabled { get; init; }

    /// <summary>provided (packagée, remplaçable) ou user (créée depuis l'IHM, éditable).</summary>
    public string Origin { get; init; } = string.Empty;

    public bool Editable { get; init; }

    /// <summary>Vrai si une règle utilisateur masque une règle fournie du même identifiant.</summary>
    public bool OverridesProvided { get; init; }

    public string File { get; init; } = string.Empty;
    public string? Handler { get; init; }
    public bool HasQuery { get; init; }
    public int? IntervalSeconds { get; init; }

    /// <summary>Délai propre déclaré par la règle ; null = délai global du scheduler.</summary>
    public int? TimeoutSeconds { get; init; }

    /// <summary>Délai appliqué à défaut de délai propre, en secondes : la valeur globale en vigueur.</summary>
    public int DefaultTimeoutSeconds { get; init; }

    public RuleRequirementsResponse Requires { get; init; } = new();
    public Dictionary<string, object?> Parameters { get; init; } = [];

    /// <summary>Surcharge globale et par instance, telles qu'enregistrées en base.</summary>
    public IReadOnlyList<RuleOverrideResponse> Overrides { get; init; } = [];

    /// <summary>
    /// Instances où la règle est signalée par le garde-fou sans être écartée. Permet à la liste
    /// des règles d'avertir sans avoir à charger le détail de chacune.
    /// </summary>
    public int DegradedInstances { get; init; }

    /// <summary>Instances où la règle est écartée : son diagnostic n'y est plus produit.</summary>
    public int QuarantinedInstances { get; init; }
}

/// <summary>
/// État d'une règle sur une instance, du point de vue du garde-fou de coût. C'est ce qui rend
/// une quarantaine constatable : sans cela, une catégorie cesserait d'être évaluée et le score
/// s'améliorerait sans que personne ne sache pourquoi.
/// </summary>
public sealed record RuleHealthResponse
{
    public int ConnectionId { get; init; }
    public string ConnectionName { get; init; } = string.Empty;
    public string RuleId { get; init; } = string.Empty;

    /// <summary>healthy, degraded ou quarantined.</summary>
    public string State { get; init; } = string.Empty;

    /// <summary>Vrai tant que l'échéance de quarantaine n'est pas atteinte.</summary>
    public bool Quarantined { get; init; }

    /// <summary>Incidents consécutifs, toutes natures confondues : c'est ce que comparent les seuils.</summary>
    public int Strikes { get; init; }

    public int ConsecutiveFailures { get; init; }
    public int ConsecutiveSlowRuns { get; init; }

    /// <summary>timeout, error ou slow : ce qui dit s'il faut corriger la règle ou s'inquiéter de la base.</summary>
    public string? FailureKind { get; init; }

    public string? FailureMessage { get; init; }
    public DateTimeOffset? LastFailureAt { get; init; }
    public DateTimeOffset? LastSuccessAt { get; init; }
    public double? LastDurationMs { get; init; }
    public double? MaxDurationMs { get; init; }

    /// <summary>Délai en vigueur lors de la dernière exécution, pour situer la durée mesurée.</summary>
    public int? LastTimeoutSeconds { get; init; }

    public DateTimeOffset? QuarantinedAt { get; init; }
    public DateTimeOffset? QuarantinedUntil { get; init; }
    public string? QuarantineReason { get; init; }
    public int QuarantineCount { get; init; }

    /// <summary>Seuils en vigueur, pour que l'IHM puisse afficher « 3 incidents sur 5 ».</summary>
    public int WarningThreshold { get; init; }

    public int QuarantineThreshold { get; init; }
    public DateTimeOffset UpdatedAt { get; init; }
}

/// <summary>Cible d'une réactivation manuelle : une instance, ou toutes.</summary>
public sealed record ReleaseQuarantineRequest
{
    /// <summary>Null pour lever la quarantaine de la règle sur toutes les instances.</summary>
    public int? ConnectionId { get; init; }
}

public sealed record RuleRequirementsResponse
{
    public IReadOnlyList<string> Views { get; init; } = [];
    public IReadOnlyList<string> Extensions { get; init; } = [];
    public IReadOnlyList<string> MissingExtensions { get; init; } = [];
    public int? MinVersion { get; init; }
    public int? MaxVersion { get; init; }
    public bool? MonitorRole { get; init; }
    public bool? Primary { get; init; }
}

public sealed record RuleDetailResponse
{
    public required RuleSummaryResponse Rule { get; init; }
    public string Yaml { get; init; } = string.Empty;

    /// <summary>Applicabilité constatée pour chaque instance supervisée, avec le motif du refus.</summary>
    public IReadOnlyList<RuleApplicabilityResponse> Applicability { get; init; } = [];
}

public sealed record RuleApplicabilityResponse
{
    public int ConnectionId { get; init; }
    public string ConnectionName { get; init; } = string.Empty;
    public bool Applicable { get; init; }
    public string? Reason { get; init; }

    /// <summary>Délai réellement appliqué à cette règle sur cette instance, surcharges comprises.</summary>
    public int TimeoutSeconds { get; init; }

    /// <summary>État du garde-fou ; null tant que la règle n'a jamais été exécutée ici.</summary>
    public RuleHealthResponse? Health { get; init; }
}

public sealed record RuleOverrideResponse
{
    public int? ConnectionId { get; init; }
    public string? ConnectionName { get; init; }
    public bool? Enabled { get; init; }
    public string? Severity { get; init; }
    public int? IntervalSeconds { get; init; }

    /// <summary>Délai maximal accordé à la règle sur cette cible ; null = valeur du fichier.</summary>
    public int? TimeoutSeconds { get; init; }

    public Dictionary<string, object?> Parameters { get; init; } = [];
    public DateTimeOffset UpdatedAt { get; init; }
}

public sealed record SaveRuleRequest
{
    [Required]
    public string Yaml { get; init; } = string.Empty;
}

public sealed record ValidateRuleResponse(bool Valid, IReadOnlyList<string> Errors, RuleSummaryResponse? Rule);

public sealed record SaveRuleOverrideRequest
{
    /// <summary>Null pour une surcharge globale, sinon l'instance visée.</summary>
    public int? ConnectionId { get; init; }

    public bool? Enabled { get; init; }
    public string? Severity { get; init; }

    [Range(RuleLimits.MinIntervalSeconds, RuleLimits.MaxIntervalSeconds)]
    public int? IntervalSeconds { get; init; }

    /// <summary>Délai maximal accordé à la règle ; null rend la main au fichier ou au délai global.</summary>
    [Range(RuleLimits.MinTimeoutSeconds, RuleLimits.MaxTimeoutSeconds)]
    public int? TimeoutSeconds { get; init; }

    public Dictionary<string, object?>? Parameters { get; init; }
}

public sealed record DryRunRequest
{
    [Required]
    public int ConnectionId { get; init; }

    /// <summary>YAML à tester ; à défaut, la version enregistrée de la règle est utilisée.</summary>
    public string? Yaml { get; init; }
}

public sealed record DryRunResponse
{
    public bool Executed { get; init; }
    public string? SkipReason { get; init; }
    public string? Error { get; init; }
    public int RowCount { get; init; }
    public double DurationMs { get; init; }
    public IReadOnlyList<Dictionary<string, object?>> Rows { get; init; } = [];
    public IReadOnlyList<DryRunFinding> Findings { get; init; } = [];
}

public sealed record DryRunFinding(
    string Target,
    string Severity,
    string Title,
    string Message,
    string? RemediationSql,
    Dictionary<string, object?> Evidence);

/// <summary>Éléments de langage exposés à l'éditeur de règles de l'IHM.</summary>
public sealed record RuleSchemaResponse
{
    public IReadOnlyList<string> Categories { get; init; } = [];
    public IReadOnlyList<string> Severities { get; init; } = [];
    public IReadOnlyList<string> Groups { get; init; } = [];
    public IReadOnlyList<string> Filters { get; init; } = [];
    public IReadOnlyList<string> Functions { get; init; } = [];
    public IReadOnlyList<string> KnownViews { get; init; } = [];
    public IReadOnlyList<string> NotableExtensions { get; init; } = [];
    public IReadOnlyList<RuleHandlerResponse> Handlers { get; init; } = [];
    public string Template { get; init; } = string.Empty;
}

public sealed record RuleHandlerResponse(string Name, string Description);
