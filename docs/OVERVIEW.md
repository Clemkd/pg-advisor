# Interface overview

Screenshots taken against the repository's test stack: two supervised instances — one PostgreSQL 17
with TimescaleDB and `pg_stat_statements`, one without — seeded by
[`scripts/seed-test-data.sql`](../scripts/seed-test-data.sql). The figures below therefore come
from a real database, not from a mockup.

## Overview

Overall health, diagnostics broken down by severity, score per category, and the state of each
instance. Everything refreshes without a reload, over an SSE stream.

![Overview](images/01-tableau-de-bord.png)

## Diagnostics

Every diagnostic carries its severity, its subject, the rule that produced it, and when it was
detected. A diagnostic is not a box to tick: it describes a fact observed on the instance, and
resolving it belongs to the engine. A row can be ignored or reconsidered, and re-checked on
demand — re-checking replays the rule against the instance and closes the diagnostic if the
problem is gone.

![Diagnostics](images/02-recommandations.png)

The detail view gives the measurements that triggered the rule, the estimated impact, the
confidence level and, when one exists, the corrective SQL statement.

![Diagnostic detail](images/03-recommandation-detail.png)

## Queries

A ranking of the most expensive queries, across **one or several instances at once**: the rankings
are merged on the same criterion and each row names the database it came from. Columns are sortable
and filterable; the Advisor's own queries are excluded by default, since they describe the
supervision rather than the application being supervised.

![Most expensive queries](images/04-requetes.png)

A query coming from `pg_stat_statements` is normalised: its values are replaced with `$1`, `$2`…
The **Suggest values** button reconstitutes them from the database — the most common value known to
the planner, failing that an existing one — because a plan measured on a common value resembles the
one production actually gets.

![Suggested parameter values](images/05-parametres-proposes.png)

## Execution plan

The plan is drawn as an activity diagram: rows flow from the leaves up to the root, the thickness of
a connector and the number next to it give the rows returned, and every counter is coloured
according to its weight. The shortcuts at the top jump straight to the slowest node, the largest one,
and the costliest one.

![Execution plan](images/06-plan-execution.png)

Each step expands in place: what the node type does, the warnings that concern it, then the details
split across tabs — general, I/O and buffers, output, parallelism, miscellaneous.

![Plan node detail](images/07-plan-detail-noeud.png)

## Rules

The 34 bundled rules are editable from the interface, just like the ones you add. The engine
reloads them without a restart.

![Rules](images/08-regles.png)

The editor highlights the YAML, validates the definition as you type, and can dry-run it against an
instance: the query goes out read-only and no diagnostic is created.

![Rule editor](images/09-editeur-regle.png)

## Instances

Registering a connection, detected capabilities, and collection status. The interface follows the
system theme, and can be forced to light or dark.

![Instances, light theme](images/10-instances-clair.png)
