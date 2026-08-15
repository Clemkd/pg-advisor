**Français** · [English](RULES.en.md)

# Format des règles

Une règle est un fichier YAML unique. Les règles intégrées sont chargées depuis
`PGADVISOR_RulesDirectory` (`/app/rules`, montable en lecture seule) ; les règles créées ou
modifiées depuis l'IHM sont écrites dans `<DataDirectory>/rules` (`/app/data/rules`). Les deux
répertoires sont surveillés : tout ajout ou modification déclenche validation puis activation,
sans redémarrage.

Une règle invalide n'est jamais activée et ne fait jamais tomber l'application : elle est
listée en erreur dans le dashboard et sur la page Règles, avec le message de validation.

Lorsqu'une règle utilisateur porte le même `id` qu'une règle intégrée, elle la remplace. C'est
le mécanisme d'édition d'une règle packagée depuis l'IHM ; supprimer la version utilisateur
rétablit la règle d'origine.

## Champs

| Champ | Requis | Description |
| --- | --- | --- |
| `id` | oui | Identifiant stable et unique, en minuscules. Convention `categorie.sujet`. |
| `version` | oui | Entier positif, incrémenté à chaque changement de sémantique. |
| `name` | oui | Libellé court affiché dans l'IHM. |
| `description` | non | Explication du diagnostic, affichée dans l'éditeur. |
| `category` | oui | Une des catégories ci-dessous. |
| `severity` | oui | `info`, `warning` ou `critical`. Surchargeable par instance. |
| `group` | non | Groupe de périodicité : `health`, `statistics`, `recommendations` (défaut) ou `configuration`. |
| `intervalSeconds` | non | Périodicité propre, de 5 à 86400. Sert de limitation à l'intérieur du groupe. |
| `timeoutSeconds` | non | Timeout d'exécution, de 1 à 300. Défaut : `Scheduler:QueryTimeout`. Surchargeable par instance. |
| `enabled` | non | `false` livre la règle désactivée par défaut. |
| `requires` | non | Prérequis de capacités ; la règle est ignorée si non satisfaits. |
| `parameters` | non | Seuils scalaires, surchargeables depuis l'IHM. |
| `query` | oui sauf si `handler` | SQL **lecture seule** exécuté sur l'instance supervisée. |
| `handler` | non | Handler interne, exclusif de `query`. |
| `condition` | non | Expression évaluée par ligne ; la ligne devient un finding si elle est vraie. |
| `key` | non | Colonnes formant l'identité du finding. Vide = un finding unique par instance. |
| `limit` | non | Nombre maximal de findings par exécution, de 1 à 1000 (défaut 100). |
| `recommendation` | oui | Contenu du finding produit. |

Un champ inconnu fait échouer le chargement : une faute de frappe dans un nom de champ est
signalée plutôt que silencieusement ignorée.

### `requires`

```yaml
requires:
  views:              # relations ou vues système devant être lisibles
    - pg_stat_user_tables
  extensions:         # extensions devant être installées
    - pg_stat_statements
  missingExtensions:  # inverse : la règle ne se déclenche que si elles sont absentes
    - hypopg
  minVersion: 14      # version majeure PostgreSQL minimale
  maxVersion: 16      # version majeure maximale
  monitorRole: true   # exige pg_monitor ou le rôle superutilisateur
  primary: true       # ignore les instances en recovery
```

Les capacités sont détectées par instance : version, extensions installées, et vues réellement
lisibles par l'utilisateur de supervision (`has_table_privilege`). Une règle dont les prérequis
ne sont pas satisfaits est ignorée pour cette instance — pas d'erreur, pas de finding, et sa
catégorie n'est pas notée dans le score.

Une vue peut être citée par son nom court ou qualifié : `chunks` comme
`timescaledb_information.chunks`.

### `parameters`

```yaml
parameters:
  minimum_ratio: 0.20
  minimum_rows: 10000
```

Chaque seuil est disponible de deux façons :

- comme **paramètre SQL** dans `query`, sous la forme `@minimum_ratio` ;
- comme **variable de la condition**, sous son nom nu.

Les seuils sont surchargeables par instance depuis l'IHM sans toucher au fichier.

### `query`

