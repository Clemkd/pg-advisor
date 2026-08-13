namespace PgAdvisor.Api.Collectors;

/// <summary>
/// Instantané léger d'une instance, rafraîchi par le groupe « health ». Vit en mémoire :
/// SQLite ne conserve que l'état de l'Advisor, pas de série temporelle de métriques.
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

    /// <summary>Taux d'occupation des slots de connexion, 0 à 1.</summary>
    public double ConnectionUsage =>
        MaxConnections - ReservedConnections > 0
            ? (double)Connections / (MaxConnections - ReservedConnections)
            : 0;
}
