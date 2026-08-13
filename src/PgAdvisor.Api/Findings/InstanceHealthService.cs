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
    public HealthScore Compute(IEnumerable<FindingWeight> weights, PgCapabilities? capabilities)
    {
        // Sans capabilities connues, aucune catégorie n'est déclarée évaluée : seules celles
        // portant des findings seront notées.
        var evaluated = capabilities is null
            ? []
            : ruleStore.Current.Rules
                .Where(rule => rule.Definition.Enabled && rule.EvaluateApplicability(capabilities).IsApplicable)
                .Select(rule => rule.Category)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

        return calculator.Compute(weights, evaluated);
    }
}
