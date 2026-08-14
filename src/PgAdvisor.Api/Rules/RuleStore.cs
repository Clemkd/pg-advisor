using Microsoft.Extensions.Options;

namespace PgAdvisor.Api.Rules;

/// <summary>Photographie immuable du jeu de règles ; remplacée d'un bloc à chaque rechargement.</summary>
public sealed record RuleSnapshot
{
    public IReadOnlyList<LoadedRule> Rules { get; init; } = [];
    public IReadOnlyList<RuleLoadError> Errors { get; init; } = [];
    public DateTimeOffset LoadedAt { get; init; } = DateTimeOffset.UtcNow;
    public int Generation { get; init; }

    /// <summary>Identifiants dont une règle utilisateur remplace la règle fournie du même nom.</summary>
    public IReadOnlySet<string> Shadowed { get; init; } = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    public LoadedRule? Find(string id) =>
        Rules.FirstOrDefault(r => string.Equals(r.Id, id, StringComparison.OrdinalIgnoreCase));

    public IEnumerable<LoadedRule> InGroup(string group) =>
        Rules.Where(r => string.Equals(r.Group, group, StringComparison.OrdinalIgnoreCase));
}

/// <summary>
/// Registre des règles en vigueur. Le remplacement se fait par affectation atomique d'un
/// snapshot : un rechargement ne peut donc pas être observé à moitié appliqué par le scheduler.
/// </summary>
public sealed class RuleStore(
    RuleLoader loader,
    IOptions<AdvisorOptions> options,
    ILogger<RuleStore> logger)
{
    private readonly AdvisorOptions _options = options.Value;
    private readonly object _reloadLock = new();
    private RuleSnapshot _snapshot = new();

    public RuleSnapshot Current => Volatile.Read(ref _snapshot);

    /// <summary>Notifie le rechargement (hot reload, écriture depuis l'IHM, démarrage).</summary>
    public event Action<RuleSnapshot>? Changed;

    public string ProvidedDirectory => _options.RulesDirectory;
    public string UserDirectory => _options.UserRulesDirectory;

    public RuleSnapshot Reload()
    {
        RuleSnapshot snapshot;

        lock (_reloadLock)
        {
            var (providedRules, providedErrors) = loader.LoadDirectory(_options.RulesDirectory, RuleOrigin.Provided);
            var (userRules, userErrors) = loader.LoadDirectory(_options.UserRulesDirectory, RuleOrigin.User);

            var errors = new List<RuleLoadError>(providedErrors);
            errors.AddRange(userErrors);

            var accepted = new Dictionary<string, LoadedRule>(StringComparer.OrdinalIgnoreCase);

            // Les règles fournies d'abord, puis les règles utilisateur qui peuvent les remplacer :
            // c'est le mécanisme permettant de corriger depuis l'IHM une règle packagée.
            foreach (var rule in providedRules)
            {
                if (accepted.TryGetValue(rule.Id, out var existing))
                {
                    errors.Add(new RuleLoadError(rule.SourcePath, rule.Id,
                        $"Identifier already defined by {existing.SourcePath}: rule ignored.", rule.Origin));
                    continue;
                }

                accepted[rule.Id] = rule;
            }

            var shadowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var rule in userRules)
            {
                if (accepted.TryGetValue(rule.Id, out var existing) && existing.Origin == RuleOrigin.User)
                {
                    errors.Add(new RuleLoadError(rule.SourcePath, rule.Id,
                        $"Identifier already defined by {existing.SourcePath}: rule ignored.", rule.Origin));
                    continue;
                }

                if (accepted.ContainsKey(rule.Id))
                {
                    shadowed.Add(rule.Id);
                    logger.LogInformation(
                        "Rule {RuleId} defined in {Path} overrides the provided rule with the same identifier.",
                        rule.Id, rule.SourcePath);
                }

                accepted[rule.Id] = rule;
            }

            snapshot = new RuleSnapshot
            {
                Rules = accepted.Values.OrderBy(r => r.Id, StringComparer.Ordinal).ToList(),
                Errors = errors,
                LoadedAt = DateTimeOffset.UtcNow,
                Generation = Current.Generation + 1,
                Shadowed = shadowed,
            };

            Volatile.Write(ref _snapshot, snapshot);
        }

        if (snapshot.Errors.Count == 0)
        {
            logger.LogInformation("{Count} rules loaded.", snapshot.Rules.Count);
        }
        else
        {
            logger.LogWarning("{Count} rules loaded, {ErrorCount} in error.",
                snapshot.Rules.Count, snapshot.Errors.Count);

            foreach (var error in snapshot.Errors)
            {
                logger.LogWarning("Rule {RuleId} ({Path}): {Message}",
                    error.RuleId ?? "?", Path.GetFileName(error.Path), error.Message);
            }
        }

        // L'abonné ne doit pas pouvoir empêcher le rechargement d'aboutir.
        try
        {
            Changed?.Invoke(snapshot);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "A rule reload subscriber failed.");
        }

        return snapshot;
    }
}
