namespace PgAdvisor.Api.Data;

public static class Roles
{
    public const string Admin = "Admin";
    public const string Viewer = "Viewer";

    public static bool IsValid(string role) => role is Admin or Viewer;
}

public static class Severities
{
    public const string Info = "info";
    public const string Warning = "warning";
    public const string Critical = "critical";

    private static readonly string[] Ordered = [Info, Warning, Critical];

    public static bool IsValid(string? severity) =>
        severity is not null && Array.IndexOf(Ordered, severity) >= 0;

    /// <summary>0 = info, 2 = critical. -1 si inconnue.</summary>
    public static int Rank(string? severity) =>
        severity is null ? -1 : Array.IndexOf(Ordered, severity);

    public static bool MeetsMinimum(string severity, string minimum) =>
        Rank(severity) >= Rank(minimum);
}

public static class FindingStatus
{
    public const string Active = "active";
    public const string Resolved = "resolved";
    public const string Ignored = "ignored";
}

public static class NotificationEvents
{
    public const string NewFinding = "new_finding";
    public const string FindingResolved = "finding_resolved";

    /// <summary>Une règle accumule les incidents sur une instance : elle s'exécute encore.</summary>
    public const string RuleDegraded = "rule_degraded";

    /// <summary>Une règle a été écartée d'une instance : son diagnostic n'est plus produit.</summary>
    public const string RuleQuarantined = "rule_quarantined";

    public static readonly string[] All = [NewFinding, FindingResolved, RuleDegraded, RuleQuarantined];

    public static bool IsValid(string value) => All.Contains(value, StringComparer.Ordinal);
}

/// <summary>
/// Nature de l'objet notifié. La déduplication se fait par (webhook, sujet, identifiant du
/// sujet, événement, cycle) : un finding et une règle peuvent porter le même identifiant
/// numérique sans jamais se confondre.
/// </summary>
public static class NotificationSubjects
{
    public const string Finding = "finding";
    public const string Rule = "rule";
}

/// <summary>État d'une règle sur une instance, du point de vue du garde-fou de coût.</summary>
public static class RuleHealthStates
{
    /// <summary>Aucun incident en cours : la dernière exécution a réussi dans son budget.</summary>
    public const string Healthy = "healthy";

    /// <summary>Incidents répétés signalés à l'exploitant ; la règle continue de s'exécuter.</summary>
    public const string Degraded = "degraded";

    /// <summary>Règle écartée de cette instance jusqu'à l'échéance, puis réessayée.</summary>
    public const string Quarantined = "quarantined";
}

/// <summary>
/// Nature d'un incident. La distinction est ce qui dit à l'exploitant s'il doit corriger sa
/// règle ou s'inquiéter de sa base : un dépassement de délai dit « cette instance souffre »,
/// une erreur SQL dit « cette règle est fautive ».
/// </summary>
public static class RuleFailureKinds
{
    /// <summary>Le statement_timeout de la session a coupé la requête.</summary>
    public const string Timeout = "timeout";

    /// <summary>Erreur SQL ordinaire : vue absente, colonne inconnue, droits, condition invalide.</summary>
    public const string Error = "error";

    /// <summary>Exécution réussie, mais assez lente pour peser sur la base observée.</summary>
    public const string Slow = "slow";

    public static bool IsValid(string? kind) => kind is Timeout or Error or Slow;
}

/// <summary>
/// Forme de la charge envoyée. Les services de messagerie n'acceptent pas un JSON quelconque :
/// Discord exige « content » ou « embeds », Slack « text » ou « blocks ». Un webhook maison,
/// lui, préfère la charge complète.
/// </summary>
public static class NotificationFormats
{
    /// <summary>Charge JSON complète de l'Advisor : instance, finding, preuves.</summary>
    public const string Generic = "generic";

    public const string Discord = "discord";
    public const string Slack = "slack";

    public static readonly string[] All = [Generic, Discord, Slack];

    public static bool IsValid(string? format) =>
        format is not null && All.Contains(format, StringComparer.OrdinalIgnoreCase);
}

