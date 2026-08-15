import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Check, X } from 'lucide-react'
import { api } from '@/api/client'
import type { CapabilityStatus, ConnectionDetail } from '@/api/types'
import { useEventListener } from '@/app/EventsContext'
import { Hero, Page } from '@/components/layout/Page'
import type { ValueTone } from '@/components/layout/Page'
import {
  Badge,
  Card,
  CardAction,
  CardBody,
  CardHeader,
  EmptyState,
  KeyValue,
  KeyValueGrid,
  LastUpdated,
  LiveRegion,
  LoadingBlock,
  Notice,
  RefreshBar,
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
  scoreTone,
} from '@/lib/format'
import { currentLocale, translate, tr, useT, useTc } from '@/lib/i18n'
import { guardAnnouncement, RULE_GUARD_EVENTS } from '@/lib/ruleGuard'
import { cn } from '@/lib/utils'

const LIVE_EVENTS = [
  'collection.state',
  'instance.changed',
  'health.changed',
  'finding.created',
  'finding.resolved',
]

const HERO_TONES: Record<string, ValueTone> = {
  good: 'success',
  warn: 'warning',
  bad: 'danger',
}

/**
 * Détail d'une instance. On y arrive pour comprendre l'état d'une base : le score et sa
 * décomposition d'abord, l'activité mesurée ensuite, ce que l'Advisor sait lire en dernier.
 */
