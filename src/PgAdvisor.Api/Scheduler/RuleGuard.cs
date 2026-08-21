using Microsoft.Extensions.Options;
using PgAdvisor.Api.Data;
using PgAdvisor.Api.Rules;

namespace PgAdvisor.Api.Scheduler;

/// <summary>Ce qu'une exécution a coûté, tel que le garde-fou le consigne.</summary>
public readonly record struct RuleRunOutcome
{
    public required bool Succeeded { get; init; }

    /// <summary>timeout ou error ; ignoré lorsque l'exécution a réussi.</summary>
    public string? FailureKind { get; init; }

    public string? Message { get; init; }
    public required TimeSpan Duration { get; init; }

    /// <summary>Délai en vigueur pour cette exécution : c'est lui qui dit si la durée est excessive.</summary>
    public required int TimeoutSeconds { get; init; }

    public static RuleRunOutcome Success(TimeSpan duration, int timeoutSeconds) => new()
    {
        Succeeded = true,
        Duration = duration,
        TimeoutSeconds = timeoutSeconds,
    };

    public static RuleRunOutcome Failure(string kind, string? message, TimeSpan duration, int timeoutSeconds) => new()
    {
        Succeeded = false,
        FailureKind = kind,
        Message = message,
        Duration = duration,
        TimeoutSeconds = timeoutSeconds,
    };
}

/// <summary>Ce que l'exécution a changé à l'état de la règle, et qu'il faut faire savoir.</summary>
public enum RuleGuardTransition
{
    /// <summary>Rien de neuf : ni franchissement de seuil, ni rétablissement.</summary>
    None,

    /// <summary>Premier seuil franchi : la règle est signalée, elle continue de s'exécuter.</summary>
    Degraded,

    /// <summary>Second seuil franchi : la règle est écartée de cette instance.</summary>
    Quarantined,

    /// <summary>Exécution réussie et rapide après incident : l'ardoise est effacée.</summary>
    Recovered,
}

/// <summary>
/// Garde-fou de coût des règles. Il tient, par couple (règle, instance), le compte des
/// exécutions qui pèsent sur la base observée, avertit au premier seuil et met la règle en
/// quarantaine au second. Toute la logique est ici et ne touche qu'à des entités de l'Advisor :
/// rien n'est jamais écrit sur l'instance supervisée.
/// </summary>
public sealed class RuleGuard(IOptions<AdvisorOptions> options)
{
    private readonly RuleGuardOptions _options = options.Value.Scheduler.RuleGuard;

    public bool Enabled => _options.Enabled;

    /// <summary>Incidents consécutifs à partir desquels la règle est signalée.</summary>
    public int WarningThreshold => Math.Max(1, _options.WarningThreshold);

    /// <summary>
    /// Incidents consécutifs à partir desquels la règle est écartée. Jamais inférieur au seuil
    /// d'avertissement, qui serait sinon inatteignable.
    /// </summary>
    public int QuarantineThreshold => Math.Max(WarningThreshold, _options.QuarantineThreshold);

    public TimeSpan QuarantineDuration => _options.QuarantineDuration > TimeSpan.Zero
        ? _options.QuarantineDuration
        : TimeSpan.FromHours(6);

    public double SlowRunRatio => _options.SlowRunRatio;

    public static RuleHealth NewState(int connectionId, string ruleId, DateTimeOffset now) => new()
    {
        ConnectionId = connectionId,
        RuleId = ruleId,
        State = RuleHealthStates.Healthy,
        UpdatedAt = now,
    };

    /// <summary>La règle est-elle écartée de cette instance à cet instant ?</summary>
    public bool IsQuarantined(RuleHealth? state, DateTimeOffset now) =>
        _options.Enabled &&
        state is { State: RuleHealthStates.Quarantined } &&
        (state.QuarantinedUntil is null || state.QuarantinedUntil > now);

