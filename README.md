# PostgreSQL Advisor

Advisor PostgreSQL self-hosted, livré comme un **unique conteneur Docker**. Une seule instance
supervise **plusieurs bases PostgreSQL distinctes**, en lecture seule, sans rien installer ni
modifier côté serveur (principe *zero-touch*), et produit un health score et des
recommandations à partir d'un moteur de règles YAML rechargeable à chaud et **éditable depuis
l'interface**.

L'outil est utile sans aucune extension PostgreSQL et devient plus précis à mesure que
`pg_stat_statements`, TimescaleDB, `pgstattuple` ou HypoPG sont disponibles.

## Démarrage

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
s'exécutent → health score et recommandations, avec notification webhook des nouveaux
diagnostics.

## Rôle PostgreSQL à créer

L'Advisor n'a besoin que de lire. Un rôle de supervision suffit, et `pg_monitor` élargit ce
qu'il voit des autres sessions :

```sql
CREATE ROLE pg_advisor LOGIN PASSWORD 'change-moi';
GRANT pg_monitor TO pg_advisor;
GRANT CONNECT ON DATABASE ma_base TO pg_advisor;
```

Sans `pg_monitor`, l'Advisor fonctionne mais certaines règles sont automatiquement désactivées
et signalées comme telles dans l'interface. Aucune écriture n'est jamais tentée : la session
est ouverte avec `default_transaction_read_only=on` et un `statement_timeout` borné.

## Structure

```
pg-advisor
├── src/PgAdvisor.Api        ASP.NET Core 10 — API REST, SSE, rule engine, scheduler
│   ├── Auth/ Security/      cookie, hash PBKDF2, chiffrement des secrets au repos
│   ├── Collectors/          collecte read-only de l'activité et des statistiques
│   ├── Postgres/            connexions Npgsql, détection des capacités
│   ├── Rules/               modèle YAML, validation, expressions, gabarits, hot reload
│   ├── Scheduler/           BackgroundService, analyse par instance
│   ├── Findings/            cycle de vie des findings, health score
│   ├── Notifications/       file d'attente et dispatcher webhook
│   └── Sse/                 bus d'événements temps réel
├── src/pg-advisor-web       React + TypeScript + Vite + Tailwind, compilé vers wwwroot
├── tests/PgAdvisor.Tests    tests du moteur de règles et du cycle des findings
├── rules                    règles YAML intégrées
├── scripts                  jeu de données de test et validation de bout en bout
├── docs                     descriptif projet et format des règles
├── Dockerfile               build multi-étapes SPA + API, image unique
├── docker-compose.yml       déploiement minimal
└── docker-compose.test.yml  deux PostgreSQL de test + récepteur de webhooks
```

## Développement

```bash
dotnet run --project src/PgAdvisor.Api
```

```bash
npm --prefix src/pg-advisor-web run dev
```

Le serveur de développement Vite écoute sur http://localhost:5173 et relaie `/api` et
`/events` vers `http://localhost:8080`. En production, le SPA est compilé dans
`src/PgAdvisor.Api/wwwroot` et servi par ASP.NET Core.

```bash
dotnet test
```

Instances PostgreSQL de test (une avec TimescaleDB et `pg_stat_statements`, une sans), plus un
récepteur de webhooks :

```bash
docker compose -f docker-compose.test.yml up -d
```

### Validation de bout en bout

Le script suivant construit l'image, démarre le conteneur, alimente l'instance de test avec un
jeu de données qui déclenche des règles, enregistre les deux instances, attend la première
analyse, puis affiche capacités détectées, health score, recommandations, notifications et le
résultat de chaque règle exécutée à blanc :

```bash
pwsh ./scripts/validate-e2e.ps1
```

Il vérifie aussi le principe zero-touch en listant, côté PostgreSQL, les extensions et les
paramètres après le passage de l'Advisor.

## Configuration

Toutes les clés se surchargent par variable d'environnement, préfixe `PGADVISOR_`, `__` pour
la hiérarchie.

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
| `Scheduler__QueryTimeout` | `statement_timeout` appliqué aux règles | `00:00:30` |
| `Notifications__MaxRetries` | Tentatives d'envoi d'un webhook | `3` |

Activer `Auth__RequireHttps` dès que l'Advisor est exposé derrière un reverse proxy en HTTPS.

## Ce que contient le volume de données

```
/app/data
├── pg-advisor.db      état de l'Advisor : comptes, connexions, findings, historique
├── keys/              clé de chiffrement des secrets et clés de protection des cookies
└── rules/             règles créées ou modifiées depuis l'IHM
```

Les mots de passe des instances supervisées sont chiffrés en AES-GCM avec une clé stockée hors
de la base, et ne sont jamais renvoyés par l'API ni écrits dans les journaux.

## Documentation

- [Descriptif du projet](docs/PROJECT.md) — périmètre, architecture, priorités du MVP
- [Format des règles](docs/RULES.md) — champs, prérequis, expressions, filtres, handlers, API
