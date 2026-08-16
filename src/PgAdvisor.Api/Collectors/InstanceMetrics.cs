namespace PgAdvisor.Api.Collectors;

/// <summary>
/// Lightweight snapshot of an instance, refreshed by the "health" group. Lives in memory:
/// SQLite only stores the Advisor's state, not a time series of metrics.
/// </summary>
public sealed record InstanceMetrics
{
    public DateTimeOffset CollectedAt { get; init; } = DateTimeOffset.UtcNow;

    public int Connections { get; init; }
    public int MaxConnections { get; init; }
    public int ReservedConnections { get; init; }
    public int ActiveQueries { get; init; }
    public int IdleInTransaction { get; init; }
    public int WaitingSessions { get; init; }
    public int BlockedSessions { get; init; }

    public double LongestTransactionSeconds { get; init; }
    public double LongestQuerySeconds { get; init; }

    public long DatabaseSizeBytes { get; init; }
    public double? CacheHitRatio { get; init; }
    public long Commits { get; init; }
    public long Rollbacks { get; init; }
    public long Deadlocks { get; init; }
    public long TempBytes { get; init; }

    /// <summary>Connection slot occupancy rate, 0 to 1.</summary>
    public double ConnectionUsage =>
        MaxConnections - ReservedConnections > 0
            ? (double)Connections / (MaxConnections - ReservedConnections)
            : 0;
}
