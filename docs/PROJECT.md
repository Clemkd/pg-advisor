**Français** · [English](PROJECT.en.md)

# PostgreSQL Advisor — descriptif projet

## Objet

Développer un PostgreSQL Advisor self-hosted, déployable sous forme d'un unique conteneur
Docker, capable de superviser **une ou plusieurs instances PostgreSQL distinctes** sans
modifier leur conteneur, leurs volumes ou leur configuration.

Une seule instance de l'Advisor supervise N bases PostgreSQL indépendantes : chaque
connexion est isolée (capabilities, findings, health score, planification propres).

## Stack

- Backend : ASP.NET Core 10
- Frontend : React + TypeScript + Vite
- Frontend compilé puis servi directement par ASP.NET Core (`wwwroot`)
- Npgsql pour les connexions PostgreSQL
- SQLite pour les données propres à l'Advisor
- Docker / Docker Compose
- API REST + SSE pour les mises à jour temps réel
- Authentification locale simple par compte utilisateur
- UI responsive avec Tailwind CSS

## Architecture

```
pg-advisor
┌───────────────────────────────────────────────┐
│ ASP.NET Core 10                               │
│                                               │
│ ┌───────────────┐ ┌─────────────────────────┐ │
│ │ REST API      │ │ React SPA               │ │
│ │ Authentication│ │ Dashboard               │ │
│ │ Configuration │ │ PostgreSQL analysis     │ │
│ └───────────────┘ │ Recommendations         │ │
│                   │ Rules                   │ │
│ ┌───────────────┐ └─────────────────────────┘ │
│ │ Collectors    │                             │
│ │ Rule Engine   │                             │
│ │ Scheduler     │                             │
│ │ Notifications │                             │
│ └───────┬───────┘                             │
│         │                                     │
│      SQLite                                   │
└─────────┼─────────────────────────────────────┘
          │ SQL read-only
          ▼
    PostgreSQL instances (1..N)
```

## PostgreSQL : principe zero-touch

L'Advisor ne doit rien installer ni modifier automatiquement sur PostgreSQL. Il se connecte
uniquement via SQL avec un utilisateur disposant des permissions nécessaires.

Sources exploitées :

- `pg_stat_activity`
- `pg_stat_database`
- `pg_stat_user_tables`
- `pg_stat_user_indexes`
- `pg_statio_*`
- `pg_locks`
- `pg_settings`
- `pg_class`
- `pg_index`
- `pg_constraint`
- `information_schema`
- `EXPLAIN`
- statistiques TimescaleDB lorsqu'elles sont disponibles

## Extensions optionnelles

Le système détecte automatiquement les extensions et capacités disponibles, par instance :

```
✓ pg_stat_activity
✓ pg_stat_user_tables
✓ TimescaleDB
✓ pg_stat_statements
✗ HypoPG
```

Les fonctionnalités dépendant d'une extension ne sont activées que si celle-ci est
disponible. Si une extension importante est absente, l'Advisor crée une recommandation
d'installation, sans jamais tenter de l'installer :

> `pg_stat_statements` n'est pas disponible. Son installation permettrait d'obtenir
> l'historique et le classement des requêtes par temps d'exécution.

## Rule Engine

Le point central du projet est un moteur de règles extensible sans recompilation. Les
règles sont définies en YAML et chargées dynamiquement depuis `/app/rules`.

```yaml
id: vacuum.dead-tuples
version: 1

name: High dead tuples
category: vacuum
severity: warning

requires:
  views:
    - pg_stat_user_tables

query: |
  SELECT
    schemaname,
    relname,
    n_dead_tup,
    n_live_tup,
    n_dead_tup::float / NULLIF(n_live_tup, 0) AS ratio
  FROM pg_stat_user_tables
  WHERE n_live_tup > 10000

condition: ratio > 0.20

recommendation:
  title: "Autovacuum may be too slow"
  message: "{{ relname }} has {{ ratio | percent }} dead tuples."
```

Pipeline du moteur :

```
YAML
 ↓
Validation
 ↓
Requirements/capabilities check
 ↓
SQL execution
 ↓
Condition evaluation
 ↓
Finding
 ↓
Recommendation
 ↓
Severity / score
```

### Types de règles

1. SQL + condition
2. SQL + expressions
3. règles dépendantes d'une extension
4. règles spécifiques PostgreSQL
5. règles spécifiques TimescaleDB

Les règles complexes nécessitant du code peuvent être implémentées comme des handlers
internes, mais le maximum doit rester déclaratif.

### Édition des règles depuis l'IHM

Les règles doivent être manipulables depuis l'interface, pas seulement via le système de
fichiers :

- liste des règles avec état (active, désactivée, en erreur), catégorie, sévérité,
  capabilities requises ;
- éditeur YAML avec validation avant enregistrement (une règle invalide n'est jamais
  activée) ;
- création, duplication, modification, suppression ;
- activation/désactivation et surcharge de sévérité ou de seuils par instance
  (`RuleOverrides`) ;
- exécution à la demande sur une instance choisie, avec aperçu du résultat SQL et des
  findings produits, sans persistance (mode « dry run ») ;
- distinction entre règles intégrées (packagées, en lecture seule, surchargeable) et règles
  utilisateur (éditables, stockées dans le volume) ;
