import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Database, X } from 'lucide-react'
import { api, ApiError } from '@/api/client'
import type { CapabilityStatus, Connection, TestConnectionResult } from '@/api/types'
import { useAuth } from '@/app/AuthContext'
import { useEventListener } from '@/app/EventsContext'
import { Page } from '@/components/layout/Page'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Field,
  FormSection,
  Input,
  LastUpdated,
  LoadingBlock,
  Modal,
  Notice,
  RefreshBar,
  Select,
  TBody,
  THead,
  Table,
  TableScroll,
  Td,
  Th,
  Tr,
} from '@/components/ui/primitives'
import { collectionStateLabel, formatDateTime, formatRelative } from '@/lib/format'
import { tr, useT, useTc } from '@/lib/i18n'
import type { Translator } from '@/lib/i18n'
import { cn } from '@/lib/utils'

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
    // Jamais préchargé : un mot de passe enregistré ne se réaffiche pas.
    password: '',
    sslMode: connection.sslMode,
    collectionIntervalSeconds: connection.collectionIntervalSeconds,
    enabled: connection.enabled,
  }
}

/** `brand` ne dit jamais un état : une collecte en cours est une information. */
function StateBadge({ connection, t }: { connection: Connection; t: Translator }) {
  if (!connection.enabled) return <Badge>{t('instances.disabledBadge')}</Badge>

  const tone =
    connection.collectionState === 'error'
      ? 'danger'
      : connection.collectionState === 'idle'
        ? 'success'
        : 'info'

  return <Badge tone={tone}>{collectionStateLabel(connection.collectionState)}</Badge>
}

/**
 * Instances supervisées — famille *installation*.
 *
 * Vue rare : on y vient pour brancher une base, puis on n'y revient qu'à l'occasion. Elle
 * s'explique plutôt qu'elle ne se compacte.
 */
