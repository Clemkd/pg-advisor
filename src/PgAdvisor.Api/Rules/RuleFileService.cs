using Microsoft.Extensions.Options;

namespace PgAdvisor.Api.Rules;

public sealed record RuleSaveResult(bool Success, IReadOnlyList<string> Errors, LoadedRule? Rule)
{
    public static RuleSaveResult Failed(IEnumerable<string> errors) => new(false, errors.ToList(), null);
}

/// <summary>
/// Écriture des règles depuis l'IHM. Les fichiers restent la source de vérité : l'interface
/// produit du YAML dans le volume de données, et le rechargement suit le même chemin qu'une
/// modification faite à la main. Une règle refusée n'est jamais écrite sur disque.
/// </summary>
public sealed class RuleFileService(
    RuleLoader loader,
    RuleStore store,
    IOptions<AdvisorOptions> options,
    ILogger<RuleFileService> logger)
{
    private readonly AdvisorOptions _options = options.Value;
    private readonly SemaphoreSlim _writeLock = new(1, 1);

    public string UserDirectory => _options.UserRulesDirectory;

    public async Task<RuleSaveResult> SaveAsync(string yaml, string? expectedId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(yaml))
        {
            return RuleSaveResult.Failed(["The YAML content is empty."]);
        }

        // Validation avant écriture : le disque ne reçoit que des règles compilables.
        var target = Path.Combine(_options.UserRulesDirectory, "pending.yaml");
        var compilation = loader.Compile(yaml, target, RuleOrigin.User);

        if (compilation.Rule is null)
        {
            return RuleSaveResult.Failed(compilation.Errors);
        }

        var rule = compilation.Rule;

        if (expectedId is not null && !string.Equals(expectedId, rule.Id, StringComparison.OrdinalIgnoreCase))
        {
            return RuleSaveResult.Failed([
                $"The rule identifier cannot change: expected \"{expectedId}\", got \"{rule.Id}\". " +
                "Create a new rule if the identifier has to be different."
            ]);
        }

        var path = PathFor(rule.Id);

        await _writeLock.WaitAsync(cancellationToken);
        try
        {
            Directory.CreateDirectory(_options.UserRulesDirectory);

            // Écriture via un fichier temporaire : le surveillant ne voit jamais un YAML tronqué.
            var temporary = path + ".tmp";
            await File.WriteAllTextAsync(temporary, Normalize(yaml), cancellationToken);
            File.Move(temporary, path, overwrite: true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            logger.LogError(ex, "Cannot write rule {RuleId} to {Directory}.", rule.Id, _options.UserRulesDirectory);
            return RuleSaveResult.Failed([
                $"Cannot write to {_options.UserRulesDirectory}: {ex.Message}. " +
                "Check that the data volume is mounted writable."
            ]);
        }
        finally
        {
            _writeLock.Release();
        }

        logger.LogInformation("Rule {RuleId} saved to {Path}.", rule.Id, path);

        // Rechargement immédiat pour que la réponse reflète l'état réellement actif ; la
        // surveillance du répertoire déclencherait de toute façon le même rechargement.
        var snapshot = store.Reload();

        return new RuleSaveResult(true, [], snapshot.Find(rule.Id));
    }

    /// <summary>
    /// Supprime la règle utilisateur. Si elle masquait une règle fournie du même identifiant,
    /// cette dernière redevient active : la suppression vaut donc « revenir à la version fournie ».
    /// </summary>
    public bool DeleteUserRule(string id)
    {
        var path = PathFor(id);
        if (!File.Exists(path))
        {
            return false;
        }

        File.Delete(path);
        logger.LogInformation("User rule {RuleId} deleted ({Path}).", id, path);

        store.Reload();
        return true;
    }

    public bool HasUserFile(string id) => File.Exists(PathFor(id));

    /// <summary>
    /// Retire un fichier utilisateur devenu inutile après réparation.
    ///
    /// Une règle corrigée est écrite sous « &lt;identifiant&gt;.yaml ». Si le fichier fautif portait
    /// un autre nom — il a pu être déposé à la main —, le laisser en place le ferait rejeter à
    /// chaque rechargement, et l'erreur qu'on vient de corriger resterait affichée.
    /// </summary>
    public bool DiscardUserFile(string path, string keptRuleId)
    {
        var root = Path.GetFullPath(_options.UserRulesDirectory);
        var full = Path.GetFullPath(path);

        // Hors du répertoire utilisateur, rien n'est supprimé : le répertoire des règles livrées
        // est monté en lecture seule, et une erreur de chemin ne doit pas y toucher.
        if (!full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal) &&
            !full.StartsWith(root + Path.AltDirectorySeparatorChar, StringComparison.Ordinal))
        {
            return false;
        }

        if (string.Equals(full, PathFor(keptRuleId), StringComparison.OrdinalIgnoreCase) || !File.Exists(full))
        {
            return false;
        }

        File.Delete(full);
        logger.LogInformation("Rejected rule file {Path} removed after being fixed as {RuleId}.", full, keptRuleId);
        return true;
    }

    /// <summary>
    /// Chemin du fichier d'une règle. L'identifiant est déjà contraint par la validation
    /// (minuscules, sans séparateur de chemin) ; on vérifie néanmoins que le résultat reste
    /// dans le répertoire des règles utilisateur.
    /// </summary>
    private string PathFor(string id)
    {
        var fileName = id + ".yaml";
        var root = Path.GetFullPath(_options.UserRulesDirectory);
        var path = Path.GetFullPath(Path.Combine(root, fileName));

        if (!path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal) &&
            !path.StartsWith(root + Path.AltDirectorySeparatorChar, StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"Rule identifier rejected: \"{id}\".");
        }

        return path;
    }

    private static string Normalize(string yaml)
    {
        var trimmed = yaml.Replace("\r\n", "\n").TrimEnd();
        return trimmed + "\n";
    }
}
