import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { CheckCircle2, ExternalLink } from 'lucide-react'
import { api } from '@/api/client'
import type { Connection, Finding, FindingDetail, FindingStatus, FindingSummary } from '@/api/types'
import { useEventListener } from '@/app/EventsContext'
import { Page } from '@/components/layout/Page'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  FormSection,
  Input,
  LoadingBlock,
  Modal,
  Notice,
  Select,
  SeverityBadge,
  SplitButton,
} from '@/components/ui/primitives'
import { cn } from '@/lib/utils'
import { useFillHeight } from '@/lib/fillHeight'
import { categoryLabel, formatDateTime, formatRelative, qualifierLabel, statusLabel } from '@/lib/format'
import { tr, useT, useTc } from '@/lib/i18n'
import { SqlCode } from '@/lib/sqlHighlight'

/** Liseré de gauche par sévérité : rend la liste balayable d'un coup d'œil. */
const SEVERITY_ACCENT: Record<string, string> = {
  critical: 'border-l-danger',
  warning: 'border-l-warning',
  info: 'border-l-brand',
}

const CATEGORIES = [
  'performance',
  'queries',
  'indexes',
  'vacuum',
  'bloat',
  'connections',
  'locks',
  'transactions',
  'checkpoints',
  'configuration',
  'storage',
  'statistics',
  'security',
  'extensions',
]

/** Onglets de statut : ignorer une recommandation ne la fait pas disparaître, elle change d'onglet. */
const STATUS_TABS: { value: string; labelKey: string; counter?: 'active' | 'ignored' | 'resolved' }[] = [
  { value: 'active', labelKey: 'findings.tab.active', counter: 'active' },
  { value: 'ignored', labelKey: 'findings.tab.ignored', counter: 'ignored' },
  { value: 'resolved', labelKey: 'findings.tab.resolved', counter: 'resolved' },
  { value: 'all', labelKey: 'findings.tab.all' },
]

type VerdictTone = 'success' | 'warning' | 'danger'

interface Verdict {
  findingId: number
  tone: VerdictTone
  message: string
  durationMs: number
}

/** Tonalité d'un résultat de vérification : résolu, toujours présent, ou vérification en échec. */
function verdictTone(result: { resolved: boolean; stillPresent: boolean }): VerdictTone {
  if (result.resolved) return 'success'
  return result.stillPresent ? 'warning' : 'danger'
}

