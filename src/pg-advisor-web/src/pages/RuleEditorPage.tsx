import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FlaskConical, ServerOff } from 'lucide-react'
import { api, ApiError } from '@/api/client'
import type { Connection, DryRunResult, RuleDetail, RuleSchema, Severity } from '@/api/types'
import { useAuth } from '@/app/AuthContext'
import { Page } from '@/components/layout/Page'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Field,
  FormSection,
  Input,
  LastUpdated,
  LoadingBlock,
  Notice,
  Select,
  SeverityBadge,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui/primitives'
import { useFillHeight } from '@/lib/fillHeight'
import { categoryLabel, severityLabel } from '@/lib/format'
import { tr, useT, useTc } from '@/lib/i18n'
import type { PluralTranslator, Translator } from '@/lib/i18n'
import { SqlCommand } from '@/lib/sqlHighlight'
import { errorLine, YamlEditor } from '@/lib/yamlHighlight'
import { cn } from '@/lib/utils'

/**
 * Raccourci d'exécution à blanc. Affiché sur le bouton : un raccourci qu'on ne voit pas n'existe
 * pas, et l'établi se juge à la longueur de la boucle écrire / exécuter / lire.
 */
const APPLE = /mac|iphone|ipad/i.test(navigator.userAgent)
const RUN_SHORTCUT = APPLE ? '⌘ ↵' : 'Ctrl ↵'
const RUN_KEYS = APPLE ? 'Meta+Enter' : 'Control+Enter'

/** Identifiant de repli d'une règle en cours de création, le temps de l'exécuter à blanc. */
const DRAFT_ID = 'nouvelle-regle'

