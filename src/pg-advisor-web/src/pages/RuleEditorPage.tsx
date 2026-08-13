import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import type {
  Connection,
  DryRunResult,
  RuleDetail,
  RuleSchema,
  Severity,
} from '../api/types'
import { useAuth } from '../app/AuthContext'
import {
  Alert,
  Button,
  Card,
  CodeBlock,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  SeverityBadge,
  Spinner,
  Tag,
} from '../components/ui'
import { categoryLabel } from '../lib/format'
import { YamlEditor } from '../lib/yamlHighlight'

export function RuleEditorPage() {
  const { id } = useParams<{ id: string }>()
  const creating = id === undefined
  const navigate = useNavigate()
  const { isAdmin } = useAuth()

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

  const [dryRunInstance, setDryRunInstance] = useState<number | null>(null)
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null)
  const [dryRunBusy, setDryRunBusy] = useState(false)

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
      setFailure(cause instanceof Error ? cause.message : 'Chargement impossible.')
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

  async function save() {
    setBusy(true)
    setFailure(null)
    setNotice(null)

    try {
      const saved = creating ? await api.rules.create(yaml) : await api.rules.update(id!, yaml)
      setDetail(saved)
      setYaml(saved.yaml)
      setNotice(`Règle « ${saved.rule.id} » enregistrée et rechargée.`)

      if (creating) {
        navigate(`/rules/${encodeURIComponent(saved.rule.id)}`, { replace: true })
      }
    } catch (cause) {
      if (cause instanceof ApiError) {
        setFailure(cause.message)
        setErrors(cause.details ?? [])
      } else {
        setFailure('Enregistrement impossible.')
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
      setFailure(cause instanceof ApiError ? cause.message : 'Suppression impossible.')
    } finally {
      setBusy(false)
    }
  }

  async function runDryRun() {
    if (dryRunInstance === null) return

    setDryRunBusy(true)
    setDryRun(null)

    try {
      setDryRun(await api.rules.dryRun(detail?.rule.id ?? 'nouvelle-regle', dryRunInstance, yaml))
    } catch (cause) {
      if (cause instanceof ApiError) {
        setFailure(cause.message)
        setErrors(cause.details ?? [])
      } else {
        setFailure('Aperçu impossible.')
      }
    } finally {
      setDryRunBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="size-6" />
      </div>
    )
  }

  const rule = detail?.rule

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={
          <>
            <Link to="/rules" className="hover:underline">
              Règles
            </Link>{' '}
            / {creating ? 'nouvelle règle' : rule?.id}
          </>
        }
        title={creating ? 'Nouvelle règle' : (rule?.name ?? rule?.id ?? '')}
        meta={
          rule && (
            <>
              <SeverityBadge severity={rule.severity} />
              <Tag tone="accent">{categoryLabel(rule.category)}</Tag>
              <Tag>groupe {rule.group}</Tag>
              <Tag>version {rule.version}</Tag>
              {rule.origin === 'user' ? <Tag tone="accent">personnalisée</Tag> : <Tag>intégrée</Tag>}
              <span className="truncate font-mono text-xs text-ink-muted">{rule.file}</span>
            </>
          )
        }
        actions={
          isAdmin && (
            <>
              {!creating && rule?.origin === 'user' && (
                <Button variant="danger" onClick={remove} disabled={busy}>
                  Supprimer
                </Button>
              )}
              <Button variant="primary" onClick={save} disabled={busy || validated === false}>
                {busy && <Spinner />} Enregistrer
              </Button>
            </>
          )
        }
      />

      {failure && <Alert title={failure}>{errors.length > 0 && <ErrorList errors={errors} />}</Alert>}
      {notice && (
        <Alert tone="success" onDismiss={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      {!creating && rule && rule.origin === 'provided' && (
        <Alert tone="info" title="Règle intégrée à l'application">
          L'enregistrement ne modifie pas le fichier livré : il crée une version personnalisée dans le
          volume de données qui la remplace. Supprimer cette version rétablira la règle d'origine.
        </Alert>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card
          title="Définition YAML"
          className="xl:col-span-2"
          actions={
            validated === null ? null : validated ? (
              <Tag tone="good">valide</Tag>
            ) : (
              <Tag tone="bad">{errors.length} erreur(s)</Tag>
            )
          }
        >
          <YamlEditor
            value={yaml}
            onChange={setYaml}
            readOnly={!isAdmin}
            rows={28}
            label="Définition YAML de la règle"
          />

          {dirty && <p className="mt-2 text-xs text-warning">Modifications non enregistrées.</p>}

          {errors.length > 0 && (
            <div className="mt-3">
              <Alert title="La règle n'est pas valide">
                <ErrorList errors={errors} />
              </Alert>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Aperçu sur une instance">
            {connections.length === 0 ? (
              <EmptyState title="Aucune instance">
                Ajoutez une connexion pour tester une règle.
              </EmptyState>
            ) : (
              <>
                <Field label="Instance cible">
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
                  className="mt-3 w-full"
                  onClick={runDryRun}
                  disabled={dryRunBusy || validated === false}
                >
                  {dryRunBusy && <Spinner />} Exécuter sans enregistrer
                </Button>

                <p className="mt-2 text-xs text-ink-muted">
                  La requête est exécutée en lecture seule sur l'instance choisie. Aucun finding n'est
                  créé.
                </p>

                {dryRun && <DryRunPanel result={dryRun} />}
              </>
            )}
          </Card>

          {detail && detail.applicability.length > 0 && (
            <Card title="Applicabilité">
              <ul className="space-y-1.5 text-sm">
                {detail.applicability.map((entry) => (
                  <li key={entry.connectionId} className="flex flex-wrap items-center gap-2">
                    {entry.applicable ? <Tag tone="good">applicable</Tag> : <Tag tone="warn">ignorée</Tag>}
                    <span className="text-ink">{entry.connectionName}</span>
                    {entry.reason && <span className="text-xs text-ink-muted">{entry.reason}</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {schema && <SchemaHelp schema={schema} />}
        </div>
      </div>

      {detail && isAdmin && (
        <OverridesCard
          detail={detail}
          connections={connections}
          onChanged={() => void load()}
        />
      )}
    </div>
  )
}

function ErrorList({ errors }: { errors: string[] }) {
  return (
    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
      {errors.map((error, index) => (
        <li key={index}>{error}</li>
      ))}
    </ul>
  )
}

function DryRunPanel({ result }: { result: DryRunResult }) {
  if (result.error) {
    return (
      <div className="mt-3">
        <Alert title="Exécution en échec">{result.error}</Alert>
      </div>
    )
  }

  if (result.skipReason) {
    return (
      <div className="mt-3">
        <Alert tone="warning" title="Règle non applicable">
          {result.skipReason}
        </Alert>
      </div>
    )
  }

  const columns = result.rows[0] ? Object.keys(result.rows[0]) : []

  return (
    <div className="mt-3 space-y-3">
      <Alert tone="success">
        {result.rowCount} ligne(s) retournée(s) en {Math.round(result.durationMs)} ms —{' '}
        {result.findings.length} finding(s) produit(s).
      </Alert>

      {result.findings.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold text-ink-muted">Findings</p>
          <ul className="space-y-2">
            {result.findings.map((finding, index) => (
              <li key={index} className="rounded-md border border-border-subtle p-2">
                <div className="flex items-center gap-2">
                  <SeverityBadge severity={finding.severity} />
                  <span className="text-sm font-medium text-ink">{finding.title}</span>
                </div>
                <p className="mt-0.5 text-xs text-ink-muted">{finding.message}</p>
                {finding.target && (
                  <p className="mt-0.5 font-mono text-xs text-ink-muted">{finding.target}</p>
                )}
                {finding.remediationSql && (
                  <CodeBlock className="mt-1.5">{finding.remediationSql}</CodeBlock>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {columns.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold text-ink-muted">Résultat SQL</p>
          <div className="max-h-64 overflow-auto rounded-md border border-border-subtle">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface-sunken text-left">
                <tr>
                  {columns.map((column) => (
                    <th key={column} className="whitespace-nowrap px-2 py-1 font-medium text-ink-muted">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {result.rows.map((row, index) => (
                  <tr key={index}>
                    {columns.map((column) => (
                      <td key={column} className="max-w-64 truncate px-2 py-1 font-mono text-ink">
                        {row[column] === null || row[column] === undefined
                          ? '—'
                          : String(row[column])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function SchemaHelp({ schema }: { schema: RuleSchema }) {
  const [open, setOpen] = useState(false)

  return (
    <Card
      title="Aide-mémoire"
      actions={
        <Button variant="ghost" onClick={() => setOpen((current) => !current)}>
          {open ? 'Réduire' : 'Afficher'}
        </Button>
      }
    >
      {open ? (
        <dl className="space-y-3 text-xs">
          <Help label="Catégories" items={schema.categories.map(categoryLabel)} />
          <Help label="Groupes de périodicité" items={schema.groups} />
          <Help label="Filtres de message" items={schema.filters} />
          <Help label="Fonctions de condition" items={schema.functions} />
          <Help label="Extensions reconnues" items={schema.notableExtensions} />
          <div>
            <dt className="mb-1 font-semibold text-ink-muted">Handlers internes</dt>
            <dd className="space-y-1">
              {schema.handlers.map((handler) => (
                <p key={handler.name} className="text-ink-muted">
                  <code className="rounded bg-surface-sunken px-1">{handler.name}</code> —{' '}
                  {handler.description}
                </p>
              ))}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="text-xs text-ink-muted">
          Catégories, groupes, filtres de message, fonctions disponibles dans les conditions et
          handlers internes.
        </p>
      )}
    </Card>
  )
}

function Help({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <dt className="mb-1 font-semibold text-ink-muted">{label}</dt>
      <dd className="flex flex-wrap gap-1">
        {items.map((item) => (
          <code key={item} className="rounded bg-surface-sunken px-1 text-ink">
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
      setError(cause instanceof ApiError ? cause.message : 'Enregistrement impossible.')
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
      setError(cause instanceof ApiError ? cause.message : 'Suppression impossible.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Surcharges">
      <p className="mb-3 text-xs text-ink-muted">
        Une surcharge n'écrit pas dans le fichier : elle ajuste l'activation, la sévérité, la
        périodicité ou les seuils, globalement ou pour une seule instance.
      </p>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Portée">
          <Select value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="">Toutes les instances</option>
            {connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Activation">
          <Select value={enabled} onChange={(event) => setEnabled(event.target.value)}>
            <option value="">Valeur de la règle ({detail.rule.enabled ? 'activée' : 'désactivée'})</option>
            <option value="true">Activée</option>
            <option value="false">Désactivée</option>
          </Select>
        </Field>

        <Field label="Sévérité">
          <Select value={severity} onChange={(event) => setSeverity(event.target.value)}>
            <option value="">Valeur de la règle ({detail.rule.severity})</option>
            <option value="info">Information</option>
            <option value="warning">Avertissement</option>
            <option value="critical">Critique</option>
          </Select>
        </Field>

        <Field label="Périodicité (s)" hint="Vide = périodicité du groupe">
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
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-semibold text-ink-muted">Seuils</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {ruleParameters.map(([key, value]) => (
              <Field key={key} label={key} hint={`défaut : ${String(value)}`}>
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
        </div>
      )}

      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" onClick={save} disabled={busy}>
          {busy && <Spinner />} Enregistrer la surcharge
        </Button>
        {existing && (
          <Button onClick={remove} disabled={busy}>
            Supprimer cette surcharge
          </Button>
        )}
      </div>

      {detail.rule.overrides.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-semibold text-ink-muted">Surcharges enregistrées</p>
          <ul className="space-y-1 text-xs text-ink-muted">
            {detail.rule.overrides.map((item) => (
              <li key={item.connectionId ?? 'global'} className="flex flex-wrap gap-2">
                <Tag tone="accent">{item.connectionName ?? 'toutes les instances'}</Tag>
                {item.enabled !== null && <span>{item.enabled ? 'activée' : 'désactivée'}</span>}
                {item.severity && <span>sévérité {item.severity}</span>}
                {item.intervalSeconds && <span>toutes les {item.intervalSeconds} s</span>}
                {Object.keys(item.parameters).length > 0 && (
                  <span className="font-mono">
                    {Object.entries(item.parameters)
                      .map(([key, value]) => `${key}=${String(value)}`)
                      .join(', ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
