[Français](README.md) · **English**

# PostgreSQL Advisor

A self-hosted PostgreSQL advisor, shipped as a **single Docker container**. One instance supervises
**several separate PostgreSQL databases**, read-only, without installing or changing anything on the
server side (*zero-touch*), and produces a health score and recommendations from a YAML rule engine
that reloads without a restart and is **editable from the interface**.

The tool is useful with no PostgreSQL extension at all, and grows more precise as
`pg_stat_statements`, TimescaleDB, `pgstattuple` or HypoPG become available.

## Overview

| Dashboard | Recommendations |
| --- | --- |
| [![Dashboard](docs/images/01-tableau-de-bord.png)](docs/OVERVIEW.md#overview) | [![Recommendations](docs/images/02-recommandations.png)](docs/OVERVIEW.md#recommendations) |

A query plan reads as an activity diagram: rows flow from the leaves up to the root, the thickness of
a link gives the rows returned, and every counter is coloured according to its weight. Each step
expands in place.

[![Execution plan](docs/images/06-plan-execution.png)](docs/OVERVIEW.md#execution-plan)

→ [All the screenshots](docs/OVERVIEW.md): multi-instance query ranking, parameter values suggested
from the database, rule editor, light theme.

## Getting started

```bash
docker compose up -d
```

The interface is on http://localhost:8080. The `admin` account password is written **exactly once**
to the container logs — the log line itself is in French:

```bash
docker compose logs pg-advisor | grep "mot de passe"
```

To set it up front:

```bash
PGADVISOR_Auth__BootstrapPassword=... docker compose up -d
```

Then: add an instance → the Advisor detects its capabilities → the applicable rules run → health
score and recommendations, with a webhook notification for each new diagnostic.

## The PostgreSQL role to create

The Advisor only ever reads. A monitoring role is enough, and `pg_monitor` widens what it sees of
other sessions:

```sql
CREATE ROLE pg_advisor LOGIN PASSWORD 'change-me';
GRANT pg_monitor TO pg_advisor;
GRANT CONNECT ON DATABASE my_database TO pg_advisor;
```

Without `pg_monitor` the Advisor still works, but some rules are disabled automatically and
reported as such in the interface. No write is ever attempted: the session is opened with
`default_transaction_read_only=on` and a bounded `statement_timeout`.

## Layout

```
pg-advisor
├── src/PgAdvisor.Api        ASP.NET Core 10 — REST API, SSE, rule engine, scheduler
│   ├── Auth/ Security/      cookie, PBKDF2 hashing, secrets encrypted at rest
│   ├── Collectors/          read-only collection of activity and statistics
│   ├── Postgres/            Npgsql connections, capability detection
│   ├── Rules/               YAML model, validation, expressions, templates, hot reload
│   ├── Scheduler/           BackgroundService, per-instance analysis
│   ├── Findings/            finding lifecycle, health score
│   ├── Notifications/       webhook queue and dispatcher
│   └── Sse/                 real-time event bus
├── src/PgAdvisor.AppHost    Aspire — development stack orchestration
├── src/pg-advisor-web       React + TypeScript + Vite + Tailwind, built into wwwroot
├── tests/PgAdvisor.Tests    rule engine and finding lifecycle tests
├── rules                    bundled YAML rules
├── scripts                  test dataset and end-to-end validation
├── docs                     project description and rule format
├── Dockerfile               multi-stage SPA + API build, single image
├── docker-compose.yml       minimal deployment
└── docker-compose.test.yml  two test PostgreSQL instances + webhook receiver
```

## Development

The development stack is orchestrated by [Aspire](https://aka.ms/dotnet/aspire): a single command
starts the API, the Vite server, both supervised PostgreSQL instances and the webhook receiver, and
the Aspire dashboard gathers their logs, addresses and state.

```bash
dotnet run --project src/PgAdvisor.AppHost
```

| Resource | Role | Address |
| --- | --- | --- |
| `web` | SPA served by Vite, proxying to the API | http://localhost:5173 |
| `api` | ASP.NET Core API | http://localhost:5153 |
| `pg-full` | PostgreSQL 17 + TimescaleDB + `pg_stat_statements`, `shop` database | localhost:55432 |
| `pg-bare` | Bare PostgreSQL 17, `billing` database | localhost:55433 |
| `webhook-echo` | Webhook receiver | http://localhost:58888 |

The `admin` account is created on first start with the password `advisor-dev`; both instances are
registered with user `postgres` and password `advisor-test`. `pg-full` is seeded on startup from
[`scripts/seed-test-data.sql`](scripts/seed-test-data.sql), so the rules have something to react to
from the very first analysis. No volume is mounted on the test instances, so every start begins from
a known state.

Both projects also run separately, without Aspire:

```bash
dotnet run --project src/PgAdvisor.Api
```

```bash
npm --prefix src/pg-advisor-web run dev
```

The Vite dev server then listens on http://localhost:5173 and relays `/api` and `/events` to the API
on its launch-profile port, which `PGADVISOR_API_URL` overrides. In production the SPA is built into
`src/PgAdvisor.Api/wwwroot` and served by ASP.NET Core.

```bash
dotnet test
```

### End-to-end validation

This validation targets the published image rather than the code being edited, so it goes through
Docker Compose instead of Aspire. The test instances are started separately:

```bash
docker compose -f docker-compose.test.yml up -d
```

The script below builds the image, starts the container, loads the test instance with a dataset that
trips rules, registers both instances, waits for the first analysis, then prints detected
capabilities, health score, recommendations, notifications and the result of every rule executed as
a dry run:

```bash
pwsh ./scripts/validate-e2e.ps1
```

It also checks the zero-touch principle by listing, on the PostgreSQL side, the extensions and
settings left behind after the Advisor has run.

## Configuration

Every key can be overridden by environment variable, with the `PGADVISOR_` prefix and `__` for
nesting.

| Key | Role | Default |
| --- | --- | --- |
| `DataDirectory` | Writable volume: SQLite, keys, rules created from the UI | `/app/data` in the container |
| `RulesDirectory` | Bundled rules, mountable read-only | `/app/rules` in the container |
| `Auth__BootstrapPassword` | Password of the `admin` account created on first start | generated and logged once |
| `Auth__RequireHttps` | Forces the `Secure` attribute on the cookie | `false` |
| `Auth__SlidingExpirationHours` | Session lifetime | `12` |
| `Scheduler__Intervals__Health` | Activity and connection polling period | `00:00:10` |
| `Scheduler__Intervals__Statistics` | Statistics polling period | `00:01:00` |
| `Scheduler__Intervals__Recommendations` | Analysis period | `00:05:00` |
| `Scheduler__Intervals__Configuration` | Configuration and storage period | `01:00:00` |
| `Scheduler__MaxConcurrentInstances` | Instances analysed in parallel | `4` |
| `Scheduler__PerInstanceTimeout` | Maximum time per instance | `00:02:00` |
| `Scheduler__QueryTimeout` | `statement_timeout` applied to rules | `00:00:30` |
| `Notifications__MaxRetries` | Webhook delivery attempts | `3` |

Turn `Auth__RequireHttps` on as soon as the Advisor sits behind an HTTPS reverse proxy.

## What the data volume holds

```
/app/data
├── pg-advisor.db      Advisor state: accounts, connections, findings, history
├── keys/              secret-encryption key and cookie protection keys
└── rules/             rules created or modified from the UI
```

Supervised instance passwords are encrypted with AES-GCM using a key stored outside the database,
and are never returned by the API nor written to the logs.

## Documentation

- [Interface overview](docs/OVERVIEW.md) — commented screenshots of every view
- [Project description](docs/PROJECT.md) — scope, architecture, MVP priorities *(French)*
- [Rule format](docs/RULES.md) — fields, prerequisites, expressions, filters, handlers, API
  *(French)*
