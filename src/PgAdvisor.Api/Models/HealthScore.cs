namespace PgAdvisor.Api.Models;

/// <summary>
/// Score de santé d'une instance : note globale, note par catégorie et décompte par sévérité.
/// Recalculé à partir des findings actifs, jamais stocké — il ne peut donc pas diverger.
/// </summary>
public sealed record HealthScore
{
    public int Global { get; init; } = 100;

    /// <summary>Catégorie → note sur 100. Ne contient que les catégories réellement évaluées.</summary>
    public Dictionary<string, int> Categories { get; init; } = [];

    public int Critical { get; init; }
    public int Warning { get; init; }
    public int Info { get; init; }

    public int Total => Critical + Warning + Info;

    public DateTimeOffset ComputedAt { get; init; } = DateTimeOffset.UtcNow;
}
