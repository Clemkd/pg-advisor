[Français](PROJECT.md) · **English**

# PostgreSQL Advisor — project description

## Purpose

Build a self-hosted PostgreSQL Advisor, deployable as a single Docker container, able to supervise
**one or several separate PostgreSQL instances** without altering their container, their volumes or
their configuration.

A single Advisor instance supervises N independent PostgreSQL databases: each connection is isolated
(its own capabilities, findings, health score and scheduling).

## Stack

- Backend: ASP.NET Core 10
- Frontend: React + TypeScript + Vite
- Frontend built and then served directly by ASP.NET Core (`wwwroot`)
- Npgsql for PostgreSQL connections
- SQLite for the Advisor's own data
- Docker / Docker Compose
- REST API + SSE for real-time updates
- Simple local authentication by user account
- Responsive UI with Tailwind CSS

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
│ └───────────────┘ │ Diagnostics             │ │
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

## PostgreSQL: the zero-touch principle

The Advisor must never install or change anything on PostgreSQL automatically. It connects purely
over SQL, as a user holding the necessary permissions.

Sources it draws on:

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
- TimescaleDB statistics when they are available

## Optional extensions

The system automatically detects the available extensions and capabilities, per instance:

```
✓ pg_stat_activity
✓ pg_stat_user_tables
✓ TimescaleDB
✓ pg_stat_statements
✗ HypoPG
```

Features that depend on an extension are only enabled when it is available. If an important
extension is missing, the Advisor raises a diagnostic asking for it, without ever attempting the
installation itself:

> `pg_stat_statements` is not available. Installing it would provide query history and a ranking of
> queries by execution time.

## Rule engine

The centrepiece of the project is a rule engine extensible without recompilation. Rules are defined
in YAML and loaded dynamically from `/app/rules`.

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

Engine pipeline:

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

### Rule types

1. SQL + condition
2. SQL + expressions
3. extension-dependent rules
4. PostgreSQL-specific rules
5. TimescaleDB-specific rules

Complex rules that need code can be implemented as built-in handlers, but as much as possible must
stay declarative.

### Editing rules from the UI

Rules must be manageable from the interface, not only through the file system:

- a list of rules with their state (enabled, disabled, failing), category, severity and required
  capabilities;
- a YAML editor with validation before saving (an invalid rule is never activated);
- creation, duplication, modification, deletion;
- enable/disable and per-instance override of severity or thresholds (`RuleOverrides`);
- on-demand execution against a chosen instance, with a preview of the SQL result and of the findings
  produced, without persistence ("dry run" mode);
- a distinction between bundled rules (packaged, read-only, overridable) and user rules (editable,
  stored in the volume);
- writes from the UI produce YAML files in the rules directory: the file format remains the source of
  truth, and hot reload applies to changes made through the UI as well.

### Initial categories

performance; queries; indexes; vacuum/autovacuum; bloat; connections; locks/blocking; long
transactions; checkpoints; PostgreSQL configuration; storage; statistics; configuration security;
available extensions.

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
```

Every diagnostic shows: severity; title; description; evidence/metrics; estimated impact;
confidence; the rule that raised it; a corrective SQL statement when there is one;
documentation; detection date; and status `active` / `resolved` / `ignored`.

A diagnostic is not a box to tick: it describes a fact observed on the instance. Only the engine
moves it to `resolved`, once the rule stops reporting it. An operator ignores or reconsiders it —
`resolved` is refused by the API if a UI sends it.

## Managing PostgreSQL instances

The Advisor supervises several instances, each with its own health score:

```
Production
PostgreSQL 18
Health: 91/100

Staging
PostgreSQL 18
Health: 97/100
```

Every connection holds: name; host; port; database; user; secret/password; collection interval;
enable/disable.

Credentials must never appear in the logs or the interface once saved.

## Webhook notifications

```yaml
webhooks:
  - id: operations
    url: ${OPS_WEBHOOK_URL}
    enabled: true
    minimumSeverity: warning
    events:
      - new_finding
      - finding_resolved
      - rule_degraded
      - rule_quarantined
```

`rule_degraded` and `rule_quarantined` come from the cost guard: a rule piling up incidents on an
instance, then a rule set aside from it. Without them, a database stops being analysed on one
point and nobody is told.

Deduplication is mandatory:

```
Finding detected
     ↓
already notified?
 ┌───┴────┐
no       yes
 ↓        ↓
Webhook  ignore
```

Keep a notification history, and handle errors with reasonable retries.

## Authentication

- login/password
- ASP.NET Core cookie authentication
- HttpOnly, Secure cookie
- robust password hashing
- `[Authorize]` on the API
- logout
- a **My profile** view: every account sees its username and role there, and changes its own
  password — the old one is required, and managing other accounts stays with administrators
- possibly Admin / Viewer roles

No IdentityServer/OIDC for the MVP.

## SQLite

SQLite holds the Advisor's state only:

```
Users
PostgresConnections
Findings
FindingHistory
NotificationConfigurations
NotificationHistory
RuleOverrides
RuleHealth
QueryPlanSnapshots
Settings
```

Rules stay in YAML files so that they can be added or modified without recompilation.

## Rule hot reload

Watching `/app/rules`:

```
File change
    ↓
Validation
    ↓
Compilation/interpretation
    ↓
Activation
```

An invalid rule must never bring the application down; its error is shown on the dashboard.

## Scheduler

A `BackgroundService` runs the collectors and rules periodically, per instance:

```
Every 10 s  → health / activity
Every 1 min → statistics
Every 5 min → recommendations
Every 1 h   → configuration / storage analysis
```

The frequencies are configurable. A heavy analysis on one instance must never block the others.

A cost guard protects the instance being observed: every rule has a time limit, its own or
inherited from `Scheduler:QueryTimeout`, and incidents are counted per (rule, instance) pair. At
the warning threshold the rule is flagged; at the quarantine threshold it is set aside from that
instance for a few hours, then retried. The detail is in [the rule format](RULES.en.md#cost-guard).

## SSE

Server-Sent Events to push to the frontend: new finding; resolved finding; health score change;
collection state; analysis progress; a rule flagged or set aside by the cost guard, and its
recovery. No WebSocket for the MVP.

## Docker

A single container:

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

No modification to the PostgreSQL container.

> Note: editing rules from the UI requires the user-rules directory to be writable. Packaged rules
> can stay read-only; user rules are written to the data volume (`/app/data/rules`), and the
> `./rules:/app/rules:ro` mount remains valid for operator-supplied rules.

## MVP — development priority

1. ASP.NET Core 10 + React/Vite in a single container
2. Local authentication
3. Adding and removing PostgreSQL connections
4. Read-only PostgreSQL collector
5. Automatic capability/extension detection
6. YAML rule engine
7. Rule hot reload
8. Health score dashboard
9. First PostgreSQL rules
10. Finding management
11. Webhooks + deduplication
12. SSE
13. TimescaleDB support
14. Editing rules from the UI
15. Documentation and rule examples

## Final goal

```
docker compose up -d
```

then:

```
Login
 ↓
Add PostgreSQL
 ↓
Read-only connection
 ↓
Automatic analysis
 ↓
Health Score
 ↓
Diagnostics
 ↓
Webhook notifications
```

**Fundamental principle**: the Advisor must be useful with no PostgreSQL extension at all, yet grow
progressively more powerful as `pg_stat_statements`, HypoPG, `pgstattuple` or other capabilities
become available.
