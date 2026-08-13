using System.Collections.Concurrent;
using PgAdvisor.Api.Collectors;
using PgAdvisor.Api.Models;
using PgAdvisor.Api.Postgres;

namespace PgAdvisor.Api.State;

public static class CollectionStates
{
    public const string Unknown = "unknown";
    public const string Collecting = "collecting";
    public const string Analyzing = "analyzing";
    public const string Idle = "idle";
    public const string Error = "error";
    public const string Disabled = "disabled";
}

/// <summary>État volatil d'une instance supervisée, entre deux passages du scheduler.</summary>
public sealed record InstanceState
{
    public PgCapabilities? Capabilities { get; init; }
    public InstanceMetrics? Metrics { get; init; }
    public HealthScore? Health { get; init; }
    public string CollectionState { get; init; } = CollectionStates.Unknown;
    public string? LastError { get; init; }
    public DateTimeOffset? LastCollectedAt { get; init; }
    public DateTimeOffset? LastAnalyzedAt { get; init; }

    /// <summary>Progression de l'analyse en cours, 0 à 1, pour la barre de progression du dashboard.</summary>
    public double? AnalysisProgress { get; init; }
}

/// <summary>
/// Cache mémoire de l'état par instance. Les capabilities sont aussi persistées en SQLite pour
/// que le dashboard ne soit pas vide au redémarrage, mais cette source-ci fait autorité à chaud.
/// </summary>
public sealed class InstanceStateStore
{
    private readonly ConcurrentDictionary<int, InstanceState> _states = new();

    public InstanceState Get(int connectionId) =>
        _states.TryGetValue(connectionId, out var state) ? state : new InstanceState();

    public InstanceState Update(int connectionId, Func<InstanceState, InstanceState> mutate) =>
        _states.AddOrUpdate(connectionId, _ => mutate(new InstanceState()), (_, current) => mutate(current));

    public void Remove(int connectionId) => _states.TryRemove(connectionId, out _);

    public IReadOnlyDictionary<int, InstanceState> Snapshot() =>
        _states.ToDictionary(pair => pair.Key, pair => pair.Value);
}
