import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Database } from 'lucide-react'
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
  FormSection,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  TableScroll,
  Tag,
} from '../components/ui'
import { collectionStateLabel, formatDateTime, formatRelative } from '../lib/format'
import { tr, useT, useTc } from '../lib/i18n'
import type { Translator } from '../lib/i18n'

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

function StateTag({ connection, t }: { connection: Connection; t: Translator }) {
  if (!connection.enabled) {
    return <Tag>{t('instances.disabledBadge')}</Tag>
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
  const t = useT()
  const tc = useTc()
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
      setError(cause instanceof Error ? cause.message : tr('common.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEventListener(['collection.state', 'instance.changed', 'health.changed'], () => void load())

  const addButton = isAdmin && (
    <Button variant="primary" onClick={() => setForm(EMPTY_FORM)}>
      {t('instances.add')}
    </Button>
  )

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('nav.instances')}
        subtitle={t('instances.subtitle')}
        actions={addButton}
      />

      <Card title={tc('instances.count', connections.length)} padded={false}>
        {error && (
          <div className="p-4">
            <Alert title={t('common.error')}>{error}</Alert>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="size-6" />
          </div>
        ) : connections.length === 0 ? (
          <EmptyState
            title={t('instances.empty.title')}
            icon={<Database className="size-6" aria-hidden />}
            action={addButton}
          >
            {t('instances.empty.body')}
          </EmptyState>
        ) : (
          <>
            {/* Tableau à partir de md ; en dessous, une liste de cartes reste lisible sans
                défilement horizontal. */}
            <div className="hidden md:block">
              <TableScroll minWidth={860}>
                <table className="w-full text-sm">
                  <thead className="bg-surface-sunken text-left text-xs uppercase tracking-wide text-ink-muted">
                    <tr>
                      <th className="px-4 py-2 font-medium">{t('common.name')}</th>
                      <th className="px-4 py-2 font-medium">{t('instances.column.target')}</th>
                      <th className="px-4 py-2 font-medium">{t('instanceDetail.version')}</th>
                      <th className="px-4 py-2 font-medium">{t('common.state')}</th>
                      <th className="px-4 py-2 font-medium whitespace-nowrap">
                        {t('instances.column.lastCollection')}
                      </th>
                      <th className="px-4 py-2 text-right font-medium">
                        {t('instanceDetail.health')}
                      </th>
                      <th className="px-4 py-2">
                        <span className="sr-only">{t('common.actions')}</span>
                      </th>
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
                        </td>
                        <td className="px-4 py-2.5">
                          <StateTag connection={connection} t={t} />
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
                        {/* Les scores se comparent d'une ligne à l'autre : alignés à droite,
                            en chiffres de largeur fixe. */}
                        <td className="px-4 py-2.5 text-right">
                          <span className="whitespace-nowrap font-semibold tabular-nums text-ink">
                            {connection.health ? `${connection.health.global}/100` : '—'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {isAdmin && (
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" onClick={() => setForm(toForm(connection))}>
                                {t('common.edit')}
                              </Button>
                              <Button
                                variant="ghost"
                                className="text-danger hover:text-danger"
                                onClick={() => setConfirmDelete(connection)}
                              >
                                {t('common.delete')}
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

                  {/* État, version et date de collecte sur une même ligne d'étiquettes : trois
                      informations courtes n'ont pas besoin de trois lignes. */}
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                    <StateTag connection={connection} t={t} />
                    {connection.serverVersion && <Tag>PostgreSQL {connection.serverVersion}</Tag>}
                    <span className="text-xs text-ink-muted">
                      {t('instances.collectedAt', {
                        when: formatRelative(connection.lastCollectedAt),
                      })}
                    </span>
                  </div>

                  {connection.lastError && (
                    <p className="mt-1.5 line-clamp-2 text-xs text-danger">{connection.lastError}</p>
                  )}

                  {isAdmin && (
                    <div className="mt-2 flex gap-2">
                      <Button onClick={() => setForm(toForm(connection))}>{t('common.edit')}</Button>
                      <Button
                        className="text-danger hover:text-danger"
                        onClick={() => setConfirmDelete(connection)}
                      >
                        {t('common.delete')}
                      </Button>
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
          title={t('instances.delete.title', { name: confirmDelete.name })}
          onClose={() => setConfirmDelete(null)}
          size="sm"
          footer={
            <>
              <Button onClick={() => setConfirmDelete(null)}>{t('common.cancel')}</Button>
              <Button
                variant="danger"
                onClick={async () => {
                  await api.connections.remove(confirmDelete.id)
                  setConfirmDelete(null)
                  void load()
                }}
              >
                {t('common.delete')}
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink">{t('instances.delete.body')}</p>
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
  const t = useT()
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
      setError(cause instanceof ApiError ? cause.message : t('instances.form.testFailed'))
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
        setError(t('instances.form.saveFailed'))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={
        editing ? t('instances.form.editTitle', { name: initial.name }) : t('instances.form.addTitle')
      }
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={runTest} disabled={busy || !form.host || !form.username}>
            {busy && <Spinner />} {t('instances.form.test')}
          </Button>
          <Button form="connection-form" type="submit" variant="primary" disabled={busy}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      {/* Trois ensembles au lieu d'une grille de huit champs : la cible, l'identification, puis
          le rythme de collecte. Chacun tient sur une ou deux lignes. */}
      <form id="connection-form" onSubmit={save} className="space-y-5">
        <FormSection
          title={t('instances.form.target')}
          action={
            <Checkbox
              label={t('instances.form.enabled')}
              checked={form.enabled}
              onChange={(event) => update('enabled', event.target.checked)}
            />
          }
        >
          <Field label={t('common.name')} hint={t('instances.form.nameHint')}>
            <Input
              value={form.name}
              required
              maxLength={128}
              onChange={(event) => update('name', event.target.value)}
            />
          </Field>

          {/* L'hôte prend la place que son contenu réclame ; le port et la base gardent la
              leur, plus courte. */}
          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)]">
            <Field label={t('instances.form.host')}>
              <Input
                value={form.host}
                required
                placeholder={t('instances.form.hostPlaceholder')}
                onChange={(event) => update('host', event.target.value)}
              />
            </Field>

            <Field label={t('instances.form.port')}>
              <Input
                type="number"
                min={1}
                max={65535}
                value={form.port}
                required
                onChange={(event) => update('port', Number(event.target.value))}
              />
            </Field>

            <Field label={t('instances.form.database')}>
              <Input
                value={form.database}
                required
                onChange={(event) => update('database', event.target.value)}
              />
            </Field>
          </div>
        </FormSection>

        <FormSection title={t('instances.form.authentication')}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('instances.form.username')} hint={t('instances.form.usernameHint')}>
              <Input
                value={form.username}
                required
                onChange={(event) => update('username', event.target.value)}
              />
            </Field>

            <Field
              label={t('instances.form.password')}
              hint={editing ? t('instances.form.passwordHint') : undefined}
            >
              <Input
                type="password"
                value={form.password}
                required={!editing}
                autoComplete="new-password"
                onChange={(event) => update('password', event.target.value)}
              />
            </Field>

            <Field label={t('instanceDetail.sslMode')}>
              <Select value={form.sslMode} onChange={(event) => update('sslMode', event.target.value)}>
                {SSL_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </FormSection>

        <FormSection title={t('instances.form.collection')}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('instances.form.interval')} hint={t('instances.form.intervalHint')}>
              <Input
                type="number"
                min={0}
                max={86400}
                value={form.collectionIntervalSeconds}
                onChange={(event) => update('collectionIntervalSeconds', Number(event.target.value))}
              />
            </Field>
          </div>
        </FormSection>

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

        {test && <TestResult result={test} t={t} />}
      </form>
    </Modal>
  )
}

function TestResult({ result, t }: { result: TestConnectionResult; t: Translator }) {
  if (!result.success) {
    return <Alert title={t('instances.test.failedTitle')}>{result.error}</Alert>
  }

  const available = result.capabilities.filter((capability) => capability.available)
  const missing = result.capabilities.filter((capability) => !capability.available)

  return (
    <div className="space-y-3">
      <Alert
        tone="success"
        title={t('instances.test.successTitle', { version: result.serverVersion ?? '—' })}
      >
        {/* Les précisions du test tiennent sur une ligne : elles se lisent d'un coup d'œil
            avant de refermer la modale. */}
        <p className="text-xs">
          {t('instances.test.readOnly', {
            state: result.readOnlyEnforced
              ? t('instances.test.readOnlyConfirmed')
              : t('instances.test.readOnlyUnconfirmed'),
          })}
          {result.timescaleVersion && (
            <> · {t('instances.test.timescale', { version: result.timescaleVersion })}</>
          )}
        </p>
      </Alert>

      {result.warnings.map((warning) => (
        <Alert key={warning} tone="warning">
          {warning}
        </Alert>
      ))}

      <div className="grid gap-3 sm:grid-cols-2">
        <CapabilityList
          title={t('instances.test.available', { count: available.length })}
          items={available.map((capability) => capability.name)}
          available
        />
        <CapabilityList
          title={t('instances.test.missing', { count: missing.length })}
          items={missing.map((capability) => capability.name)}
          available={false}
        />
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
    <div className="rounded-[var(--radius-control)] border border-border-subtle p-3">
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
