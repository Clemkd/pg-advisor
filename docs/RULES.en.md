[Français](RULES.md) · **English**

# Rule format

A rule is a single YAML file. Bundled rules are loaded from `PGADVISOR_RulesDirectory`
(`/app/rules`, mountable read-only); rules created or modified from the UI are written to
`<DataDirectory>/rules` (`/app/data/rules`). Both directories are watched: any addition or change
triggers validation and then activation, without a restart.

An invalid rule is never activated and never brings the application down: it is listed as failing on
the dashboard and on the Rules page, together with its validation message.

When a user rule carries the same `id` as a bundled one, it replaces it. That is the mechanism for
editing a packaged rule from the UI; deleting the user version restores the original.

## Fields

| Field | Required | Description |
| --- | --- | --- |
| `id` | yes | Stable, unique, lowercase identifier. Convention: `category.subject`. |
| `version` | yes | Positive integer, bumped whenever the semantics change. |
| `name` | yes | Short label shown in the UI. |
| `description` | no | Explanation of the diagnostic, shown in the editor. |
| `category` | yes | One of the categories listed below. |
| `severity` | yes | `info`, `warning` or `critical`. Overridable per instance. |
| `group` | no | Scheduling group: `health`, `statistics`, `recommendations` (default) or `configuration`. |
| `intervalSeconds` | no | Own period, from 5 to 86400. Acts as a throttle inside the group. |
| `enabled` | no | `false` ships the rule disabled by default. |
| `requires` | no | Capability prerequisites; the rule is skipped when they are not met. |
| `parameters` | no | Scalar thresholds, overridable from the UI. |
| `query` | yes unless `handler` | **Read-only** SQL executed against the supervised instance. |
| `handler` | no | Built-in handler, mutually exclusive with `query`. |
| `condition` | no | Expression evaluated per row; a row becomes a finding when it is true. |
| `key` | no | Columns forming the finding's identity. Empty = a single finding per instance. |
| `limit` | no | Maximum findings per run, from 1 to 1000 (default 100). |
| `recommendation` | yes | Content of the finding produced. |

An unknown field fails the load: a typo in a field name is reported rather than silently ignored.

### `requires`

```yaml
requires:
  views:              # relations or system views that must be readable
    - pg_stat_user_tables
  extensions:         # extensions that must be installed
    - pg_stat_statements
  missingExtensions:  # the reverse: the rule only fires when they are absent
    - hypopg
  minVersion: 14      # minimum PostgreSQL major version
  maxVersion: 16      # maximum major version
  monitorRole: true   # requires pg_monitor or the superuser role
  primary: true       # skips instances in recovery
```

Capabilities are detected per instance: version, installed extensions, and the views actually
readable by the monitoring user (`has_table_privilege`). A rule whose prerequisites are not met is
skipped for that instance — no error, no finding, and its category is not counted in the score.

A view can be named in its short or qualified form: `chunks` as well as
`timescaledb_information.chunks`.

### `parameters`

```yaml
parameters:
  minimum_ratio: 0.20
  minimum_rows: 10000
```

Every threshold is available in two ways:

- as a **SQL parameter** inside `query`, written `@minimum_ratio`;
- as a **condition variable**, under its bare name.

Thresholds are overridable per instance from the UI without touching the file.

### `query`

A read-only query, a single statement. It must start with `SELECT`, `WITH`, `TABLE` or `EXPLAIN`; a
`;` anywhere other than at the very end is rejected at load time. The PostgreSQL session is also
forced read-only with a bounded `statement_timeout`, so a rule can neither write to nor monopolise
the supervised instance.

### `condition`

A boolean expression evaluated against each row of the result. The available variables are the
columns of the `SELECT`, then the thresholds; a column shadows a threshold of the same name.

- comparisons: `>` `>=` `<` `<=` `==` (or `=`) `!=` (or `<>`)
- arithmetic: `+` `-` `*` `/` `%`
- logic: `and` `or` `not`
- null tests: `x is null`, `x is not null`
- PostgreSQL-style casts: `used::float`, `value::int`, `value::text`, `value::bool`
- functions: `coalesce`, `abs`, `round`, `greatest`, `least`, `length`, `lower`, `upper`,
  `contains`

A `NULL` value makes the comparison false instead of failing, and a division by zero yields `NULL`:
a missing statistic never produces a finding and never breaks the rule.

Without a `condition`, every returned row produces a finding.

### `key`

```yaml
key:
  - schemaname
  - relname
```

The key identifies the object concerned within the rule. It is what allows the same diagnostic to be
recognised from one run to the next: without a key, the rule produces a single finding per instance;
with one, it produces a finding per target.

### `recommendation`

```yaml
recommendation:
  title: "Autovacuum behind on {{ schemaname }}.{{ relname }}"
  message: "{{ relname }} holds {{ ratio | percent }} dead rows."
  impact: low | medium | high
  confidence: low | medium | high
  evidence:            # columns attached to the finding; empty = all of them
    - n_dead_tup
    - ratio
  sql: "VACUUM (ANALYZE) {{ schemaname }}.{{ relname }};"
  documentation: https://www.postgresql.org/docs/current/routine-vacuuming.html
```

