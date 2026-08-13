using System.ComponentModel.DataAnnotations;

namespace PgAdvisor.Api.Models;

public sealed record NotificationConfigurationResponse
{
    public int Id { get; init; }
    public string Key { get; init; } = string.Empty;
    public string Url { get; init; } = string.Empty;
    public bool Enabled { get; init; }
    public string MinimumSeverity { get; init; } = string.Empty;

    /// <summary>generic, discord ou slack.</summary>
    public string Format { get; init; } = string.Empty;

    public IReadOnlyList<string> Events { get; init; } = [];
    public int? ConnectionId { get; init; }
    public string? ConnectionName { get; init; }

    /// <summary>Les en-têtes peuvent porter un jeton : on n'expose que leur présence.</summary>
    public bool HasHeaders { get; init; }

    public DateTimeOffset CreatedAt { get; init; }
    public DateTimeOffset? LastAttemptAt { get; init; }
    public bool? LastAttemptSucceeded { get; init; }
    public string? LastError { get; init; }
}

public sealed record SaveNotificationRequest
{
    [Required, MaxLength(64), RegularExpression(@"^[a-z0-9][a-z0-9._-]*$",
        ErrorMessage = "L'identifiant doit être en minuscules (lettres, chiffres, point, tiret, souligné).")]
    public string Key { get; init; } = string.Empty;

    [Required, MaxLength(2048)]
    public string Url { get; init; } = string.Empty;

    public bool Enabled { get; init; } = true;

    [Required]
    public string MinimumSeverity { get; init; } = "warning";

    /// <summary>
    /// Forme de la charge : « discord » et « slack » produisent le format attendu par ces
    /// services, qui refusent un JSON quelconque. « generic » envoie la charge complète.
    /// </summary>
    public string Format { get; init; } = "generic";

    public List<string> Events { get; init; } = ["new_finding", "finding_resolved"];

    /// <summary>Restreint à une instance ; null pour toutes.</summary>
    public int? ConnectionId { get; init; }

    /// <summary>En-têtes HTTP additionnels. Null conserve ceux enregistrés, objet vide les supprime.</summary>
    public Dictionary<string, string>? Headers { get; init; }
}

public sealed record NotificationHistoryResponse(
    DateTimeOffset At,
    string Webhook,
    string Event,
    string Severity,
    bool Success,
    int Attempts,
    int? StatusCode,
    string? Error);

public sealed record TestWebhookResponse(bool Success, int? StatusCode, string? Error);