export function RuleEditorPage() {
  const { id } = useParams<{ id: string }>()
  const creating = id === undefined
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const t = useT()
  const tc = useTc()

  const [schema, setSchema] = useState<RuleSchema | null>(null)
  const [detail, setDetail] = useState<RuleDetail | null>(null)
  const [connections, setConnections] = useState<Connection[]>([])
  const [yaml, setYaml] = useState('')
  const [loading, setLoading] = useState(true)

  const [errors, setErrors] = useState<string[]>([])
  const [validated, setValidated] = useState<boolean | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const [dryRunInstance, setDryRunInstance] = useState<number | null>(null)
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null)
  const [dryRunAt, setDryRunAt] = useState<string | null>(null)
  const [dryRunBusy, setDryRunBusy] = useState(false)

  const editorBox = useRef<HTMLDivElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const available = useFillHeight(editorBox)

  const load = useCallback(async () => {
    try {
      const [ruleSchema, instances] = await Promise.all([api.rules.schema(), api.connections.list()])
      setSchema(ruleSchema)
      setConnections(instances)
      setDryRunInstance(instances[0]?.id ?? null)

      if (creating) {
        setYaml(ruleSchema.template)
      } else {
        const ruleDetail = await api.rules.get(id!)
        setDetail(ruleDetail)
        setYaml(ruleDetail.yaml)
      }

      setFailure(null)
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : tr('common.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [creating, id])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = detail !== null && yaml !== detail.yaml

  // Validation à la frappe, temporisée : l'auteur voit ses erreurs sans enregistrer.
  useEffect(() => {
    if (!yaml.trim()) {
      setValidated(null)
      setErrors([])
      return
    }

    const timer = window.setTimeout(async () => {
      try {
        const result = await api.rules.validate(yaml)
        setValidated(result.valid)
        setErrors(result.errors)
      } catch {
        // La validation est un confort : son échec ne doit pas gêner l'édition.
      }
    }, 600)

    return () => window.clearTimeout(timer)
  }, [yaml])

  // Chaque erreur est rapportée à sa ligne quand le message permet de la retrouver : la ligne
  // est teintée dans l'éditeur, et l'erreur y conduit d'un clic.
  const located = useMemo(
    () => errors.map((message) => ({ message, line: errorLine(message, yaml) })),
    [errors, yaml],
  )
  const errorLines = useMemo(
    () => new Set(located.map((item) => item.line).filter((line): line is number => line !== null)),
    [located],
  )

  async function save() {
    setBusy(true)
    setFailure(null)
    setNotice(null)

    try {
      const saved = creating ? await api.rules.create(yaml) : await api.rules.update(id!, yaml)
      setDetail(saved)
      setYaml(saved.yaml)
      setNotice(t('ruleEditor.saved', { id: saved.rule.id }))

      if (creating) {
        navigate(`/rules/${encodeURIComponent(saved.rule.id)}`, { replace: true })
      }
    } catch (cause) {
      if (cause instanceof ApiError) {
        setFailure(cause.message)
        setErrors(cause.details ?? [])
      } else {
        setFailure(t('ruleEditor.saveFailed'))
      }
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!detail) return
    setBusy(true)

    try {
      await api.rules.remove(detail.rule.id)
      navigate('/rules')
    } catch (cause) {
      setFailure(cause instanceof ApiError ? cause.message : t('ruleEditor.deleteFailed'))
      setConfirmDelete(false)
    } finally {
      setBusy(false)
    }
  }

  const runDryRun = useCallback(async () => {
    if (dryRunInstance === null || dryRunBusy) return

    setDryRunBusy(true)

    try {
      // Le résultat précédent reste affiché jusqu'à l'arrivée du suivant : on compare ce qu'on
      // vient d'écrire à ce qu'on avait, plutôt que de regarder un cadre vide.
      const result = await api.rules.dryRun(detail?.rule.id ?? DRAFT_ID, dryRunInstance, yaml)
      setDryRun(result)
      setDryRunAt(new Date().toISOString())
    } catch (cause) {
      if (cause instanceof ApiError) {
        setFailure(cause.message)
        setErrors(cause.details ?? [])
      } else {
        // `tr` et non `t` : ce dernier change avec la langue et recréerait le rappel, donc le
        // raccourci clavier, à chaque bascule.
        setFailure(tr('ruleEditor.dryRunFailed'))
      }
    } finally {
      setDryRunBusy(false)
    }
  }, [detail?.rule.id, dryRunInstance, dryRunBusy, yaml])

  // Le raccourci est lu au moment où il sert : la fonction qu'il déclenche change à chaque
  // frappe dans l'éditeur, on ne réabonne pas la fenêtre pour autant.
  const runRef = useRef(runDryRun)
  runRef.current = runDryRun

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        void runRef.current()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  /** Pose le curseur sur une ligne et l'amène sous les yeux. */
  function goToLine(line: number) {
    const element = textarea.current
    if (!element) return

    const lines = yaml.split('\n')
    const start = lines.slice(0, line - 1).reduce((total, text) => total + text.length + 1, 0)
    element.focus()
    element.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0))
  }

  if (loading) {
    return <LoadingBlock />
  }

  const rule = detail?.rule

  return (
    <Page
      title={creating ? t('ruleEditor.newTitle') : (rule?.name ?? rule?.id ?? '')}
      // Le fil d'Ariane de la coquille annonce déjà « Règles / identifiant » : la page n'en
      // repose pas un second. La signalétique de la règle tient sur la ligne du titre.
      meta={
        rule && (
          <>
            <SeverityBadge severity={rule.severity} />
            <Badge tone="info">{categoryLabel(rule.category)}</Badge>
            <Badge>{t('ruleEditor.group', { group: rule.group })}</Badge>
            <Badge>{t('ruleEditor.version', { version: rule.version })}</Badge>
            {rule.origin === 'user' ? (
              <Badge tone="info">{t('rules.customTag')}</Badge>
            ) : (
              <Badge>{t('rules.bundledTag')}</Badge>
            )}
          </>
        )
      }
      actions={
        isAdmin && (
          <>
            {!creating && rule?.origin === 'user' && (
              <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={busy}>
                {t('common.delete')}
              </Button>
            )}
            <Button
              variant="primary"
              size="lg"
              onClick={save}
              loading={busy}
              disabled={validated === false}
            >
              {t('common.save')}
            </Button>
          </>
        )
      }
      wide
    >
      <div className="space-y-4">
        {failure && (
          <Notice tone="danger" title={failure}>
            {errors.length > 0 && <ErrorList errors={errors} />}
          </Notice>
        )}
        {notice && (
          <Notice tone="success" onDismiss={() => setNotice(null)}>
            {notice}
          </Notice>
        )}

        {!creating && rule && rule.origin === 'provided' && (
          <Notice tone="info" title={t('ruleEditor.providedTitle')}>
            {t('ruleEditor.providedBody')}
          </Notice>
        )}

        {/* Deux colonnes de même largeur : la définition et ce qu'elle produit se lisent
            ensemble. Dans une colonne au tiers, le résultat SQL défilait dans un couloir.
            `grid-cols-1` explicite en dessous de xl : sans lui, la colonne implicite se
            dimensionne sur le contenu le plus large — l'éditeur, un tableau de résultat — et
            débordait la fenêtre en largeur réduite. */}
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader
              title={t('ruleEditor.yamlTitle')}
              description={
                rule && (
                  <span className="font-mono" title={rule.file}>
                    {rule.file}
                  </span>
                )
              }
              // Validité et état d'enregistrement sur la ligne du titre : deux étiquettes
              // plutôt qu'une phrase de plus sous l'éditeur.
              action={
                <>
                  {dirty && (
                    <Badge tone="warning" title={t('ruleEditor.unsavedTitle')}>
                      {t('ruleEditor.unsavedTag')}
                    </Badge>
                  )}
                  {validated !== null &&
                    (validated ? (
                      <Badge tone="success">{t('ruleEditor.validTag')}</Badge>
                    ) : (
                      <Badge tone="danger">{tc('ruleEditor.errorCount', errors.length)}</Badge>
                    ))}
                </>
              }
            />
            <CardBody>
              {/* L'éditeur occupe la hauteur restante, mesurée et non budgétée : un avertissement
                  au-dessus de lui change la place disponible, et un `calc()` deviendrait faux. */}
              <div
                ref={editorBox}
                style={{ height: available }}
                className="flex min-h-72 flex-col gap-3"
              >
                <YamlEditor
                  value={yaml}
                  onChange={setYaml}
                  readOnly={!isAdmin}
                  label={t('ruleEditor.yamlLabel')}
                  errorLines={errorLines}
                  textareaRef={textarea}
                  fill
                />

                {located.length > 0 && (
                  <div className="border-danger bg-danger-subtle max-h-40 shrink-0 overflow-auto rounded-[var(--radius-control)] border-l-2 px-3 py-2">
                    <p className="text-ink font-medium">{t('ruleEditor.invalidTitle')}</p>
                    <ul className="mt-1 space-y-0.5">
                      {located.map((item, index) => (
                        <li key={index}>
                          {item.line === null ? (
                            <span className="text-ink text-meta">{item.message}</span>
                          ) : (
                            // L'erreur conduit à la ligne fautive : la lire ne suffit pas, il
                            // faut y aller.
                            <button
                              type="button"
                              onClick={() => goToLine(item.line!)}
                              title={t('ruleEditor.goToLine', { line: item.line })}
                              className="text-ink hover:bg-danger/10 flex w-full gap-2 rounded-[var(--radius-control)] px-1 py-0.5 text-left text-meta"
                            >
                              <span className="text-danger-strong shrink-0 font-semibold tabular-nums">
                                {t('ruleEditor.line', { line: item.line })}
                              </span>
                              <span className="min-w-0">{item.message}</span>
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </CardBody>
          </Card>

          <div className="min-w-0 space-y-4">
            <Card>
              <CardHeader
                title={t('ruleEditor.dryRunTitle')}
                description={t('ruleEditor.dryRunHint')}
                action={dryRunAt && <LastUpdated at={dryRunAt} />}
              />
              <CardBody className="space-y-3">
                {connections.length === 0 ? (
                  <EmptyState
                    icon={<ServerOff className="size-6" aria-hidden />}
                    title={t('ruleEditor.noInstance')}
                    description={t('ruleEditor.noInstanceBody')}
                    action={
                      isAdmin && (
                        <Button variant="primary" size="lg" onClick={() => navigate('/instances')}>
                          {t('ruleEditor.addInstance')}
                        </Button>
                      )
                    }
                  />
                ) : (
                  <>
                    {/* Cible et déclencheur sur une même ligne : le geste « choisir puis
                        exécuter » se lit de gauche à droite, et le bouton s'aligne sur le bas
                        de la liste déroulante. */}
                    <div className="flex flex-wrap items-end gap-3">
                      <Field label={t('ruleEditor.dryRunTarget')} className="min-w-48 flex-1">
                        <Select
                          value={dryRunInstance ?? ''}
                          onChange={(event) => setDryRunInstance(Number(event.target.value))}
                        >
                          {connections.map((connection) => (
                            <option key={connection.id} value={connection.id}>
                              {connection.name}
                            </option>
                          ))}
                        </Select>
                      </Field>

                      <Button
                        variant="primary"
                        className="shrink-0"
                        onClick={runDryRun}
                        loading={dryRunBusy}
                        disabled={validated === false}
                        aria-keyshortcuts={RUN_KEYS}
                      >
                        {t('ruleEditor.dryRunRun')}
                        <span className="opacity-70" aria-hidden>
                          {RUN_SHORTCUT}
                        </span>
                      </Button>
                    </div>

                    {dryRun ? (
                      <DryRunPanel result={dryRun} t={t} tc={tc} />
                    ) : (
                      <EmptyState
                        icon={<FlaskConical className="size-6" aria-hidden />}
                        title={t('ruleEditor.dryRunPending')}
                        description={t('ruleEditor.dryRunPendingHint')}
                      />
                    )}
                  </>
                )}
              </CardBody>
            </Card>

            {detail && detail.applicability.length > 0 && (
              <Card>
                <CardHeader
                  title={t('ruleEditor.applicability')}
                  description={t('ruleEditor.applicabilityHint')}
                />
                <CardBody>
                  <ul className="space-y-1.5">
                    {detail.applicability.map((entry) => (
                      <li key={entry.connectionId} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {entry.applicable ? (
                          <Badge tone="success">{t('ruleEditor.applicableTag')}</Badge>
                        ) : (
                          <Badge tone="warning">{t('ruleEditor.skippedTag')}</Badge>
                        )}
                        <span className="text-ink">{entry.connectionName}</span>
                        {entry.reason && <span className="text-ink-muted text-meta">{entry.reason}</span>}
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            )}
          </div>
        </div>

        {schema && <SchemaHelp schema={schema} />}

        {detail && isAdmin && (
          <OverridesCard detail={detail} connections={connections} onChanged={() => void load()} />
        )}
      </div>

      {confirmDelete && rule && (
        <ConfirmDialog
          title={t('ruleEditor.deleteTitle', { id: rule.id })}
          description={t('ruleEditor.deleteBody')}
          confirmLabel={t('ruleEditor.deleteConfirm')}
          onConfirm={remove}
          onCancel={() => setConfirmDelete(false)}
          busy={busy}
        />
      )}
    </Page>
  )
}

function ErrorList({ errors }: { errors: string[] }) {
  return (
    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-meta">
      {errors.map((error, index) => (
        <li key={index}>{error}</li>
      ))}
    </ul>
  )
}

function DryRunPanel({
  result,
  t,
  tc,
}: {
  result: DryRunResult
  t: Translator
  tc: PluralTranslator
}) {
  if (result.error) {
    return (
      <Notice tone="danger" title={t('ruleEditor.dryRunErrorTitle')}>
        {result.error}
      </Notice>
    )
  }

  if (result.skipReason) {
    return (
      <Notice tone="warning" title={t('ruleEditor.dryRunSkippedTitle')}>
        {result.skipReason}
      </Notice>
    )
  }

  const columns = result.rows[0] ? Object.keys(result.rows[0]) : []

  return (
    <div className="space-y-3">
      <Notice tone="success">
        {t('ruleEditor.dryRunSummary', {
          rows: tc('ruleEditor.dryRunRows', result.rowCount),
          ms: Math.round(result.durationMs),
          findings: tc('ruleEditor.dryRunFindings', result.findings.length),
        })}
      </Notice>

      {result.findings.length > 0 && (
        <FormSection title={t('ruleEditor.dryRunFindingsTitle')}>
          <ul className="space-y-2">
            {result.findings.map((finding, index) => (
              <li
                key={index}
                className="border-border-subtle rounded-[var(--radius-control)] border px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <SeverityBadge severity={finding.severity} />
                  <span className="text-ink font-medium">{finding.title}</span>
                  {finding.target && (
                    <code className="bg-surface-sunken text-ink-muted rounded px-1 font-mono text-meta">
                      {finding.target}
                    </code>
                  )}
                </div>
                <p className="text-ink-muted mt-1 text-meta">{finding.message}</p>
                {finding.remediationSql && (
                  <SqlCommand
                    sql={finding.remediationSql}
                    label={t('findings.detail.remediation')}
                    className="mt-1"
                  />
                )}
              </li>
            ))}
          </ul>
        </FormSection>
      )}

      {columns.length > 0 && (
        <FormSection title={t('ruleEditor.dryRunSqlTitle')}>
          {/* Le résultat brut défile dans son propre cadre : c'est ce qui permet de le comparer à
              la définition sans perdre l'éditeur de vue. */}
          <div className="border-border-subtle max-h-72 overflow-auto rounded-[var(--radius-control)] border">
            <Table>
              <THead>
                <Tr>
                  {columns.map((column) => (
                    <Th key={column} className="whitespace-nowrap normal-case">
                      {column}
                    </Th>
                  ))}
                </Tr>
              </THead>
              <TBody>
                {result.rows.map((row, index) => (
                  <Tr key={index}>
                    {columns.map((column) => (
                      <Td
                        key={column}
                        className="max-w-64 truncate font-mono"
                        title={row[column] === null || row[column] === undefined ? '' : String(row[column])}
                      >
                        {row[column] === null || row[column] === undefined ? '—' : String(row[column])}
                      </Td>
                    ))}
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        </FormSection>
      )}
    </div>
  )
}

/**
 * Aide-mémoire de la grammaire des règles. Déployé, il s'étale sur toute la largeur : les
 * listes de mots-clés se rangent alors en trois colonnes au lieu de s'empiler dans une
 * gouttière.
 */
function SchemaHelp({ schema }: { schema: RuleSchema }) {
  const t = useT()
  const [open, setOpen] = useState(false)

  return (
    <Card>
      <CardHeader
        title={t('ruleEditor.help')}
        description={!open ? t('ruleEditor.helpSummary') : undefined}
        action={
          <Button variant="ghost" onClick={() => setOpen((current) => !current)}>
            {open ? t('ruleEditor.helpHide') : t('ruleEditor.helpShow')}
          </Button>
        }
      />
      {open && (
        <CardBody>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
            <Help label={t('ruleEditor.helpCategories')} items={schema.categories.map(categoryLabel)} />
            <Help label={t('ruleEditor.helpGroups')} items={schema.groups} />
            <Help label={t('ruleEditor.helpFilters')} items={schema.filters} />
            <Help label={t('ruleEditor.helpFunctions')} items={schema.functions} />
            <Help label={t('ruleEditor.helpExtensions')} items={schema.notableExtensions} />
            <div className="min-w-0">
              <dt className="text-ink-muted mb-1 text-micro font-semibold tracking-wider uppercase">
                {t('ruleEditor.helpHandlers')}
              </dt>
              <dd className="space-y-1">
                {schema.handlers.map((handler) => (
                  <p key={handler.name} className="text-ink-muted text-meta">
                    <code className="bg-surface-sunken text-ink rounded px-1 font-mono">
                      {handler.name}
                    </code>{' '}
                    — {handler.description}
                  </p>
                ))}
              </dd>
            </div>
          </dl>
        </CardBody>
      )}
    </Card>
  )
}

function Help({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="min-w-0">
      <dt className="text-ink-muted mb-1 text-micro font-semibold tracking-wider uppercase">{label}</dt>
      <dd className="flex flex-wrap gap-1">
        {items.map((item) => (
          <code key={item} className="bg-surface-sunken text-ink rounded px-1 font-mono text-meta">
            {item}
          </code>
        ))}
      </dd>
    </div>
  )
}

function OverridesCard({
  detail,
  connections,
  onChanged,
}: {
  detail: RuleDetail
  connections: Connection[]
  onChanged: () => void
}) {
  const t = useT()
  const [target, setTarget] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const connectionId = target === '' ? null : Number(target)
  const existing = useMemo(
    () => detail.rule.overrides.find((item) => (item.connectionId ?? null) === connectionId),
    [detail.rule.overrides, connectionId],
  )

  const [enabled, setEnabled] = useState<string>('')
  const [severity, setSeverity] = useState<string>('')
  const [interval, setInterval] = useState<string>('')
  const [parameters, setParameters] = useState<Record<string, string>>({})

  // Recharge le formulaire lorsque la cible de surcharge change.
  useEffect(() => {
    setEnabled(existing?.enabled === undefined || existing?.enabled === null ? '' : String(existing.enabled))
    setSeverity(existing?.severity ?? '')
    setInterval(existing?.intervalSeconds ? String(existing.intervalSeconds) : '')
    setParameters(
      Object.fromEntries(
        Object.entries(existing?.parameters ?? {}).map(([key, value]) => [key, String(value)]),
      ),
    )
  }, [existing])

  const ruleParameters = Object.entries(detail.rule.parameters)

  async function save() {
    setBusy(true)
    setError(null)

    const normalized: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(parameters)) {
      if (value.trim() === '') continue
      const asNumber = Number(value)
      normalized[key] = Number.isFinite(asNumber) && value.trim() !== '' ? asNumber : value
    }

    try {
      await api.rules.saveOverride(detail.rule.id, {
        connectionId,
        enabled: enabled === '' ? null : enabled === 'true',
        severity: severity === '' ? null : (severity as Severity),
        intervalSeconds: interval === '' ? null : Number(interval),
        parameters: Object.keys(normalized).length > 0 ? normalized : null,
      })
      onChanged()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('ruleEditor.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await api.rules.deleteOverride(detail.rule.id, connectionId)
      onChanged()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('ruleEditor.deleteFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      {/* L'explication tient sur la ligne du titre : elle situe la carte sans ouvrir le
          formulaire par un paragraphe. */}
      <CardHeader title={t('ruleEditor.overrides')} description={t('ruleEditor.overridesHint')} />
      <CardBody className="space-y-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('ruleEditor.scope')} hint={t('ruleEditor.scopeHint')}>
            <Select value={target} onChange={(event) => setTarget(event.target.value)}>
              <option value="">{t('ruleEditor.allInstances')}</option>
              {connections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t('ruleEditor.activation')}>
            <Select value={enabled} onChange={(event) => setEnabled(event.target.value)}>
              <option value="">
                {t('ruleEditor.ruleValue', {
                  value: detail.rule.enabled ? t('rules.enabledTag') : t('rules.disabledTag'),
                })}
              </option>
              <option value="true">{t('ruleEditor.enabledOption')}</option>
              <option value="false">{t('ruleEditor.disabledOption')}</option>
            </Select>
          </Field>

          <Field label={t('common.severity')}>
            <Select value={severity} onChange={(event) => setSeverity(event.target.value)}>
              <option value="">
                {t('ruleEditor.ruleValue', { value: severityLabel(detail.rule.severity) })}
              </option>
              <option value="info">{t('severity.info')}</option>
              <option value="warning">{t('severity.warning')}</option>
              <option value="critical">{t('severity.critical')}</option>
            </Select>
          </Field>

          <Field label={t('ruleEditor.interval')} hint={t('ruleEditor.intervalHint')}>
            <Input
              type="number"
              min={5}
              max={86400}
              value={interval}
              onChange={(event) => setInterval(event.target.value)}
            />
          </Field>
        </div>

        {ruleParameters.length > 0 && (
          <FormSection title={t('ruleEditor.thresholds')}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {ruleParameters.map(([key, value]) => (
                <Field
                  key={key}
                  label={key}
                  hint={t('ruleEditor.thresholdDefault', { value: String(value) })}
                >
                  <Input
                    value={parameters[key] ?? ''}
                    placeholder={String(value)}
                    onChange={(event) =>
                      setParameters((current) => ({ ...current, [key]: event.target.value }))
                    }
                  />
                </Field>
              ))}
            </div>
          </FormSection>
        )}

        {error && <Notice tone="danger">{error}</Notice>}

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="lg" onClick={save} loading={busy}>
            {t('ruleEditor.saveOverride')}
          </Button>
          {existing && (
            <Button onClick={remove} disabled={busy}>
              {t('ruleEditor.deleteOverride')}
            </Button>
          )}
        </div>

        {detail.rule.overrides.length > 0 && (
          <FormSection title={t('ruleEditor.savedOverrides')}>
            {/* Chaque surcharge enregistrée ramène le formulaire sur sa portée : la liste
                cesse d'être un simple relevé qu'il fallait recopier dans le sélecteur. */}
            <ul className="space-y-1">
              {detail.rule.overrides.map((item) => {
                const scope = item.connectionName ?? t('ruleEditor.allInstances')
                const value = item.connectionId === null ? '' : String(item.connectionId)
                const active = value === target

                return (
                  <li key={item.connectionId ?? 'global'}>
                    <button
                      type="button"
                      onClick={() => setTarget(value)}
                      aria-pressed={active}
                      title={t('ruleEditor.editOverride', { scope })}
                      className={cn(
                        'flex min-h-8 w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--radius-control)] px-2 py-1 text-left transition-colors',
                        active ? 'bg-brand-subtle' : 'hover:bg-surface-sunken',
                      )}
                    >
                      <Badge tone="info">{scope}</Badge>
                      {item.enabled !== null && (
                        <span className="text-ink-muted text-meta">
                          {item.enabled ? t('rules.enabledTag') : t('rules.disabledTag')}
                        </span>
                      )}
                      {item.severity && (
                        <span className="text-ink-muted text-meta">
                          {t('ruleEditor.overrideSeverity', { severity: severityLabel(item.severity) })}
                        </span>
                      )}
                      {item.intervalSeconds && (
                        <span className="text-ink-muted text-meta">
                          {t('ruleEditor.overrideInterval', { seconds: item.intervalSeconds })}
                        </span>
                      )}
                      {Object.keys(item.parameters).length > 0 && (
                        <span className="text-ink-muted font-mono text-meta">
                          {Object.entries(item.parameters)
                            .map(([key, parameter]) => `${key}=${String(parameter)}`)
                            .join(', ')}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </FormSection>
        )}
      </CardBody>
    </Card>
  )
}