`message` is optional: failing that, the title doubles as the message. `documentation` must be an
absolute http or https URL.

The `sql` field is a **suggestion shown to the user**. The Advisor never runs it: the zero-touch
principle forbids any write to the supervised instance.

### Interpolation and filters

`{{ expression | filter }}` accepts any expression of the condition language, and filters chain.

| Filter | Input | Output |
| --- | --- | --- |
| `percent` (`percent:0`) | ratio from 0 to 1 | `20.3 %` |
| `bytes` | bytes | `1.5 KiB` |
| `duration` | milliseconds | `1.5 s` |
| `seconds` | seconds | `2 min` |
| `round` (`round:2`) | number | `3.14` |
| `integer` | number | `4` |
| `number` | number | `1,234,567` |
| `upper`, `lower`, `trim` | text | text |

A null value renders as `n/a`: a message never shows a hole.

## Built-in handlers

A rule whose logic goes beyond "SQL + condition" — several queries, correlation across rows — names
a handler instead. YAML stays the way in: it supplies the prerequisites, the severity and the
recommendation.

| Handler | Columns produced |
| --- | --- |
| `capabilities.missing-extension` | `extension`, `installable`, `server_version` |
| `indexes.redundant` | `schemaname`, `tablename`, `indexname`, `covering_index`, `index_bytes`, `idx_scan`, `columns`, `access_method`, `is_partial` |

The up-to-date list, with a description of each handler, is exposed by `GET /api/rules/schema` and
shown in the editor's cheat sheet.

## Categories

`performance`, `queries`, `indexes`, `vacuum`, `bloat`, `connections`, `locks`, `transactions`,
`checkpoints`, `configuration`, `storage`, `statistics`, `security`, `extensions`.

## Scheduling groups

| Group | Default period | Used for |
| --- | --- | --- |
| `health` | 10 s | activity, connections, locks, long transactions |
| `statistics` | 1 min | cumulative `pg_stat_*` counters |
| `recommendations` | 5 min | table, index and query analysis |
| `configuration` | 1 h | settings, storage, security |

The periods are configurable (`Scheduler:Intervals`). An instance's own interval replaces the one of
the `health` group.

## Rule types and bundled examples

| Type | Example |
| --- | --- |
| SQL + condition | [vacuum.dead-tuples](../rules/vacuum.dead-tuples.yaml) |
| SQL + expressions across columns | [connections.saturation](../rules/connections.saturation.yaml) |
| Extension-dependent | [queries.slowest-mean-time](../rules/queries.slowest-mean-time.yaml) |
| Specific to a PostgreSQL version | [checkpoints.forced-too-often-pg17](../rules/checkpoints.forced-too-often-pg17.yaml) |
| TimescaleDB-specific | [timescaledb.uncompressed-chunks](../rules/timescaledb.uncompressed-chunks.yaml) |
| Built-in handler | [indexes.redundant](../rules/indexes.redundant.yaml) |
| Missing capability | [extensions.pg-stat-statements-missing](../rules/extensions.pg-stat-statements-missing.yaml) |

## Working with rules from the UI

The **Rules** page lists the loaded rules with their origin, their state and their prerequisites, and
shows the rules that failed to load. A rule's editor lets you:

- edit the YAML, with validation as you type (nothing is written while the rule is invalid);
- run the rule against a chosen instance without persisting anything, and see both the raw SQL result
  and the findings it would produce;
- review its applicability instance by instance, with the reason for each refusal;
- create, duplicate or delete a user rule;
- set a global or per-instance override: enablement, severity, period, thresholds.

Every write from the UI produces a YAML file in `<DataDirectory>/rules` and triggers the same reload
as a hand-made change: the file format remains the source of truth.

## Overrides

`RuleOverrides` (SQLite) applies a delta to a rule, either globally (`connectionId` null) or for one
instance. Precedence runs: file value, then global override, then instance override. A threshold
override only replaces the thresholds it names; the others keep their file value.

## API

| Route | Role |
| --- | --- |
| `GET /api/rules` | List, filterable by category, origin and free-text search |
| `GET /api/rules/{id}` | Rule, YAML and per-instance applicability |
| `GET /api/rules/schema` | Categories, groups, filters, functions, handlers, template |
| `GET /api/rules/errors` | Rules rejected at load time |
| `POST /api/rules/validate` | Validates a YAML without writing anything |
| `POST /api/rules` | Creates a user rule |
| `PUT /api/rules/{id}` | Replaces a rule |
| `DELETE /api/rules/{id}` | Deletes the user rule |
| `POST /api/rules/reload` | Forces a reload |
| `POST /api/rules/{id}/dry-run` | Runs against an instance without persisting |
| `PUT /api/rules/{id}/override` | Sets an override |
| `DELETE /api/rules/{id}/override` | Removes an override |

Writes require the `Admin` role.