Requête en lecture seule, une seule instruction. Elle doit commencer par `SELECT`, `WITH`,
`TABLE` ou `EXPLAIN` ; un `;` ailleurs qu'en fin de requête est refusé au chargement. La
session PostgreSQL est en outre forcée en lecture seule avec un `statement_timeout` borné,
si bien qu'une règle ne peut ni écrire ni monopoliser l'instance supervisée.

### `timeoutSeconds`

```yaml
timeoutSeconds: 120
```

Timeout accordé à cette règle, de 1 à 300 secondes. À défaut, le timeout global
`Scheduler:QueryTimeout` s'applique. Il est posé en `statement_timeout` sur la session qui
exécute la règle, puis rendu à sa valeur globale : c'est un réglage de session, jamais une
écriture sur l'instance supervisée.

Une règle légitimement coûteuse sur une grosse base — un calcul de bloat, un parcours d'index —
se voit ainsi accorder son propre budget sans allonger celui de toutes les autres. Le timeout est
surchargeable par instance comme les seuils : la même règle peut disposer de 180 s sur une base
de 2 To et de 30 s ailleurs.

Le plafond de 300 s est volontairement bas. Au-delà, une règle de supervision ne borne plus rien
et redevient exactement ce que ce mécanisme cherche à empêcher.

### `condition`

Expression booléenne évaluée sur chaque ligne du résultat. Les variables disponibles sont les
colonnes du `SELECT`, puis les seuils ; une colonne masque un seuil homonyme.

- comparaisons : `>` `>=` `<` `<=` `==` (ou `=`) `!=` (ou `<>`)
- arithmétique : `+` `-` `*` `/` `%`
- logique : `and` `or` `not`
- test de nullité : `x is null`, `x is not null`
- cast de style PostgreSQL : `used::float`, `value::int`, `value::text`, `value::bool`
- fonctions : `coalesce`, `abs`, `round`, `greatest`, `least`, `length`, `lower`, `upper`,
  `contains`

Une valeur `NULL` rend la comparaison fausse au lieu d'échouer, et une division par zéro donne
`NULL` : une statistique manquante ne produit jamais de finding et ne casse jamais la règle.

Sans `condition`, chaque ligne retournée produit un finding.

### `key`

```yaml
key:
  - schemaname
  - relname
```

La clé identifie l'objet concerné à l'intérieur de la règle. C'est elle qui permet de
reconnaître le même diagnostic d'une exécution à l'autre : sans clé, la règle produit un
finding unique par instance, avec clé elle en produit un par cible.

### `recommendation`

```yaml
recommendation:
  title: "Autovacuum en retard sur {{ schemaname }}.{{ relname }}"
  message: "{{ relname }} présente {{ ratio | percent }} de lignes mortes."
  impact: low | medium | high
  confidence: low | medium | high
  evidence:            # colonnes attachées au finding ; vide = toutes
    - n_dead_tup
    - ratio
  sql: "VACUUM (ANALYZE) {{ schemaname }}.{{ relname }};"
  documentation: https://www.postgresql.org/docs/current/routine-vacuuming.html
```

`message` est facultatif : à défaut, le titre fait office de message. `documentation` doit être
une URL absolue en http ou https.

Le champ `sql` est une **suggestion affichée à l'utilisateur**. L'Advisor ne l'exécute jamais :
le principe zero-touch interdit toute écriture sur l'instance supervisée.

### Interpolation et filtres

`{{ expression | filtre }}` accepte n'importe quelle expression du langage de conditions, et
les filtres se chaînent.

| Filtre | Entrée | Sortie |
| --- | --- | --- |
| `percent` (`percent:0`) | ratio 0 à 1 | `20.3 %` |
| `bytes` | octets | `1.5 KiB` |
| `duration` | millisecondes | `1.5 s` |
| `seconds` | secondes | `2 min` |
| `round` (`round:2`) | nombre | `3.14` |
| `integer` | nombre | `4` |
| `number` | nombre | `1,234,567` |
| `upper`, `lower`, `trim` | texte | texte |

Une valeur nulle est rendue `n/a` : un message n'affiche jamais un trou.

## Handlers internes