    /// <summary>
    /// Échéance atteinte : la règle est rendue à l'exécution, compteurs conservés. Un seul essai
    /// décide de la suite — un succès rapide efface l'ardoise, un nouvel incident remet en
    /// quarantaine sans attendre à nouveau le seuil complet, faute de quoi une règle
    /// définitivement fautive coûterait cinq exécutions à chaque échéance.
    /// </summary>
    public bool TryRelease(RuleHealth state, DateTimeOffset now)
    {
        if (state.State != RuleHealthStates.Quarantined ||
            (state.QuarantinedUntil is DateTimeOffset until && until > now))
        {
            return false;
        }

        state.State = RuleHealthStates.Degraded;
        state.QuarantinedUntil = null;
        state.UpdatedAt = now;
        return true;
    }

    /// <summary>
    /// Réactivation manuelle immédiate. L'exploitant affirme que la cause est traitée : on
    /// repart d'une ardoise vierge, sans quoi le premier passage suivant reconduirait la
    /// quarantaine sur des incidents déjà corrigés.
    /// </summary>
    public static void Reactivate(RuleHealth state, DateTimeOffset now)
    {
        state.State = RuleHealthStates.Healthy;
        state.ConsecutiveFailures = 0;
        state.ConsecutiveSlowRuns = 0;
        state.IncidentsSince = null;
        state.QuarantinedAt = null;
        state.QuarantinedUntil = null;
        state.QuarantineReason = null;
        state.QuarantineCount = 0;
        state.MaxDurationMs = null;
        state.UpdatedAt = now;
    }

    /// <summary>Consigne une exécution et renvoie le franchissement de seuil qu'elle provoque.</summary>
    public RuleGuardTransition Record(RuleHealth state, RuleRunOutcome outcome, DateTimeOffset now)
    {
        state.UpdatedAt = now;
        state.LastTimeoutSeconds = outcome.TimeoutSeconds;

        if (outcome.Succeeded)
        {
            state.LastSuccessAt = now;
            state.LastDurationMs = outcome.Duration.TotalMilliseconds;
            state.MaxDurationMs = Math.Max(state.MaxDurationMs ?? 0, outcome.Duration.TotalMilliseconds);

            if (!IsSlow(outcome))
            {
                return ClearSlate(state);
            }
        }

        if (outcome.Succeeded)
        {
            // Succès trop lent : il compte autant qu'un échec. Une règle qui réussit en 25 s
            // sous un délai de 30 est déjà un problème, et n'échouerait jamais d'elle-même.
            state.ConsecutiveSlowRuns++;
            state.LastFailureKind = RuleFailureKinds.Slow;
            state.LastFailureMessage = Truncate(DescribeSlowRun(outcome));
        }
        else
        {
            state.ConsecutiveFailures++;
            state.LastFailureKind = RuleFailureKinds.IsValid(outcome.FailureKind)
                ? outcome.FailureKind!
                : RuleFailureKinds.Error;
            state.LastFailureMessage = Truncate(outcome.Message);
        }

        state.LastFailureAt = now;
        state.IncidentsSince ??= now;

        if (!_options.Enabled)
        {
            // Garde-fou désactivé : on continue de compter, on n'écarte rien.
            return RuleGuardTransition.None;
        }

        if (state.Strikes >= QuarantineThreshold)
        {
            state.State = RuleHealthStates.Quarantined;
            state.QuarantinedAt = now;
            state.QuarantinedUntil = now + QuarantineDuration;
            state.QuarantineReason = Truncate(DescribeQuarantine(state));
            state.QuarantineCount++;
            return RuleGuardTransition.Quarantined;
        }

        if (state.Strikes >= WarningThreshold)
        {
            // Déjà signalée : le même épisode ne se renotifie pas à chaque passage.
            if (state.State == RuleHealthStates.Degraded)
            {
                return RuleGuardTransition.None;
            }

            state.State = RuleHealthStates.Degraded;
            return RuleGuardTransition.Degraded;
        }

        // Sous le premier seuil : l'incident est consigné mais ne mérite pas encore d'alerte.
        // L'affectation réconcilie aussi l'état d'une règle signalée avant que l'exploitant
        // n'ait relevé les seuils, qui resterait sinon marquée à tort.
        state.State = RuleHealthStates.Healthy;
        return RuleGuardTransition.None;
    }

