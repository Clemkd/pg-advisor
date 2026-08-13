using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using PgAdvisor.Api.Sse;

namespace PgAdvisor.Api.Controllers;

/// <summary>
/// Flux Server-Sent Events du dashboard. Le SSE suffit ici : le serveur pousse, le client
/// n'envoie rien, et la reconnexion est gérée nativement par le navigateur.
/// </summary>
[ApiController]
[Route("api/events")]
public sealed class EventsController(EventBus bus, ILogger<EventsController> logger) : ControllerBase
{
    private static readonly TimeSpan Heartbeat = TimeSpan.FromSeconds(20);

    private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web);

    [HttpGet]
    public async Task Stream(CancellationToken cancellationToken)
    {
        Response.StatusCode = StatusCodes.Status200OK;
        Response.ContentType = "text/event-stream";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers.Connection = "keep-alive";
        // Empêche la mise en tampon par un proxy inverse, qui retarderait les événements.
        Response.Headers["X-Accel-Buffering"] = "no";

        using var subscription = bus.Subscribe();

        await WriteAsync(new AdvisorEvent("stream.open", new { subscribers = bus.SubscriberCount }), cancellationToken);

        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var readTask = subscription.Reader.WaitToReadAsync(cancellationToken).AsTask();
                var heartbeatTask = Task.Delay(Heartbeat, cancellationToken);
                var completed = await Task.WhenAny(readTask, heartbeatTask);

                if (completed == readTask)
                {
                    if (!await readTask)
                    {
                        break;
                    }

                    while (subscription.Reader.TryRead(out var advisorEvent))
                    {
                        await WriteAsync(advisorEvent, cancellationToken);
                    }
                }
                else
                {
                    // Commentaire SSE : maintient la connexion ouverte à travers les proxys.
                    await Response.WriteAsync(": ping\n\n", cancellationToken);
                }

                await Response.Body.FlushAsync(cancellationToken);
            }
        }
        catch (OperationCanceledException)
        {
            // Client déconnecté : cas normal.
        }
        catch (Exception ex)
        {
            logger.LogDebug(ex, "Flux SSE interrompu.");
        }
    }

    private async Task WriteAsync(AdvisorEvent advisorEvent, CancellationToken cancellationToken)
    {
        var payload = JsonSerializer.Serialize(new
        {
            type = advisorEvent.Type,
            at = advisorEvent.At,
            connectionId = advisorEvent.ConnectionId,
            data = advisorEvent.Payload,
        }, SerializerOptions);

        var builder = new StringBuilder()
            .Append("event: ").Append(advisorEvent.Type).Append('\n')
            .Append("data: ").Append(payload).Append("\n\n");

        await Response.WriteAsync(builder.ToString(), cancellationToken);
    }
}
