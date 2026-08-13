import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import type { Connection, TestConnectionResult } from '../api/types'
import { useAuth } from '../app/AuthContext'
import { useEventListener } from '../app/EventsContext'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  TableScroll,
  Tag,
} from '../components/ui'
import { collectionStateLabel, formatDateTime, formatRelative } from '../lib/format'

interface FormState {
  id: number | null
  name: string
  host: string
  port: number
  database: string
  username: string
  password: string
  sslMode: string
  collectionIntervalSeconds: number
  enabled: boolean
}

const EMPTY_FORM: FormState = {
  id: null,
  name: '',
  host: '',
  port: 5432,
  database: 'postgres',
  username: '',
  password: '',
  sslMode: 'Prefer',
  collectionIntervalSeconds: 0,
  enabled: true,
}

const SSL_MODES = ['Disable', 'Allow', 'Prefer', 'Require', 'VerifyCA', 'VerifyFull']

function toForm(connection: Connection): FormState {
  return {
    id: connection.id,
    name: connection.name,
    host: connection.host,
    port: connection.port,
    database: connection.database,
    username: connection.username,
    password: '',
    sslMode: connection.sslMode,
    collectionIntervalSeconds: connection.collectionIntervalSeconds,
    enabled: connection.enabled,
  }
}

function StateTag({ connection }: { connection: Connection }) {
  if (!connection.enabled) {
    return <Tag>désactivée</Tag>
  }

  const tone =
    connection.collectionState === 'error'
      ? 'bad'
      : connection.collectionState === 'idle'
        ? 'good'
        : 'accent'

  return <Tag tone={tone}>{collectionStateLabel(connection.collectionState)}</Tag>
}

