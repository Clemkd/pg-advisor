using PgAdvisor.Api.Data;
using PgAdvisor.Api.Postgres;
using PgAdvisor.Api.Rules.Expressions;

namespace PgAdvisor.Api.Rules;

public enum RuleOrigin
{
    /// <summary>Règle livrée avec l'image ou montée par l'opérateur : lisible, surchargeable, non éditable.</summary>
    Provided,

    /// <summary>Règle créée depuis l'IHM et stockée dans le volume de données : éditable.</summary>
    User,
}

/// <summary>Règle validée et compilée, prête à être exécutée.</summary>
public sealed record LoadedRule
{
    public required RuleDefinition Definition { get; init; }
    public required string SourcePath { get; init; }
    public required RuleOrigin Origin { get; init; }
    public required string RawYaml { get; init; }

    public Expr? Condition { get; init; }
    public required Template TitleTemplate { get; init; }
    public required Template MessageTemplate { get; init; }
    public Template? SqlTemplate { get; init; }

    public string[] KeyColumns { get; init; } = [];
    public DateTimeOffset LoadedAt { get; init; } = DateTimeOffset.UtcNow;

    public string Id => Definition.Id!;
    public string Category => Definition.Category!.ToLowerInvariant();
    public string Severity => Definition.Severity!.ToLowerInvariant();
    public string Group => (Definition.Group ?? RuleGroups.Recommendations).ToLowerInvariant();
    public bool IsEditable => Origin == RuleOrigin.User;

    /// <summary>Une règle sans query ni handler ne juge que les capabilities de l'instance.</summary>
    public bool IsCapabilityOnly => string.IsNullOrWhiteSpace(Definition.Query) && string.IsNullOrWhiteSpace(Definition.Handler);

    /// <summary>Vérifie si la règle peut s'exécuter sur une instance, et explique le refus.</summary>
    public RuleApplicability EvaluateApplicability(PgCapabilities? capabilities)
    {
        if (capabilities is null)
        {
            return new RuleApplicability(false, "Instance capabilities are not known yet.");
        }

        var requires = Definition.Requires;
        if (requires is null)
        {
            return RuleApplicability.Applicable;
        }

        foreach (var view in requires.Views ?? [])
        {
            if (!capabilities.HasView(view))
            {
                return new RuleApplicability(false, $"View {view} is not readable.");
            }
        }

        foreach (var extension in requires.Extensions ?? [])
        {
            if (!capabilities.HasExtension(extension))
            {
                return new RuleApplicability(false, $"Extension {extension} is not installed.");
            }
        }

        foreach (var extension in requires.MissingExtensions ?? [])
        {
            if (capabilities.HasExtension(extension))
            {
                return new RuleApplicability(false, $"Extension {extension} is already installed.");
            }
        }

        if (requires.MinVersion is int min && !capabilities.MeetsVersion(min))
        {
            return new RuleApplicability(false, $"PostgreSQL {min} or later required (instance runs {capabilities.ServerVersion}).");
        }

        if (requires.MaxVersion is int max && capabilities.ServerVersionNum >= (max + 1) * 10_000)
        {
            return new RuleApplicability(false, $"Rule limited to PostgreSQL {max} and earlier.");
        }

        if (requires.MonitorRole == true && !capabilities.HasPgMonitor && !capabilities.IsSuperuser)
        {
            return new RuleApplicability(false, "The pg_monitor role or superuser is required.");
        }

        if (requires.Primary == true && capabilities.InRecovery)
        {
            return new RuleApplicability(false, "Instance is in recovery: this rule only applies to a primary.");
        }

        return RuleApplicability.Applicable;
    }

    /// <summary>Applique une surcharge d'instance ou globale : sévérité, activation, seuils, périodicité, délai.</summary>
    public EffectiveRule ApplyOverrides(RuleOverride? global, RuleOverride? perInstance)
    {
        var enabled = perInstance?.Enabled ?? global?.Enabled ?? Definition.Enabled;
        var severity = perInstance?.Severity ?? global?.Severity ?? Severity;
        var interval = perInstance?.IntervalSeconds ?? global?.IntervalSeconds ?? Definition.IntervalSeconds;
        var timeout = perInstance?.TimeoutSeconds ?? global?.TimeoutSeconds ?? Definition.TimeoutSeconds;

        var parameters = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        foreach (var pair in Definition.Parameters ?? [])
        {
            parameters[pair.Key] = pair.Value;
        }

        // L'ordre compte : la surcharge d'instance a le dernier mot sur la surcharge globale.
        foreach (var source in new[] { global?.ParametersJson, perInstance?.ParametersJson })
        {
            foreach (var pair in RuleParameterSerializer.Deserialize(source))
            {
                parameters[pair.Key] = pair.Value;
            }
        }

        return new EffectiveRule(this, enabled, severity.ToLowerInvariant(), interval, timeout, parameters);
    }
}

public readonly record struct RuleApplicability(bool IsApplicable, string? Reason)
{
    public static readonly RuleApplicability Applicable = new(true, null);
}

/// <summary>Règle telle qu'elle sera exécutée sur une instance donnée, surcharges appliquées.</summary>
public sealed record EffectiveRule(
    LoadedRule Rule,
    bool Enabled,
    string Severity,
    int? IntervalSeconds,
    int? TimeoutSeconds,
    Dictionary<string, object?> Parameters)
{
    public string Id => Rule.Id;
    public string Category => Rule.Category;
    public string Group => Rule.Group;

    /// <summary>Délai réellement appliqué, le délai global servant de valeur par défaut.</summary>
    public int ResolveTimeoutSeconds(TimeSpan globalTimeout) => Math.Clamp(
        TimeoutSeconds ?? (int)Math.Ceiling(globalTimeout.TotalSeconds),
        RuleLimits.MinTimeoutSeconds,
        RuleLimits.MaxTimeoutSeconds);
}
