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

    /// <summary>
    /// Délai maximal d'exécution d'une requête de règle sur l'instance supervisée, appliqué à
    /// défaut de délai propre à la règle (<c>timeoutSeconds</c>).
    /// </summary>
    public TimeSpan QueryTimeout { get; set; } = TimeSpan.FromSeconds(30);

    /// <summary>Garde-fou de coût : comptage des exécutions coûteuses et mise en quarantaine.</summary>
    public RuleGuardOptions RuleGuard { get; set; } = new();
}

/// <summary>
/// Garde-fou de coût des règles. Il compte, par couple (règle, instance), les exécutions qui
/// pèsent sur la base supervisée — dépassement de délai, erreur SQL, ou succès trop lent — puis
/// avertit, et finit par écarter la règle de cette instance plutôt que de la laisser coûter
/// indéfiniment. Rien de tout cela n'est écrit sur l'instance supervisée : c'est de l'état de
/// l'Advisor.
/// </summary>
public sealed class RuleGuardOptions
{
    /// <summary>Désactive tout le mécanisme : les règles s'exécutent alors sans plafond d'incidents.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>
    /// Incidents consécutifs à partir desquels la règle est signalée et notifiée, sans cesser
    /// de s'exécuter. Trois passages écartent l'accident isolé (bascule, verrou, redémarrage)
    /// sans laisser traîner un vrai problème.
    /// </summary>
    public int WarningThreshold { get; set; } = 3;

    /// <summary>
    /// Incidents consécutifs à partir desquels la règle est mise en quarantaine sur cette
    /// instance. Deux passages de plus que l'avertissement : l'exploitant a le temps de voir
    /// l'alerte avant que le diagnostic ne cesse d'être produit.
    /// </summary>
    public int QuarantineThreshold { get; set; } = 5;

    /// <summary>
    /// Durée d'une quarantaine, au terme de laquelle la règle est réessayée d'elle-même. Six
    /// heures : assez long pour que la règle cesse de peser sur une base en souffrance, assez
    /// court pour qu'un correctif appliqué dans la journée soit constaté sans intervention.
    /// </summary>
    public TimeSpan QuarantineDuration { get; set; } = TimeSpan.FromHours(6);

    /// <summary>
    /// Fraction du délai maximal au-delà de laquelle une exécution réussie compte quand même
    /// comme un incident. À 80 % du budget, la règle n'est qu'à une croissance de tables du
    /// dépassement : elle coûte déjà, et n'échouerait jamais d'elle-même.
    /// </summary>
    public double SlowRunRatio { get; set; } = 0.8;
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