Une règle dont la logique dépasse « SQL + condition » — plusieurs requêtes, corrélation entre
lignes — désigne un handler par son nom. Le YAML reste la porte d'entrée : il fournit les
prérequis, la sévérité et la recommandation.

| Handler | Colonnes produites |
| --- | --- |
| `capabilities.missing-extension` | `extension`, `installable`, `server_version` |
| `indexes.redundant` | `schemaname`, `tablename`, `indexname`, `covering_index`, `index_bytes`, `idx_scan`, `columns`, `access_method`, `is_partial` |

La liste à jour, avec la description de chaque handler, est exposée par
`GET /api/rules/schema` et affichée dans l'aide-mémoire de l'éditeur.

## Catégories

`performance`, `queries`, `indexes`, `vacuum`, `bloat`, `connections`, `locks`,
`transactions`, `checkpoints`, `configuration`, `storage`, `statistics`, `security`,
`extensions`.

## Groupes de périodicité

| Groupe | Périodicité par défaut | Usage |
| --- | --- | --- |
| `health` | 10 s | activité, connexions, verrous, transactions longues |
| `statistics` | 1 min | compteurs cumulés de `pg_stat_*` |
| `recommendations` | 5 min | analyses de tables, index, requêtes |
| `configuration` | 1 h | paramètres, stockage, sécurité |

Les périodicités sont configurables (`Scheduler:Intervals`). L'intervalle propre d'une
instance remplace celui du groupe `health`.

## Garde-fou de coût

Un timeout borne chaque exécution, mais rien n'empêche une règle de le consommer indéfiniment. Le
garde-fou tient donc, **par couple (règle, instance)**, le compte des exécutions qui pèsent sur
la base observée. Cet état est persisté en SQLite : il survit à un redémarrage de l'Advisor,
sans quoi le compteur repartirait de zéro à chaque relance et le garde-fou ne se déclencherait
jamais.

Compte comme incident :

| Nature | Motif consigné | Ce que cela dit |
| --- | --- | --- |
| `timeout` | Le `statement_timeout` a coupé la requête | L'instance souffre, ou la règle a besoin de plus de temps **ici** |
| `error` | Erreur SQL ordinaire (vue absente, colonne inconnue, droits) | La règle est fautive |
| `slow` | Exécution réussie mais au-delà de `SlowRunRatio` du timeout | La règle coûte déjà, et n'échouerait jamais d'elle-même |

Une règle qui réussit en 25 s sous un timeout de 30 est déjà un problème : elle n'échoue jamais,
et rien ne la signalerait sans ce troisième cas.

Deux seuils, deux réactions :

1. **`WarningThreshold` (3 par défaut)** — la règle est marquée `degraded`, affichée comme telle
   dans l'IHM et notifiée (`rule_degraded`). **Elle continue de s'exécuter.**
2. **`QuarantineThreshold` (5 par défaut)** — la règle est mise en quarantaine **sur cette
   instance seulement**, pour `QuarantineDuration` (6 h par défaut), et notifiée
   (`rule_quarantined`). Passée l'échéance, elle est réessayée automatiquement : un succès rapide
   efface l'ardoise, un nouvel incident reconduit la quarantaine sans attendre à nouveau cinq
   passages.

Une règle qui suffoque sur une base de 2 To n'est jamais coupée sur les autres.

**Le succès efface l'ardoise.** Une exécution réussie et rapide remet tous les compteurs à zéro :
un incident ancien ne finit pas par condamner une règle redevenue saine.

Une quarantaine ne fait jamais disparaître un diagnostic en silence :

- les findings déjà produits par la règle **ne sont pas résolus** — ils continuent de peser sur
  le score tant que la règle n'a pas pu constater leur disparition ;
- la catégorie de la règle **cesse d'être déclarée évaluée** sur cette instance, au lieu d'être
  notée à 100 comme si tout allait bien ;
- l'état est exposé par l'API (`GET /api/rules/{id}`, `GET /api/rules/health`, et la liste des
  règles écartées dans la réponse de chaque instance).

Une réactivation manuelle immédiate est possible : `POST /api/rules/{id}/reactivate`. Elle repart
d'une ardoise vierge, l'exploitant affirmant que la cause est traitée.