export function InstancesPage() {
  const { isAdmin } = useAuth()
  const t = useT()
  const tc = useTc()

  const [connections, setConnections] = useState<Connection[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Connection | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [receivedAt, setReceivedAt] = useState<string | null>(null)

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      setConnections(await api.connections.list())
      setReceivedAt(new Date().toISOString())
      setError(null)
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

  useEventListener(['collection.state', 'instance.changed', 'health.changed'], () => void load())

  async function remove() {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await api.connections.remove(confirmDelete.id)
      setConfirmDelete(null)
      void load()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : tr('common.unknownError'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  const addButton = isAdmin ? (
    <Button variant="primary" onClick={() => setForm(EMPTY_FORM)}>
      {t('instances.add')}
    </Button>
  ) : null

  const sorted = [...connections].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <Page title={t('nav.instances')} description={t('instances.subtitle')} actions={addButton}>
      <div className="space-y-4" aria-busy={refreshing}>
        {error && (
          <Notice tone="danger" title={t('common.error')} onDismiss={() => setError(null)}>
            {error}
          </Notice>
        )}

        {!isAdmin && <Notice tone="info">{t('instances.viewerNotice')}</Notice>}

        <Card className="overflow-hidden">
          <RefreshBar active={refreshing && !loading} />
          {/* La vue se met à jour seule sur événement : l'écart depuis la dernière donnée reçue
              répond à la première question devant un écran immobile — est-ce à jour ? */}
          <CardHeader
            title={tc('instances.count', connections.length)}
            description={<LastUpdated at={receivedAt} />}
          />

          {loading ? (
            <LoadingBlock />
          ) : connections.length === 0 ? (
            <EmptyState
              icon={<Database className="size-6" aria-hidden />}
              title={t('instances.empty.title')}
              description={t('instances.empty.body')}
              action={addButton}
            />
          ) : (
            <>
              {/* Tableau à partir de md ; en dessous, une liste de cartes reste lisible sans
                  défilement horizontal. */}
              <div className="hidden md:block">
                <TableScroll minWidth={900}>
                  <Table>
                    <THead>
                      <Tr>
                        <Th>{t('common.name')}</Th>
                        <Th>{t('instances.column.target')}</Th>
                        <Th>{t('instanceDetail.version')}</Th>
                        <Th>{t('common.state')}</Th>
                        <Th className="whitespace-nowrap">
                          {t('instances.column.lastCollection')}
                        </Th>
                        <Th numeric>{t('instances.column.score')}</Th>
                        <Th>
                          <span className="sr-only">{t('common.actions')}</span>
                        </Th>
                      </Tr>
                    </THead>
                    <TBody>
                      {sorted.map((connection) => (
                        <Tr key={connection.id}>
                          <Td>
                            <Link
                              to={`/instances/${connection.id}`}
                              className="text-ink hover:text-brand font-medium hover:underline"
                            >
                              {connection.name}
                            </Link>
                            <p className="text-ink-muted text-meta">{connection.username}</p>
                          </Td>
                          <Td>
                            <span className="whitespace-nowrap">
                              {connection.host}:{connection.port}
                            </span>
                            <p className="text-ink-muted text-meta">{connection.database}</p>
                          </Td>
                          <Td className="whitespace-nowrap">{connection.serverVersion ?? '—'}</Td>
                          <Td>
                            <StateBadge connection={connection} t={t} />
                            {connection.lastError && (
                              <p
                                className="text-danger-strong mt-1 line-clamp-2 max-w-56 text-meta"
                                title={connection.lastError}
                              >
                                {connection.lastError}
                              </p>
                            )}
                          </Td>
                          <Td
                            className="whitespace-nowrap"
                            title={formatDateTime(connection.lastCollectedAt)}
                          >
                            {formatRelative(connection.lastCollectedAt)}
                          </Td>
                          {/* Les scores se comparent d'une ligne à l'autre : alignés à droite,
                              en chiffres de largeur fixe. */}
                          <Td numeric className="font-semibold whitespace-nowrap">
                            {connection.health ? `${connection.health.global}/100` : '—'}
                          </Td>
                          <Td>
                            {isAdmin && (
                              <div className="flex justify-end gap-1">
                                <Button variant="ghost" onClick={() => setForm(toForm(connection))}>
                                  {t('common.edit')}
                                </Button>
                                <Button
                                  variant="ghost"
                                  className="text-danger-strong hover:text-danger-strong"
                                  onClick={() => setConfirmDelete(connection)}
                                >
                                  {t('common.delete')}
                                </Button>
                              </div>
                            )}
                          </Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                </TableScroll>
              </div>

              <ul className="divide-border-subtle divide-y md:hidden">
                {sorted.map((connection) => (
                  <li key={connection.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          to={`/instances/${connection.id}`}
                          className="text-ink block truncate text-body font-medium"
                        >
                          {connection.name}
                        </Link>
                        <p className="text-ink-muted truncate text-meta">
                          {connection.host}:{connection.port} · {connection.database}
                        </p>
                      </div>
                      <span className="text-ink shrink-0 text-body font-semibold tabular-nums">
                        {connection.health ? `${connection.health.global}/100` : '—'}
                      </span>
                    </div>

                    {/* État, version et date de collecte sur une même ligne d'étiquettes : trois
                        informations courtes n'ont pas besoin de trois lignes. */}
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                      <StateBadge connection={connection} t={t} />
                      {connection.serverVersion && (
                        <Badge>PostgreSQL {connection.serverVersion}</Badge>
                      )}
                      <span className="text-ink-muted text-meta">
                        {t('instances.collectedAt', {
                          when: formatRelative(connection.lastCollectedAt),
                        })}
                      </span>
                    </div>

                    {connection.lastError && (
                      <p className="text-danger-strong mt-1.5 line-clamp-2 text-meta">
                        {connection.lastError}
                      </p>
                    )}

                    {isAdmin && (
                      <div className="mt-2 flex gap-2">
                        <Button onClick={() => setForm(toForm(connection))}>
                          {t('common.edit')}
                        </Button>
                        <Button
                          className="text-danger-strong hover:text-danger-strong"
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
      </div>

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
        <ConfirmDialog
          title={t('instances.delete.title', { name: confirmDelete.name })}
          description={t('instances.delete.body')}
          confirmLabel={t('instances.delete.confirm')}
          busy={deleting}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void remove()}
        />
      )}
    </Page>
  )
}

/**
 * Formulaire de connexion. Une colonne, trois ensembles courts, et une indication par champ qui
 * dit la conséquence du réglage : celui qui revient ici après six mois ne se souvient de rien.
 */
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
  // Quelle opération est en cours, et non un simple « occupé » : deux sabliers tournaient de
  // concert dans le pied de la modale sans dire lequel travaillait.
  const [pending, setPending] = useState<'test' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<string[]>([])
  const [test, setTest] = useState<TestConnectionResult | null>(null)
  const editing = initial.id !== null
  const busy = pending !== null

  // Le résultat du test s'affiche en tête du corps : sans cela, il naissait sous le pli d'une
  // modale défilante et le clic sur « Tester » semblait sans effet.
  const result = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (test || error) result.current?.scrollIntoView({ block: 'nearest' })
  }, [test, error])

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setTest(null)
  }

  async function runTest() {
    setPending('test')
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
      setPending(null)
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setPending('save')
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
      setPending(null)
    }
  }

  return (
    <Modal
      title={
        editing ? t('instances.form.editTitle', { name: initial.name }) : t('instances.form.addTitle')
      }
      onClose={onClose}
      // Une largeur de formulaire, pas de diagramme : neuf champs sur une colonne.
      size="md"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={runTest}
            loading={pending === 'test'}
            disabled={busy || !form.host || !form.username}
          >
            {t('instances.form.test')}
          </Button>
          <Button
            form="connection-form"
            type="submit"
            variant="primary"
            size="lg"
            loading={pending === 'save'}
            disabled={busy}
          >
            {editing ? t('instances.form.submit') : t('instances.form.create')}
          </Button>
        </>
      }
    >
      <form id="connection-form" onSubmit={save} className="space-y-5">
        <div ref={result} className="empty:hidden space-y-3">
          {error && (
            <Notice tone="danger" title={error}>
              {details.length > 0 && (
                <ul className="mt-1 list-disc pl-4">
                  {details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              )}
            </Notice>
          )}

          {test && <TestResult result={test} t={t} />}
        </div>

        <FormSection title={t('instances.form.target')}>
          <Field label={t('common.name')} hint={t('instances.form.nameHint')}>
            <Input
              value={form.name}
              required
              maxLength={128}
              onChange={(event) => update('name', event.target.value)}
            />
          </Field>

          <Field label={t('instances.form.host')} hint={t('instances.form.hostHint')}>
            <Input
              value={form.host}
              required
              placeholder={t('instances.form.hostPlaceholder')}
              onChange={(event) => update('host', event.target.value)}
            />
          </Field>

          <Field label={t('instances.form.port')} hint={t('instances.form.portHint')}>
            <Input
              type="number"
              min={1}
              max={65535}
              value={form.port}
              required
              onChange={(event) => update('port', Number(event.target.value))}
            />
          </Field>

          <Field label={t('instances.form.database')} hint={t('instances.form.databaseHint')}>
            <Input
              value={form.database}
              required
              onChange={(event) => update('database', event.target.value)}
            />
          </Field>
        </FormSection>

        <FormSection title={t('instances.form.authentication')}>
          <Field label={t('instances.form.username')} hint={t('instances.form.usernameHint')}>
            <Input
              value={form.username}
              required
              onChange={(event) => update('username', event.target.value)}
            />
          </Field>

          <Field
            label={t('instances.form.password')}
            hint={
              editing ? t('instances.form.passwordHint') : t('instances.form.passwordNewHint')
            }
          >
            <Input
              type="password"
              value={form.password}
              required={!editing}
              autoComplete="new-password"
              onChange={(event) => update('password', event.target.value)}
            />
          </Field>

          <Field label={t('instanceDetail.sslMode')} hint={t('instances.form.sslModeHint')}>
            <Select value={form.sslMode} onChange={(event) => update('sslMode', event.target.value)}>
              {SSL_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </Select>
          </Field>
        </FormSection>

        <FormSection title={t('instances.form.collection')}>
          <Field label={t('instances.form.interval')} hint={t('instances.form.intervalHint')}>
            <Input
              type="number"
              min={0}
              max={86400}
              value={form.collectionIntervalSeconds}
              onChange={(event) => update('collectionIntervalSeconds', Number(event.target.value))}
            />
          </Field>

          <Checkbox
            label={t('instances.form.enabled')}
            hint={t('instances.form.enabledHint')}
            checked={form.enabled}
            onChange={(event) => update('enabled', event.target.checked)}
          />
        </FormSection>
      </form>
    </Modal>
  )
}

function TestResult({ result, t }: { result: TestConnectionResult; t: Translator }) {
  if (!result.success) {
    return (
      <Notice tone="danger" title={t('instances.test.failedTitle')}>
        {result.error}
      </Notice>
    )
  }

  const available = result.capabilities.filter((capability) => capability.available)
  const missing = result.capabilities.filter((capability) => !capability.available)

  return (
    <div className="space-y-3">
      <Notice
        tone="success"
        title={t('instances.test.successTitle', { version: result.serverVersion ?? '—' })}
      >
        {/* Les précisions du test tiennent sur une ligne : elles se lisent d'un coup d'œil
            avant de refermer la modale. */}
        {t('instances.test.readOnly', {
          state: result.readOnlyEnforced
            ? t('instances.test.readOnlyConfirmed')
            : t('instances.test.readOnlyUnconfirmed'),
        })}
        {result.timescaleVersion && (
          <> · {t('instances.test.timescale', { version: result.timescaleVersion })}</>
        )}
      </Notice>

      {result.warnings.map((warning) => (
        <Notice key={warning} tone="warning">
          {warning}
        </Notice>
      ))}

      <div className="grid gap-3 sm:grid-cols-2">
        <CapabilityList
          title={t('instances.test.available', { count: available.length })}
          items={available}
          available
        />
        <CapabilityList
          title={t('instances.test.missing', { count: missing.length })}
          items={missing}
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
  items: CapabilityStatus[]
  available: boolean
}) {
  return (
    <section className="border-border-subtle rounded-[var(--radius-control)] border p-3">
      <h3 className="text-ink-muted mb-1.5 text-micro font-semibold tracking-wider uppercase">
        {title}
      </h3>
      <ul className="space-y-0.5">
        {items.length === 0 && <li className="text-ink-muted text-body">—</li>}
        {items.map((item) => (
          <li key={item.name} className="flex min-w-0 items-center gap-1.5">
            {available ? (
              <Check className="text-success size-3.5 shrink-0" aria-hidden />
            ) : (
              <X className="text-ink-faint size-3.5 shrink-0" aria-hidden />
            )}
            <span
              className={cn('truncate font-mono text-body', available ? 'text-ink' : 'text-ink-muted')}
              title={item.name}
            >
              {item.name}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
