# PostgreSQL Advisor — design

This document merges the project's design references: system architecture, the rule engine and
its YAML format, and the interface's design system. It replaces `docs/PROJECT(.en).md`,
`docs/RULES(.en).md`, `docs/OVERVIEW.md` and `docs/APERCU.md`.

---

## Part 1 — System architecture

### Purpose

A self-hosted PostgreSQL Advisor, deployable as a single Docker container, able to supervise **one
or several separate PostgreSQL instances** without altering their container, their volumes, or
their configuration. A single Advisor instance supervises N independent databases: each connection
is isolated (its own capabilities, findings, health score, and scheduling).

### Stack

- Backend: ASP.NET Core 10
- Frontend: React + TypeScript + Vite, built and served directly by ASP.NET Core (`wwwroot`)
- Npgsql for PostgreSQL connections; SQLite for the Advisor's own data
- REST API + SSE for real-time updates
- Local cookie authentication

### Architecture

```
pg-advisor
┌───────────────────────────────────────────────┐
│ ASP.NET Core 10                                │
│                                                 │
│ ┌───────────────┐ ┌─────────────────────────┐  │
│ │ REST API      │ │ React SPA               │  │
│ │ Authentication│ │ Dashboard, diagnostics  │  │
│ │ Configuration │ │ Queries, rules          │  │
│ └───────────────┘ └─────────────────────────┘  │
│                                                 │
│ ┌───────────────┐                              │
│ │ Collectors    │                              │
│ │ Rule Engine   │                              │
│ │ Scheduler     │                              │
│ │ Notifications │                              │
│ └───────┬───────┘                              │
│         │                                      │
│      SQLite                                    │
└─────────┼───────────────────────────────────────┘
          │ SQL, read-only
          ▼
    PostgreSQL instances (1..N)
```

### The zero-touch principle

The Advisor never installs or changes anything on a supervised PostgreSQL instance. It connects
purely over SQL, as a user holding the necessary permissions, drawing on `pg_stat_activity`,
`pg_stat_database`, `pg_stat_user_tables`, `pg_stat_user_indexes`, `pg_statio_*`, `pg_locks`,
`pg_settings`, `pg_class`, `pg_index`, `pg_constraint`, `information_schema`, `EXPLAIN`, and
TimescaleDB statistics when available.

Capabilities and extensions are auto-detected per instance:

```
✓ pg_stat_activity
✓ pg_stat_user_tables
✓ TimescaleDB
✓ pg_stat_statements
✗ HypoPG
```

Features that depend on an extension are enabled only when it is present. A missing extension that
would materially help raises a diagnostic asking for it — the Advisor never attempts the install
itself.

### Dashboard, instances, notifications

A diagnostic is not a checkbox: it describes a fact observed on the instance. Only the engine moves
it to `resolved`, once the rule that raised it stops reporting it — the API rejects a client
attempting to set that status directly. An operator can only ignore or reconsider it.

Every supervised connection holds a name, host, port, database, user, secret, collection interval,
and enabled flag. Credentials never appear in logs or the interface once saved.

Webhook notifications are deduplicated (a finding already notified is not renotified) and cover
`new_finding`, `finding_resolved`, `rule_degraded`, and `rule_quarantined` — the last two coming
from the cost guard (Part 2), without which a rule set aside from an instance would silently stop
covering it.

### SQLite

SQLite holds only the Advisor's own state: users, PostgreSQL connections, findings and their
history, notification configuration and history, rule overrides and health, query plan snapshots,
settings. Rules themselves stay in YAML files so they can be added or changed without a rebuild.

### Scheduler

A `BackgroundService` runs collectors and rules periodically, per instance and per scheduling
group (health every 10 s, statistics every minute, recommendations every 5 minutes, configuration
every hour — see Part 2). Frequencies are configurable; a heavy analysis on one instance never
blocks the others. A cost guard (Part 2) protects the instance being observed.

---

## Part 2 — Rule engine