export function InstanceDetailPage() {
  const t = useT()
  const tc = useTc()
  const { id } = useParams<{ id: string }>()
  const connectionId = Number(id)

  const [detail, setDetail] = useState<ConnectionDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [receivedAt, setReceivedAt] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState<string | null>(null)

  const previousScore = useRef<number | null | undefined>(undefined)

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      const next = await api.connections.get(connectionId)
      setDetail(next)
      setReceivedAt(new Date().toISOString())
      setError(null)

      const score = next.connection.health?.global ?? null
      // Le premier chargement n'annonce rien : afficher n'est pas changer.
      if (previousScore.current !== undefined && previousScore.current !== score && score !== null) {
        setAnnouncement(
          translate(currentLocale(), 'instanceDetail.live.scoreChanged', {
            name: next.connection.name,
            score,
          }),
        )
      } else {
        setAnnouncement(null)
      }
      previousScore.current = score
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr('common.loadFailed'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [connectionId])

  useEffect(() => {
    void load()
  }, [load])

  useEventListener(LIVE_EVENTS, (event) => {
    if (event.connectionId === null || event.connectionId === connectionId) {
      void load()
    }
  })

  // Une règle écartée d'ici retire une catégorie du score de cette instance : l'annonce le dit,
  // et le contenu se met à jour sans être remplacé par un sablier.
  useEventListener(RULE_GUARD_EVENTS, (event) => {
    if (event.connectionId !== null && event.connectionId !== connectionId) return
    const message = guardAnnouncement(event)
    void load().then(() => setAnnouncement(message))
  })

  const health = detail?.connection.health ?? null

  if (loading) {
    return (
      <Page title={t('nav.instances')}>
        <LoadingBlock />
      </Page>
    )
  }

  if (!detail) {
    return (
      <Page title={t('nav.instances')}>
        <Notice tone="danger" title={t('common.error')}>
          {error ?? t('common.loadFailed')}
        </Notice>
      </Page>
    )
  }

  const { connection, capabilities, capabilitySummary } = detail
  const metrics = connection.metrics
  const views = capabilitySummary.filter((capability) => capability.kind === 'view')
  const extensions = capabilitySummary.filter((capability) => capability.kind === 'extension')
  const presentExtensions = extensions.filter((extension) => extension.available)
  const missingExtensions = extensions.filter((extension) => !extension.available)
  const score = health?.global ?? null
  const categories = Object.entries(connection.health?.categories ?? {}).sort(([, a], [, b]) => a - b)
  const quarantined = connection.quarantinedRules ?? []

  return (
    <Page
      title={connection.name}
      description={[
        connection.serverVersion ? `PostgreSQL ${connection.serverVersion}` : null,
        `${connection.host}:${connection.port}`,
        connection.database,
        connection.username,
      ]
        .filter(Boolean)
        .join(' · ')}
      meta={
        <>
          <Badge tone={stateTone(connection.enabled, connection.collectionState)}>
            {connection.enabled
              ? collectionStateLabel(connection.collectionState)
              : t('instances.disabledBadge')}
          </Badge>
          <LastUpdated at={receivedAt} />
        </>
      }
      actions={
        <CardAction to={`/findings?connectionId=${connection.id}`}>
          {t('instanceDetail.seeDiagnostics')}
        </CardAction>
      }
    >
      <div className="space-y-4" aria-busy={refreshing}>
        <LiveRegion message={announcement} />

        {error && (
          <Notice tone="danger" title={t('common.error')}>
            {error}
          </Notice>
        )}

        {connection.lastError && (
          <Notice tone="danger" title={t('instanceDetail.lastCollectionError')}>
            {connection.lastError}
          </Notice>
        )}

        {/* Le garde-fou a écarté des règles d'ici : leur catégorie n'est plus notée, et le score
            affiché plus haut est meilleur qu'il ne devrait l'être. Les règles sont nommées et
            mènent à leur détail, où la quarantaine se lit et se lève. */}
        {quarantined.length > 0 && (
          <Notice
            tone="warning"
            title={tc('instanceDetail.quarantine.title', quarantined.length)}
          >
            <p>{t('instanceDetail.quarantine.body')}</p>
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {quarantined.map((ruleId) => (
                <li key={ruleId}>
                  <Link
                    to={`/rules/${encodeURIComponent(ruleId)}`}
                    className="text-brand hover:text-brand-hover font-mono text-meta hover:underline"
                  >
                    {ruleId}
                  </Link>
                </li>
              ))}
            </ul>
          </Notice>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          <Hero
            label={t('instanceDetail.health')}
            value={
              score === null ? (
                '—'
              ) : (
                <>
                  {score}
                  <span className="text-ink-muted text-body font-normal"> {t('score.outOf')}</span>
                </>
              )
            }
            tone={score === null ? undefined : HERO_TONES[scoreTone(score)]}
            hint={
              <span title={formatDateTime(connection.lastCollectedAt)}>
                {connection.lastCollectedAt
                  ? t('instanceDetail.collectedAt', {
                      when: formatRelative(connection.lastCollectedAt),
                    })
                  : t('dashboard.awaitingCollection')}
              </span>
            }
            aside={<ScoreRing score={score} size={72} />}
            meta={
              (health || quarantined.length > 0) && (
                <>
                  {health && health.critical > 0 && (
                    <Badge tone="danger">{tc('dashboard.criticalCount', health.critical)}</Badge>
                  )}
                  {health && health.warning > 0 && (
                    <Badge tone="warning">{tc('dashboard.warningCount', health.warning)}</Badge>
                  )}
                  {health && health.info > 0 && (
                    <Badge tone="info">{tc('dashboard.infoCount', health.info)}</Badge>
                  )}
                  {health && health.total === 0 && quarantined.length === 0 && (
                    <Badge tone="success">{t('dashboard.noDiagnosticBadge')}</Badge>
                  )}
                  {/* Le score se lit avec ce qui a cessé d'être regardé, ou il ment. */}
                  {quarantined.length > 0 && (
                    <Badge tone="warning" title={quarantined.join(', ')}>
                      {tc('dashboard.quarantinedRules', quarantined.length)}
                    </Badge>
                  )}
                </>
              )
            }
          />

          <Card className="lg:col-span-2">
            <CardHeader title={t('dashboard.categoryScores')} />
            <CardBody>
              {categories.length === 0 ? (
                <EmptyState
                  title={t('instanceDetail.noScore')}
                  description={t('instanceDetail.noScoreHint')}
                />
              ) : (
                <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
                  {categories.map(([category, categoryScore]) => (
                    <ScoreBar key={category} label={categoryLabel(category)} score={categoryScore} />
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Le bloc qui bouge le plus : il garde son contenu pendant qu'il se met à jour, et le
            liseré dit qu'une collecte est arrivée. */}
        <Card className="overflow-hidden">
          <RefreshBar active={refreshing} />
          <CardHeader
            title={t('instanceDetail.activity')}
            description={
              metrics ? (
                <span title={formatDateTime(metrics.collectedAt)}>
                  {t('instanceDetail.collectedAt', { when: formatRelative(metrics.collectedAt) })}
                </span>
              ) : undefined
            }
          />
          <CardBody>
            {!metrics ? (
              <EmptyState
                title={t('instanceDetail.noMetrics')}
                description={t('instanceDetail.noMetricsHint')}
              />
            ) : (
              <KeyValueGrid columns={4}>
                <KeyValue label={t('dashboard.connections')}>
                  {formatNumber(metrics.connections)} / {formatNumber(metrics.maxConnections)}
                  <span className="text-ink-muted"> ({formatPercent(metrics.connectionUsage)})</span>
                </KeyValue>
                <KeyValue label={t('instanceDetail.activeQueries')}>
                  {formatNumber(metrics.activeQueries)}
                </KeyValue>
                <KeyValue label={t('instanceDetail.idleInTransaction')}>
                  {formatNumber(metrics.idleInTransaction)}
                </KeyValue>
                <KeyValue label={t('instanceDetail.blockedSessions')}>
                  {formatNumber(metrics.blockedSessions)}
                </KeyValue>
                <KeyValue label={t('instanceDetail.longestTransaction')}>
                  {formatSeconds(metrics.longestTransactionSeconds)}
                </KeyValue>
                <KeyValue label={t('instanceDetail.longestQuery')}>
                  {formatSeconds(metrics.longestQuerySeconds)}
                </KeyValue>
                <KeyValue label={t('instanceDetail.cacheHitRatio')}>
                  {formatPercent(metrics.cacheHitRatio)}
                </KeyValue>
                <KeyValue label={t('instanceDetail.databaseSize')}>
                  {formatBytes(metrics.databaseSizeBytes)}
                </KeyValue>
                <KeyValue label={t('instanceDetail.commits')}>
                  {formatNumber(metrics.commits)}
                </KeyValue>
                <KeyValue label={t('instanceDetail.rollbacks')}>
                  {formatNumber(metrics.rollbacks)}
                </KeyValue>
                <KeyValue label={t('instanceDetail.deadlocks')}>
                  {formatNumber(metrics.deadlocks)}
                </KeyValue>
                <KeyValue label={t('instanceDetail.tempFiles')}>
                  {formatBytes(metrics.tempBytes)}
                </KeyValue>
              </KeyValueGrid>
            )}
          </CardBody>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title={t('instanceDetail.capabilities')} />
            <CardBody className="space-y-4">
              {!capabilities ? (
                <EmptyState
                  title={t('instanceDetail.unknownCapabilities')}
                  description={t('instanceDetail.unknownCapabilitiesHint')}
                />
              ) : (
                <>
                  <KeyValueGrid columns={2}>
                    <KeyValue label={t('instanceDetail.version')}>
                      {capabilities.serverVersion}
                    </KeyValue>
                    <KeyValue label={t('instanceDetail.user')}>{capabilities.currentUser}</KeyValue>
                    <KeyValue label={t('instanceDetail.superuser')}>
                      {capabilities.isSuperuser ? t('common.yesShort') : t('common.noShort')}
                    </KeyValue>
                    <KeyValue label="pg_monitor">
                      {capabilities.hasPgMonitor ? t('common.yesShort') : t('common.noShort')}
                    </KeyValue>
                    <KeyValue label={t('instanceDetail.inRecovery')}>
                      {capabilities.inRecovery ? t('common.yesShort') : t('common.noShort')}
                    </KeyValue>
                    <KeyValue label={t('instanceDetail.detected')}>
                      {formatDateTime(capabilities.detectedAt)}
                    </KeyValue>
                  </KeyValueGrid>

                  {/* La version d'une extension — TimescaleDB comprise — se lit ici, avec les
                      autres extensions, et nulle part ailleurs : ce n'est pas une caractéristique
                      de l'instance mais un détail de ce qui est installé. */}
                  <CapabilityList
                    title={t('instanceDetail.extensionsPresent', {
                      count: presentExtensions.length,
                    })}
                    items={presentExtensions}
                    empty={t('instanceDetail.noExtension')}
                    available
                  />

                  {missingExtensions.length > 0 && (
                    <CapabilityList
                      title={t('instanceDetail.extensionsMissing', {
                        count: missingExtensions.length,
                      })}
                      items={missingExtensions}
                      empty={t('instanceDetail.noExtension')}
                      available={false}
                    />
                  )}

                  <CapabilityList
                    title={tc('instanceDetail.readableViews', views.length)}
                    items={views}
                    empty={t('instanceDetail.noView')}
                    available
                  />
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('instanceDetail.collectionSettings')} />
            <CardBody className="space-y-4">
              <KeyValueGrid columns={2}>
                <KeyValue label={t('instanceDetail.instanceEnabled')}>
                  {connection.enabled ? t('common.yesShort') : t('common.noShort')}
                </KeyValue>
                <KeyValue label={t('instanceDetail.sslMode')}>{connection.sslMode}</KeyValue>
                <KeyValue label={t('instanceDetail.ownInterval')}>
                  {connection.collectionIntervalSeconds > 0
                    ? `${connection.collectionIntervalSeconds} s`
                    : t('instanceDetail.globalInterval')}
                </KeyValue>
                <KeyValue label={t('instanceDetail.createdAt')}>
                  {formatDateTime(connection.createdAt)}
                </KeyValue>
              </KeyValueGrid>

              {/* Le principe zero-touch se rappelle là où l'on règle la collecte : l'Advisor
                  diagnostique, il ne corrige jamais. Les deux réglages sont nommés puis
                  expliqués — une phrase à trous autour d'un bloc de code ne se traduit pas. */}
              <Notice tone="info" title={t('instanceDetail.readOnlyTitle')}>
                <p>{t('instanceDetail.readOnlyIntro')}</p>
                <ul className="mt-1 space-y-0.5">
                  <li>
                    <code className="font-mono">default_transaction_read_only=on</code>
                    <span className="text-ink-muted"> — {t('instanceDetail.readOnlyItem')}</span>
                  </li>
                  <li>
                    <code className="font-mono">statement_timeout</code>
                    <span className="text-ink-muted">
                      {' '}
                      — {t('instanceDetail.readOnlyTimeoutItem')}
                    </span>
                  </li>
                </ul>
                <p className="mt-1">{t('instanceDetail.readOnlyZeroTouch')}</p>
              </Notice>
            </CardBody>
          </Card>
        </div>
      </div>
    </Page>
  )
}

/** `brand` ne dit jamais un état : une collecte en cours est une information. */
function stateTone(enabled: boolean, state: string): 'neutral' | 'danger' | 'success' | 'info' {
  if (!enabled) return 'neutral'
  if (state === 'error') return 'danger'
  if (state === 'idle') return 'success'
  return 'info'
}

/**
 * Ce que l'Advisor sait lire sur l'instance : extensions installées, vues accessibles. Deux
 * colonnes de noms plutôt qu'une zone défilante — la liste est courte et se lit une fois.
 */
function CapabilityList({
  title,
  items,
  empty,
  available,
}: {
  title: string
  items: CapabilityStatus[]
  empty: string
  available: boolean
}) {
  return (
    <section>
      <h3 className="text-ink-muted mb-1.5 text-micro font-semibold tracking-wider uppercase">
        {title}
      </h3>

      {items.length === 0 ? (
        <p className="text-ink-muted text-body">{empty}</p>
      ) : (
        <ul className="grid gap-x-4 sm:grid-cols-2">
          {items.map((item) => (
            <li key={item.name} className="flex min-w-0 items-center gap-1.5 py-0.5">
              {available ? (
                <Check className="text-success size-3.5 shrink-0" aria-hidden />
              ) : (
                <X className="text-ink-faint size-3.5 shrink-0" aria-hidden />
              )}
              <span
                className={cn(
                  'truncate font-mono text-body',
                  available ? 'text-ink' : 'text-ink-muted',
                )}
                title={item.name}
              >
                {item.name}
              </span>
              {item.version && (
                <span className="text-ink-muted shrink-0 text-meta tabular-nums">
                  {item.version}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