public class User
{
    public int Id { get; set; }
    public string Username { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public string Role { get; set; } = Roles.Admin;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? LastLoginAt { get; set; }

    /// <summary>Vrai lorsque le mot de passe a été généré au bootstrap et n'a pas encore été changé.</summary>
    public bool MustChangePassword { get; set; }
}

/// <summary>Une instance PostgreSQL supervisée. L'Advisor en gère N indépendamment.</summary>
public class PostgresConnection
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Host { get; set; } = string.Empty;
    public int Port { get; set; } = 5432;
    public string Database { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;

    /// <summary>Chiffré au repos, jamais renvoyé par l'API ni journalisé.</summary>
    public string EncryptedPassword { get; set; } = string.Empty;

    public string SslMode { get; set; } = "Prefer";

    /// <summary>Périodicité propre à cette instance ; 0 = utiliser les groupes globaux.</summary>
    public int CollectionIntervalSeconds { get; set; }

    public bool Enabled { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; }

    // État de la dernière collecte, alimenté par le scheduler.
    public DateTimeOffset? LastCollectedAt { get; set; }
    public string? LastError { get; set; }
    public string? ServerVersion { get; set; }
    public int ServerVersionNum { get; set; }
    public string? TimescaleVersion { get; set; }

    /// <summary>Capabilities détectées, sérialisées en JSON pour survivre au redémarrage.</summary>
    public string? CapabilitiesJson { get; set; }

    public List<Finding> Findings { get; set; } = [];
}

public class Finding
{
    public int Id { get; set; }
    public int ConnectionId { get; set; }
    public PostgresConnection? Connection { get; set; }

    public string RuleId { get; set; } = string.Empty;
    public int RuleVersion { get; set; }

    /// <summary>
    /// Identité de l'objet concerné à l'intérieur de la règle (par exemple public.orders).
    /// Chaîne vide pour une règle produisant un finding unique par instance.
    /// </summary>
    public string TargetKey { get; set; } = string.Empty;

    public string Category { get; set; } = string.Empty;
    public string Severity { get; set; } = Severities.Info;
    public string Title { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;

    /// <summary>Preuves/métriques de la ligne ayant déclenché la règle, en JSON.</summary>
    public string? EvidenceJson { get; set; }

    public string? Impact { get; set; }
    public string? Confidence { get; set; }
    public string? RemediationSql { get; set; }
    public string? Documentation { get; set; }

    public string Status { get; set; } = FindingStatus.Active;
    public DateTimeOffset DetectedAt { get; set; }
    public DateTimeOffset LastSeenAt { get; set; }
    public DateTimeOffset? ResolvedAt { get; set; }
    public int OccurrenceCount { get; set; } = 1;

    public List<FindingHistoryEntry> History { get; set; } = [];
}

public class FindingHistoryEntry
{
    public int Id { get; set; }
    public int FindingId { get; set; }
    public Finding? Finding { get; set; }
    public DateTimeOffset At { get; set; }
    public string? FromStatus { get; set; }
    public string ToStatus { get; set; } = string.Empty;
    public string? Severity { get; set; }
    public string? Note { get; set; }

    /// <summary>Utilisateur à l'origine du changement, null si automatique.</summary>
    public string? Actor { get; set; }
}

public class NotificationConfiguration
{
    public int Id { get; set; }

    /// <summary>Identifiant lisible utilisé dans la configuration YAML et les logs.</summary>
    public string Key { get; set; } = string.Empty;

    public string Url { get; set; } = string.Empty;
    public bool Enabled { get; set; } = true;
    public string MinimumSeverity { get; set; } = Severities.Warning;

    /// <summary>Forme de la charge : generic, discord ou slack.</summary>
    public string Format { get; set; } = NotificationFormats.Generic;

    /// <summary>Événements souscrits, séparés par des virgules.</summary>
    public string Events { get; set; } = string.Join(',', NotificationEvents.All);

    /// <summary>En-têtes HTTP additionnels, JSON objet. Peut contenir un secret : non renvoyé par l'API.</summary>
    public string? HeadersJson { get; set; }

    /// <summary>Restreint la notification à une instance ; null = toutes.</summary>
    public int? ConnectionId { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? LastAttemptAt { get; set; }
    public bool? LastAttemptSucceeded { get; set; }
    public string? LastError { get; set; }

    public IEnumerable<string> EventList =>
        Events.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
}

public class NotificationHistoryEntry
{
    public int Id { get; set; }
    public int ConfigurationId { get; set; }
    public NotificationConfiguration? Configuration { get; set; }

