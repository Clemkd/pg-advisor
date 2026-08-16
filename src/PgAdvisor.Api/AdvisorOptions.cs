namespace PgAdvisor.Api;

/// <summary>
/// Root options tied to deployment (volume paths, periodicities).
/// Bound from configuration, environment prefix PGADVISOR_.
/// </summary>
public sealed class AdvisorOptions
{
    /// <summary>
    /// Writable volume: SQLite database, encryption key, rules created from the UI.
    /// The default name deliberately avoids "data", which would collide with the
    /// Data/ source directory on a case-insensitive filesystem.
    /// </summary>
    public string DataDirectory { get; set; } = "advisor-data";

    /// <summary>Directory of operator-provided rules, potentially read-only.</summary>
    public string RulesDirectory { get; set; } = "rules";

    /// <summary>Volume subdirectory holding rules created or modified from the UI.</summary>
    public string UserRulesDirectoryName { get; set; } = "rules";

    public AuthOptions Auth { get; set; } = new();
    public SchedulerOptions Scheduler { get; set; } = new();
    public NotificationOptions Notifications { get; set; } = new();

    public string UserRulesDirectory => Path.Combine(DataDirectory, UserRulesDirectoryName);
    public string DatabasePath => Path.Combine(DataDirectory, "pg-advisor.db");
    public string KeyPath => Path.Combine(DataDirectory, "keys", "secrets.key");
}

public sealed class AuthOptions
{
    public string CookieName { get; set; } = "pg-advisor";
    public int SlidingExpirationHours { get; set; } = 12;

    /// <summary>
    /// Forces the Secure attribute on the cookie. Enable it as soon as the Advisor is exposed
    /// over HTTPS; left false by default so local HTTP access or a proxy setup isn't broken.
    /// </summary>
    public bool RequireHttps { get; set; }

    /// <summary>
    /// Admin account password created on first startup. If empty, a random password is
    /// generated and logged once.
    /// </summary>
    public string? BootstrapPassword { get; set; }

    public string BootstrapUsername { get; set; } = "admin";
}

public sealed class SchedulerOptions
{
    public bool Enabled { get; set; } = true;
    public SchedulerIntervals Intervals { get; set; } = new();

    /// <summary>Number of instances analyzed concurrently: one heavy analysis doesn't block the others.</summary>
    public int MaxConcurrentInstances { get; set; } = 4;

    public TimeSpan PerInstanceTimeout { get; set; } = TimeSpan.FromMinutes(2);

    /// <summary>
    /// Maximum execution time for a rule query on the monitored instance, applied when the
    /// rule has no timeout of its own (<c>timeoutSeconds</c>).
    /// </summary>
    public TimeSpan QueryTimeout { get; set; } = TimeSpan.FromSeconds(30);

    /// <summary>Cost guard: counts costly executions and quarantines offending rules.</summary>
    public RuleGuardOptions RuleGuard { get; set; } = new();
}

/// <summary>
/// Rule cost guard. For each (rule, instance) pair, it counts executions that burden the
/// monitored database — timeout, SQL error, or a success that's too slow — then warns, and
/// eventually drops the rule from that instance rather than letting it cost indefinitely.
/// None of this is written to the monitored instance: it is Advisor-side state.
/// </summary>
public sealed class RuleGuardOptions
{
    /// <summary>Disables the whole mechanism: rules then run with no incident cap.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>
    /// Consecutive incidents after which the rule is flagged and a notification is sent,
    /// without stopping execution. Three occurrences rule out an isolated accident (failover,
    /// lock, restart) without letting a real problem linger.
    /// </summary>
    public int WarningThreshold { get; set; } = 3;

    /// <summary>
    /// Consecutive incidents after which the rule is quarantined on this instance. Two more
    /// than the warning threshold: the operator has time to see the alert before the
    /// diagnostic stops being produced.
    /// </summary>
    public int QuarantineThreshold { get; set; } = 5;

    /// <summary>
    /// Duration of a quarantine, after which the rule is retried on its own. Six hours: long
    /// enough for the rule to stop weighing on a struggling database, short enough that a fix
    /// applied the same day is picked up without manual intervention.
    /// </summary>
    public TimeSpan QuarantineDuration { get; set; } = TimeSpan.FromHours(6);

    /// <summary>
    /// Fraction of the maximum delay beyond which a successful execution still counts as an
    /// incident. At 80% of the budget, the rule is only one table-growth away from timing
    /// out: it already costs, and would never fail on its own.
    /// </summary>
    public double SlowRunRatio { get; set; } = 0.8;
}

public sealed class SchedulerIntervals
{
    public TimeSpan Health { get; set; } = TimeSpan.FromSeconds(10);
    public TimeSpan Statistics { get; set; } = TimeSpan.FromMinutes(1);
    public TimeSpan Recommendations { get; set; } = TimeSpan.FromMinutes(5);
    public TimeSpan Configuration { get; set; } = TimeSpan.FromHours(1);
}

public sealed class NotificationOptions
{
    public int MaxRetries { get; set; } = 3;
    public TimeSpan RetryDelay { get; set; } = TimeSpan.FromSeconds(30);
    public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(10);
}