The centerpiece of the project: a rule engine extensible without recompilation. Rules are YAML
files loaded dynamically — bundled ones from `PGADVISOR_RulesDirectory` (`/app/rules`, mountable
read-only), rules created or edited from the UI in `<DataDirectory>/rules`
(`/app/data/rules`). Both directories are watched; any change triggers validation then activation,
without a restart. An invalid rule is never activated and never brings the application down: it is
listed as failing, with its validation message. A user rule sharing a bundled rule's `id` replaces
it — the mechanism for editing a packaged rule from the UI; deleting the user version restores the
original.

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
  SELECT schemaname, relname, n_dead_tup, n_live_tup,
         n_dead_tup::float / NULLIF(n_live_tup, 0) AS ratio
  FROM pg_stat_user_tables
  WHERE n_live_tup > 10000
condition: ratio > 0.20
recommendation:
  title: "Autovacuum may be too slow"
  message: "{{ relname }} has {{ ratio | percent }} dead tuples."
```

Pipeline: YAML → validation → requirements/capabilities check → SQL execution → condition
evaluation per row → finding → recommendation → severity/score.

### Fields

| Field | Required | Description |
| --- | --- | --- |
| `id` | yes | Stable, unique, lowercase identifier — `category.subject`. |
| `version` | yes | Positive integer, bumped when semantics change. |
| `name` | yes | Short UI label. |
| `description` | no | Explanation shown in the editor. |
| `category` | yes | performance, queries, indexes, vacuum, bloat, connections, locks, transactions, checkpoints, configuration, storage, statistics, security, extensions. |
| `severity` | yes | `info`, `warning`, or `critical`. Overridable per instance. |
| `group` | no | Scheduling group: `health`, `statistics`, `recommendations` (default), `configuration`. |
| `intervalSeconds` | no | Own period, 5–86400 s, throttles inside the group. |
| `timeoutSeconds` | no | Own deadline, 1–300 s. Defaults to `Scheduler:QueryTimeout`. Overridable per instance. |
| `enabled` | no | `false` ships the rule disabled by default. |
| `requires` | no | Capability prerequisites; the rule is skipped for instances that don't meet them. |
| `parameters` | no | Scalar thresholds, overridable from the UI. |
| `query` | yes unless `handler` | **Read-only** SQL against the supervised instance. |
| `handler` | no | Built-in handler, mutually exclusive with `query`. |
| `condition` | no | Per-row boolean expression; a true row becomes a finding. |
| `key` | no | Columns forming the finding's identity. Empty = one finding per instance. |
| `limit` | no | Max findings per run, 1–1000 (default 100). |
| `recommendation` | yes | The produced finding's content. |

An unknown field fails the load — a typo is reported, not silently ignored.

`requires` can name views/system views (short or schema-qualified), required extensions, extensions
that must be *absent* (`missingExtensions`), a PostgreSQL version range, `monitorRole: true`
(requires `pg_monitor` or superuser), and `primary: true` (skips instances in recovery).
Capabilities are detected per instance (version, installed extensions, views actually readable via
`has_table_privilege`); an unmet prerequisite skips the rule silently — no error, no finding, and
its category is not counted in that instance's score.

`query` must be a single statement starting with `SELECT`, `WITH`, `TABLE`, or `EXPLAIN`; the
session is forced read-only with a bounded `statement_timeout`, so a rule can neither write to nor
monopolize the instance. `condition` supports comparisons, arithmetic, `and`/`or`/`not`, null
tests, PostgreSQL-style casts, and functions (`coalesce`, `abs`, `round`, `greatest`, `least`,
`length`, `lower`, `upper`, `contains`); a `NULL` makes the comparison false rather than error.
`recommendation` supports `{{ expression | filter }}` interpolation (filters: `percent`, `bytes`,
`duration`, `seconds`, `round`, `integer`, `number`, `upper`, `lower`, `trim`); a null value renders
as `n/a`. The `sql` field is a suggestion shown to the user — the Advisor never runs it.

A handful of rules whose logic goes beyond "SQL + condition" name a built-in `handler` instead
(e.g. `indexes.redundant`); the up-to-date list is exposed by `GET /api/rules/schema`.

### Cost guard

A deadline bounds every run, but nothing stops a rule from spending it every time. The guard keeps,
per (rule, instance) pair, a count of runs that weighed on the observed database — persisted in
SQLite so an Advisor restart doesn't reset it.

| Incident kind | Recorded reason | Meaning |
| --- | --- | --- |
| `timeout` | `statement_timeout` cancelled the query | the instance is struggling, or the rule needs more time here |
| `error` | plain SQL error (missing view, unknown column, privileges) | the rule itself is at fault |
| `slow` | success past `SlowRunRatio` of its deadline | the rule already costs, and would never fail on its own |

At `WarningThreshold` (3 by default) the rule is marked `degraded` and notified
(`rule_degraded`) but **keeps running**. At `QuarantineThreshold` (5 by default) it is quarantined
**on that instance only** for `QuarantineDuration` (6 h by default) and notified
(`rule_quarantined`); past the deadline it is retried automatically. A successful, fast run wipes
every counter. A quarantine never makes a diagnostic vanish silently: findings already produced
stay active, and the rule's category stops being counted as scored on that instance rather than
scoring 100 as if nothing were wrong. `POST /api/rules/{id}/reactivate` lifts a quarantine
immediately. Settings live under `Scheduler__RuleGuard__*` (see the README's configuration table).

---

## Part 3 — Interface design system

This part is the interface's design contract. It states the intended use first, then the rules
that follow from it. Every rule is justified by a use case described here; a rule serving none of
them should be discussed, not applied. It addresses whoever writes a view. The tokens and
primitives named exist at `src/index.css`, `src/components/ui/**`, `src/components/layout/**`.

### 1. Intended use

A read-only PostgreSQL Advisor that supervises N instances, computes a health score, and produces
diagnostics from a YAML rule engine. Three traits drive everything else.

**Usage frequency is very uneven, and it alone drives density.**

| Family | Views | Real usage |
| --- | --- | --- |
| **Scan** | Overview, Diagnostics | Daily, skimmed, sometimes under pressure |
| **Study** | Queries, execution plan | A long session focused on a single object |
| **Setup** | Instances, Rules, Notifications, Users, My profile | Rare: at install time, then occasionally |
| **Workbench** | Rule editor | Write YAML, dry-run it, read the result |

**The tool stays open and updates itself**, over SSE, often on a second screen. What changes must
be noticeable without staring at the screen; what doesn't change must not draw the eye.

**The user does not act from the tool.** The zero-touch principle means the Advisor fixes nothing:
it hands over a diagnostic, measurements, and a command to run elsewhere. The unit of work is
"understand a diagnostic and decide what to do about it," never "click an action button."

### 2. Five principles

1. **Frequency drives density.** A daily view compacts to fit under the eye; a yearly view
   explains itself. No view borrows another family's density.
2. **What changes announces itself; what persists stays quiet.** On a second screen, a value that
   silently replaces itself is lost information. Change carries a mark that outlives the moment it
   happened.
3. **What you read outranks what you click.** The page is about a diagnostic, not a command.
   Buttons stay out of the way; the diagnostic's text owns the center.
4. **One scale only.** Every size, gap, and control height comes from the tables in §3. A value
   outside that scale is a defect, not a nuance.
5. **Brand purple never states a status.** It only marks what you can interact with. A status is
   said in green, amber, red, or blue — never by color alone.

### 3. Tokens

Everything goes through tokens. No hardcoded color: no `bg-white`, no `text-gray-500`, no
`dark:bg-slate-800`. Both themes are carried by the same classes — a class that needs a `dark:`
variant is the sign that a token is missing.

**Color — surfaces.** `canvas` (app background) < `surface` (card) < `surface-raised` (bubble,
modal); `surface-sunken` for anything recessed: code block, table header, gauge track. `border-subtle`
separates, `border-strong` outlines a control.

**Color — ink.** `ink` for any value or content; `ink-muted` for everything else — label, hint,
unit, count. **`ink-faint` never carries text meant to be read** — reserved for chevrons,
decorative icons, separators, and empty-field placeholder text. The reason is measured: on the
light surface, `ink-faint` caps around 4.3:1, not enough for an 11 px label, while `ink-muted`
holds 6:1.

**Color — interaction.** `brand`, and only `brand`: link, primary action, active nav entry,
selected option. Strict reservation — see principle 5.

**Color — status.** `success`, `warning`, `danger`, `info`, each with two variants: `-subtle` for
the background, `-strong` for the ink on top of it. The bare token fills a dot or draws a gauge;
used as ink on its own light background it fell under 3.5:1. The `-subtle`/`-strong` pair holds at
least 6.3:1 in light mode and 8:1 in dark. `info` is a blue, distinct from brand purple — otherwise
an informational diagnostic reads as a button.

**Color — severity.** `severity-critical` → `danger`, `severity-warning` → `warning`,
`severity-info` → `info`, mapped once in `SeverityBadge`; no view re-decides a severity color.
`fresh` marks what just changed (§6). Code tokens (`code-key`, `code-string`, `code-number`,
`code-type`, `code-param`) are distinct from status colors — calibrated to carry text on a recessed
background, not to fill a dot.

**Typography.** Six sizes; the default is `text-body`, not `text-meta` — the interface reads at
14 px.

| Token | Size | Weight | Use |
| --- | --- | --- | --- |
| `text-display` | 32 px | 600 | The global score. At most once per page. |
| `text-title` | 18 px | 600 | Page title. One, set by `Page`. |
| `text-section` | 15 px | 600 | Card title, modal title. |
| `text-body` | 14 px | 400 | **Default.** Any value, content, table row. |
| `text-meta` | 12 px | 400 | Accompanying text: timestamp, hint, count, subtitle. |
| `text-micro` | 11 px | 600, caps, letter-spaced | **Labels only.** |

**Golden rule: a value never drops below `text-body`, and is never smaller than its own label.**
The state found was the reverse — 120 uses of `text-xs` against 47 of `text-sm` — producing views
where nothing stands out because everything is small. Numeric values meant to be compared row to
row carry `tabular-nums`.

**Spacing.** Useful scale: **4, 8, 12, 16, 24, 32 px** (`1, 2, 3, 4, 6, 8`). Half-steps (`1.5`,
`2.5`) are reserved for optical alignment *inside* a primitive; they never appear in a view's
layout. Between two page blocks: `space-y-4` (16). Card grid gutter: `gap-4` (16). Between two form
fields: `gap-3` (12). Card interior gutter: **16 px**, header/body/list rows alike. Between a label
and its value: `gap-1` (4). Page's outer margin is set once by the shell; a view never adds its
own.

**Controls, radii, shadows.** Three heights only: `sm` (32 px, dense filter bars/column filters,
pointer only), `md` (36 px, default, aligned with `Input`/`Select`/`MultiSelect`), `lg` (44 px,
primary action of a setup form, and any touch context). An icon-only button is at least 36×36, with
a 16 px glyph. Radii: `--radius-card` for a surface, `--radius-control` for a control,
`rounded-full` for a dot; `rounded-md`/`rounded-lg` are not used. Shadows: `shadow-card` for a card
resting on the background, `shadow-popover` for anything floating — nothing else; a card never
gains a hover shadow, since it isn't clickable.

**Motion.** `--motion-fast` (120 ms) for hover/focus, `--motion-base` (200 ms) for an expand,
`--motion-fresh` (6 s) for the freshness signal's decay. Everything is neutralized under
`prefers-reduced-motion: reduce`, set once in `index.css`. The freshness signal does not disappear
in that case — it becomes static (§6): an information signal is not removed just because animation
is declined.

### 4. Densities

Three densities, one per view family. They are chosen, not dialed.

**Scan — Overview, Diagnostics.** Read daily, skimmed, sometimes during an incident. The question
is *"what changed, and what's serious?"* — not *"what is this parameter's exact value?"* List row:
minimum 40 px height, 16 px gutter, at most two text levels (`text-body` title, `text-meta`
support). Filter bar in a `Toolbar`, `sm` controls, single line, never collapsed into a block. One
entry point per screen: the number that drives the read — global score, critical count — in
`text-display`, tinted by its value; everything else is hierarchically below it. A grid of four
identical tiles has no entry point. Default sort: most severe first, then most recent. Nothing
revealed on hover — nobody hovers on a second screen.

**Study — Queries, execution plan.** A long session on a single object; the surface belongs to the
object. The studied object (SQL text, plan node) fills the available height via `useFillHeight`,
never a hardcoded `calc()`. Chrome compacts: `sm` controls, single-line headers, column filters
built into the table header rather than a separate bar. What scrolls is the block, never the page.
Monospace for all SQL, object identifiers, and plan measurements.

**Setup — Instances, Rules, Notifications, Users, My profile.** Rare views; a user returning after
six months remembers nothing, so they must be explicit, not compact. Single-column form, `gap-3`
fields, `md` controls, `lg` primary action. Every field carries a hint stating the consequence, not
the syntax. Field groups are named with `FormSection`. Empty states carry the expected action, not
just an observation. List density can rise to 56 px per row — these lists are short and read once.

**Workbench — Rule editor.** Write, dry-run, read the result, repeat; the loop must be short. The
editor fills the available height; the run result appears beside or below it, never replacing it.
Dry run is keyboard-reachable, with the shortcut shown on the button. A new run result carries the
freshness signal (§6) rather than silently replacing the previous one. Validation errors sit next
to the offending line, never only at the top of the page.

### 5. Anatomies

**Page.** `Page` sets the title, margin, and width; a view redeclares neither. Title in
`text-title`, one per page, aligned with the description and meta on the same line while there's
room — a three-line header steals a third of a scan view's useful screen. `wide` removes the
reading-width limit for views that line up tables.

**Card.** `CardHeader` (title `text-section`, description `text-meta`, action) + `CardBody`
(content, 16 px gutter). A header action is a `CardAction`. A card never carries more than one
action; beyond that, it's a `SplitButton`.

**Table.** Built from `Table`, `Th`, `Td`. Sticky `text-micro` header once the body scrolls;
numbers right-aligned with `tabular-nums` (`<Td numeric>`), text left-aligned, never the reverse.
Identity column first, the only one allowed to be wide; measurements stay narrow and fixed. Hovered
row tinted `surface-sunken`, selected row `brand-subtle` — hover reveals nothing not already
readable. Sort: one column at a time, direction shown by icon **and** `aria-sort`. Horizontal
overflow contained by `TableScroll` — the table scrolls, never the page.

**Filtering and sorting happen in the column's own header, never in a separate bar** — a
separate filter bar forces you to mentally re-link a control to the column it governs, and costs a
whole card's height for three fields. The control is chosen by the data's nature:

| Data | Filter | Sort |
| --- | --- | --- |
| Free text — name, id, description | text input (`FilterInput`) | alphabetical |
| Enumerated value — category, origin, state | multi-select (`MultiSelect`) | alphabetical |
| Ordered enum — severity, impact | multi-select | **by severity order**, never alphabetical |
| Numeric measurement | comparator + threshold (`FilterInput` with operator) | numeric |
| Column with no relevant filter | no control, rather than an invented one | case by case |

Three obligations: the filtered state stays legible with the menu closed (a count or a mark on the
header); one action clears everything (`common.clearFilters`); and the empty state distinguishes
"nothing to show" from "nothing matches these filters" — different situations calling for different
reactions. Where the cost is reasonable, filter state lives in the URL so a filtered view can be
shared by link.

**Modal.** Header (title `text-section`, description `text-meta`, header actions, close) +
scrolling body + footer (secondary left, primary right). Four widths: `sm` (confirmation), `md`
(single-column form), `lg` (two columns), `full` (query plan, table). `Modal` owns focus trapping,
restore-on-close, and `Escape`-to-close; no view redoes it.

**Form.** `Field` carries the label, hint, and error on the label's line — one fewer line per
field; the error replaces the hint. Button order: secondary left, primary right, named with a verb
("Save the instance"), never "OK". A form also submits on `Enter`.

**Empty state.** A title naming what's missing, a sentence saying why, and — in setup views — the
expected action. Never an illustration; the space serves content better. A *filtered* empty state
differs from an *initial* one: "No rules match these filters" offers to clear them; "No rules yet"
offers to create one.

**Loading.** Three cases, three treatments — conflating them causes flicker. (1) First page load:
`LoadingBlock`, centered, once. (2) Refreshing already-displayed content (SSE, filter change): the
content **stays visible**, gains `aria-busy` and a `RefreshBar` progress rule at the top of the
block. (3) Loading a region of known shape: `Skeleton` at final dimensions, so nothing jumps when
content arrives.

**Error.** `Notice tone="danger"` at the top of the affected block, never replacing the page — a
refresh error must not erase data already read. The message states what failed and offers a retry.

### 6. Realtime

The worst-handled aspect found: five views fully reload on an SSE event, and nothing distinguishes
a just-changed value from an unchanged one. Three obligations for any self-updating view:

**Date it, don't tint it.** No background color signals a refresh — a card that lights up then
fades demands having looked at the right moment, and six seconds later says nothing; on a screen
that reloads itself all day, the tint ends up read as a data state ("is this card alerting?") when
it only talks about the moment it loaded. Freshness is said with a number that stays true:
"Updated 5s ago." It answers the same question without requiring anything to have been seen,
survives a delayed glance, and reads equally well in color or black-and-white — see `LastUpdated`
below.

**Say when.** `LastUpdated` shows the time since the last received data and refreshes itself; any
view that lives without user action carries one — facing a frozen screen, the first question is
"is this current?", and a still number doesn't answer it.

**Announce.** `LiveRegion` (`aria-live="polite"`) announces what just arrived — "2 new critical
diagnostics." The state found had **no** live region at all: a self-rewriting interface is mute to
a screen reader. Stream state in the top bar is a `role="status"`; an interrupted stream is
`warning`, not a quiet gray — on a second screen, a dead stream that doesn't show reads stale data
for hours.

### 7. Color, severity, zero-touch

**Never color alone.** A severity is said with a word (`SeverityBadge`); a `Dot` never appears
without the text it accompanies; a score carries its number. Color blindness is not an edge case on
an operations tool.

**Three severities, three weights**: critical is visible from a distance (solid fill), warning is
visible on reading (muted fill), info is visible only when sought (outline). A list where all three
weigh the same forces reading words to sort — exactly what scanning tries to avoid.

**Zero-touch.** The Advisor fixes nothing: a view hands over text to understand and a command to
run elsewhere. Two firm consequences: every displayed SQL command is copyable (`CommandBlock`
carries the copy button and the "Copied" acknowledgment); buttons don't take the center — the
diagnostic owns the reading column, changing its status is a housekeeping gesture, not the page's
subject.

**A rising score is not necessarily good news.** The cost guard removes from an instance the rules
that weigh too heavily on it; the category that rule used to score stops being scored, and the
score rises without the database actually improving. It's the one case where a displayed
improvement must be explained before being believed: a quarantine never silently makes a diagnostic
disappear (a `warning` banner names the number of set-aside rules); the green "no diagnostics"
badge disappears once a rule has stopped watching, rather than reading as calm where there is only
an absence of observation; and the nature of the last incident is stated, since a timeout or a slow
run says the instance is struggling while a SQL error says the rule is at fault.

### 8. Behavioral conventions

**Confirmations.** Only one action asks for one: deletion, via `ConfirmDialog`. One step, never
two; the title names the object, the body states the consequence, the button carries the verb
("Delete the instance").

**Reversible = no confirmation.** Ignoring or reconsidering a diagnostic undoes itself; confirming
it would be a toll. The way back is a success `Notice` carrying the inverse action. Resolving is not
offered: a diagnostic describes an observed fact, and only the engine closes it once the rule stops
reporting it.

**Destructive actions.** `variant="danger"`, on the right, never in the default position; initial
focus goes to cancel, `Escape` cancels.

**Defaults.** They answer the daily question: Diagnostics opens on active items, most severe first.
Filters live in the URL — an investigation state must be shareable and survive a reload — and never
reset themselves.

**Keyboard.** `Escape` closes anything floating. Dropdowns navigate with arrow keys, `Home`/`End`
jump to the ends, `Enter` confirms. A displayed shortcut is a shortcut that exists, and vice versa.

**Focus.** A global `:focus-visible` ring, set once. No view sets `outline-none` without a visible
replacement. After an action removes a list item, focus moves to the next item, never to `<body>`.

**Dropdowns.** Always `Select`, `MultiSelect`, or `Bubble` — never a native `<select>`, whose list
is painted by the OS, stays light in dark mode, and ignores the app's typography.

### 9. Bilingual

An English label typically runs 30% longer than its French counterpart; layout must survive that
without manual tuning. Every visible string goes through `useT()`/`useTc()`, or `tr()` inside a
memoized callback — never `t` itself as a `useCallback` dependency, which would recreate the
callback on every language change. **An injected count requires `useTc()`** — `t('x', { count })`
on a pluralized label produces "1 criticals". No fixed width on text (`min-w-0` + `truncate` on
anything that can overflow, `flex-wrap` on anything that can wrap); the sole exception is a label
column that must stay aligned row to row (`ScoreBar` gauges), expressed in `ch` with truncation and
a `title`. `text-micro` in caps only fits one or two words. Strict parity: any key added to `fr.ts`
is added to `en.ts` at the same place.

### 10. Available primitives

Exported from `@/components/ui/primitives` unless noted.

- **Actions** — `Button` (`primary`/`secondary`/`outline`/`ghost`/`danger` × `sm`/`md`/`lg`/`icon`),
  `SplitButton`, `CopyButton`, `CardAction`.
- **Fields** — `Input`, `Textarea`, `Select`, `MultiSelect`, `Checkbox`, `Field`, `Fieldset`,
  `FormSection`, `Label`, `FilterInput` (`@/components/ui/FilterInput`).
- **Surfaces** — `Card`, `CardHeader`, `CardBody`, `Toolbar`, `Tabs`, `TableScroll`,
  `Bubble`/`BubbleItem` (`@/components/ui/Bubble`).
- **Table** — `Table`, `THead`, `TBody`, `Tr`, `Th` (`numeric`, `sort`, `onSort`), `Td` (`numeric`).
- **Signaling** — `Badge` (`neutral`/`brand`/`info`/`success`/`warning`/`danger`), `SeverityBadge`,
  `Dot`, `KeyValue`, `KeyValueGrid`, `ScoreRing`/`ScoreBar` (`@/components/ui/score`).
- **States** — `Spinner`, `LoadingBlock`, `Skeleton`, `RefreshBar`, `EmptyState`, `Notice`.
- **Realtime** — `LastUpdated`, `LiveRegion` in the primitives; `useFresh`, `freshClass` in
  `@/components/ui/fresh` (a separate module, since a file exporting both components and functions
  loses hot reload).
- **Overlays** — `Modal`, `ConfirmDialog`.
- **Code** — `CodeBlock`, `CommandBlock`, `CopyButton`.
- **Layout** — `Page`, `Stat`, `StatGrid`, `Hero` (`@/components/layout/Page`).
