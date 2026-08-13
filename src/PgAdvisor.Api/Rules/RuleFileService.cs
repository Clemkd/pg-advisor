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
            return RuleSaveResult.Failed(["Le contenu YAML est vide."]);
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
                $"L'identifiant de la règle ne peut pas changer : « {expectedId} » attendu, « {rule.Id} » fourni. " +
                "Créez une nouvelle règle si l'identifiant doit être différent."
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
            logger.LogError(ex, "Écriture de la règle {RuleId} impossible dans {Directory}.", rule.Id, _options.UserRulesDirectory);
            return RuleSaveResult.Failed([
                $"Écriture impossible dans {_options.UserRulesDirectory} : {ex.Message}. " +
                "Vérifiez que le volume de données est monté en écriture."
            ]);
        }
        finally
        {
            _writeLock.Release();
        }

        logger.LogInformation("Règle {RuleId} enregistrée dans {Path}.", rule.Id, path);

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
        logger.LogInformation("Règle utilisateur {RuleId} supprimée ({Path}).", id, path);

        store.Reload();
        return true;
    }

    public bool HasUserFile(string id) => File.Exists(PathFor(id));

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
            throw new InvalidOperationException($"Identifiant de règle refusé : « {id} ».");
        }

        return path;
    }

    private static string Normalize(string yaml)
    {
        var trimmed = yaml.Replace("\r\n", "\n").TrimEnd();
        return trimmed + "\n";
    }
}