export function FindingsPage() {
  const t = useT()
  const tc = useTc()
  const [params, setParams] = useSearchParams()
  const [connections, setConnections] = useState<Connection[]>([])
  const [findings, setFindings] = useState<Finding[]>([])
  const [summary, setSummary] = useState<FindingSummary | null>(null)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [verdict, setVerdict] = useState<Verdict | null>(null)

  const scrollParent = useRef<HTMLDivElement>(null)

  const status = params.get('status') ?? 'active'
  const severity = params.get('severity') ?? ''
  const category = params.get('category') ?? ''
  const connectionId = params.get('connectionId') ?? ''
  const search = params.get('search') ?? ''

  // Pas de pagination : la liste est virtualisée, on charge tout le périmètre filtré.
  const pageSize = 2000

  const load = useCallback(async () => {
    try {
      const [result, counts] = await Promise.all([
        api.findings.list({
          status,
          severity: severity || undefined,
          category: category || undefined,
          connectionId: connectionId ? Number(connectionId) : undefined,
          search: search || undefined,
          page: 1,
          pageSize,
        }),
        api.findings.summary(connectionId ? Number(connectionId) : undefined),
      ])
      setFindings(result.items)
      setTotal(result.total)
      setSummary(counts)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr('common.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [status, severity, category, connectionId, search])

  const changeStatus = useCallback(
    async (finding: Finding, next: FindingStatus, message: string) => {
      setBusyId(finding.id)
      setNotice(null)
      setVerdict(null)

      try {
        await api.findings.setStatus(finding.id, next)
        setNotice(message)
        await load()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : tr('findings.statusFailed'))
      } finally {
        setBusyId(null)
      }
    },
    [load],
  )

  /**
   * Rejoue la règle sur l'instance concernée. Si le diagnostic a disparu, le serveur marque
   * la recommandation résolue : l'opérateur n'attend pas le prochain passage du scheduler.
   */
  const verify = useCallback(
    async (finding: Finding) => {
      setBusyId(finding.id)
      setNotice(null)
      setVerdict(null)

      try {
        const result = await api.findings.verify(finding.id)
        setVerdict({
          findingId: finding.id,
          tone: verdictTone(result),
          message: result.message,
          durationMs: result.durationMs,
        })

        if (result.resolved || result.stillPresent) {
          await load()
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : tr('findings.verifyFailed'))
      } finally {
        setBusyId(null)
      }
    },
    [load],
  )

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void api.connections.list().then(setConnections).catch(() => undefined)
  }, [])

  useEventListener(['finding.created', 'finding.resolved', 'finding.updated'], () => void load())

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  return (
    <Page title={t('nav.findings')} description={t('findings.subtitle')} wide>
      <div className="space-y-3">
        {error && (
          <Notice tone="danger" title={t('common.error')}>
            {error}
          </Notice>
        )}
        {notice && (
          <Notice tone="success" onDismiss={() => setNotice(null)}>
            {notice}
          </Notice>
        )}
        {status === 'ignored' && <Notice tone="info">{t('findings.ignoredNotice')}</Notice>}

        {/* Onglets, filtres et liste dans une seule carte : trois blocs empilés coûtaient deux
            bordures et deux écarts de plus, pour une seule et même tâche — restreindre le
            périmètre, puis le parcourir. */}
        <Card>
          <div className="border-border-subtle flex flex-wrap items-center justify-between gap-x-4 border-b px-4">
            {/* Les onglets ne se replient pas : en largeur réduite ils défilent latéralement,
                ce qui garde le rang de statuts sur une seule ligne au lieu de trois. */}
            <nav
              className="scrollbar-none -mb-px flex max-w-full items-center gap-1 overflow-x-auto"
              aria-label={t('findings.statusTabs')}
            >
              {STATUS_TABS.map((tab) => {
                const active = status === tab.value
                const count = tab.counter && summary ? summary[tab.counter] : null

                return (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() => setFilter('status', tab.value)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-sm font-medium whitespace-nowrap transition-colors sm:px-3',
                      active
                        ? 'border-brand text-brand'
                        : 'text-ink-muted hover:border-border-strong hover:text-ink border-transparent',
                    )}
                  >
                    {t(tab.labelKey)}
                    {count !== null && (
                      <span
                        className={cn(
                          'rounded-full px-1.5 py-0.5 text-xs tabular-nums',
                          active ? 'bg-brand-subtle text-brand' : 'bg-surface-sunken text-ink-muted',
                        )}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                )
              })}
            </nav>

            {/* Le décompte tient sur la ligne des onglets plutôt que sur un en-tête à lui seul. */}
            <p className="text-ink-muted py-2 text-xs">
              {tc('findings.count', total)}
              {findings.length > 0 && (
                <span className="text-ink-faint"> · {t('findings.virtualized')}</span>
              )}
              {total >= pageSize && (
                <span className="text-warning"> · {t('findings.limited', { count: pageSize })}</span>
              )}
            </p>
          </div>

          <div className="border-border-subtle grid grid-cols-1 gap-x-3 gap-y-2.5 border-b p-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t('common.severity')}>
              <Select value={severity} onChange={(event) => setFilter('severity', event.target.value)}>
                <option value="">{t('common.all')}</option>
                <option value="critical">{t('severity.critical')}</option>
                <option value="warning">{t('severity.warning')}</option>
                <option value="info">{t('severity.info')}</option>
              </Select>
            </Field>

            <Field label={t('common.category')}>
              <Select value={category} onChange={(event) => setFilter('category', event.target.value)}>
                <option value="">{t('common.all')}</option>
                {CATEGORIES.map((item) => (
                  <option key={item} value={item}>
                    {categoryLabel(item)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('common.instance')}>
              <Select
                value={connectionId}
                onChange={(event) => setFilter('connectionId', event.target.value)}
              >
                <option value="">{t('common.all')}</option>
                {connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('common.search')} hint={t('findings.searchHint')}>
              <Input
                defaultValue={search}
                placeholder={t('findings.searchPlaceholder')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    setFilter('search', (event.target as HTMLInputElement).value)
                  }
                }}
              />
            </Field>
          </div>

          {loading ? (
            <LoadingBlock />
          ) : findings.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 className="size-6" />}
              title={t('findings.empty.title')}
              description={
                status === 'active'
                  ? t('findings.empty.active')
                  : status === 'ignored'
                    ? t('findings.empty.ignored')
                    : t('findings.empty.other')
              }
            />
          ) : (
            <VirtualFindingList
              findings={findings}
              busyId={busyId}
              verdict={verdict}
              scrollParent={scrollParent}
              onOpen={setSelected}
              onResolve={(finding) =>
                changeStatus(finding, 'resolved', t('findings.notice.resolved', { title: finding.title }))
              }
              onIgnore={(finding) =>
                changeStatus(finding, 'ignored', t('findings.notice.ignored', { title: finding.title }))
              }
              onReactivate={(finding) =>
                changeStatus(finding, 'active', t('findings.notice.reactivated', { title: finding.title }))
              }
              onVerify={verify}
            />
          )}
        </Card>
      </div>

      {selected !== null && (
        <FindingDetailModal id={selected} onClose={() => setSelected(null)} onChanged={() => void load()} />
      )}
    </Page>
  )
}

