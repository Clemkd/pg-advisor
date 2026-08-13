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
  CardBody,
  CardHeader,
  CodeBlock,
  EmptyState,
  Field,
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
  'timescaledb',
  'extensions',
]

/** Onglets de statut : ignorer une recommandation ne la fait pas disparaître, elle change d'onglet. */
const STATUS_TABS: { value: string; label: string; counter?: 'active' | 'ignored' | 'resolved' }[] = [
  { value: 'active', label: 'À traiter', counter: 'active' },
  { value: 'ignored', label: 'Ignorées', counter: 'ignored' },
  { value: 'resolved', label: 'Résolues', counter: 'resolved' },
  { value: 'all', label: 'Toutes' },
]

interface Verdict {
  findingId: number
  tone: 'success' | 'warning' | 'danger'
  message: string
  durationMs: number
}

export function FindingsPage() {
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
      setError(cause instanceof Error ? cause.message : 'Chargement impossible.')
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
        setError(cause instanceof Error ? cause.message : 'Changement de statut impossible.')
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
          tone: result.resolved ? 'success' : result.stillPresent ? 'warning' : 'danger',
          message: result.message,
          durationMs: result.durationMs,
        })

        if (result.resolved || result.stillPresent) {
          await load()
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Vérification impossible.')
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
    <Page
      title="Recommandations"
      description="Chaque diagnostic indique la règle qui l'a produit, ses preuves et la commande corrective — jamais exécutée automatiquement."
      wide
    >
      <div className="space-y-4">
        <nav className="border-border-subtle flex flex-wrap gap-1 border-b" aria-label="Statut">
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
                  '-mb-px flex items-center gap-1.5 rounded-t-[var(--radius-control)] border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'border-brand text-brand'
                    : 'text-ink-muted hover:border-border-strong hover:text-ink border-transparent',
                )}
              >
                {tab.label}
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

        {error && (
          <Notice tone="danger" title="Erreur">
            {error}
          </Notice>
        )}
        {notice && (
          <Notice tone="success" onDismiss={() => setNotice(null)}>
            {notice}
          </Notice>
        )}
        {status === 'ignored' && (
          <Notice tone="info">
            Une recommandation ignorée n'est plus notifiée et ne pèse plus sur le score de santé. Elle
            continue d'être rafraîchie : « Ne plus ignorer » la remet dans la liste à traiter.
          </Notice>
        )}

        <Card>
          <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Sévérité">
              <Select value={severity} onChange={(event) => setFilter('severity', event.target.value)}>
                <option value="">Toutes</option>
                <option value="critical">Critique</option>
                <option value="warning">Avertissement</option>
                <option value="info">Information</option>
              </Select>
            </Field>

            <Field label="Catégorie">
              <Select value={category} onChange={(event) => setFilter('category', event.target.value)}>
                <option value="">Toutes</option>
                {CATEGORIES.map((item) => (
                  <option key={item} value={item}>
                    {categoryLabel(item)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Instance">
              <Select
                value={connectionId}
                onChange={(event) => setFilter('connectionId', event.target.value)}
              >
                <option value="">Toutes</option>
                {connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Recherche" hint="Entrée pour valider">
              <Input
                defaultValue={search}
                placeholder="titre, objet, règle"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    setFilter('search', (event.target as HTMLInputElement).value)
                  }
                }}
              />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={`${total} recommandation${total > 1 ? 's' : ''}`}
            description={findings.length > 0 ? 'Liste virtualisée : le défilement reste fluide.' : undefined}
            action={
              total >= pageSize && (
                <span className="text-warning text-xs">
                  affichage limité aux {pageSize} premières : affinez les filtres
                </span>
              )
            }
          />

          {loading ? (
            <LoadingBlock />
          ) : findings.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 className="size-6" />}
              title="Aucune recommandation pour ces filtres"
              description={
                status === 'active'
                  ? 'Aucun diagnostic à traiter sur le périmètre sélectionné.'
                  : status === 'ignored'
                    ? "Aucune recommandation ignorée. Le menu d'une ligne à traiter permet de l'y ranger."
                    : 'Essayez un autre statut ou élargissez les filtres.'
              }
            />
          ) : (
            <VirtualFindingList
              findings={findings}
              busyId={busyId}
              verdict={verdict}
              scrollParent={scrollParent}
              onOpen={setSelected}
              onResolve={(finding) => changeStatus(finding, 'resolved', `« ${finding.title} » marquée résolue.`)}
              onIgnore={(finding) => changeStatus(finding, 'ignored', `« ${finding.title} » est désormais ignorée.`)}
              onReactivate={(finding) => changeStatus(finding, 'active', `« ${finding.title} » revient à traiter.`)}
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
    estimateSize: () => 132,
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
              className="absolute left-0 top-0 w-full"
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
  const verifyOption = {
    label: 'Vérifier',
    description: "Rejoue la règle sur l'instance et résout si le problème a disparu.",
    onSelect: () => onVerify(finding),
  }

  return (
    <div
      className={cn(
        'border-border-subtle hover:bg-surface-sunken flex flex-col gap-2 border-b border-l-2 px-5 py-3.5 transition-colors sm:flex-row sm:items-start',
        finding.status === 'ignored'
          ? 'border-l-border-strong opacity-70'
          : (SEVERITY_ACCENT[finding.severity] ?? 'border-l-border-subtle'),
      )}
    >
      {/* Le bouton ne couvre que la zone d'information : les actions restent des éléments
          interactifs distincts, jamais imbriqués. */}
      <button type="button" onClick={() => onOpen(finding.id)} className="min-w-0 flex-1 text-left">
        <div className="flex items-start justify-between gap-3">
          <p className="text-ink min-w-0 font-medium">{finding.title}</p>
          <div className="flex shrink-0 items-center gap-1.5">
            {finding.status !== 'active' && <Badge>{statusLabel(finding.status)}</Badge>}
            <SeverityBadge severity={finding.severity} />
          </div>
        </div>

        <p className="text-ink-muted mt-1 text-sm">{finding.message}</p>

        <div className="text-ink-faint mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="truncate">{finding.connectionName}</span>
          <span aria-hidden>·</span>
          <span className="truncate">{categoryLabel(finding.category)}</span>
          <span aria-hidden>·</span>
          <code className="bg-surface-sunken max-w-full truncate rounded px-1 font-mono">
            {finding.ruleId}
          </code>
          {finding.target && (
            <code className="bg-surface-sunken max-w-full truncate rounded px-1 font-mono">
              {finding.target}
            </code>
          )}
          <span aria-hidden>·</span>
          <span className="whitespace-nowrap" title={formatDateTime(finding.detectedAt)}>
            détecté {formatRelative(finding.detectedAt)}
          </span>
          {finding.occurrences > 1 && (
            <span className="whitespace-nowrap">{finding.occurrences} occurrences</span>
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
            {verdict.durationMs > 0 && <span className="opacity-70"> ({Math.round(verdict.durationMs)} ms)</span>}
          </p>
        )}
      </button>

      <div className="flex shrink-0 items-start gap-1.5">
        {finding.status === 'active' && (
          <SplitButton
            label="Marquer résolue"
            loading={busy}
            disabled={busy}
            onClick={() => onResolve(finding)}
            options={[
              verifyOption,
              {
                label: 'Ignorer',
                description: 'Sort de la liste à traiter, sans notification ni impact sur le score.',
                onSelect: () => onIgnore(finding),
              },
            ]}
          />
        )}

        {finding.status === 'ignored' && (
          <SplitButton
            label="Ne plus ignorer"
            loading={busy}
            disabled={busy}
            onClick={() => onReactivate(finding)}
            options={[verifyOption, { label: 'Marquer résolue', onSelect: () => onResolve(finding) }]}
          />
        )}

        {finding.status === 'resolved' && (
          <SplitButton
            label="Réactiver"
            loading={busy}
            disabled={busy}
            onClick={() => onReactivate(finding)}
            options={[verifyOption, { label: 'Ignorer', onSelect: () => onIgnore(finding) }]}
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
  const [detail, setDetail] = useState<FindingDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setDetail(await api.findings.get(id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Chargement impossible.')
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function changeStatus(status: FindingStatus) {
    setBusy(true)
    try {
      await api.findings.setStatus(id, status)
      await load()
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Changement de statut impossible.')
    } finally {
      setBusy(false)
    }
  }

  async function verify() {
    setBusy(true)
    try {
      const result = await api.findings.verify(id)
      setError(null)
      await load()
      onChanged()
      if (!result.verified) setError(result.message)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Vérification impossible.')
    } finally {
      setBusy(false)
    }
  }

  const finding = detail?.finding

  return (
    <Modal
      title={finding?.title ?? 'Recommandation'}
      onClose={onClose}
      wide
      footer={
        finding && (
          <>
            <Button variant="ghost" onClick={onClose}>
              Fermer
            </Button>
            <Button onClick={verify} loading={busy}>
              Vérifier
            </Button>
            {finding.status !== 'ignored' && (
              <Button disabled={busy} onClick={() => changeStatus('ignored')}>
                Ignorer
              </Button>
            )}
            {finding.status !== 'active' && (
              <Button disabled={busy} onClick={() => changeStatus('active')}>
                Réactiver
              </Button>
            )}
            {finding.status === 'active' && (
              <Button variant="primary" disabled={busy} onClick={() => changeStatus('resolved')}>
                Marquer résolue
              </Button>
            )}
          </>
        )
      }
    >
      {error && (
        <Notice tone="danger" title="Erreur" className="mb-4">
          {error}
        </Notice>
      )}

      {!detail ? (
        <LoadingBlock />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={detail.finding.severity} />
            <Badge>{statusLabel(detail.finding.status)}</Badge>
            <Badge tone="brand">{categoryLabel(detail.finding.category)}</Badge>
            <span className="text-ink-faint text-xs">
              {detail.finding.connectionName}
              {detail.finding.target && ` · ${detail.finding.target}`}
            </span>
          </div>

          <p className="text-ink text-sm">{detail.finding.message}</p>

          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Info label="Impact estimé" value={qualifierLabel(detail.finding.impact)} />
            <Info label="Confiance" value={qualifierLabel(detail.finding.confidence)} />
            <Info label="Occurrences" value={String(detail.finding.occurrences)} />
            <Info label="Vue pour la dernière fois" value={formatRelative(detail.finding.lastSeenAt)} />
            <Info label="Détecté le" value={formatDateTime(detail.finding.detectedAt)} />
            {detail.finding.resolvedAt && (
              <Info label="Résolu le" value={formatDateTime(detail.finding.resolvedAt)} />
            )}
          </dl>

          <div>
            <p className="text-ink-muted mb-1 text-xs font-medium">Règle déclenchante</p>
            <p className="text-sm">
              <Link
                to={`/rules/${encodeURIComponent(detail.finding.ruleId)}`}
                className="text-brand font-mono hover:underline"
              >
                {detail.finding.ruleId}
              </Link>
              {detail.finding.ruleName && <span className="text-ink-muted"> — {detail.finding.ruleName}</span>}
              <span className="text-ink-faint ml-1 text-xs">version {detail.finding.ruleVersion}</span>
            </p>
            {detail.finding.ruleMissing && (
              <p className="text-warning mt-1 text-xs">
                Cette règle n'est plus chargée : le finding ne sera plus rafraîchi.
              </p>
            )}
          </div>

          {detail.finding.evidence && Object.keys(detail.finding.evidence).length > 0 && (
            <div>
              <p className="text-ink-muted mb-1 text-xs font-medium">Preuves collectées</p>
              <div className="border-border-subtle overflow-x-auto rounded-[var(--radius-control)] border">
                <table className="w-full text-xs">
                  <tbody className="divide-border-subtle divide-y">
                    {Object.entries(detail.finding.evidence).map(([key, value]) => (
                      <tr key={key}>
                        <th className="bg-surface-sunken text-ink-muted w-48 px-2 py-1 text-left font-medium">
                          {key}
                        </th>
                        <td className="text-ink break-all px-2 py-1 font-mono">
                          {value === null ? '—' : String(value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {detail.finding.remediationSql && (
            <div>
              <p className="text-ink-muted mb-1 text-xs font-medium">
                Commande corrective proposée — à exécuter manuellement
              </p>
              <CodeBlock>{detail.finding.remediationSql}</CodeBlock>
              <p className="text-ink-faint mt-1 text-xs">
                L'Advisor n'exécute jamais cette commande : la session de supervision est en lecture seule.
              </p>
            </div>
          )}

          {detail.finding.documentation && (
            <p className="text-sm">
              <a
                href={detail.finding.documentation}
                target="_blank"
                rel="noreferrer noopener"
                className="text-brand inline-flex items-center gap-1 hover:underline"
              >
                Documentation PostgreSQL
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            </p>
          )}

          <div>
            <p className="text-ink-muted mb-1 text-xs font-medium">Historique</p>
            <ul className="text-ink-muted space-y-1 text-xs">
              {detail.history.map((entry, index) => (
                <li key={index} className="flex flex-wrap gap-2">
                  <span className="text-ink-faint">{formatDateTime(entry.at)}</span>
                  <span>
                    {entry.fromStatus ? `${statusLabel(entry.fromStatus)} → ` : ''}
                    {statusLabel(entry.toStatus)}
                  </span>
                  {entry.note && <span className="text-ink-faint">({entry.note})</span>}
                  {entry.actor && <span className="text-ink-faint">par {entry.actor}</span>}
                </li>
              ))}
            </ul>
          </div>

          {detail.notifications.length > 0 && (
            <div>
              <p className="text-ink-muted mb-1 text-xs font-medium">Notifications envoyées</p>
              <ul className="text-ink-muted space-y-1 text-xs">
                {detail.notifications.map((entry, index) => (
                  <li key={index} className="flex flex-wrap items-center gap-2">
                    <span className="text-ink-faint">{formatDateTime(entry.at)}</span>
                    <code className="bg-surface-sunken rounded px-1 font-mono">{entry.webhook}</code>
                    <span>{entry.event}</span>
                    {entry.success ? (
                      <Badge tone="success">envoyée</Badge>
                    ) : (
                      <Badge tone="danger">échec {entry.statusCode ?? ''}</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-ink-faint truncate text-[11px] uppercase tracking-wide">{label}</dt>
      <dd className="text-ink truncate">{value}</dd>
    </div>
  )
}
