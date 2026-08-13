namespace PgAdvisor.Api;

/// <summary>
/// Options racine liées au déploiement (chemins du volume, périodicités).
/// Liées depuis la configuration, préfixe d'environnement PGADVISOR_.
/// </summary>
public sealed class AdvisorOptions
{
    /// <summary>
    /// Volume inscriptible : base SQLite, clé de chiffrement, règles créées depuis l'IHM.
    /// Le nom par défaut évite délibérément « data », qui entrerait en collision avec le
    /// répertoire de sources Data/ sur un système de fichiers insensible à la casse.
    /// </summary>
    public string DataDirectory { get; set; } = "advisor-data";

    /// <summary>Répertoire des règles fournies par l'opérateur, potentiellement en lecture seule.</summary>
    public string RulesDirectory { get; set; } = "rules";

    /// <summary>Sous-répertoire du volume accueillant les règles créées ou modifiées depuis l'IHM.</summary>
    public string UserRulesDirectoryName { get; set; } = "rules";

    public AuthOptions Auth { get; set; } = new();
    public SchedulerOptions Scheduler { get; set; } = new();
    public NotificationOptions Notifications { get; set; } = new();

    public string UserRulesDirectory => Path.Combine(DataDirectory, UserRulesDirectoryName);
    public string DatabasePath => Path.Combine(DataDirectory, "pg-advisor.db");
    public string KeyPath => Path.Combine(DataDirectory, "keys", "secrets.key");
}

public sealed class AuthOptions
{
    public string CookieName { get; set; } = "pg-advisor";
    public int SlidingExpirationHours { get; set; } = 12;

    /// <summary>
    /// Force l'attribut Secure sur le cookie. À activer dès que l'Advisor est exposé en HTTPS ;
    /// laissé à false par défaut pour ne pas casser un accès HTTP local ou derrière un proxy.
    /// </summary>
    public bool RequireHttps { get; set; }

    /// <summary>
    /// Mot de passe du compte admin créé au premier démarrage. Si vide, un mot de passe
    /// aléatoire est généré et journalisé une seule fois.
    /// </summary>
    public string? BootstrapPassword { get; set; }

    public string BootstrapUsername { get; set; } = "admin";
}

public sealed class SchedulerOptions
{
    public bool Enabled { get; set; } = true;
    public SchedulerIntervals Intervals { get; set; } = new();

    /// <summary>Nombre d'instances analysées simultanément : une analyse lourde n'en bloque pas les autres.</summary>
    public int MaxConcurrentInstances { get; set; } = 4;

    public TimeSpan PerInstanceTimeout { get; set; } = TimeSpan.FromMinutes(2);

    /// <summary>Délai maximal d'exécution d'une requête de règle sur l'instance supervisée.</summary>
    public TimeSpan QueryTimeout { get; set; } = TimeSpan.FromSeconds(30);
}

public sealed class SchedulerIntervals
{
    public TimeSpan Health { get; set; } = TimeSpan.FromSeconds(10);
    public TimeSpan Statistics { get; set; } = TimeSpan.FromMinutes(1);
    public TimeSpan Recommendations { get; set; } = TimeSpan.FromMinutes(5);
    public TimeSpan Configuration { get; set; } = TimeSpan.FromHours(1);
}

public sealed class NotificationOptions
{
    public int MaxRetries { get; set; } = 3;
    public TimeSpan RetryDelay { get; set; } = TimeSpan.FromSeconds(30);
    public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(10);
}