Les réglages vivent dans la section `Scheduler` (voir le tableau de configuration du
[README](../README.md)) : `Scheduler__RuleGuard__Enabled`, `WarningThreshold`,
`QuarantineThreshold`, `QuarantineDuration`, `SlowRunRatio`.

Rien de tout cela n'est écrit sur l'instance supervisée : c'est de l'état de l'Advisor.

## Types de règles et exemples fournis

| Type | Exemple |
| --- | --- |
| SQL + condition | [vacuum.dead-tuples](../rules/vacuum.dead-tuples.yaml) |
| SQL + expressions entre colonnes | [connections.saturation](../rules/connections.saturation.yaml) |
| Dépendante d'une extension | [queries.slowest-mean-time](../rules/queries.slowest-mean-time.yaml) |
| Spécifique à une version PostgreSQL | [checkpoints.forced-too-often-pg17](../rules/checkpoints.forced-too-often-pg17.yaml) |
| Spécifique TimescaleDB | [timescaledb.uncompressed-chunks](../rules/timescaledb.uncompressed-chunks.yaml) |
| Handler interne | [indexes.redundant](../rules/indexes.redundant.yaml) |
| Capacité absente | [extensions.pg-stat-statements-missing](../rules/extensions.pg-stat-statements-missing.yaml) |

## Manipuler les règles depuis l'IHM

La page **Règles** liste les règles chargées avec leur origine, leur état et leurs prérequis,
et affiche les règles en erreur. L'éditeur d'une règle permet de :

- modifier le YAML, avec validation à la frappe (aucune écriture tant que la règle est
  invalide) ;
- exécuter la règle sur une instance choisie sans rien persister, et voir le résultat SQL brut
  comme les findings qui en découleraient ;
- consulter son applicabilité instance par instance, avec le motif du refus, le timeout en vigueur
  et l'état du garde-fou ;
- créer, dupliquer ou supprimer une règle utilisateur ;
- poser une surcharge globale ou par instance : activation, sévérité, périodicité, timeout, seuils ;
- lever immédiatement une quarantaine.

Toute écriture depuis l'IHM produit un fichier YAML dans `<DataDirectory>/rules` et déclenche
le même rechargement qu'une modification faite à la main : le format fichier reste la source
de vérité.

## Surcharges

`RuleOverrides` (SQLite) applique un delta à une règle, globalement (`connectionId` nul) ou
pour une instance : activation, sévérité, périodicité, **timeout** et seuils. L'ordre de
précédence est : valeur du fichier, puis surcharge globale, puis surcharge d'instance. Une
surcharge de seuils ne remplace que les seuils cités ; les autres gardent la valeur du fichier.

## API

| Route | Rôle |
| --- | --- |
| `GET /api/rules` | Liste, filtrable par catégorie, origine et recherche |
| `GET /api/rules/{id}` | Règle, YAML et applicabilité par instance, avec timeout et état du garde-fou |
| `GET /api/rules/health` | État du garde-fou pour toutes les règles suivies, filtrable par instance et par état |
| `GET /api/rules/schema` | Catégories, groupes, filtres, fonctions, handlers, gabarit |
| `GET /api/rules/errors` | Règles refusées au chargement |
| `POST /api/rules/validate` | Valide un YAML sans rien écrire |
| `POST /api/rules` | Crée une règle utilisateur |
| `PUT /api/rules/{id}` | Remplace une règle |
| `DELETE /api/rules/{id}` | Supprime la règle utilisateur |
| `POST /api/rules/reload` | Force un rechargement |
| `POST /api/rules/{id}/dry-run` | Exécute sur une instance sans persister |
| `POST /api/rules/{id}/reactivate` | Lève la quarantaine, sur une instance ou sur toutes |
| `PUT /api/rules/{id}/override` | Pose une surcharge |
| `DELETE /api/rules/{id}/override` | Retire une surcharge |

Les écritures exigent le rôle `Admin`.

Deux événements de notification s'ajoutent aux deux existants : `rule_degraded` (avertissement,
sévérité `warning`) et `rule_quarantined` (règle écartée, sévérité `critical`). Ils empruntent
la même déduplication : un épisode n'est notifié qu'une fois par webhook, une rechute après
rétablissement l'est à nouveau.
