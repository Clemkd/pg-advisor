using PgAdvisor.Api.Data;
using PgAdvisor.Api.Models;

namespace PgAdvisor.Api.Findings;

/// <summary>
/// Traduit les findings actifs en score de santé. Deux principes :
/// une catégorie non évaluée (capability absente) n'est pas notée plutôt que d'être notée 100,
/// et le score reste toujours reconstituable à partir des findings — il n'est jamais stocké.
/// </summary>
public sealed class HealthScoreCalculator
{
    private const int CriticalPenalty = 25;
    private const int WarningPenalty = 8;
    private const int InfoPenalty = 2;

    public HealthScore Compute(
        IEnumerable<FindingWeight> activeFindings,
        IEnumerable<string> evaluatedCategories)
    {
        var penalties = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var critical = 0;
        var warning = 0;
        var info = 0;

        foreach (var finding in activeFindings)
        {
            var penalty = finding.Severity switch
            {
                Severities.Critical => CriticalPenalty,
                Severities.Warning => WarningPenalty,
                _ => InfoPenalty,
            };

            penalties[finding.Category] = penalties.GetValueOrDefault(finding.Category) + penalty;

            switch (finding.Severity)
            {
                case Severities.Critical:
                    critical++;
                    break;
                case Severities.Warning:
                    warning++;
                    break;
                default:
                    info++;
                    break;
            }
        }

        var categories = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

        // Une catégorie porteuse de findings est notée même si aucune règle n'y est plus applicable :
        // les findings existants doivent rester visibles dans le score.
        foreach (var category in evaluatedCategories.Concat(penalties.Keys).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            categories[category] = Math.Clamp(100 - penalties.GetValueOrDefault(category), 0, 100);
        }

        var global = categories.Count == 0
            ? 100
            : (int)Math.Round(categories.Values.Average(), MidpointRounding.AwayFromZero);

        return new HealthScore
        {
            Global = global,
            Categories = categories
                .OrderBy(pair => pair.Key, StringComparer.Ordinal)
                .ToDictionary(pair => pair.Key, pair => pair.Value),
            Critical = critical,
            Warning = warning,
            Info = info,
            ComputedAt = DateTimeOffset.UtcNow,
        };
    }
}

public readonly record struct FindingWeight(string Category, string Severity);
