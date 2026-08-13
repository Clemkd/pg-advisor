using System.Collections.Concurrent;
using System.Threading.Channels;

namespace PgAdvisor.Api.Sse;

public static class AdvisorEventTypes
{
    public const string FindingCreated = "finding.created";
    public const string FindingResolved = "finding.resolved";
    public const string FindingUpdated = "finding.updated";
    public const string HealthChanged = "health.changed";
    public const string CollectionState = "collection.state";
    public const string AnalysisProgress = "analysis.progress";
    public const string RulesReloaded = "rules.reloaded";
    public const string InstanceChanged = "instance.changed";
}

public sealed record AdvisorEvent(string Type, object? Payload, int? ConnectionId = null)
{
    public DateTimeOffset At { get; init; } = DateTimeOffset.UtcNow;
}

/// <summary>
/// Diffusion des événements vers les clients SSE. Chaque abonné a sa propre file bornée :
/// un navigateur lent est délesté de ses événements les plus anciens plutôt que de faire
/// grossir la mémoire du serveur ou de ralentir la collecte.
/// </summary>
public sealed class EventBus(ILogger<EventBus> logger)
{
    private const int SubscriberCapacity = 256;

    private readonly ConcurrentDictionary<Guid, Channel<AdvisorEvent>> _subscribers = new();

    public int SubscriberCount => _subscribers.Count;

    public Subscription Subscribe()
    {
        var channel = Channel.CreateBounded<AdvisorEvent>(new BoundedChannelOptions(SubscriberCapacity)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
            SingleWriter = false,
        });

        var id = Guid.NewGuid();
        _subscribers[id] = channel;
        logger.LogDebug("Abonné SSE {Id} connecté ({Count} au total).", id, _subscribers.Count);

        return new Subscription(this, id, channel.Reader);
    }

    public void Publish(AdvisorEvent advisorEvent)
    {
        foreach (var subscriber in _subscribers)
        {
            // Écriture non bloquante : la file délesté d'elle-même en cas de saturation.
            subscriber.Value.Writer.TryWrite(advisorEvent);
        }
    }

    public void Publish(string type, object? payload, int? connectionId = null) =>
        Publish(new AdvisorEvent(type, payload, connectionId));

    private void Unsubscribe(Guid id)
    {
        if (_subscribers.TryRemove(id, out var channel))
        {
            channel.Writer.TryComplete();
            logger.LogDebug("Abonné SSE {Id} déconnecté ({Count} restants).", id, _subscribers.Count);
        }
    }

    public sealed class Subscription(EventBus bus, Guid id, ChannelReader<AdvisorEvent> reader) : IDisposable
    {
        public ChannelReader<AdvisorEvent> Reader { get; } = reader;

        public void Dispose() => bus.Unsubscribe(id);
    }
}
