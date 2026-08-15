using PgAdvisor.Api.Models;
using PgAdvisor.Api.Postgres;
using PgAdvisor.Api.Rules;

namespace PgAdvisor.Api.Findings;

/// <summary>
/// Point unique de calcul du score d'une instance, partagé par le scheduler et l'API : le
/// dashboard affiche donc exactement ce que le scheduler a calculé, même après redémarrage.
/// </summary>
public sealed class InstanceHealthService(HealthScoreCalculator calculator, RuleStore ruleStore)
{
    /// <param name="quarantinedRuleIds">
    /// Règles écartées de cette instance par le garde-fou. Elles sont retirées des catégories
    /// déclarées évaluées : une catégorie dont plus aucune règle ne s'exécute ne peut pas être
    /// notée à 100 comme si tout allait bien.
    /// </param>
    public HealthScore Compute(
        IEnumerable<FindingWeight> weights,
        PgCapabilities? capabilities,
        IReadOnlySet<string>? quarantinedRuleIds = null)
    {
        // Sans capabilities connues, aucune catégorie n'est déclarée évaluée : seules celles
        // portant des findings seront notées.
        var evaluated = capabilities is null
            ? []
            : ruleStore.Current.Rules
                .Where(rule => rule.Definition.Enabled &&
                               quarantinedRuleIds?.Contains(rule.Id) != true &&
                               rule.EvaluateApplicability(capabilities).IsApplicable)
                .Select(rule => rule.Category)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

        return calculator.Compute(weights, evaluated);
    }
}