export function InstancesPage() {
  const { isAdmin } = useAuth()
  const [connections, setConnections] = useState<Connection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Connection | null>(null)

  const load = useCallback(async () => {
    try {
      setConnections(await api.connections.list())
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

  useEventListener(['collection.state', 'instance.changed', 'health.changed'], () => void load())

  return (
    <div className="space-y-5">
      <PageHeader
        title="Instances PostgreSQL"
        subtitle="Chaque instance est supervisée en lecture seule et notée indépendamment."
        actions={
          isAdmin && (
            <Button variant="primary" onClick={() => setForm(EMPTY_FORM)}>
              Ajouter une instance
            </Button>
          )
        }
      />

      <Card title={`${connections.length} instance${connections.length > 1 ? 's' : ''}`} padded={false}>
        {error && (
          <div className="p-4">
            <Alert title="Erreur">{error}</Alert>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="size-6" />
          </div>
        ) : connections.length === 0 ? (
          <div className="p-4">
            <EmptyState title="Aucune instance supervisée">
              Ajoutez une connexion en lecture seule. L'Advisor ne modifie jamais l'instance
              PostgreSQL : la session est forcée en lecture seule.
            </EmptyState>
          </div>
        ) : (
          <>
            {/* Tableau à partir de md ; en dessous, une liste de cartes reste lisible sans
                défilement horizontal. */}
            <div className="hidden md:block">
              <TableScroll minWidth={860}>
                <table className="w-full text-sm">
                  <thead className="bg-surface-sunken text-left text-xs uppercase tracking-wide text-ink-muted">
                    <tr>
                      <th className="px-4 py-2 font-medium">Nom</th>
                      <th className="px-4 py-2 font-medium">Cible</th>
                      <th className="px-4 py-2 font-medium">Version</th>
                      <th className="px-4 py-2 font-medium">État</th>
                      <th className="px-4 py-2 font-medium whitespace-nowrap">Dernière collecte</th>
                      <th className="px-4 py-2 font-medium">Santé</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {connections.map((connection) => (
                      <tr key={connection.id} className="align-top hover:bg-surface-sunken">
                        <td className="px-4 py-2.5">
                          <Link
                            to={`/instances/${connection.id}`}
                            className="font-medium text-ink hover:text-brand hover:underline"
                          >
                            {connection.name}
                          </Link>
                          <p className="text-xs text-ink-muted">{connection.username}</p>
                        </td>
                        <td className="px-4 py-2.5 text-ink-muted">
                          <span className="whitespace-nowrap">
                            {connection.host}:{connection.port}
                          </span>
                          <p className="text-xs text-ink-muted">{connection.database}</p>
                        </td>
                        <td className="px-4 py-2.5 text-ink-muted">
                          <span className="whitespace-nowrap">{connection.serverVersion ?? '—'}</span>
                          {connection.timescaleVersion && (
                            <p className="whitespace-nowrap text-xs text-ink-muted">
                              TimescaleDB {connection.timescaleVersion}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <StateTag connection={connection} />
                          {connection.lastError && (
                            <p
                              className="mt-1 line-clamp-2 max-w-56 text-xs text-danger"
                              title={connection.lastError}
                            >
                              {connection.lastError}
                            </p>
                          )}
                        </td>
                        <td
                          className="whitespace-nowrap px-4 py-2.5 text-ink-muted"
                          title={formatDateTime(connection.lastCollectedAt)}
                        >
                          {formatRelative(connection.lastCollectedAt)}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="whitespace-nowrap font-semibold tabular-nums text-ink">
                            {connection.health ? `${connection.health.global}/100` : '—'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {isAdmin && (
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" onClick={() => setForm(toForm(connection))}>
                                Modifier
                              </Button>
                              <Button variant="ghost" onClick={() => setConfirmDelete(connection)}>
                                Supprimer
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </div>

            <ul className="divide-y divide-border-subtle md:hidden">
              {connections.map((connection) => (
                <li key={connection.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        to={`/instances/${connection.id}`}
                        className="block truncate font-medium text-ink"
                      >
                        {connection.name}
                      </Link>
                      <p className="truncate text-xs text-ink-muted">
                        {connection.host}:{connection.port} · {connection.database}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                      {connection.health ? `${connection.health.global}/100` : '—'}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <StateTag connection={connection} />
                    {connection.serverVersion && <Tag>PostgreSQL {connection.serverVersion}</Tag>}
                    {connection.timescaleVersion && (
                      <Tag tone="accent">TimescaleDB {connection.timescaleVersion}</Tag>
                    )}
                  </div>

                  <p className="mt-2 text-xs text-ink-muted">
                    Collecte {formatRelative(connection.lastCollectedAt)}
                  </p>

                  {connection.lastError && (
                    <p className="mt-1 line-clamp-2 text-xs text-danger">{connection.lastError}</p>
                  )}

                  {isAdmin && (
                    <div className="mt-2 flex gap-2">
                      <Button onClick={() => setForm(toForm(connection))}>Modifier</Button>
                      <Button onClick={() => setConfirmDelete(connection)}>Supprimer</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {form && (
        <ConnectionForm
          initial={form}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null)
            void load()
          }}
        />
      )}

      {confirmDelete && (
        <Modal
          title={`Supprimer « ${confirmDelete.name} » ?`}
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <Button onClick={() => setConfirmDelete(null)}>Annuler</Button>
              <Button
                variant="danger"
                onClick={async () => {
                  await api.connections.remove(confirmDelete.id)
                  setConfirmDelete(null)
                  void load()
                }}
              >
                Supprimer
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink">
            L'instance PostgreSQL n'est pas touchée : seuls la connexion enregistrée, ses findings et
            son historique sont supprimés de l'Advisor.
          </p>
        </Modal>
      )}
    </div>
  )
}

function ConnectionForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: FormState
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<string[]>([])
  const [test, setTest] = useState<TestConnectionResult | null>(null)
  const editing = initial.id !== null

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setTest(null)
  }

  async function runTest() {
    setBusy(true)
    setError(null)
    setDetails([])

    try {
      setTest(
        await api.connections.test({
          host: form.host,
          port: form.port,
          database: form.database,
          username: form.username,
          password: form.password || null,
          sslMode: form.sslMode,
          connectionId: form.id,
        }),
      )
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Test impossible.')
    } finally {
      setBusy(false)
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setDetails([])

    const body = {
      name: form.name,
      host: form.host,
      port: form.port,
      database: form.database,
      username: form.username,
      sslMode: form.sslMode,
      collectionIntervalSeconds: form.collectionIntervalSeconds,
      enabled: form.enabled,
      password: form.password || undefined,
    }

    try {
      if (form.id === null) {
        await api.connections.create({ ...body, password: form.password })
      } else {
        await api.connections.update(form.id, body)
      }
      onSaved()
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.message)
        setDetails(cause.details ?? [])
      } else {
        setError('Enregistrement impossible.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={editing ? `Modifier « ${initial.name} »` : 'Ajouter une instance PostgreSQL'}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button onClick={runTest} disabled={busy || !form.host || !form.username}>
            {busy && <Spinner />} Tester la connexion
          </Button>
          <Button form="connection-form" type="submit" variant="primary" disabled={busy}>
            Enregistrer
          </Button>
        </>
      }
    >
      <form id="connection-form" onSubmit={save} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nom" hint="Libellé affiché dans le dashboard">
            <Input
              value={form.name}
              required
              maxLength={128}
              onChange={(event) => update('name', event.target.value)}
            />
          </Field>

          <Field label="Base de données">
            <Input
              value={form.database}
              required
              onChange={(event) => update('database', event.target.value)}
            />
          </Field>

          <Field label="Hôte">
            <Input
              value={form.host}
              required
              placeholder="db.exemple.local"
              onChange={(event) => update('host', event.target.value)}
            />
          </Field>

          <Field label="Port">
            <Input
              type="number"
              min={1}
              max={65535}
              value={form.port}
              required
              onChange={(event) => update('port', Number(event.target.value))}
            />
          </Field>

          <Field label="Utilisateur" hint="Un rôle en lecture, membre de pg_monitor si possible">
            <Input
              value={form.username}
              required
              onChange={(event) => update('username', event.target.value)}
            />
          </Field>

          <Field
            label="Mot de passe"
            hint={editing ? 'Laisser vide pour conserver le mot de passe enregistré' : undefined}
          >
            <Input
              type="password"
              value={form.password}
              required={!editing}
              autoComplete="new-password"
              onChange={(event) => update('password', event.target.value)}
            />
          </Field>

          <Field label="Mode SSL">
            <Select value={form.sslMode} onChange={(event) => update('sslMode', event.target.value)}>
              {SSL_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Intervalle de collecte (s)"
            hint="0 pour suivre la périodicité globale du scheduler"
          >
            <Input
              type="number"
              min={0}
              max={86400}
              value={form.collectionIntervalSeconds}
              onChange={(event) => update('collectionIntervalSeconds', Number(event.target.value))}
            />
          </Field>
        </div>

        <Checkbox
          label="Instance active"
          checked={form.enabled}
          onChange={(event) => update('enabled', event.target.checked)}
        />

        {error && (
          <Alert title={error}>
            {details.length > 0 && (
              <ul className="mt-1 list-disc pl-4 text-xs">
                {details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            )}
          </Alert>
        )}

        {test && <TestResult result={test} />}
      </form>
    </Modal>
  )
}

function TestResult({ result }: { result: TestConnectionResult }) {
  if (!result.success) {
    return <Alert title="Connexion impossible">{result.error}</Alert>
  }

  const available = result.capabilities.filter((capability) => capability.available)
  const missing = result.capabilities.filter((capability) => !capability.available)

  return (
    <div className="space-y-3">
      <Alert tone="success" title={`Connexion établie — PostgreSQL ${result.serverVersion}`}>
        {result.timescaleVersion && <p className="text-xs">TimescaleDB {result.timescaleVersion}</p>}
        <p className="text-xs">
          Session en lecture seule : {result.readOnlyEnforced ? 'confirmée' : 'non confirmée'}
        </p>
      </Alert>

      {result.warnings.map((warning) => (
        <Alert key={warning} tone="warning">
          {warning}
        </Alert>
      ))}

      <div className="grid gap-3 sm:grid-cols-2">
        <CapabilityList title={`Disponible (${available.length})`} items={available.map((c) => c.name)} available />
        <CapabilityList title={`Absent (${missing.length})`} items={missing.map((c) => c.name)} available={false} />
      </div>
    </div>
  )
}

function CapabilityList({
  title,
  items,
  available,
}: {
  title: string
  items: string[]
  available: boolean
}) {
  return (
    <div className="rounded-md border border-border-subtle p-3">
      <p className="mb-1.5 text-xs font-semibold text-ink-muted">{title}</p>
      <ul className="max-h-40 space-y-0.5 overflow-y-auto font-mono text-xs">
        {items.length === 0 && <li className="text-ink-faint">—</li>}
        {items.map((item) => (
          <li key={item} className={available ? 'text-success' : 'text-ink-faint'}>
            {available ? '✓' : '✗'} {item}
          </li>
        ))}
      </ul>
    </div>
  )
}
