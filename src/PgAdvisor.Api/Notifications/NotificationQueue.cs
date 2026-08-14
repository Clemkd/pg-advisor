using System.Threading.Channels;

namespace PgAdvisor.Api.Notifications;

/// <summary>Demande de notification, résolue et envoyée hors du chemin d'analyse.</summary>
public sealed record NotificationRequest(
    int ConnectionId,
    int FindingId,
    string Event,
    long Cycle,
    string Severity);

/// <summary>
/// File d'attente des notifications. L'analyse d'une instance ne doit jamais attendre un
/// webhook lent : elle dépose ici et poursuit.
/// </summary>
public sealed class NotificationQueue(ILogger<NotificationQueue> logger)
{
    private const int Capacity = 2_000;

    private readonly Channel<NotificationRequest> _channel =
        Channel.CreateBounded<NotificationRequest>(new BoundedChannelOptions(Capacity)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
            SingleWriter = false,
        });

    public ChannelReader<NotificationRequest> Reader => _channel.Reader;

    public void Enqueue(NotificationRequest request)
    {
        if (!_channel.Writer.TryWrite(request))
        {
            logger.LogWarning("Notification queue is full: request {Event} for finding {FindingId} dropped.",
                request.Event, request.FindingId);
        }
    }
}
