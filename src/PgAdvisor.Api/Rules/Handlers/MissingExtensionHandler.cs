namespace PgAdvisor.Api.Rules.Handlers;

/// <summary>
/// Produit une recommandation d'installation par extension absente déclarée dans
/// <c>requires.missingExtensions</c>. L'Advisor n'installe rien : il signale le gain attendu.
/// </summary>
public sealed class MissingExtensionHandler : IRuleHandler
{
    public string Name => "capabilities.missing-extension";

    public string Description =>
        "One row per missing extension listed in requires.missingExtensions " +
        "(columns: extension, installable, server_version).";

    public Task<IReadOnlyList<RuleRow>> ExecuteAsync(RuleHandlerContext context, CancellationToken cancellationToken)
    {
        var missing = context.Rule.Rule.Definition.Requires?.MissingExtensions ?? [];

        var rows = missing
            // L'applicabilité a déjà écarté les extensions présentes ; ce filtre couvre le dry-run.
            .Where(extension => !context.Capabilities.HasExtension(extension))
            .Select(extension => new RuleRow
            {
                ["extension"] = extension,
                ["installable"] = context.Capabilities.AvailableExtensions
                    .Contains(extension, StringComparer.OrdinalIgnoreCase),
                ["server_version"] = context.Capabilities.ServerVersion,
            })
            .ToList();

        return Task.FromResult<IReadOnlyList<RuleRow>>(rows);
    }
}