    /// <summary>Nature de l'objet notifié : « finding » ou « rule ».</summary>
    public string Subject { get; set; } = NotificationSubjects.Finding;

    /// <summary>
    /// Identifiant de l'objet notifié dans son propre référentiel : un finding, ou l'état de
    /// santé d'une règle sur une instance. Conservé même si l'objet est purgé, d'où l'absence
    /// de contrainte de suppression en cascade stricte.
    /// </summary>
    public int SubjectId { get; set; }

    public string Event { get; set; } = string.Empty;

    /// <summary>
    /// Cycle de vie du finding auquel se rattache la notification (date de détection en secondes
    /// Unix). Il permet de renotifier une réapparition sans jamais renotifier deux fois le même
    /// épisode.
    /// </summary>
    public long Cycle { get; set; }

    public string Severity { get; set; } = string.Empty;
    public DateTimeOffset At { get; set; }
    public bool Success { get; set; }
    public int Attempts { get; set; }
    public int? StatusCode { get; set; }
    public string? Error { get; set; }
}

/// <summary>
/// Delta appliqué à une règle : globalement (ConnectionId null) ou pour une instance donnée.
/// Le fichier YAML reste la définition de référence.
/// </summary>
public class RuleOverride
{
    public int Id { get; set; }
    public string RuleId { get; set; } = string.Empty;
    public int? ConnectionId { get; set; }
    public PostgresConnection? Connection { get; set; }

    public bool? Enabled { get; set; }
    public string? Severity { get; set; }

    /// <summary>Surcharge des seuils exposés par la règle, JSON objet.</summary>
    public string? ParametersJson { get; set; }

    public int? IntervalSeconds { get; set; }

