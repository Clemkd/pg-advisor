using PgAdvisor.Api.Rules;

namespace PgAdvisor.Api.Models;

public sealed record DashboardResponse
{
    /// <summary>Moyenne des scores des instances actives ; null si aucune instance n'a encore été analysée.</summary>
    public int? GlobalHealth { get; init; }

    public IReadOnlyList<ConnectionResponse> Instances { get; init; } = [];
    public required FindingSummaryResponse Summary { get; init; }
    public required RulesStatusResponse Rules { get; init; }
}

public sealed record RulesStatusResponse
{
    public int Total { get; init; }
    public int Enabled { get; init; }
    public int Provided { get; init; }
    public int User { get; init; }
    public DateTimeOffset LoadedAt { get; init; }
    public IReadOnlyList<RuleErrorResponse> Errors { get; init; } = [];
    public Dictionary<string, int> ByCategory { get; init; } = [];

    /// <summary>
    /// Le tableau de bord et la page des règles décrivent le même instantané : la projection vit
    /// ici plutôt que recopiée dans chaque contrôleur, où elle avait déjà commencé à diverger de
    /// mise en forme.
    /// </summary>
    public static RulesStatusResponse From(RuleSnapshot snapshot) => new()
    {
        Total = snapshot.Rules.Count,
        Enabled = snapshot.Rules.Count(rule => rule.Definition.Enabled),
        Provided = snapshot.Rules.Count(rule => rule.Origin == RuleOrigin.Provided),
        User = snapshot.Rules.Count(rule => rule.Origin == RuleOrigin.User),
        LoadedAt = snapshot.LoadedAt,
        Errors = snapshot.Errors.Select(RuleErrorResponse.From).ToList(),
        ByCategory = snapshot.Rules
            .GroupBy(rule => rule.Category)
            .OrderBy(group => group.Key, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.Count()),
    };
}

public sealed record RuleErrorResponse(string File, string? RuleId, string Message, string Origin)
{
    /// <summary>Seul le nom de fichier sort : le chemin serveur ne regarde pas le client.</summary>
    public static RuleErrorResponse From(RuleLoadError error) => new(
        Path.GetFileName(error.Path),
        error.RuleId,
        error.Message,
        error.Origin.ToString().ToLowerInvariant());
}

/// <summary>
/// Un fichier de règle que le moteur a refusé, avec son contenu : une règle en erreur n'entre pas
/// dans le catalogue, elle n'a donc pas d'identifiant à éditer — on ouvre son fichier.
/// </summary>
public sealed record FailingRuleResponse(
    string File,
    string? RuleId,
    string Message,
    string Origin,
    string Yaml,
    /// <summary>Faux pour un fichier livré avec l'application : son répertoire est monté en lecture seule.</summary>
    bool Writable);
