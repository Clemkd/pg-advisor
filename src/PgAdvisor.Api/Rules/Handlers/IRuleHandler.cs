using Npgsql;
using PgAdvisor.Api.Data;
using PgAdvisor.Api.Postgres;

namespace PgAdvisor.Api.Rules.Handlers;

/// <summary>Ligne produite par une règle : nom de colonne → valeur, comme un enregistrement SQL.</summary>
public sealed class RuleRow : Dictionary<string, object?>
{
    public RuleRow() : base(StringComparer.OrdinalIgnoreCase) { }

    public RuleRow(IDictionary<string, object?> source) : base(source, StringComparer.OrdinalIgnoreCase) { }
}

public sealed record RuleHandlerContext(
    EffectiveRule Rule,
    NpgsqlConnection Connection,
    PgCapabilities Capabilities,
    PostgresConnection Instance);

/// <summary>
/// Règle dont la logique dépasse « SQL + condition » : plusieurs requêtes, corrélations en
/// mémoire, comparaisons entre lignes. Le YAML reste la porte d'entrée — il désigne le
/// handler par son nom et fournit la recommandation.
/// </summary>
public interface IRuleHandler
{
    string Name { get; }

    /// <summary>Description affichée dans l'IHM à côté du champ « handler ».</summary>
    string Description { get; }

    Task<IReadOnlyList<RuleRow>> ExecuteAsync(RuleHandlerContext context, CancellationToken cancellationToken);
}

public sealed class RuleHandlerRegistry(IEnumerable<IRuleHandler> handlers)
{
    private readonly Dictionary<string, IRuleHandler> _handlers =
        handlers.ToDictionary(h => h.Name, StringComparer.OrdinalIgnoreCase);

    public bool Contains(string name) => _handlers.ContainsKey(name);

    public IRuleHandler? Find(string name) => _handlers.GetValueOrDefault(name);

    public IEnumerable<IRuleHandler> All => _handlers.Values.OrderBy(h => h.Name, StringComparer.Ordinal);
}