    /// <summary>
    /// Délai maximal accordé à la règle sur cette instance. Une base de 2 To a besoin de plus
    /// de temps que les autres pour la même règle : le délai se surcharge comme les seuils.
    /// </summary>
    public int? TimeoutSeconds { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>
/// Mémoire des exécutions d'une règle sur une instance. Persistée pour survivre à un
/// redémarrage : sans cela, redémarrer l'Advisor remettrait les compteurs à zéro et le
/// garde-fou ne se déclencherait jamais.
///
/// Toujours par couple (règle, instance) : une règle qui suffoque sur une base de 2 To ne doit
/// pas être coupée sur les autres.
/// </summary>
/// <summary>
/// Dernières valeurs observées par une règle sur une cible. Certaines règles lisent des compteurs
/// cumulés depuis le dernier reset des statistiques — checkpoints forcés, fichiers temporaires,
/// taux de cache. Une fois le seuil franchi, la valeur cumulée ne redescend plus : le diagnostic
/// restait actif à vie, même après correction du problème. Conserver l'échantillon précédent
/// permet à la règle de raisonner sur ce qui a bougé depuis, et donc de se résoudre.
/// </summary>
public class RuleSample
{
    public int Id { get; set; }
    public int ConnectionId { get; set; }
    public string RuleId { get; set; } = string.Empty;

    /// <summary>Vide pour une règle qui ne produit qu'une ligne par instance.</summary>
    public string TargetKey { get; set; } = string.Empty;

    /// <summary>Colonnes numériques de la ligne, sérialisées en JSON.</summary>
    public string ValuesJson { get; set; } = "{}";

    public DateTimeOffset At { get; set; }

    public PostgresConnection? Connection { get; set; }
}

public class RuleHealth
{
    public int Id { get; set; }
    public int ConnectionId { get; set; }
    public PostgresConnection? Connection { get; set; }

    public string RuleId { get; set; } = string.Empty;

    /// <summary>healthy, degraded ou quarantined.</summary>
    public string State { get; set; } = RuleHealthStates.Healthy;

    /// <summary>Échecs consécutifs : dépassement de délai ou erreur SQL.</summary>
    public int ConsecutiveFailures { get; set; }

    /// <summary>
    /// Exécutions réussies mais trop lentes, consécutives. Elles comptent autant : une règle
    /// qui réussit en 25 s sous un délai de 30 est déjà un problème, et n'échoue jamais.
    /// </summary>
    public int ConsecutiveSlowRuns { get; set; }

    /// <summary>timeout, error ou slow. Null tant qu'aucun incident n'a eu lieu.</summary>
    public string? LastFailureKind { get; set; }

    /// <summary>Message du dernier incident, borné : il est affiché tel quel dans l'IHM.</summary>
    public string? LastFailureMessage { get; set; }

    public DateTimeOffset? LastFailureAt { get; set; }
    public DateTimeOffset? LastSuccessAt { get; set; }

    /// <summary>Durée de la dernière exécution réussie, en millisecondes.</summary>
    public double? LastDurationMs { get; set; }

    /// <summary>Pire durée réussie depuis la dernière remise à zéro : c'est elle qui alerte avant l'échec.</summary>
    public double? MaxDurationMs { get; set; }

    /// <summary>Délai en vigueur lors de la dernière exécution, pour situer la durée mesurée.</summary>
    public int? LastTimeoutSeconds { get; set; }

    /// <summary>
    /// Début de la série d'incidents en cours. Sert d'identifiant d'épisode à la déduplication
    /// des notifications : une nouvelle série après un rétablissement se renotifie, la même
    /// série jamais deux fois.
    /// </summary>
    public DateTimeOffset? IncidentsSince { get; set; }

    /// <summary>Date d'entrée en quarantaine, null tant que le second seuil n'est pas franchi.</summary>
    public DateTimeOffset? QuarantinedAt { get; set; }

    /// <summary>Échéance de la quarantaine ; passée cette date, la règle est réessayée d'elle-même.</summary>
    public DateTimeOffset? QuarantinedUntil { get; set; }

    /// <summary>Motif consigné, en clair : il dit lequel des deux problèmes s'est produit.</summary>
    public string? QuarantineReason { get; set; }

    /// <summary>Nombre de mises en quarantaine depuis le dernier rétablissement complet.</summary>
    public int QuarantineCount { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }

    /// <summary>Incidents consécutifs, toutes natures confondues : c'est ce que comparent les seuils.</summary>
    public int Strikes => ConsecutiveFailures + ConsecutiveSlowRuns;
}

/// <summary>
/// Plan d'exécution mesuré, conservé pour être relu sans le remesurer. Produire un plan demande
/// un EXPLAIN ANALYZE, donc une exécution réelle de la requête sur l'instance supervisée : ce
/// n'est pas anodin en production, et rien ne justifie de le refaire pour relire un plan déjà
/// obtenu.
///
/// Une seule ligne par requête et par instance : la mesure la plus récente remplace la
/// précédente. Un historique complet ferait grossir la base sans borne pour un usage — comparer
/// deux mesures — qui n'est pas demandé.
/// </summary>
public class QueryPlanSnapshot
{
    public int Id { get; set; }
    public int ConnectionId { get; set; }
    public PostgresConnection? Connection { get; set; }

    /// <summary>
    /// Identité de la requête pour cette instance : le queryid de pg_stat_statements quand
    /// l'analyse part du classement, sinon une empreinte du texte saisi.
    /// </summary>
    public string QueryKey { get; set; } = string.Empty;

    /// <summary>queryid de pg_stat_statements, null pour une requête saisie à la main.</summary>
    public string? QueryId { get; set; }

    /// <summary>Texte réellement passé à EXPLAIN : préfixe retiré, paramètres substitués.</summary>
    public string Sql { get; set; } = string.Empty;

    /// <summary>
    /// Valeurs saisies pour $1, $2…, en tableau JSON. Un plan dépend des valeurs qui l'ont
    /// produit : relire le plan sans elles reviendrait à lire un plan sans savoir de quoi il parle.
    /// </summary>
    public string? ParametersJson { get; set; }

    /// <summary>Plan brut au format JSON, seule source de la vue structurée : il est reparsé à la relecture.</summary>
    public string PlanJson { get; set; } = string.Empty;

    /// <summary>Sortie textuelle d'EXPLAIN, que le parseur JSON ne sait pas reconstituer.</summary>
    public string PlanText { get; set; } = string.Empty;

    /// <summary>Date de la mesure : sans elle, l'opérateur relit un plan d'âge inconnu.</summary>
    public DateTimeOffset MeasuredAt { get; set; }

    /// <summary>Durée de la mesure elle-même, en millisecondes — ce qu'a coûté l'analyse à l'instance.</summary>
    public double DurationMs { get; set; }
}

public class Setting
{
    public string Key { get; set; } = string.Empty;
    public string? Value { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
