namespace PgAdvisor.Api.Rules;

/// <summary>Catégories reconnues. Une catégorie inconnue invalide la règle plutôt que de créer une colonne fantôme au dashboard.</summary>
public static class RuleCategories
{
    public const string Performance = "performance";
    public const string Queries = "queries";
    public const string Indexes = "indexes";
    public const string Vacuum = "vacuum";
    public const string Bloat = "bloat";
    public const string Connections = "connections";
    public const string Locks = "locks";
    public const string Transactions = "transactions";
    public const string Checkpoints = "checkpoints";
    public const string Configuration = "configuration";
    public const string Storage = "storage";
    public const string Statistics = "statistics";
    public const string Security = "security";
    public const string Extensions = "extensions";

    public static readonly string[] All =
    [
        Performance, Queries, Indexes, Vacuum, Bloat, Connections, Locks, Transactions,
        Checkpoints, Configuration, Storage, Statistics, Security, Extensions,
    ];

    public static bool IsValid(string? category) =>
        category is not null && All.Contains(category, StringComparer.OrdinalIgnoreCase);
}

/// <summary>Groupes de périodicité du scheduler, tels que décrits dans le descriptif projet.</summary>
public static class RuleGroups
{
    public const string Health = "health";
    public const string Statistics = "statistics";
    public const string Recommendations = "recommendations";
    public const string Configuration = "configuration";

    public static readonly string[] All = [Health, Statistics, Recommendations, Configuration];

    public static bool IsValid(string? group) =>
        group is not null && All.Contains(group, StringComparer.OrdinalIgnoreCase);
}

/// <summary>Bornes des champs numériques d'une règle, partagées par la validation et l'API.</summary>
public static class RuleLimits
{
    /// <summary>
    /// Taille maximale d'un YAML accepté par l'API. Sans borne, la seule limite est celle de
    /// Kestrel — trente mégaoctets — que YamlDotNet chargerait intégralement en mémoire. La plus
    /// grosse règle livrée tient en deux kilooctets.
    /// </summary>
    public const int MaxYamlLength = 256 * 1024;

    public const int MinIntervalSeconds = 5;
    public const int MaxIntervalSeconds = 86_400;

    public const int MinLimit = 1;
    public const int MaxLimit = 1_000;

    /// <summary>
    /// Bornes du délai propre à une règle. Le plafond est volontairement bas : au-delà de cinq
    /// minutes, une règle de supervision ne borne plus rien et redevient ce que le garde-fou
    /// cherche à empêcher.
    /// </summary>
    public const int MinTimeoutSeconds = 1;
    public const int MaxTimeoutSeconds = 300;
}

/// <summary>Règle telle qu'écrite dans le fichier YAML.</summary>
public sealed class RuleDefinition
{
    public string? Id { get; set; }
    public int Version { get; set; } = 1;
    public string? Name { get; set; }
    public string? Description { get; set; }
    public string? Category { get; set; }
    public string? Severity { get; set; }
    public bool Enabled { get; set; } = true;

    /// <summary>Groupe de périodicité ; à défaut, « recommendations ».</summary>
    public string? Group { get; set; }

    /// <summary>Périodicité propre en secondes, prioritaire sur le groupe.</summary>
    public int? IntervalSeconds { get; set; }

    /// <summary>
    /// Délai maximal accordé à la règle, en secondes. Appliqué en statement_timeout sur la
    /// session qui l'exécute. À défaut, le délai global (Scheduler:QueryTimeout) s'applique.
    /// </summary>
    public int? TimeoutSeconds { get; set; }

    public RuleRequirements? Requires { get; set; }

    /// <summary>Seuils exposés : disponibles comme variables de la condition et comme paramètres SQL.</summary>
    public Dictionary<string, object?>? Parameters { get; set; }

    public string? Query { get; set; }
    public string? Condition { get; set; }

    /// <summary>Colonnes formant l'identité du finding ; vide = un seul finding par instance.</summary>
    public List<string>? Key { get; set; }

    /// <summary>Handler interne pour les règles non exprimables en SQL + condition.</summary>
    public string? Handler { get; set; }

    /// <summary>Nombre maximal de findings produits par exécution.</summary>
    public int? Limit { get; set; }

    public RuleRecommendation? Recommendation { get; set; }
}

public sealed class RuleRequirements
{
    public List<string>? Views { get; set; }
    public List<string>? Extensions { get; set; }

    /// <summary>Extensions devant être absentes : sert aux règles qui recommandent une installation.</summary>
    public List<string>? MissingExtensions { get; set; }

    /// <summary>Version majeure PostgreSQL minimale (14 pour « 14 et plus »).</summary>
    public int? MinVersion { get; set; }

    public int? MaxVersion { get; set; }

    /// <summary>Exige l'appartenance à pg_monitor ou le rôle superutilisateur.</summary>
    public bool? MonitorRole { get; set; }

    /// <summary>Exige une instance primaire (ignore les réplicas en lecture seule).</summary>
    public bool? Primary { get; set; }
}

public sealed class RuleRecommendation
{
    public string? Title { get; set; }
    public string? Message { get; set; }
    public string? Impact { get; set; }
    public string? Confidence { get; set; }

    /// <summary>Commande corrective proposée. Jamais exécutée par l'Advisor.</summary>
    public string? Sql { get; set; }

    public string? Documentation { get; set; }

    /// <summary>Colonnes à joindre au finding comme preuves ; vide = toutes les colonnes.</summary>
    public List<string>? Evidence { get; set; }
}
