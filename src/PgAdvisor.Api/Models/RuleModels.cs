using System.ComponentModel.DataAnnotations;

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
    public RuleRequirementsResponse Requires { get; init; } = new();
    public Dictionary<string, object?> Parameters { get; init; } = [];

    /// <summary>Surcharge globale et par instance, telles qu'enregistrées en base.</summary>
    public IReadOnlyList<RuleOverrideResponse> Overrides { get; init; } = [];
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

public sealed record RuleApplicabilityResponse(
    int ConnectionId,
    string ConnectionName,
    bool Applicable,
    string? Reason);

public sealed record RuleOverrideResponse
{
    public int? ConnectionId { get; init; }
    public string? ConnectionName { get; init; }
    public bool? Enabled { get; init; }
    public string? Severity { get; init; }
    public int? IntervalSeconds { get; init; }
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

    [Range(5, 86400)]
    public int? IntervalSeconds { get; init; }

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