    /// <summary>
    /// Une exécution réussie et rapide remet tout à zéro : sans cela, un incident ancien
    /// finirait par condamner une règle redevenue saine.
    /// </summary>
    private static RuleGuardTransition ClearSlate(RuleHealth state)
    {
        var recovering = state.Strikes > 0 || state.State != RuleHealthStates.Healthy;

        state.ConsecutiveFailures = 0;
        state.ConsecutiveSlowRuns = 0;
        state.State = RuleHealthStates.Healthy;
        state.IncidentsSince = null;
        state.QuarantinedAt = null;
        state.QuarantinedUntil = null;
        state.QuarantineReason = null;
        state.QuarantineCount = 0;

        // La pire durée repart de la mesure qui vient d'effacer l'ardoise, et non d'un pic
        // observé avant l'incident : elle décrirait sinon un passé révolu.
        state.MaxDurationMs = state.LastDurationMs;

        return recovering ? RuleGuardTransition.Recovered : RuleGuardTransition.None;
    }

    /// <summary>Une exécution qui consomme l'essentiel de son budget est un incident, même réussie.</summary>
    public bool IsSlow(RuleRunOutcome outcome)
    {
        if (!outcome.Succeeded || SlowRunRatio <= 0)
        {
            return false;
        }

        var budget = TimeSpan.FromSeconds(outcome.TimeoutSeconds * SlowRunRatio);
        return outcome.Duration >= budget;
    }

    private string DescribeSlowRun(RuleRunOutcome outcome) =>
        $"Succeeded in {outcome.Duration.TotalMilliseconds:F0} ms, " +
        $"over {SlowRunRatio:P0} of its {outcome.TimeoutSeconds}s budget on this instance.";

    /// <summary>
    /// Motif consigné. Il doit dire lequel des deux problèmes s'est produit : sans cela,
    /// l'exploitant ne sait pas s'il doit corriger sa règle ou s'inquiéter de sa base.
    /// </summary>
    private static string DescribeQuarantine(RuleHealth state) => state.LastFailureKind switch
    {
        RuleFailureKinds.Timeout =>
            $"{state.Strikes} consecutive runs hit the {state.LastTimeoutSeconds}s statement timeout on this instance. " +
            "The instance is struggling with this query, or the rule needs a longer timeout here.",

        RuleFailureKinds.Slow =>
            $"{state.Strikes} consecutive runs used most of their {state.LastTimeoutSeconds}s budget on this instance. " +
            "The rule has become a load of its own, and would soon time out.",

        _ =>
            $"{state.Strikes} consecutive runs failed on this instance with a SQL error. " +
            $"The rule itself is most likely at fault: {state.LastFailureMessage}",
    };

    /// <summary>Coupe net à la largeur de la colonne : ni ellipse, ni perte du null.</summary>
    private static string? Truncate(string? value) => Services.Text.Clip(value, 500);
}

/// <summary>Correspondance entre un franchissement de seuil et la notification qui l'annonce.</summary>
public static class RuleGuardNotifications
{
    public static string? Event(RuleGuardTransition transition) => transition switch
    {
        RuleGuardTransition.Degraded => NotificationEvents.RuleDegraded,
        RuleGuardTransition.Quarantined => NotificationEvents.RuleQuarantined,
        _ => null,
    };

    /// <summary>
    /// Une quarantaine fait cesser un diagnostic : elle est critique. Un simple avertissement
    /// reste un warning, filtré comme tel par les webhooks.
    /// </summary>
    public static string Severity(RuleGuardTransition transition) => transition switch
    {
        RuleGuardTransition.Quarantined => Severities.Critical,
        _ => Severities.Warning,
    };

    /// <summary>
    /// Identifiant d'épisode pour la déduplication : la date d'entrée dans l'épisode en cours.
    /// Le même épisode n'est jamais notifié deux fois, une rechute après rétablissement l'est.
    /// </summary>
    public static long Cycle(RuleHealth state, RuleGuardTransition transition)
    {
        var reference = transition == RuleGuardTransition.Quarantined
            ? state.QuarantinedAt ?? state.IncidentsSince
            : state.IncidentsSince;

        return (reference ?? state.UpdatedAt).ToUnixTimeSeconds();
    }
}
