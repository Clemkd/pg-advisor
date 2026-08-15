import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Database } from 'lucide-react'
import { api } from '@/api/client'
import type { Connection, Dashboard } from '@/api/types'
import { useEventListener, useEvents } from '@/app/EventsContext'
import { Hero, Page } from '@/components/layout/Page'
import type { ValueTone } from '@/components/layout/Page'
import {
  Badge,
  Card,
  CardAction,
  CardBody,
  CardHeader,
  Dot,
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
import { currentLocale, translate, translatePlural, tr, useT, useTc } from '@/lib/i18n'
import type { PluralTranslator, Translator } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const LIVE_EVENTS = [
  'finding.created',
  'finding.resolved',
  'finding.updated',
  'health.changed',
  'collection.state',
  'instance.changed',
  'rules.reloaded',
]

/** Repli lorsque le flux temps réel est interrompu. Il double le flux tant qu'il vit. */
const FALLBACK_POLL_MS = 30_000

/** Le score commande la teinte du point d'entrée : il se lit avant d'être lu. */
const HERO_TONES: Record<string, ValueTone> = {
  good: 'success',
  warn: 'warning',
  bad: 'danger',
}

/** Les trois sévérités dans l'ordre où elles se lisent : le plus grave d'abord. */
const SEVERITIES = [
  { key: 'critical', labelKey: 'dashboard.criticals', ink: 'text-danger-strong' },
  { key: 'warning', labelKey: 'dashboard.warnings', ink: 'text-warning-strong' },
  { key: 'info', labelKey: 'dashboard.infos', ink: 'text-info-strong' },
] as const

/**
 * Vue d'ensemble — famille *balayage*.
 *
 * Ouverte en permanence, souvent sur un second écran : elle dit d'un coup d'œil ce qui est grave,
 * ce qui vient de changer et où aller. Le score global est le seul point d'entrée ; tout le reste
 * lui est hiérarchiquement inférieur.
 */
export function DashboardPage() {
  const t = useT()
  const tc = useTc()
  const { connected } = useEvents()

  const [data, setData] = useState<Dashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [receivedAt, setReceivedAt] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState<string | null>(null)

  // Ce qui a été lu au passage précédent, pour ne signaler que ce qui a effectivement bougé.
  const previous = useRef<{ critical: number; health: number | null } | null>(null)

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      const next = await api.dashboard()
      setData(next)
      setReceivedAt(new Date().toISOString())
      setError(null)
      setAnnouncement(announce(previous.current, next))
      previous.current = { critical: next.summary.critical, health: next.globalHealth }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr('common.loadFailed'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEventListener(LIVE_EVENTS, () => void load())

  // Le rappel périodique ne vit que si le flux est mort : branché en permanence, il doublait le
  // SSE et rechargeait la page toutes les trente secondes pour rien.
  useEffect(() => {
    if (connected) return
    const timer = window.setInterval(() => void load(), FALLBACK_POLL_MS)
    return () => window.clearInterval(timer)
  }, [connected, load])

  if (loading) {
    return (
      <Page title={t('nav.overview')}>
        <LoadingBlock />
      </Page>
    )
  }

  // La donnée n'a jamais été lue : il n'y a rien à conserver derrière l'erreur.
  if (!data) {
    return (
      <Page title={t('nav.overview')}>
        <Notice tone="danger" title={t('common.error')}>
          {error ?? t('common.loadFailed')}
        </Notice>
      </Page>
    )
  }

  const { summary, rules, instances, globalHealth } = data
  const categories = aggregateCategories(instances)
  const scored = instances.filter((instance) => instance.health !== null).length
  const activeDiagnostics = summary.critical + summary.warning + summary.info

  return (
    <Page
      title={t('nav.overview')}
      description={tc('dashboard.supervised', instances.length)}
      meta={<LastUpdated at={receivedAt} />}
      wide
    >
      {/* aria-busy plutôt qu'un sablier : le contenu reste affiché pendant qu'il se met à jour. */}
      <div className="space-y-4" aria-busy={refreshing}>
        <LiveRegion message={announcement} />

        {/* Une erreur de rafraîchissement n'efface pas ce qui a déjà été lu. */}
        {error && (
          <Notice tone="danger" title={t('common.error')}>
            {error}
          </Notice>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          <Hero
            label={t('dashboard.globalHealth')}
            value={
              globalHealth === null ? (
                '—'
              ) : (
                <>
                  {globalHealth}
                  <span className="text-ink-muted text-body font-normal"> {t('score.outOf')}</span>
                </>
              )
            }
            tone={globalHealth === null ? undefined : HERO_TONES[scoreTone(globalHealth)]}
            hint={
              globalHealth === null
                ? t('dashboard.awaitingFirstCollection')
                : tc('dashboard.scoredInstances', scored)
            }
            aside={<ScoreRing score={globalHealth} size={72} />}
            action={<CardAction to="/findings">{t('dashboard.handleDiagnostics')}</CardAction>}
          />

          <Card>
            <CardHeader
              title={t('dashboard.activeDiagnostics')}
              description={`${tc('dashboard.resolvedCount', summary.resolved)} · ${tc(
                'dashboard.ignoredCount',
                summary.ignored,
              )}`}
            />

            {activeDiagnostics === 0 ? (
              <EmptyState
                title={t('dashboard.noDiagnostic')}
                description={t('dashboard.noActiveFindingHint')}
              />
            ) : (
              <ul className="divide-border-subtle divide-y">
                {SEVERITIES.map((severity) => (
                  <SeverityRow
                    key={severity.key}
                    severity={severity.key}
                    label={t(severity.labelKey)}
                    ink={severity.ink}
                    count={summary[severity.key]}
                  />
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title={t('dashboard.rulesTitle')}
              description={tc('dashboard.rulesLoaded', rules.total)}
              action={<CardAction to="/rules">{t('dashboard.manage')}</CardAction>}
            />
            <CardBody className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                <Badge tone="neutral">{tc('dashboard.bundled', rules.provided)}</Badge>
                {/* `info` et non `brand` : un décompte dit un état, il ne se clique pas. */}
                <Badge tone="info">{tc('dashboard.custom', rules.user)}</Badge>
                <Badge tone={rules.errors.length > 0 ? 'danger' : 'success'}>
                  {tc('dashboard.failing', rules.errors.length)}
                </Badge>
              </div>

              <p className="text-ink-muted text-meta" title={formatDateTime(rules.loadedAt)}>
                {t('dashboard.lastLoad', { when: formatRelative(rules.loadedAt) })}
              </p>

              {/* Le message est borné à deux lignes : une vue de balayage annonce la panne, elle
                  ne la raconte pas — l'éditeur de règles porte le texte entier. */}
              {rules.errors.slice(0, 2).map((ruleError, index) => (
                <Notice
                  key={`${ruleError.file}-${index}`}
                  tone="danger"
                  title={ruleError.ruleId ?? ruleError.file}
                >
                  <span className="line-clamp-2" title={ruleError.message}>
                    {ruleError.message}
                  </span>
                </Notice>
              ))}
            </CardBody>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {/* overflow-hidden : le liseré de rechargement suit le rayon de la carte. */}
          <Card className="overflow-hidden lg:col-span-2">
            <RefreshBar active={refreshing} />
            <CardHeader
              title={t('common.instances')}
              action={<CardAction to="/instances">{t('dashboard.manageInstances')}</CardAction>}
            />

            {instances.length === 0 ? (
              <EmptyState
                icon={<Database className="size-6" aria-hidden />}
                title={t('dashboard.noInstance')}
                description={t('dashboard.noInstanceHint')}
                action={<CardAction to="/instances">{t('instances.add')}</CardAction>}
              />
            ) : (
              <ul className="divide-border-subtle divide-y">
                {[...instances].sort(byUrgency).map((instance) => (
                  <InstanceRow key={instance.id} instance={instance} t={t} tc={tc} />
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title={t('dashboard.categoryScores')}
              description={t('dashboard.categoryScoresHint')}
            />
            <CardBody>
              {categories.length === 0 ? (
                <EmptyState
                  title={t('dashboard.noCategoryScore')}
                  description={t('dashboard.noCategoryScoreHint')}
                />
              ) : (
                <div className="space-y-2">
                  {categories.map(([category, score]) => (
                    <ScoreBar key={category} label={categoryLabel(category)} score={score} />
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        {/* La répartition par catégorie ne s'affiche que s'il y a quelque chose à répartir : sans
            diagnostic actif, la carte des diagnostics ci-dessus l'a déjà dit, et un second état
            vide n'apprend rien. */}
        {Object.keys(summary.byCategory).length > 0 && (
          <Card>
            <CardHeader
              title={t('dashboard.diagnosticsByCategory')}
              action={<CardAction to="/findings">{t('dashboard.seeAll')}</CardAction>}
            />
            <CardBody>
              <ul className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-4">
                  {Object.entries(summary.byCategory)
                    .sort(([, a], [, b]) => b - a)
                    .map(([category, count]) => (
                      <li key={category}>
                        <Link
                          to={`/findings?category=${category}`}
                          className="hover:bg-surface-sunken flex min-h-10 items-center justify-between gap-3 rounded-[var(--radius-control)] px-2 text-body"
                        >
                          <span className="text-ink truncate">{categoryLabel(category)}</span>
                          <span className="text-ink shrink-0 font-semibold tabular-nums">
                            {count}
                          </span>
                        </Link>
                      </li>
                    ))}
              </ul>
            </CardBody>
          </Card>
        )}
      </div>
    </Page>
  )
}

/**
 * Ce qu'il y a à annoncer depuis le dernier passage, ou rien.
 *
 * Le premier chargement n'annonce jamais : une liste qui s'affiche n'est pas une liste qui change.
 * La traduction est lue au moment de l'annonce plutôt que passée en paramètre — le message est
 * transitoire, et le rappel qui l'écrit ne doit pas dépendre de la langue.
 */
function announce(
  before: { critical: number; health: number | null } | null,
  next: Dashboard,
): string | null {
  if (!before) return null

  const locale = currentLocale()
  const added = next.summary.critical - before.critical
  if (added > 0) return translatePlural(locale, 'dashboard.live.newCritical', added)

  if (next.globalHealth !== null && next.globalHealth !== before.health) {
    return translate(locale, 'dashboard.live.scoreChanged', { score: next.globalHealth })
  }

  return null
}

/**
 * Ordre de la question posée : ce qui est en erreur, puis ce qui porte le plus de critiques, puis
 * le score le plus bas. Une instance désactivée ferme la marche — elle ne dit rien de l'état du
 * parc.
 */
function byUrgency(a: Connection, b: Connection): number {
  const rank = (instance: Connection) =>
    !instance.enabled ? 2 : instance.collectionState === 'error' ? 0 : 1

  const byState = rank(a) - rank(b)
  if (byState !== 0) return byState

  const byCritical = (b.health?.critical ?? 0) - (a.health?.critical ?? 0)
  if (byCritical !== 0) return byCritical

  const byWarning = (b.health?.warning ?? 0) - (a.health?.warning ?? 0)
  if (byWarning !== 0) return byWarning

  // Une instance pas encore notée passe après celles qui le sont : elle n'est pas « parfaite ».
  const scoreA = a.health?.global ?? 101
  const scoreB = b.health?.global ?? 101
  if (scoreA !== scoreB) return scoreA - scoreB

  return a.name.localeCompare(b.name)
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

/**
 * Une sévérité et son décompte, qui mène à la liste filtrée sur cette sévérité. Le chiffre reste
 * en `text-body` et prend l'encre de son état : la couleur double le mot, elle ne le remplace pas.
 */
function SeverityRow({
  severity,
  label,
  ink,
  count,
}: {
  severity: string
  label: string
  ink: string
  count: number
}) {
  return (
    <li>
      <Link
        to={`/findings?severity=${severity}`}
        className="hover:bg-surface-sunken flex min-h-10 items-center justify-between gap-3 px-4 py-2"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Dot tone={severity} />
          <span className="text-ink truncate text-body">{label}</span>
        </span>
        <span className={cn('shrink-0 text-body font-semibold tabular-nums', count > 0 ? ink : 'text-ink-muted')}>
          {count}
        </span>
      </Link>
    </li>
  )
}

/**
 * Une instance supervisée : identité et état sur une ligne, cible et fraîcheur de collecte sur la
 * suivante, mesures en dessous. Deux niveaux de texte, puis les chiffres.
 */
function InstanceRow({
  instance,
  t,
  tc,
}: {
  instance: Connection
  t: Translator
  tc: PluralTranslator
}) {
  const health = instance.health
  const metrics = instance.metrics

  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        <ScoreRing score={health?.global ?? null} size={56} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              to={`/instances/${instance.id}`}
              className="text-ink hover:text-brand truncate text-body font-medium"
            >
              {instance.name}
            </Link>
            <StateBadge instance={instance} t={t} />

            {health && health.critical > 0 && (
              <Badge tone="danger">{tc('dashboard.criticalCount', health.critical)}</Badge>
            )}
            {health && health.warning > 0 && (
              <Badge tone="warning">{tc('dashboard.warningCount', health.warning)}</Badge>
            )}
            {health && health.info > 0 && (
              <Badge tone="info">{tc('dashboard.infoCount', health.info)}</Badge>
            )}
            {health && health.total === 0 && (
              <Badge tone="success">{t('dashboard.noDiagnosticBadge')}</Badge>
            )}
          </div>

          {/* La fraîcheur se dit par le temps écoulé depuis la dernière collecte, instance par
              instance : sur un parc, c'est celle qui n'a plus été collectée qui inquiète, et
              l'écart se réactualise seul sans que la vue se rende à nouveau. */}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-meta">
            <span className="text-ink-muted min-w-0 truncate">
              {instance.serverVersion
                ? `PostgreSQL ${instance.serverVersion}`
                : `${instance.host}:${instance.port}`}
              {' · '}
              {instance.database}
            </span>
            {instance.lastCollectedAt ? (
              <LastUpdated at={instance.lastCollectedAt} />
            ) : (
              <span className="text-ink-muted whitespace-nowrap">
                {t('dashboard.awaitingCollection')}
              </span>
            )}
          </div>

          {instance.lastError && (
            <p
              className="text-danger-strong mt-1 line-clamp-2 text-meta"
              title={instance.lastError}
            >
              {instance.lastError}
            </p>
          )}
        </div>
      </div>

      {/* Une instance sans mesure n'aligne pas quatre tirets : la rangée disparaît, et la ligne
          se compacte d'autant. */}
      {metrics && (
        <KeyValueGrid columns={4} className="border-border-subtle mt-3 border-t pt-3">
          <KeyValue label={t('dashboard.connections')}>
            {formatNumber(metrics.connections)} / {formatNumber(metrics.maxConnections)}
          </KeyValue>
          <KeyValue label={t('dashboard.cache')}>{formatPercent(metrics.cacheHitRatio)}</KeyValue>
          <KeyValue label={t('dashboard.longestTx')}>
            {formatSeconds(metrics.longestTransactionSeconds)}
          </KeyValue>
          <KeyValue label={t('dashboard.size')}>{formatBytes(metrics.databaseSizeBytes)}</KeyValue>
        </KeyValueGrid>
      )}
    </li>
  )
}

function StateBadge({ instance, t }: { instance: Connection; t: Translator }) {
  if (!instance.enabled) return <Badge>{t('instances.disabledBadge')}</Badge>

  // `brand` ne dit jamais un état : une collecte en cours est une information, pas un bouton.
  const tone =
    instance.collectionState === 'error'
      ? 'danger'
      : instance.collectionState === 'idle'
        ? 'success'
        : 'info'

  const label =
    instance.collectionState === 'analyzing' && instance.analysisProgress !== null
      ? t('instances.analysisProgress', {
          percent: Math.round(instance.analysisProgress * 100),
        })
      : collectionStateLabel(instance.collectionState)

  return <Badge tone={tone}>{label}</Badge>
}
