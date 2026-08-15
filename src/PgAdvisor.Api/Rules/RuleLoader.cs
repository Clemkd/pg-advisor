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
            var location = ex.Start.Line > 0 ? $" (line {ex.Start.Line})" : string.Empty;
            return new RuleCompilation(null, [$"Invalid YAML{location}: {ex.Message}"]);
        }

        if (definition is null)
        {
            return new RuleCompilation(null, ["The file is empty."]);
        }

        var errors = new List<string>();

        // --- Identité et métadonnées -----------------------------------------
        if (string.IsNullOrWhiteSpace(definition.Id))
        {
            errors.Add("The \"id\" field is required.");
        }
        else if (!RuleIdPattern.IsMatch(definition.Id))
        {
            errors.Add($"Identifier \"{definition.Id}\" must be lowercase and contain only letters, digits, dot, dash or underscore.");
        }

        if (string.IsNullOrWhiteSpace(definition.Name))
        {
            errors.Add("The \"name\" field is required.");
        }

        if (!RuleCategories.IsValid(definition.Category))
        {
            errors.Add($"Unknown category \"{definition.Category}\". Accepted values: {string.Join(", ", RuleCategories.All)}.");
        }

        if (!Severities.IsValid(definition.Severity?.ToLowerInvariant()))
        {
            errors.Add($"Unknown severity \"{definition.Severity}\". Accepted values: {Severities.Info}, {Severities.Warning}, {Severities.Critical}.");
        }

        if (definition.Group is not null && !RuleGroups.IsValid(definition.Group))
        {
            errors.Add($"Unknown group \"{definition.Group}\". Accepted values: {string.Join(", ", RuleGroups.All)}.");
        }

        if (definition.Version <= 0)
        {
            errors.Add("The \"version\" field must be a positive integer.");
        }

        if (definition.IntervalSeconds is int interval &&
            (interval < RuleLimits.MinIntervalSeconds || interval > RuleLimits.MaxIntervalSeconds))
        {
            errors.Add($"\"intervalSeconds\" must be between {RuleLimits.MinIntervalSeconds} and {RuleLimits.MaxIntervalSeconds}.");
        }

        if (definition.TimeoutSeconds is int timeout &&
            (timeout < RuleLimits.MinTimeoutSeconds || timeout > RuleLimits.MaxTimeoutSeconds))
        {
            errors.Add($"\"timeoutSeconds\" must be between {RuleLimits.MinTimeoutSeconds} and {RuleLimits.MaxTimeoutSeconds}.");
        }

        if (definition.Limit is int limit && (limit < RuleLimits.MinLimit || limit > RuleLimits.MaxLimit))
        {
            errors.Add($"\"limit\" must be between {RuleLimits.MinLimit} and {RuleLimits.MaxLimit}.");
        }

        // --- Source des lignes ------------------------------------------------
        var hasQuery = !string.IsNullOrWhiteSpace(definition.Query);
        var hasHandler = !string.IsNullOrWhiteSpace(definition.Handler);

        if (hasQuery && hasHandler)
        {
            errors.Add("A rule uses either \"query\" or \"handler\", not both.");
        }

        if (hasQuery && !SqlGuard.Validate(definition.Query!, out var sqlError))
        {
            errors.Add($"Query rejected: {sqlError}");
        }

        if (hasHandler && !handlers.Contains(definition.Handler!))
        {
            errors.Add($"Unknown handler \"{definition.Handler}\". Available: {string.Join(", ", handlers.All.Select(h => h.Name))}.");
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
                errors.Add("A rule with neither \"query\" nor \"handler\" must declare at least one requirement under \"requires\": otherwise it would produce a permanent finding with nothing to diagnose.");
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
                errors.Add($"Invalid condition: {conditionError}");
            }
        }

        var recommendation = definition.Recommendation;
        if (recommendation is null || string.IsNullOrWhiteSpace(recommendation.Title))
        {
            errors.Add("The \"recommendation\" block must contain at least a \"title\".");
        }

        Template? titleTemplate = null;
        Template? messageTemplate = null;
        Template? sqlTemplate = null;

        if (recommendation is not null)
        {
            if (!string.IsNullOrWhiteSpace(recommendation.Title) &&
                !Template.TryParse(recommendation.Title, out titleTemplate, out var titleError))
            {
                errors.Add($"Invalid \"recommendation.title\": {titleError}");
            }

            // Message facultatif : à défaut, le titre fait office de message.
            var messageSource = string.IsNullOrWhiteSpace(recommendation.Message)
                ? recommendation.Title
                : recommendation.Message;

            if (!string.IsNullOrWhiteSpace(messageSource) &&
                !Template.TryParse(messageSource, out messageTemplate, out var messageError))
            {
                errors.Add($"Invalid \"recommendation.message\": {messageError}");
            }

            if (!string.IsNullOrWhiteSpace(recommendation.Sql) &&
                !Template.TryParse(recommendation.Sql, out sqlTemplate, out var remediationError))
            {
                errors.Add($"Invalid \"recommendation.sql\": {remediationError}");
            }

            if (recommendation.Impact is not null && !IsQualifier(recommendation.Impact))
            {
                errors.Add("\"recommendation.impact\" must be low, medium or high.");
            }

            if (recommendation.Confidence is not null && !IsQualifier(recommendation.Confidence))
            {
                errors.Add("\"recommendation.confidence\" must be low, medium or high.");
            }

            if (!string.IsNullOrWhiteSpace(recommendation.Documentation))
            {
                if (!Uri.TryCreate(recommendation.Documentation, UriKind.Absolute, out var documentationUri))
                {
                    errors.Add("\"recommendation.documentation\" must be an absolute URL.");
                }
                else if (documentationUri.Scheme != Uri.UriSchemeHttp && documentationUri.Scheme != Uri.UriSchemeHttps)
                {
                    errors.Add("\"recommendation.documentation\" must use http or https.");
                }
            }
        }

        // --- Seuils -----------------------------------------------------------
        var parameters = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        foreach (var pair in definition.Parameters ?? [])
        {
            if (pair.Value is IEnumerable<object> or IDictionary<object, object>)
            {
                errors.Add($"Parameter \"{pair.Key}\" must be a scalar value.");
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
            logger.LogInformation("Rules directory {Directory} does not exist: skipped.", directory);
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
                errors.Add(new RuleLoadError(file, null, $"Cannot read the file: {ex.Message}", origin));
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
