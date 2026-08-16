**Français** · [English](README.en.md)

# PostgreSQL Advisor

![.NET 10](https://img.shields.io/badge/.NET-10-512BD4?logo=dotnet&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-9%20à%2018-4169E1?logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-conteneur%20unique-2496ED?logo=docker&logoColor=white)
![Zero-touch](https://img.shields.io/badge/serveur-zero--touch-brightgreen)

Advisor PostgreSQL self-hosted, livré comme un **unique conteneur Docker**. Une seule instance
supervise **plusieurs bases PostgreSQL distinctes**, en lecture seule, sans rien installer ni
modifier côté serveur (*zero-touch*), et produit un health score et des diagnostics à partir d'un
moteur de règles YAML rechargeable à chaud et **éditable depuis l'interface**.

## Pourquoi cet outil

Superviser PostgreSQL demande d'habitude d'installer une extension, de lire des vues système à la
main et de connaître les bons seuils par cœur. PG Advisor condense ça dans une interface qui donne
directement un diagnostic actionnable — sans droits d'écriture, sans agent à déployer, et sans
extension obligatoire :

- **utile dès le premier jour**, avec le PostgreSQL nu ;
- **plus précis** à mesure que `pg_stat_statements`, `pgstattuple` ou HypoPG sont disponibles ;
- **règles TimescaleDB** activées automatiquement quand l'extension est présente.

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Aperçu](#aperçu)
- [Démarrage rapide](#démarrage-rapide)
- [Rôle PostgreSQL à créer](#rôle-postgresql-à-créer)
- [Configuration](#configuration)
- [Développement](#développement)
- [Structure du projet](#structure-du-projet)
- [Documentation](#documentation)

## Fonctionnalités

- **Health score et diagnostics** générés par un moteur de règles YAML, rechargé à chaud et
  éditable depuis l'interface.
- **Zero-touch** — lecture seule stricte, rien à installer ni modifier côté serveur supervisé.
- **Multi-instances** — une seule interface pour plusieurs bases PostgreSQL, classements fusionnés.
- **Requêtes les plus coûteuses**, avec reconstruction des valeurs de paramètres depuis la base.
- **Plan d'exécution visuel**, lu comme un diagramme d'activité, chaque nœud dépliable.
- **34 règles livrées**, extensibles, avec exécution à blanc en lecture seule.
- **Notifications webhook** à chaque nouveau diagnostic.
- **Support TimescaleDB** natif quand l'extension est présente.

## Aperçu

<table>
<tr>
<td width="50%"><a href="docs/APERCU.md#vue-densemble"><img src="docs/images/01-tableau-de-bord.png" alt="Vue d'ensemble"></a></td>
<td width="50%"><a href="docs/APERCU.md#diagnostics"><img src="docs/images/02-recommandations.png" alt="Diagnostics"></a></td>
</tr>
<tr>
<td align="center"><sub>Vue d'ensemble</sub></td>
<td align="center"><sub>Diagnostics</sub></td>
</tr>
</table>

Le plan d'une requête se lit comme un diagramme d'activité : les données remontent des feuilles
vers la racine, l'épaisseur d'un lien donne les lignes remontées, et chaque compteur est coloré
selon son poids. Chaque étape se déplie sur place.

<a href="docs/APERCU.md#plan-dexécution"><img src="docs/images/06-plan-execution.png" alt="Plan d'exécution"></a>

→ [Toutes les captures](docs/APERCU.md) : requêtes multi-instances, valeurs de paramètres
proposées depuis la base, éditeur de règles, thème clair.

## Démarrage rapide

```bash
docker compose up -d
```

L'interface est sur http://localhost:8080. Le mot de passe du compte `admin` est écrit **une
seule fois** dans les journaux du conteneur :

```bash
docker compose logs pg-advisor | grep "mot de passe"
```

Pour le fixer d'avance :

```bash
PGADVISOR_Auth__BootstrapPassword=... docker compose up -d
```

Puis : ajouter une instance → l'Advisor détecte ses capacités → les règles applicables
s'exécutent → health score et diagnostics, avec notification webhook des nouveaux diagnostics.

## Rôle PostgreSQL à créer

L'Advisor n'a besoin que de lire. Un rôle de supervision suffit, et `pg_monitor` élargit ce qu'il
voit des autres sessions :

```sql
CREATE ROLE pg_advisor LOGIN PASSWORD 'change-moi';
GRANT pg_monitor TO pg_advisor;
GRANT CONNECT ON DATABASE ma_base TO pg_advisor;
```

Sans `pg_monitor`, l'Advisor fonctionne mais certaines règles sont automatiquement désactivées et
signalées comme telles dans l'interface.

> [!NOTE]
> Aucune écriture n'est jamais tentée : la session est ouverte avec
> `default_transaction_read_only=on` et un `statement_timeout` borné.

## Configuration

Toutes les clés se surchargent par variable d'environnement, préfixe `PGADVISOR_`, `__` pour la
hiérarchie.

| Clé | Rôle | Défaut |
| --- | --- | --- |
| `DataDirectory` | Volume inscriptible : SQLite, clés, règles créées depuis l'IHM | `/app/data` en conteneur |
| `RulesDirectory` | Règles intégrées, montables en lecture seule | `/app/rules` en conteneur |
| `Auth__BootstrapPassword` | Mot de passe du compte `admin` créé au premier démarrage | généré et journalisé une fois |
| `Auth__RequireHttps` | Force l'attribut `Secure` sur le cookie | `false` |
| `Auth__SlidingExpirationHours` | Durée de validité de la session | `12` |
| `Scheduler__Intervals__Health` | Périodicité activité et connexions | `00:00:10` |
| `Scheduler__Intervals__Statistics` | Périodicité des statistiques | `00:01:00` |
| `Scheduler__Intervals__Recommendations` | Périodicité des analyses | `00:05:00` |
| `Scheduler__Intervals__Configuration` | Périodicité configuration et stockage | `01:00:00` |
| `Scheduler__MaxConcurrentInstances` | Instances analysées en parallèle | `4` |
| `Scheduler__PerInstanceTimeout` | Délai maximal par instance | `00:02:00` |
| `Scheduler__QueryTimeout` | `statement_timeout` appliqué aux règles sans timeout propre | `00:00:30` |
| `Scheduler__RuleGuard__Enabled` | Garde-fou de coût des règles | `true` |
| `Scheduler__RuleGuard__WarningThreshold` | Incidents consécutifs avant avertissement | `3` |
| `Scheduler__RuleGuard__QuarantineThreshold` | Incidents consécutifs avant mise en quarantaine | `5` |
| `Scheduler__RuleGuard__QuarantineDuration` | Durée d'une quarantaine avant réessai automatique | `06:00:00` |
| `Scheduler__RuleGuard__SlowRunRatio` | Part du timeout au-delà de laquelle un succès compte comme incident | `0.8` |
| `Notifications__MaxRetries` | Tentatives d'envoi d'un webhook | `3` |

> [!TIP]
> Activer `Auth__RequireHttps` dès que l'Advisor est exposé derrière un reverse proxy en HTTPS.

<details>
<summary><b>Ce que contient le volume de données</b></summary>

```text
/app/data
├── pg-advisor.db      état de l'Advisor : comptes, connexions, findings, historique
├── keys/              clé de chiffrement des secrets et clés de protection des cookies
└── rules/             règles créées ou modifiées depuis l'IHM
```

Les mots de passe des instances supervisées sont chiffrés en AES-GCM avec une clé stockée hors de
la base, et ne sont jamais renvoyés par l'API ni écrits dans les journaux.

</details>

## Développement

La stack de développement est orchestrée par [Aspire](https://aka.ms/dotnet/aspire) : une seule
commande démarre l'API, le serveur Vite, deux PostgreSQL supervisés et un récepteur de webhooks.

```bash
dotnet run --project src/PgAdvisor.AppHost
```

| Ressource | Rôle | Adresse |
| --- | --- | --- |
| `web` | SPA servi par Vite, avec proxy vers l'API | http://localhost:5173 |
| `api` | API ASP.NET Core | http://localhost:5153 |
| `pg-full` | PostgreSQL 17 + TimescaleDB + `pg_stat_statements`, base `shop` | localhost:55432 |
| `pg-bare` | PostgreSQL 17 nu, base `billing` | localhost:55433 |
| `webhook-echo` | Récepteur de webhooks | http://localhost:58888 |

Le compte `admin` est créé au premier démarrage avec le mot de passe `advisor-dev` ; les deux
instances s'enregistrent avec l'utilisateur `postgres` et le mot de passe `advisor-test`.
`pg-full` est amorcée avec [`scripts/seed-test-data.sql`](scripts/seed-test-data.sql), pour que
les règles aient de quoi réagir dès la première analyse.

Les deux projets se lancent aussi séparément, sans Aspire :

```bash
dotnet run --project src/PgAdvisor.Api
npm --prefix src/pg-advisor-web run dev
```

```bash
dotnet test
```

<details>
<summary><b>Validation de bout en bout</b></summary>

Cette validation porte sur l'image publiée plutôt que sur le code en cours d'édition, et passe
donc par Docker Compose plutôt que par Aspire :

```bash
docker compose -f docker-compose.test.yml up -d
pwsh ./scripts/validate-e2e.ps1
```

Le script construit l'image, démarre le conteneur, alimente l'instance de test avec un jeu de
données qui déclenche des règles, enregistre les deux instances, attend la première analyse, puis
affiche capacités détectées, health score, diagnostics, notifications et le résultat de chaque
règle exécutée à blanc. Il vérifie aussi le principe zero-touch en listant, côté PostgreSQL, les
extensions et les paramètres après le passage de l'Advisor.

</details>

## Structure du projet

```text
pg-advisor
├── src/PgAdvisor.Api        ASP.NET Core 10 — API REST, SSE, rule engine, scheduler
│   ├── Auth/ Security/      cookie, hash PBKDF2, chiffrement des secrets au repos
│   ├── Collectors/          collecte read-only de l'activité et des statistiques
│   ├── Postgres/            connexions Npgsql, détection des capacités
│   ├── Rules/               modèle YAML, validation, expressions, gabarits, hot reload
│   ├── Scheduler/           BackgroundService, analyse par instance, garde-fou de coût
│   ├── Findings/            cycle de vie des findings, health score
│   ├── Notifications/       file d'attente et dispatcher webhook
│   └── Sse/                 bus d'événements temps réel
├── src/PgAdvisor.AppHost    Aspire — orchestration de la stack de développement
├── src/pg-advisor-web       React + TypeScript + Vite + Tailwind, compilé vers wwwroot
├── tests/PgAdvisor.Tests    tests du moteur de règles et du cycle des findings
├── rules                    règles YAML intégrées
├── scripts                  jeu de données de test et validation de bout en bout
├── docs                     descriptif projet et format des règles
├── Dockerfile               build multi-étapes SPA + API, image unique
├── docker-compose.yml       déploiement minimal
└── docker-compose.test.yml  deux PostgreSQL de test + récepteur de webhooks
```

## Documentation

Chaque document existe dans les deux langues.

- [Aperçu de l'interface](docs/APERCU.md) — captures commentées de chaque vue
  ([English](docs/OVERVIEW.md))
- [Descriptif du projet](docs/PROJECT.md) — périmètre, architecture, priorités du MVP
  ([English](docs/PROJECT.en.md))
- [Format des règles](docs/RULES.md) — champs, prérequis, expressions, filtres, handlers,
  garde-fou de coût, API ([English](docs/RULES.en.md))