- les écritures depuis l'IHM produisent des fichiers YAML dans le répertoire des règles :
  le format fichier reste la source de vérité et le hot reload s'applique aussi aux
  modifications faites via l'IHM.

### Catégories initiales

performance ; requêtes ; index ; vacuum/autovacuum ; bloat ; connexions ; locks/blocking ;
transactions longues ; checkpoints ; configuration PostgreSQL ; stockage ; statistiques ;
sécurité de configuration ; TimescaleDB ; extensions disponibles.

## Dashboard

```
PostgreSQL Advisor

Health Score                         87/100

Critical       1
Warning        4
Info           7

Performance    82
Indexes        91
Vacuum         74
Storage        94
Configuration  89
Connections    96
TimescaleDB    81
```

Chaque recommandation affiche : sévérité ; titre ; description ; preuves/métriques ;
impact estimé ; confiance ; règle ayant déclenché le diagnostic ; éventuelle commande SQL
corrective ; documentation ; date de détection ; statut `active` / `resolved` / `ignored`.

## Gestion des instances PostgreSQL

L'Advisor supervise plusieurs instances, chacune avec son propre health score :

```
Production
PostgreSQL 18
TimescaleDB 2.24
Health: 91/100

Staging
PostgreSQL 18
Health: 97/100
```

Chaque connexion possède : nom ; host ; port ; database ; utilisateur ; secret/mot de
passe ; intervalle de collecte ; activation/désactivation.

Les credentials ne doivent jamais apparaître dans les logs ou l'interface après sauvegarde.

## Notifications Webhook

```yaml
webhooks:
  - id: operations
    url: ${OPS_WEBHOOK_URL}
    enabled: true
    minimumSeverity: warning
    events:
      - new_finding
      - finding_resolved
```

Déduplication obligatoire :

```
Finding détecté
     ↓
déjà notifié ?
 ┌───┴────┐
non      oui
 ↓        ↓
Webhook  ignore
```

Conserver l'historique des notifications et gérer les erreurs/retry raisonnables.

## Authentification

- login/password
- ASP.NET Core Cookie Authentication
- cookie HttpOnly, Secure
- hash de mot de passe robuste
- `[Authorize]` sur l'API
- logout
- éventuellement rôles Admin / Viewer

Pas d'IdentityServer/OIDC pour le MVP.

## SQLite

SQLite contient uniquement l'état de l'Advisor :

```
Users
PostgresConnections
Findings
FindingHistory
NotificationConfigurations
NotificationHistory
RuleOverrides
Settings
```

Les règles restent dans des fichiers YAML afin de pouvoir être ajoutées/modifiées sans
recompilation.

## Hot reload des règles

Surveillance de `/app/rules` :

```
File change
    ↓
Validation
    ↓
Compilation/interprétation
    ↓
Activation
```

Une règle invalide ne doit jamais faire tomber l'application ; son erreur est affichée dans
le dashboard.

## Scheduler

Un `BackgroundService` exécute périodiquement les collectes et règles, par instance :

```
Toutes les 10 s  → health / activity
Toutes les 1 min → statistics
Toutes les 5 min → recommendations
Toutes les 1 h   → configuration / storage analysis
```

Les fréquences sont configurables. Une analyse lourde sur une instance ne doit jamais
bloquer les autres.

## SSE

Server-Sent Events pour pousser au frontend : nouveau finding ; finding résolu ; changement
du health score ; état de collecte ; progression d'une analyse. Pas de WebSocket pour le
MVP.

## Docker

Un seul conteneur :

```
pg-advisor
├── ASP.NET Core
├── React SPA
├── Rule Engine
├── Scheduler
├── SQLite
└── Webhook dispatcher
```

```yaml
services:
  pg-advisor:
    image: pg-advisor
    ports:
      - "8080:8080"
    volumes:
      - advisor-data:/app/data
      - ./rules:/app/rules:ro
    restart: unless-stopped

volumes:
  advisor-data:
```

Aucune modification du conteneur PostgreSQL.

> Note : l'édition des règles depuis l'IHM impose que le répertoire des règles
> utilisateur soit accessible en écriture. Les règles packagées peuvent rester en lecture
> seule ; les règles utilisateur sont écrites dans le volume de données
> (`/app/data/rules`), le montage `./rules:/app/rules:ro` restant valable pour les règles
> fournies par l'opérateur.

## MVP — priorité de développement

1. ASP.NET Core 10 + React/Vite dans un conteneur unique
2. Authentification locale
3. Ajout/suppression de connexions PostgreSQL
4. Collector PostgreSQL read-only
5. Détection automatique des capabilities/extensions
6. Rule engine YAML
7. Hot reload des règles
8. Dashboard health score
9. Premières règles PostgreSQL
10. Gestion des findings
11. Webhooks + déduplication
12. SSE
13. Support TimescaleDB
14. Édition des règles depuis l'IHM
15. Documentation et exemples de règles

## Objectif final

```
docker compose up -d
```

puis :

```
Login
 ↓
Ajouter PostgreSQL
 ↓
Connexion read-only
 ↓
Analyse automatique
 ↓
Health Score
 ↓
Recommandations
 ↓
Notifications webhook
```

**Principe fondamental** : l'Advisor doit être utile sans aucune extension PostgreSQL, mais
devenir progressivement plus puissant lorsque `pg_stat_statements`, HypoPG, TimescaleDB ou
d'autres capacités sont disponibles.
