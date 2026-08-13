using System.Text.RegularExpressions;
using PgAdvisor.Api.Data;
using PgAdvisor.Api.Rules.Expressions;
using PgAdvisor.Api.Rules.Handlers;
using YamlDotNet.Core;
using YamlDotNet.Serialization;
using YamlDotNet.Serialization.NamingConventions;

namespace PgAdvisor.Api.Rules;

public sealed record RuleLoadError(string Path, string? RuleId, string Message, RuleOrigin Origin);

public sealed record RuleCompilation(LoadedRule? Rule, IReadOnlyList<string> Errors)
{
    public bool Succeeded => Rule is not null && Errors.Count == 0;
}

/// <summary>
/// Lit et valide les fichiers YAML de règles. Toute erreur est retournée à l'appelant :
/// une règle invalide est écartée mais ne fait jamais tomber l'application.
/// </summary>
public sealed partial class RuleLoader(RuleHandlerRegistry handlers, ILogger<RuleLoader> logger)
{
    private static readonly IDeserializer Deserializer = new DeserializerBuilder()
        .WithNamingConvention(CamelCaseNamingConvention.Instance)
        .Build();

    [GeneratedRegex(@"^[a-z0-9][a-z0-9._-]{1,127}$")]
    private static partial Regex RuleIdPattern { get; }

    public RuleCompilation Compile(string yaml, string sourcePath, RuleOrigin origin)
    {
        RuleDefinition? definition;

        try
        {
            definition = Deserializer.Deserialize<RuleDefinition>(yaml);
        }
        catch (YamlException ex)
        {
            var location = ex.Start.Line > 0 ? $" (ligne {ex.Start.Line})" : string.Empty;
            return new RuleCompilation(null, [$"YAML invalide{location} : {ex.Message}"]);
        }

        if (definition is null)
        {
            return new RuleCompilation(null, ["Le fichier est vide."]);
        }

        var errors = new List<string>();

        // --- Identité et métadonnées -----------------------------------------
        if (string.IsNullOrWhiteSpace(definition.Id))
        {
            errors.Add("Le champ « id » est obligatoire.");
        }
        else if (!RuleIdPattern.IsMatch(definition.Id))
        {
            errors.Add($"L'identifiant « {definition.Id} » doit être en minuscules et ne contenir que lettres, chiffres, point, tiret ou souligné.");
        }

        if (string.IsNullOrWhiteSpace(definition.Name))
        {
            errors.Add("Le champ « name » est obligatoire.");
        }

        if (!RuleCategories.IsValid(definition.Category))
        {
            errors.Add($"Catégorie « {definition.Category} » inconnue. Valeurs acceptées : {string.Join(", ", RuleCategories.All)}.");
        }

        if (!Severities.IsValid(definition.Severity?.ToLowerInvariant()))
        {
            errors.Add($"Sévérité « {definition.Severity} » inconnue. Valeurs acceptées : {Severities.Info}, {Severities.Warning}, {Severities.Critical}.");
        }

        if (definition.Group is not null && !RuleGroups.IsValid(definition.Group))
        {
            errors.Add($"Groupe « {definition.Group} » inconnu. Valeurs acceptées : {string.Join(", ", RuleGroups.All)}.");
        }

        if (definition.Version <= 0)
        {
            errors.Add("Le champ « version » doit être un entier positif.");
        }

        if (definition.IntervalSeconds is int interval && (interval < 5 || interval > 86_400))
        {
            errors.Add("« intervalSeconds » doit être compris entre 5 et 86400.");
        }

        if (definition.Limit is int limit && (limit < 1 || limit > 1_000))
        {
            errors.Add("« limit » doit être compris entre 1 et 1000.");
        }

        // --- Source des lignes ------------------------------------------------
        var hasQuery = !string.IsNullOrWhiteSpace(definition.Query);
        var hasHandler = !string.IsNullOrWhiteSpace(definition.Handler);

        if (hasQuery && hasHandler)
        {
            errors.Add("Une règle utilise soit « query », soit « handler », pas les deux.");
        }

        if (hasQuery && !SqlGuard.Validate(definition.Query!, out var sqlError))
        {
            errors.Add($"Requête refusée : {sqlError}");
        }

        if (hasHandler && !handlers.Contains(definition.Handler!))
        {
            errors.Add($"Handler « {definition.Handler} » inconnu. Disponibles : {string.Join(", ", handlers.All.Select(h => h.Name))}.");
        }

        if (!hasQuery && !hasHandler)
        {
            var requirements = definition.Requires;
            var hasRequirement = requirements is not null && (
                requirements.Views?.Count > 0 ||
                requirements.Extensions?.Count > 0 ||
                requirements.MissingExtensions?.Count > 0 ||
                requirements.MinVersion is not null ||
                requirements.MaxVersion is not null ||
                requirements.MonitorRole is not null ||
                requirements.Primary is not null);

            if (!hasRequirement)
            {
                errors.Add("Une règle sans « query » ni « handler » doit déclarer au moins un prérequis dans « requires » : sinon elle produirait un finding permanent sans diagnostic.");
            }
        }

        // --- Condition et gabarits -------------------------------------------
        Expr? condition = null;
        if (!string.IsNullOrWhiteSpace(definition.Condition))
        {
            if (ExpressionParser.TryParse(definition.Condition, out var parsed, out var conditionError))
            {
                condition = parsed;
            }
            else
            {
                errors.Add($"Condition invalide : {conditionError}");
            }
        }

        var recommendation = definition.Recommendation;
        if (recommendation is null || string.IsNullOrWhiteSpace(recommendation.Title))
        {
            errors.Add("Le bloc « recommendation » doit au moins contenir un « title ».");
        }

        Template? titleTemplate = null;
        Template? messageTemplate = null;
        Template? sqlTemplate = null;

        if (recommendation is not null)
        {
            if (!string.IsNullOrWhiteSpace(recommendation.Title) &&
                !Template.TryParse(recommendation.Title, out titleTemplate, out var titleError))
            {
                errors.Add($"« recommendation.title » invalide : {titleError}");
            }

            // Message facultatif : à défaut, le titre fait office de message.
            var messageSource = string.IsNullOrWhiteSpace(recommendation.Message)
                ? recommendation.Title
                : recommendation.Message;

            if (!string.IsNullOrWhiteSpace(messageSource) &&
                !Template.TryParse(messageSource, out messageTemplate, out var messageError))
            {
                errors.Add($"« recommendation.message » invalide : {messageError}");
            }

            if (!string.IsNullOrWhiteSpace(recommendation.Sql) &&
                !Template.TryParse(recommendation.Sql, out sqlTemplate, out var remediationError))
            {
                errors.Add($"« recommendation.sql » invalide : {remediationError}");
            }

            if (recommendation.Impact is not null && !IsQualifier(recommendation.Impact))
            {
                errors.Add("« recommendation.impact » doit valoir low, medium ou high.");
            }

            if (recommendation.Confidence is not null && !IsQualifier(recommendation.Confidence))
            {
                errors.Add("« recommendation.confidence » doit valoir low, medium ou high.");
            }

            if (!string.IsNullOrWhiteSpace(recommendation.Documentation))
            {
                if (!Uri.TryCreate(recommendation.Documentation, UriKind.Absolute, out var documentationUri))
                {
                    errors.Add("« recommendation.documentation » doit être une URL absolue.");
                }
                else if (documentationUri.Scheme != Uri.UriSchemeHttp && documentationUri.Scheme != Uri.UriSchemeHttps)
                {
                    errors.Add("« recommendation.documentation » doit utiliser http ou https.");
                }
            }
        }

        // --- Seuils -----------------------------------------------------------
        var parameters = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        foreach (var pair in definition.Parameters ?? [])
        {
            if (pair.Value is IEnumerable<object> or IDictionary<object, object>)
            {
                errors.Add($"Le paramètre « {pair.Key} » doit être une valeur scalaire.");
                continue;
            }

            parameters[pair.Key] = RuleParameterSerializer.NormalizeScalar(pair.Value);
        }

        definition.Parameters = parameters;

        if (errors.Count > 0)
        {
            return new RuleCompilation(null, errors);
        }

        var rule = new LoadedRule
        {
            Definition = definition,
            SourcePath = sourcePath,
            Origin = origin,
            RawYaml = yaml,
            Condition = condition,
            TitleTemplate = titleTemplate!,
            MessageTemplate = messageTemplate ?? titleTemplate!,
            SqlTemplate = sqlTemplate,
            KeyColumns = definition.Key?
                .Where(k => !string.IsNullOrWhiteSpace(k))
                .Select(k => k.Trim())
                .ToArray() ?? [],
        };

        return new RuleCompilation(rule, []);
    }

