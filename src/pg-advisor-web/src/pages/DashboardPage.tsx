import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CircleAlert, Database, Info, ScrollText } from 'lucide-react'
import { api } from '@/api/client'
import type { Connection, Dashboard } from '@/api/types'
import { useEventListener } from '@/app/EventsContext'
import { Page, Stat, StatGrid } from '@/components/layout/Page'
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  LoadingBlock,
  Notice,
} from '@/components/ui/primitives'
import { ScoreBar, ScoreRing } from '@/components/ui/score'
import {
  categoryLabel,
  collectionStateLabel,
  formatBytes,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatRelative,
  formatSeconds,
} from '@/lib/format'

const LIVE_EVENTS = [
  'finding.created',
  'finding.resolved',
  'finding.updated',
  'health.changed',
  'collection.state',
  'instance.changed',
  'rules.reloaded',
]

export function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      setData(await api.dashboard())
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Chargement impossible.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Le flux SSE déclenche le rafraîchissement ; un rappel périodique couvre les pertes de flux.
  useEventListener(LIVE_EVENTS, () => void load())

  useEffect(() => {
    const timer = window.setInterval(() => void load(), 30_000)
    return () => window.clearInterval(timer)
  }, [load])

  if (loading) {
    return (
      <Page title="Vue d’ensemble">
        <LoadingBlock />
      </Page>
    )
  }

  if (error) {
    return (
      <Page title="Vue d’ensemble">
        <Notice tone="danger" title="Erreur">
          {error}
        </Notice>
      </Page>
    )
  }

  if (!data) return null

  const { summary, rules, instances, globalHealth } = data
  const categories = aggregateCategories(instances)

  return (
    <Page
      title="Vue d’ensemble"
      description={`${instances.length} instance${instances.length > 1 ? 's' : ''} supervisée${
        instances.length > 1 ? 's' : ''
      } · ${rules.total} règles chargées`}
      wide
    >
      <div className="space-y-4">
        <StatGrid>
          <Stat
            label="Santé globale"
            value={globalHealth === null ? '—' : `${globalHealth}/100`}
            hint={globalHealth === null ? 'en attente de la première collecte' : undefined}
          />
          <Stat
            label="Critiques"
            value={summary.critical}
            tone={summary.critical > 0 ? 'danger' : 'default'}
            icon={<CircleAlert className="size-4" />}
          />
          <Stat
            label="Avertissements"
            value={summary.warning}
            tone={summary.warning > 0 ? 'warning' : 'default'}
            icon={<AlertTriangle className="size-4" />}
          />
          <Stat
            label="Informations"
            value={summary.info}
            hint={`${summary.resolved} résolues · ${summary.ignored} ignorées`}
            icon={<Info className="size-4" />}
          />
        </StatGrid>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader
              title="Scores par catégorie"
              description="Moyenne sur les instances où la catégorie est évaluable."
              action={
                <Link to="/findings" className="text-brand text-xs font-medium hover:underline">
                  Traiter les recommandations
                </Link>
              }
            />
            <CardBody>
              {categories.length === 0 ? (
                <EmptyState
                  title="Pas encore de score par catégorie"
                  description="Les catégories sont notées dès qu'une règle applicable a été exécutée sur au moins une instance."
                />
              ) : (
                <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
                  {categories.map(([category, score]) => (
                    <ScoreBar key={category} label={categoryLabel(category)} score={score} />
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Règles"
              action={
                <Link to="/rules" className="text-brand text-xs font-medium hover:underline">
                  Gérer
                </Link>
              }
            />
            <CardBody className="space-y-3">
              <div className="flex items-baseline gap-2">
                <span className="text-ink text-3xl font-semibold tabular-nums">{rules.total}</span>
                <span className="text-ink-muted text-sm">chargées</span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <Badge tone="neutral">{rules.provided} intégrées</Badge>
                <Badge tone="brand">{rules.user} personnalisées</Badge>
                <Badge tone={rules.errors.length > 0 ? 'danger' : 'success'}>
                  {rules.errors.length} en erreur
                </Badge>
              </div>

              <p className="text-ink-faint text-xs" title={formatDateTime(rules.loadedAt)}>
                Dernier chargement {formatRelative(rules.loadedAt)}
              </p>

              {rules.errors.slice(0, 3).map((ruleError, index) => (
                <Notice key={`${ruleError.file}-${index}`} tone="danger" title={ruleError.ruleId ?? ruleError.file}>
                  <span className="text-xs">{ruleError.message}</span>
                </Notice>
              ))}
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader
            title={`Instances supervisées (${instances.length})`}
            action={
              <Link to="/instances" className="text-brand text-xs font-medium hover:underline">
                Gérer les instances
              </Link>
            }
          />

          {instances.length === 0 ? (
            <EmptyState
              icon={<Database className="size-6" />}
              title="Aucune instance"
              description={
                <>
                  <Link to="/instances" className="text-brand font-medium hover:underline">
                    Ajoutez une connexion PostgreSQL
                  </Link>{' '}
                  pour lancer la première analyse.
                </>
              }
            />
          ) : (
            <ul className="divide-border-subtle divide-y">
              {instances.map((instance) => (
                <li key={instance.id} className="px-5 py-4">
                  <div className="flex items-start gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Link
                          to={`/instances/${instance.id}`}
                          className="text-ink hover:text-brand truncate font-medium"
                        >
                          {instance.name}
                        </Link>
                        <StateBadge instance={instance} />
                      </div>

                      <p className="text-ink-muted mt-0.5 truncate text-xs">
                        {instance.serverVersion
                          ? `PostgreSQL ${instance.serverVersion}`
                          : `${instance.host}:${instance.port}`}
                        {instance.timescaleVersion && ` · TimescaleDB ${instance.timescaleVersion}`}
                        {' · '}
                        {instance.database}
                      </p>

                      {instance.lastError && (
                        <p className="text-danger mt-1 line-clamp-2 text-xs" title={instance.lastError}>
                          {instance.lastError}
                        </p>
                      )}

                      {instance.health && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {instance.health.critical > 0 && (
                            <Badge tone="danger">{instance.health.critical} critiques</Badge>
                          )}
                          {instance.health.warning > 0 && (
                            <Badge tone="warning">{instance.health.warning} avertissements</Badge>
                          )}
                          {instance.health.info > 0 && (
                            <Badge tone="brand">{instance.health.info} informations</Badge>
                          )}
                          {instance.health.total === 0 && <Badge tone="success">aucun finding</Badge>}
                        </div>
                      )}
                    </div>

                    <ScoreRing score={instance.health?.global ?? null} size={64} />
                  </div>

                  <dl className="border-border-subtle text-ink-muted mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-3 text-xs sm:grid-cols-4">
                    <Metric label="Connexions">
                      {instance.metrics
                        ? `${formatNumber(instance.metrics.connections)} / ${formatNumber(
                            instance.metrics.maxConnections,
                          )}`
                        : '—'}
                    </Metric>
                    <Metric label="Cache">{formatPercent(instance.metrics?.cacheHitRatio ?? null)}</Metric>
                    <Metric label="Plus longue tx">
                      {instance.metrics ? formatSeconds(instance.metrics.longestTransactionSeconds) : '—'}
                    </Metric>
                    <Metric label="Taille">
                      {instance.metrics ? formatBytes(instance.metrics.databaseSizeBytes) : '—'}
                    </Metric>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Findings actifs par catégorie"
            action={
              <Link to="/findings" className="text-brand text-xs font-medium hover:underline">
                Voir tout
              </Link>
            }
          />
          <CardBody>
            {Object.keys(summary.byCategory).length === 0 ? (
              <EmptyState
                icon={<ScrollText className="size-6" />}
                title="Aucun finding actif"
                description="Rien à traiter pour le moment sur les instances supervisées."
              />
            ) : (
              <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(summary.byCategory)
                  .sort(([, a], [, b]) => b - a)
                  .map(([category, count]) => (
                    <li key={category}>
                      <Link
                        to={`/findings?category=${category}`}
                        className="hover:bg-surface-sunken flex items-center justify-between rounded-[var(--radius-control)] px-2 py-1.5 text-sm"
                      >
                        <span className="text-ink-muted truncate">{categoryLabel(category)}</span>
                        <span className="text-ink shrink-0 font-semibold tabular-nums">{count}</span>
                      </Link>
                    </li>
                  ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </Page>
  )
}

/** Moyenne par catégorie sur l'ensemble des instances notées. */
function aggregateCategories(instances: Connection[]): [string, number][] {
  const totals = new Map<string, { sum: number; count: number }>()

  for (const instance of instances) {
    for (const [category, score] of Object.entries(instance.health?.categories ?? {})) {
      const current = totals.get(category) ?? { sum: 0, count: 0 }
      totals.set(category, { sum: current.sum + score, count: current.count + 1 })
    }
  }

  return [...totals.entries()]
    .map(([category, { sum, count }]): [string, number] => [category, Math.round(sum / count)])
    .sort((a, b) => a[1] - b[1])
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-ink-faint truncate text-[11px] uppercase tracking-wide">{label}</dt>
      <dd className="text-ink truncate tabular-nums">{children}</dd>
    </div>
  )
}

function StateBadge({ instance }: { instance: Connection }) {
  if (!instance.enabled) return <Badge>désactivée</Badge>

  const tone =
    instance.collectionState === 'error' ? 'danger' : instance.collectionState === 'idle' ? 'success' : 'brand'

  const label =
    instance.collectionState === 'analyzing' && instance.analysisProgress !== null
      ? `analyse ${Math.round(instance.analysisProgress * 100)} %`
      : collectionStateLabel(instance.collectionState)

  return <Badge tone={tone}>{label}</Badge>
}