/**
 * Liste virtualisée : seules les lignes visibles sont montées. La hauteur de chaque ligne
 * varie (message, étiquettes, verdict de vérification), d'où la mesure dynamique.
 */
function VirtualFindingList({
  findings,
  busyId,
  verdict,
  scrollParent,
  onOpen,
  onResolve,
  onIgnore,
  onReactivate,
  onVerify,
}: {
  findings: Finding[]
  busyId: number | null
  verdict: Verdict | null
  scrollParent: React.RefObject<HTMLDivElement | null>
  onOpen: (id: number) => void
  onResolve: (finding: Finding) => void
  onIgnore: (finding: Finding) => void
  onReactivate: (finding: Finding) => void
  onVerify: (finding: Finding) => void
}) {
  const available = useFillHeight(scrollParent)

  const virtualizer = useVirtualizer({
    count: findings.length,
    getScrollElement: () => scrollParent.current,
    estimateSize: () => 112,
    overscan: 8,
    getItemKey: (index) => findings[index].id,
  })

  return (
    <div
      ref={scrollParent}
      style={{ maxHeight: available }}
      className="min-h-72 overflow-y-auto overscroll-contain"
    >
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((item) => {
          const finding = findings[item.index]

          return (
            <div
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <FindingRow
                finding={finding}
                busy={busyId === finding.id}
                verdict={verdict?.findingId === finding.id ? verdict : null}
                onOpen={onOpen}
                onResolve={onResolve}
                onIgnore={onIgnore}
                onReactivate={onReactivate}
                onVerify={onVerify}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Séparateur des méta-données d'une ligne, muet pour les lecteurs d'écran. */
function MetaSeparator() {
  return <span aria-hidden>·</span>
}

function FindingRow({
  finding,
  busy,
  verdict,
  onOpen,
  onResolve,
  onIgnore,
  onReactivate,
  onVerify,
}: {
  finding: Finding
  busy: boolean
  verdict: Verdict | null
  onOpen: (id: number) => void
  onResolve: (finding: Finding) => void
  onIgnore: (finding: Finding) => void
  onReactivate: (finding: Finding) => void
  onVerify: (finding: Finding) => void
}) {
  const t = useT()
  const tc = useTc()

  const verifyOption = {
    label: t('findings.action.verify'),
    description: t('findings.action.verifyHint'),
    onSelect: () => onVerify(finding),
  }

  return (
    <div
      className={cn(
        'border-border-subtle hover:bg-surface-sunken flex flex-col gap-2 border-b border-l-2 px-4 py-3 transition-colors sm:flex-row sm:items-start sm:gap-3',
        finding.status === 'ignored'
          ? 'border-l-border-strong opacity-70'
          : (SEVERITY_ACCENT[finding.severity] ?? 'border-l-border-subtle'),
      )}
    >
      {/* Le bouton ne couvre que la zone d'information : les actions restent des éléments
          interactifs distincts, jamais imbriqués. */}
      <button type="button" onClick={() => onOpen(finding.id)} className="min-w-0 flex-1 text-left">
        {/* Titre tronqué plutôt que replié sous les badges : les lignes gardent la même hauteur
            et la colonne des étiquettes reste alignée. Le titre entier revient au survol et
            dans le détail. */}
        <div className="flex items-center gap-3">
          <p className="text-ink min-w-0 flex-1 truncate font-medium" title={finding.title}>
            {finding.title}
          </p>
          <span className="flex shrink-0 items-center gap-1.5">
            {finding.status !== 'active' && <Badge>{statusLabel(finding.status)}</Badge>}
            <SeverityBadge severity={finding.severity} />
          </span>
        </div>

        {/* Deux lignes de message suffisent à décider d'ouvrir le détail ; au-delà, une ligne
            de liste chassait les suivantes hors de l'écran. */}
        <p className="text-ink-muted mt-1 line-clamp-2 text-sm" title={finding.message}>
          {finding.message}
        </p>

        <div className="text-ink-faint mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="truncate">{finding.connectionName}</span>
          <MetaSeparator />
          <span className="truncate">{categoryLabel(finding.category)}</span>
          <MetaSeparator />
          <code className="bg-surface-sunken max-w-full truncate rounded px-1 font-mono">
            {finding.ruleId}
          </code>
          {finding.target && (
            <code className="bg-surface-sunken max-w-full truncate rounded px-1 font-mono">
              {finding.target}
            </code>
          )}
          <MetaSeparator />
          <span className="whitespace-nowrap" title={formatDateTime(finding.detectedAt)}>
            {t('findings.detected', { when: formatRelative(finding.detectedAt) })}
          </span>
          {finding.occurrences > 1 && (
            <>
              <MetaSeparator />
              <span className="whitespace-nowrap">{tc('findings.occurrences', finding.occurrences)}</span>
            </>
          )}
        </div>

        {verdict && (
          <p
            className={cn(
              'mt-2 rounded-[var(--radius-control)] px-2 py-1.5 text-xs',
              verdict.tone === 'success'
                ? 'bg-success-subtle text-success'
                : verdict.tone === 'warning'
                  ? 'bg-warning-subtle text-ink'
                  : 'bg-danger-subtle text-danger',
            )}
          >
            {verdict.message}
            {verdict.durationMs > 0 && (
              <span className="opacity-70">
                {' '}
                ({t('findings.durationMs', { ms: Math.round(verdict.durationMs) })})
              </span>
            )}
          </p>
        )}
      </button>

      <div className="flex shrink-0 items-start gap-1.5">
        {finding.status === 'active' && (
          <SplitButton
            label={t('findings.action.resolve')}
            loading={busy}
            disabled={busy}
            onClick={() => onResolve(finding)}
            options={[
              verifyOption,
              {
                label: t('findings.action.ignore'),
                description: t('findings.action.ignoreHint'),
                onSelect: () => onIgnore(finding),
              },
            ]}
          />
        )}

        {finding.status === 'ignored' && (
          <SplitButton
            label={t('findings.action.unignore')}
            loading={busy}
            disabled={busy}
            onClick={() => onReactivate(finding)}
            options={[
              verifyOption,
              { label: t('findings.action.resolve'), onSelect: () => onResolve(finding) },
            ]}
          />
        )}

        {finding.status === 'resolved' && (
          <SplitButton
            label={t('findings.action.reactivate')}
            loading={busy}
            disabled={busy}
            onClick={() => onReactivate(finding)}
            options={[
              verifyOption,
              { label: t('findings.action.ignore'), onSelect: () => onIgnore(finding) },
            ]}
          />
        )}
      </div>
    </div>
  )
}

function FindingDetailModal({
  id,
  onClose,
  onChanged,
}: {
  id: number
  onClose: () => void
  onChanged: () => void
}) {
  const t = useT()
  const [detail, setDetail] = useState<FindingDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [verdict, setVerdict] = useState<{ tone: VerdictTone; message: string; durationMs: number } | null>(
    null,
  )
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setDetail(await api.findings.get(id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr('common.loadFailed'))
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function changeStatus(status: FindingStatus) {
    setBusy(true)
    setVerdict(null)

    try {
      await api.findings.setStatus(id, status)
      await load()
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr('findings.statusFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function verify() {
    setBusy(true)

    try {
      const result = await api.findings.verify(id)
      setError(null)
      // Le verdict a sa propre tonalité : un diagnostic toujours présent est un avertissement,
      // pas une erreur — le peindre en rouge laissait croire à une vérification en échec.
      setVerdict({
        tone: verdictTone(result),
        message: result.message,
        durationMs: result.durationMs,
      })
      await load()
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr('findings.verifyFailed'))
    } finally {
      setBusy(false)
    }
  }

  const finding = detail?.finding
  const evidence = finding?.evidence ? Object.entries(finding.evidence) : []

  return (
    <Modal
      title={finding?.title ?? t('findings.detail.fallbackTitle')}
      // L'instance et l'objet visé identifient le diagnostic : ils tiennent sous le titre plutôt
      // que d'ouvrir le corps de la modale par une ligne de contexte.
      description={
        finding && `${finding.connectionName}${finding.target ? ` · ${finding.target}` : ''}`
      }
      onClose={onClose}
      size="lg"
      footer={
        finding && (
          <>
            <Button variant="ghost" onClick={onClose} className="mr-auto">
              {t('common.close')}
            </Button>
            <Button onClick={verify} loading={busy}>
              {t('findings.action.verify')}
            </Button>
            {finding.status !== 'ignored' && (
              <Button disabled={busy} onClick={() => changeStatus('ignored')}>
                {t('findings.action.ignore')}
              </Button>
            )}
            {finding.status !== 'active' && (
              <Button disabled={busy} onClick={() => changeStatus('active')}>
                {t('findings.action.reactivate')}
              </Button>
            )}
            {finding.status === 'active' && (
              <Button variant="primary" disabled={busy} onClick={() => changeStatus('resolved')}>
                {t('findings.action.resolve')}
              </Button>
            )}
          </>
        )
      }
    >
      {!detail ? (
        <LoadingBlock />
      ) : (
        <div className="space-y-5">
          {error && (
            <Notice tone="danger" title={t('common.error')}>
              {error}
            </Notice>
          )}
          {verdict && (
            <Notice tone={verdict.tone}>
              {verdict.message}
              {verdict.durationMs > 0 && (
                <span className="text-ink-faint">
                  {' '}
                  ({t('findings.durationMs', { ms: Math.round(verdict.durationMs) })})
                </span>
              )}
            </Notice>
          )}

          <FormSection
            title={t('findings.detail.diagnosis')}
            action={
              detail.finding.documentation && (
                <a
                  href={detail.finding.documentation}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-brand inline-flex items-center gap-1 text-xs hover:underline"
                >
                  {t('findings.detail.documentation')}
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
              )
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={detail.finding.severity} />
              <Badge>{statusLabel(detail.finding.status)}</Badge>
              <Badge tone="brand">{categoryLabel(detail.finding.category)}</Badge>
            </div>

            <p className="text-ink text-sm">{detail.finding.message}</p>

            {/* Les mesures forment une bande de tuiles courtes : lues d'un balayage horizontal,
                elles ne coûtent que deux lignes au lieu de six paires libellé / valeur. */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm sm:grid-cols-3">
              <Info label={t('findings.detail.impact')} value={qualifierLabel(detail.finding.impact)} />
              <Info
                label={t('findings.detail.confidence')}
                value={qualifierLabel(detail.finding.confidence)}
              />
              <Info
                label={t('findings.detail.occurrences')}
                value={String(detail.finding.occurrences)}
              />
              <Info
                label={t('findings.detail.lastSeen')}
                value={formatRelative(detail.finding.lastSeenAt)}
              />
              <Info
                label={t('findings.detail.detectedAt')}
                value={formatDateTime(detail.finding.detectedAt)}
              />
              {detail.finding.resolvedAt && (
                <Info
                  label={t('findings.detail.resolvedAt')}
                  value={formatDateTime(detail.finding.resolvedAt)}
                />
              )}
            </dl>

            {/* La règle déclenchante tient sur une ligne : libellé, identifiant cliquable, nom
                et version se suivent au lieu de former un bloc à part. */}
            <p className="text-sm">
              <span className="text-ink-faint text-[11px] tracking-wide uppercase">
                {t('findings.detail.rule')}
              </span>{' '}
              <Link
                to={`/rules/${encodeURIComponent(detail.finding.ruleId)}`}
                className="text-brand font-mono hover:underline"
              >
                {detail.finding.ruleId}
              </Link>
              {detail.finding.ruleName && (
                <span className="text-ink-muted"> — {detail.finding.ruleName}</span>
              )}
              <span className="text-ink-faint ml-1 text-xs">
                {t('findings.detail.ruleVersion', { version: detail.finding.ruleVersion })}
              </span>
            </p>
            {detail.finding.ruleMissing && (
              <p className="text-warning text-xs">{t('findings.detail.ruleMissing')}</p>
            )}
          </FormSection>

          {evidence.length > 0 && (
            <FormSection title={t('findings.detail.evidence')}>
              {/* Hauteur bornée : une preuve à trente entrées repoussait le correctif SQL hors
                  de l'écran. Le tableau défile dans son propre cadre. */}
              <div className="border-border-subtle max-h-56 overflow-auto rounded-[var(--radius-control)] border">
                <table className="w-full text-xs">
                  <tbody className="divide-border-subtle divide-y">
                    {evidence.map(([key, value]) => (
                      <tr key={key}>
                        <th className="bg-surface-sunken text-ink-muted w-40 px-2 py-1.5 text-left align-top font-medium">
                          {key}
                        </th>
                        <td className="text-ink px-2 py-1.5 font-mono break-all">
                          {value === null ? '—' : String(value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </FormSection>
          )}

          {detail.finding.remediationSql && (
            <FormSection
              title={t('findings.detail.remediation')}
              // L'avertissement de lecture seule tient sur la ligne du titre : il reste sous les
              // yeux au moment de copier la commande, sans ajouter de paragraphe sous le bloc.
              action={
                <span className="text-ink-faint text-xs">{t('findings.detail.remediationHint')}</span>
              }
            >
              <SqlCode sql={detail.finding.remediationSql} wrap className="max-h-56" />
            </FormSection>
          )}

          {/* Deux journaux courts côte à côte dès qu'il y a la place : ils se lisent en un coup
              d'œil au lieu de rallonger la modale de deux blocs. */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormSection title={t('findings.detail.history')}>
              <ul className="text-ink-muted max-h-44 space-y-1.5 overflow-auto text-xs">
                {detail.history.map((entry, index) => (
                  <li key={index} className="flex flex-wrap gap-x-2">
                    <span className="text-ink-faint whitespace-nowrap">{formatDateTime(entry.at)}</span>
                    <span>
                      {entry.fromStatus ? `${statusLabel(entry.fromStatus)} → ` : ''}
                      {statusLabel(entry.toStatus)}
                    </span>
                    {entry.note && <span className="text-ink-faint">({entry.note})</span>}
                    {entry.actor && (
                      <span className="text-ink-faint">
                        {t('findings.detail.actor', { actor: entry.actor })}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </FormSection>

            {detail.notifications.length > 0 && (
              <FormSection title={t('findings.detail.notifications')}>
                <ul className="text-ink-muted max-h-44 space-y-1.5 overflow-auto text-xs">
                  {detail.notifications.map((entry, index) => (
                    <li key={index} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-ink-faint whitespace-nowrap">
                        {formatDateTime(entry.at)}
                      </span>
                      <code className="bg-surface-sunken rounded px-1 font-mono">{entry.webhook}</code>
                      <span>{entry.event}</span>
                      {entry.success ? (
                        <Badge tone="success">{t('findings.detail.sent')}</Badge>
                      ) : (
                        <Badge tone="danger">
                          {t('findings.detail.failed', { status: entry.statusCode ?? '' })}
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </FormSection>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-ink-faint truncate text-[11px] tracking-wide uppercase">{label}</dt>
      <dd className="text-ink truncate" title={value}>
        {value}
      </dd>
    </div>
  )
}
