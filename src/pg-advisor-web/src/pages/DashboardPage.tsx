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
import { useT, useTc } from '@/lib/i18n'
import type { Translator } from '@/lib/i18n'

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
  const t = useT()
  const tc = useTc()
  const [data, setData] = useState<Dashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      setData(await api.dashboard())
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('common.loadFailed'))
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
      <Page title={t('nav.overview')}>
        <LoadingBlock />
      </Page>
    )
  }

  if (error) {
    return (
      <Page title={t('nav.overview')}>
        <Notice tone="danger" title={t('common.error')}>
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
      title={t('nav.overview')}
      description={`${tc('dashboard.supervised', instances.length)} · ${tc(
        'dashboard.rulesLoaded',
        rules.total,
      )}`}
      wide
    >
      <div className="space-y-4">
        <StatGrid>
          <Stat
            label={t('dashboard.globalHealth')}
            value={globalHealth === null ? '—' : `${globalHealth}/100`}
            hint={globalHealth === null ? t('dashboard.awaitingFirstCollection') : undefined}
          />
          <Stat
            label={t('dashboard.criticals')}
            value={summary.critical}
            tone={summary.critical > 0 ? 'danger' : 'default'}
            icon={<CircleAlert className="size-4" />}
          />
          <Stat
            label={t('dashboard.warnings')}
            value={summary.warning}
            tone={summary.warning > 0 ? 'warning' : 'default'}
            icon={<AlertTriangle className="size-4" />}
          />
          <Stat
            label={t('dashboard.infos')}
            value={summary.info}
            hint={t('dashboard.resolvedIgnored', {
              resolved: summary.resolved,
              ignored: summary.ignored,
            })}
            icon={<Info className="size-4" />}
          />
        </StatGrid>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader
              title={t('dashboard.categoryScores')}
              description={t('dashboard.categoryScoresHint')}
              action={
                <Link to="/findings" className="text-brand text-xs font-medium hover:underline">
                  {t('dashboard.handleFindings')}
                </Link>
              }
            />
            <CardBody>
              {categories.length === 0 ? (
                <EmptyState
                  title={t('dashboard.noCategoryScore')}
                  description={t('dashboard.noCategoryScoreHint')}
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
              title={t('nav.rules')}
              action={
                <Link to="/rules" className="text-brand text-xs font-medium hover:underline">
                  {t('dashboard.manage')}
                </Link>
              }
            />
            <CardBody className="space-y-3">
              <div className="flex items-baseline gap-2">
                <span className="text-ink text-3xl font-semibold tabular-nums">{rules.total}</span>
                <span className="text-ink-muted text-sm">{t('dashboard.loaded')}</span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <Badge tone="neutral">{t('dashboard.bundled', { count: rules.provided })}</Badge>
                <Badge tone="brand">{t('dashboard.custom', { count: rules.user })}</Badge>
                <Badge tone={rules.errors.length > 0 ? 'danger' : 'success'}>
                  {t('dashboard.failing', { count: rules.errors.length })}
                </Badge>
              </div>

              <p className="text-ink-faint text-xs" title={formatDateTime(rules.loadedAt)}>
                {t('dashboard.lastLoad', { when: formatRelative(rules.loadedAt) })}
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
            title={t('dashboard.supervisedInstances', { count: instances.length })}
            action={
              <Link to="/instances" className="text-brand text-xs font-medium hover:underline">
                {t('dashboard.manageInstances')}
              </Link>
            }
          />

          {instances.length === 0 ? (
            <EmptyState
              icon={<Database className="size-6" />}
              title={t('dashboard.noInstance')}
              description={
                <>
                  <Link to="/instances" className="text-brand font-medium hover:underline">
                    {t('dashboard.addConnection')}
                  </Link>{' '}
                  {t('dashboard.addConnectionSuffix')}
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
                        <StateBadge instance={instance} t={t} />
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
                            <Badge tone="danger">
                              {t('dashboard.criticalCount', { count: instance.health.critical })}
                            </Badge>
                          )}
                          {instance.health.warning > 0 && (
                            <Badge tone="warning">
                              {t('dashboard.warningCount', { count: instance.health.warning })}
                            </Badge>
                          )}
                          {instance.health.info > 0 && (
                            <Badge tone="brand">
                              {t('dashboard.infoCount', { count: instance.health.info })}
                            </Badge>
                          )}
                          {instance.health.total === 0 && (
                            <Badge tone="success">{t('dashboard.noFinding')}</Badge>
                          )}
                        </div>
                      )}
                    </div>

                    <ScoreRing score={instance.health?.global ?? null} size={64} />
                  </div>

                  <dl className="border-border-subtle text-ink-muted mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-3 text-xs sm:grid-cols-4">
                    <Metric label={t('dashboard.connections')}>
                      {instance.metrics
                        ? `${formatNumber(instance.metrics.connections)} / ${formatNumber(
                            instance.metrics.maxConnections,
                          )}`
                        : '—'}
                    </Metric>
                    <Metric label={t('dashboard.cache')}>{formatPercent(instance.metrics?.cacheHitRatio ?? null)}</Metric>
                    <Metric label={t('dashboard.longestTx')}>
                      {instance.metrics ? formatSeconds(instance.metrics.longestTransactionSeconds) : '—'}
                    </Metric>
                    <Metric label={t('dashboard.size')}>
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
            title={t('dashboard.activeByCategory')}
            action={
              <Link to="/findings" className="text-brand text-xs font-medium hover:underline">
                {t('dashboard.seeAll')}
              </Link>
            }
          />
          <CardBody>
            {Object.keys(summary.byCategory).length === 0 ? (
              <EmptyState
                icon={<ScrollText className="size-6" />}
                title={t('dashboard.noActiveFinding')}
                description={t('dashboard.noActiveFindingHint')}
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

function StateBadge({ instance, t }: { instance: Connection; t: Translator }) {
  if (!instance.enabled) return <Badge>{t('instances.disabledBadge')}</Badge>

  const tone =
    instance.collectionState === 'error' ? 'danger' : instance.collectionState === 'idle' ? 'success' : 'brand'

  const label =
    instance.collectionState === 'analyzing' && instance.analysisProgress !== null
      ? t('instances.analysisProgress', {
          percent: Math.round(instance.analysisProgress * 100),
        })
      : collectionStateLabel(instance.collectionState)

  return <Badge tone={tone}>{label}</Badge>
}