    public (List<LoadedRule> Rules, List<RuleLoadError> Errors) LoadDirectory(string directory, RuleOrigin origin)
    {
        var rules = new List<LoadedRule>();
        var errors = new List<RuleLoadError>();

        if (!Directory.Exists(directory))
        {
            logger.LogInformation("Répertoire de règles {Directory} absent : ignoré.", directory);
            return (rules, errors);
        }

        var files = Directory
            .EnumerateFiles(directory, "*.*", SearchOption.AllDirectories)
            .Where(path => path.EndsWith(".yaml", StringComparison.OrdinalIgnoreCase) ||
                           path.EndsWith(".yml", StringComparison.OrdinalIgnoreCase))
            .OrderBy(path => path, StringComparer.Ordinal);

        foreach (var file in files)
        {
            string yaml;
            try
            {
                yaml = File.ReadAllText(file);
            }
            catch (IOException ex)
            {
                errors.Add(new RuleLoadError(file, null, $"Lecture impossible : {ex.Message}", origin));
                continue;
            }

            var compilation = Compile(yaml, file, origin);
            if (compilation.Rule is not null)
            {
                rules.Add(compilation.Rule);
                continue;
            }

            var id = TryReadId(yaml);
            foreach (var message in compilation.Errors)
            {
                errors.Add(new RuleLoadError(file, id, message, origin));
            }
        }

        return (rules, errors);
    }

    /// <summary>Récupère l'identifiant d'une règle invalide pour pouvoir la nommer dans le dashboard.</summary>
    private static string? TryReadId(string yaml)
    {
        foreach (var line in yaml.Split('\n').Take(20))
        {
            var trimmed = line.Trim();
            if (trimmed.StartsWith("id:", StringComparison.OrdinalIgnoreCase))
            {
                return trimmed[3..].Trim().Trim('"', '\'');
            }
        }

        return null;
    }

    private static bool IsQualifier(string value) =>
        value.ToLowerInvariant() is "low" or "medium" or "high";
}
