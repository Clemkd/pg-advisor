import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { ConnectionDetail } from '../api/types'
import { useEventListener } from '../app/EventsContext'
import {
  Alert,
  Card,
  EmptyState,
  PageHeader,
  ScoreBar,
  ScoreRing,
  Spinner,
  Tag,
} from '../components/ui'
import {
  categoryLabel,
  collectionStateLabel,
  formatBytes,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatSeconds,
} from '../lib/format'
import { tr, useT } from '../lib/i18n'

export function InstanceDetailPage() {
  const t = useT()
  const { id } = useParams<{ id: string }>()
  const connectionId = Number(id)

  const [detail, setDetail] = useState<ConnectionDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      setDetail(await api.connections.get(connectionId))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr('common.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [connectionId])

  useEffect(() => {
    void load()
  }, [load])

  useEventListener(
    ['collection.state', 'instance.changed', 'health.changed', 'finding.created', 'finding.resolved'],
    (event) => {
      if (event.connectionId === null || event.connectionId === connectionId) {
        void load()
      }
    },
  )

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="size-6" />
      </div>
    )
  }

  if (error) {
    return <Alert title={t('common.error')}>{error}</Alert>
  }

  if (!detail) {
    return null
  }

  const { connection, capabilities, capabilitySummary } = detail
  const metrics = connection.metrics
  const views = capabilitySummary.filter((capability) => capability.kind === 'view')
  const extensions = capabilitySummary.filter((capability) => capability.kind === 'extension')

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumb={
          <>
            <Link to="/instances" className="hover:underline">
              {t('nav.instances')}
            </Link>{' '}
            / {connection.name}
          </>
        }
        title={connection.name}
        subtitle={`${connection.host}:${connection.port} · ${connection.database} · ${connection.username}`}
        meta={
          <>
            <Tag tone={connection.collectionState === 'error' ? 'bad' : 'accent'}>
              {connection.enabled
                ? collectionStateLabel(connection.collectionState)
                : t('instances.disabledBadge')}
            </Tag>
            {connection.serverVersion && <Tag>PostgreSQL {connection.serverVersion}</Tag>}
          </>
        }
        actions={
          <Link
            to={`/findings?connectionId=${connection.id}`}
            className="inline-flex items-center rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-sunken"
          >
            {t('instanceDetail.seeFindings')}
          </Link>
        }
      />

      {connection.lastError && (
        <Alert title={t('instanceDetail.lastCollectionError')}>{connection.lastError}</Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title={t('instanceDetail.health')}>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-5">
            <ScoreRing score={connection.health?.global ?? null} />
            <dl className="w-full min-w-0 space-y-1 text-sm text-ink-muted">
              <div>
                {t('dashboard.criticals')} :{' '}
                <span className="font-semibold text-ink">{connection.health?.critical ?? 0}</span>
              </div>
              <div>
                {t('dashboard.warnings')} :{' '}
                <span className="font-semibold text-ink">{connection.health?.warning ?? 0}</span>
              </div>
              <div>
                {t('dashboard.infos')} :{' '}
                <span className="font-semibold text-ink">{connection.health?.info ?? 0}</span>
              </div>
              <div className="pt-1 text-xs text-ink-muted">
                {t('instanceDetail.collectedAt', {
                  when: formatDateTime(connection.lastCollectedAt),
                })}
              </div>
            </dl>
          </div>
        </Card>

        <Card title={t('dashboard.categoryScores')} className="lg:col-span-2">
          {!connection.health || Object.keys(connection.health.categories).length === 0 ? (
            <EmptyState title={t('instanceDetail.noScore')}>
              {t('instanceDetail.noScoreHint')}
            </EmptyState>
          ) : (
            <div className="space-y-2.5">
              {Object.entries(connection.health.categories)
                .sort(([, a], [, b]) => a - b)
                .map(([category, score]) => (
                  <ScoreBar key={category} label={categoryLabel(category)} score={score} />
                ))}
            </div>
          )}
        </Card>
      </div>

      <Card title={t('instanceDetail.activity')}>
        {!metrics ? (
          <EmptyState title={t('instanceDetail.noMetrics')}>
            {t('instanceDetail.noMetricsHint')}
          </EmptyState>
        ) : (
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <MetricTile
              label={t('dashboard.connections')}
              value={`${formatNumber(metrics.connections)} / ${formatNumber(metrics.maxConnections)}`}
              detail={formatPercent(metrics.connectionUsage)}
            />
            <MetricTile
              label={t('instanceDetail.activeQueries')}
              value={formatNumber(metrics.activeQueries)}
            />
            <MetricTile
              label={t('instanceDetail.idleInTransaction')}
              value={formatNumber(metrics.idleInTransaction)}
            />
            <MetricTile
              label={t('instanceDetail.blockedSessions')}
              value={formatNumber(metrics.blockedSessions)}
            />
            <MetricTile
              label={t('instanceDetail.longestTransaction')}
              value={formatSeconds(metrics.longestTransactionSeconds)}
            />
            <MetricTile
              label={t('instanceDetail.longestQuery')}
              value={formatSeconds(metrics.longestQuerySeconds)}
            />
            <MetricTile
              label={t('instanceDetail.cacheHitRatio')}
              value={formatPercent(metrics.cacheHitRatio)}
            />
            <MetricTile
              label={t('instanceDetail.databaseSize')}
              value={formatBytes(metrics.databaseSizeBytes)}
            />
            <MetricTile label={t('instanceDetail.commits')} value={formatNumber(metrics.commits)} />
            <MetricTile
              label={t('instanceDetail.rollbacks')}
              value={formatNumber(metrics.rollbacks)}
            />
            <MetricTile
              label={t('instanceDetail.deadlocks')}
              value={formatNumber(metrics.deadlocks)}
            />
            <MetricTile
              label={t('instanceDetail.tempFiles')}
              value={formatBytes(metrics.tempBytes)}
            />
          </dl>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={t('instanceDetail.capabilities')}>
          {capabilities ? (
            <>
              <dl className="mb-3 grid grid-cols-2 gap-2 text-sm">
                <Info label={t('instanceDetail.version')} value={capabilities.serverVersion} />
                <Info label={t('instanceDetail.user')} value={capabilities.currentUser} />
                <Info
                  label={t('instanceDetail.superuser')}
                  value={capabilities.isSuperuser ? t('common.yesShort') : t('common.noShort')}
                />
                <Info
                  label="pg_monitor"
                  value={capabilities.hasPgMonitor ? t('common.yesShort') : t('common.noShort')}
                />
                <Info
                  label={t('instanceDetail.inRecovery')}
                  value={capabilities.inRecovery ? t('common.yesShort') : t('common.noShort')}
                />
                <Info
                  label={t('instanceDetail.detected')}
                  value={formatDateTime(capabilities.detectedAt)}
                />
              </dl>

              <p className="mb-1.5 text-xs font-semibold text-ink-muted">
                {t('category.extensions')}
              </p>
              <ul className="mb-3 space-y-0.5 font-mono text-xs">
                {extensions.map((extension) => (
                  <li
                    key={extension.name}
                    className={extension.available ? 'text-success' : 'text-ink-faint'}
                  >
                    {extension.available ? '✓' : '✗'} {extension.name}
                    {extension.version && ` ${extension.version}`}
                  </li>
                ))}
              </ul>

              <p className="mb-1.5 text-xs font-semibold text-ink-muted">
                {t('instanceDetail.readableViews', { count: views.length })}
              </p>
              <ul className="max-h-56 space-y-0.5 overflow-y-auto font-mono text-xs text-success">
                {views.map((view) => (
                  <li key={view.name}>✓ {view.name}</li>
                ))}
              </ul>
            </>
          ) : (
            <EmptyState title={t('instanceDetail.unknownCapabilities')}>
              {t('instanceDetail.unknownCapabilitiesHint')}
            </EmptyState>
          )}
        </Card>

        <Card title={t('instanceDetail.collectionSettings')}>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Info
              label={t('instanceDetail.instanceEnabled')}
              value={connection.enabled ? t('common.yesShort') : t('common.noShort')}
            />
            <Info label={t('instanceDetail.sslMode')} value={connection.sslMode} />
            <Info
              label={t('instanceDetail.ownInterval')}
              value={
                connection.collectionIntervalSeconds > 0
                  ? `${connection.collectionIntervalSeconds} s`
                  : t('instanceDetail.globalInterval')
              }
            />
            <Info
              label={t('instanceDetail.createdAt')}
              value={formatDateTime(connection.createdAt)}
            />
          </dl>

          <p className="mt-4 rounded-md bg-surface-sunken p-3 text-xs text-ink-muted">
            {t('instanceDetail.readOnlyNoticeBefore')}
            <code className="mx-1 rounded bg-border-subtle px-1">default_transaction_read_only=on</code>
            {t('instanceDetail.readOnlyNoticeMiddle')}
            <code className="mx-1 rounded bg-border-subtle px-1">statement_timeout</code>
            {t('instanceDetail.readOnlyNoticeAfter')}
          </p>
        </Card>
      </div>
    </div>
  )
}

function MetricTile({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail?: string
}) {
  return (
    <div className="rounded-md border border-border-subtle px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">{value}</dd>
      {detail && <p className="text-xs text-ink-muted">{detail}</p>}
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="truncate text-ink" title={value}>
        {value}
      </dd>
    </div>
  )
}
