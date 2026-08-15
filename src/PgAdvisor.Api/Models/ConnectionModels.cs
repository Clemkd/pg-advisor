using System.ComponentModel.DataAnnotations;
using PgAdvisor.Api.Collectors;
using PgAdvisor.Api.Postgres;

namespace PgAdvisor.Api.Models;

/// <summary>Vue d'une instance supervisée. Ne contient jamais le secret de connexion.</summary>
public sealed record ConnectionResponse
{
    public int Id { get; init; }
    public string Name { get; init; } = string.Empty;
    public string Host { get; init; } = string.Empty;
    public int Port { get; init; }
    public string Database { get; init; } = string.Empty;
    public string Username { get; init; } = string.Empty;
    public string SslMode { get; init; } = string.Empty;
    public int CollectionIntervalSeconds { get; init; }
    public bool Enabled { get; init; }
    public DateTimeOffset CreatedAt { get; init; }
    public DateTimeOffset? LastCollectedAt { get; init; }
    public string? LastError { get; init; }
    public string? ServerVersion { get; init; }
    public string? TimescaleVersion { get; init; }
    public string CollectionState { get; init; } = string.Empty;
    public double? AnalysisProgress { get; init; }
    public HealthScore? Health { get; init; }
    public InstanceMetrics? Metrics { get; init; }

    /// <summary>
    /// Règles écartées de cette instance par le garde-fou. Leur catégorie n'est plus notée : un
    /// score qui remonte doit pouvoir s'expliquer par cette liste plutôt que par une embellie.
    /// </summary>
    public IReadOnlyList<string> QuarantinedRules { get; init; } = [];
}

public sealed record ConnectionDetailResponse
{
    public required ConnectionResponse Connection { get; init; }
    public PgCapabilities? Capabilities { get; init; }
    public IReadOnlyList<CapabilityStatus> CapabilitySummary { get; init; } = [];
}

public sealed record CreateConnectionRequest
{
    [Required, MaxLength(128)]
    public string Name { get; init; } = string.Empty;

    [Required, MaxLength(255)]
    public string Host { get; init; } = string.Empty;

    [Range(1, 65535)]
    public int Port { get; init; } = 5432;

    [Required, MaxLength(128)]
    public string Database { get; init; } = string.Empty;

    [Required, MaxLength(128)]
    public string Username { get; init; } = string.Empty;

    [Required]
    public string Password { get; init; } = string.Empty;

    public string SslMode { get; init; } = "Prefer";

    /// <summary>0 = suivre les périodicités globales du scheduler.</summary>
    [Range(0, 86400)]
    public int CollectionIntervalSeconds { get; init; }

    public bool Enabled { get; init; } = true;
}

public sealed record UpdateConnectionRequest
{
    [Required, MaxLength(128)]
    public string Name { get; init; } = string.Empty;

    [Required, MaxLength(255)]
    public string Host { get; init; } = string.Empty;

    [Range(1, 65535)]
    public int Port { get; init; } = 5432;

    [Required, MaxLength(128)]
    public string Database { get; init; } = string.Empty;

    [Required, MaxLength(128)]
    public string Username { get; init; } = string.Empty;

    /// <summary>Null ou vide : le mot de passe enregistré est conservé.</summary>
    public string? Password { get; init; }

    public string SslMode { get; init; } = "Prefer";

    [Range(0, 86400)]
    public int CollectionIntervalSeconds { get; init; }

    public bool Enabled { get; init; } = true;
}

/// <summary>Test à la volée, avant enregistrement. Le secret n'est ni stocké ni journalisé.</summary>
public sealed record TestConnectionRequest
{
    [Required, MaxLength(255)]
    public string Host { get; init; } = string.Empty;

    [Range(1, 65535)]
    public int Port { get; init; } = 5432;

    [Required, MaxLength(128)]
    public string Database { get; init; } = string.Empty;

    [Required, MaxLength(128)]
    public string Username { get; init; } = string.Empty;

    /// <summary>Null pour retester une connexion existante avec son secret enregistré.</summary>
    public string? Password { get; init; }

    public string SslMode { get; init; } = "Prefer";

    /// <summary>Renseigné pour réutiliser le secret déjà enregistré d'une connexion.</summary>
    public int? ConnectionId { get; init; }
}

public sealed record TestConnectionResponse
{
    public bool Success { get; init; }
    public string? Error { get; init; }
    public string? ServerVersion { get; init; }
    public string? TimescaleVersion { get; init; }
    public bool ReadOnlyEnforced { get; init; }
    public IReadOnlyList<CapabilityStatus> Capabilities { get; init; } = [];
    public IReadOnlyList<string> Warnings { get; init; } = [];
}
