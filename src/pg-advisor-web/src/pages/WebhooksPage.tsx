import { useCallback, useEffect, useState } from 'react'
import { Webhook as WebhookIcon } from 'lucide-react'
import { api, ApiError } from '../api/client'
import type { Connection, NotificationHistoryEntry, WebhookConfiguration } from '../api/types'
import { useAuth } from '../app/AuthContext'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Fieldset,
  FormSection,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  TableScroll,
  Tag,
  Textarea,
} from '../components/ui'
import { formatDateTime, formatRelative, severityLabel } from '../lib/format'
import { tr, useT, useTc } from '../lib/i18n'
import type { Translator } from '../lib/i18n'

const EVENTS = [
  { value: 'new_finding', labelKey: 'webhooks.event.newFinding' },
  { value: 'finding_resolved', labelKey: 'webhooks.event.findingResolved' },
]

/** Formats de charge : Discord et Slack refusent un JSON quelconque. */
const FORMATS = [
  { value: 'generic', labelKey: 'webhooks.format.generic', hintKey: 'webhooks.format.genericHint' },
  { value: 'discord', labelKey: 'webhooks.format.discord', hintKey: 'webhooks.format.discordHint' },
  { value: 'slack', labelKey: 'webhooks.format.slack', hintKey: 'webhooks.format.slackHint' },
]

/** Libellé d'un événement : la valeur brute si elle vient d'une version plus récente du serveur. */
function eventLabel(t: Translator, value: string): string {
  const known = EVENTS.find((item) => item.value === value)
  return known ? t(known.labelKey) : value
}

/** Nom du service tel qu'il s'écrit — « Discord », « Slack » —, pas la valeur d'API. */
function serviceLabel(t: Translator, value: string): string {
  const known = FORMATS.find((item) => item.value === value)
  return known ? t(known.labelKey) : value
}

interface FormState {
  id: number | null
  key: string
  url: string
  enabled: boolean
  minimumSeverity: string
  format: string
  events: string[]
  connectionId: string
  headers: string
  replaceHeaders: boolean

  /** Vrai dès que l'opérateur a choisi le format : la déduction depuis l'URL cesse alors. */
  formatTouched?: boolean
}

const EMPTY_FORM: FormState = {
  id: null,
  key: '',
  url: '',
  enabled: true,
  minimumSeverity: 'warning',
  format: 'generic',
  events: ['new_finding', 'finding_resolved'],
  connectionId: '',
  headers: '',
  replaceHeaders: true,
}

/** Déduit le format d'après l'URL : l'erreur la plus fréquente est de laisser « generic ». */
function guessFormat(url: string): string | null {
  if (/discord(app)?\.com\/api\/webhooks\//i.test(url)) return 'discord'
  if (/hooks\.slack\.com\//i.test(url)) return 'slack'
  return null
}

export function WebhooksPage() {
  const { isAdmin } = useAuth()
  const t = useT()
  const tc = useTc()
  const [webhooks, setWebhooks] = useState<WebhookConfiguration[]>([])
  const [connections, setConnections] = useState<Connection[]>([])
  const [history, setHistory] = useState<NotificationHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)

  const load = useCallback(async () => {
    try {
      const [list, instances, entries] = await Promise.all([
        api.webhooks.list(),
        api.connections.list(),
        api.webhooks.history(),
      ])
      setWebhooks(list)
      setConnections(instances)
      setHistory(entries)
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

  async function test(webhook: WebhookConfiguration) {
    setNotice(null)
    const result = await api.webhooks.test(webhook.id)
    setNotice(
      result.success
        ? t('webhooks.testSent', { key: webhook.key, status: result.statusCode ?? '—' })
        : t('webhooks.testFailed', { key: webhook.key, error: result.error ?? '' }),
    )
    void load()
  }

  /** Applique le format déduit de l'URL, sans toucher au reste de la configuration. */
  async function fixFormat(webhook: WebhookConfiguration, format: string) {
    setNotice(null)

    try {
      await api.webhooks.update(webhook.id, {
        key: webhook.key,
        url: webhook.url,
        enabled: webhook.enabled,
        minimumSeverity: webhook.minimumSeverity,
        format,
        events: webhook.events,
        connectionId: webhook.connectionId,
        headers: null,
      })
      setNotice(t('webhooks.formatFixed', { key: webhook.key, format: serviceLabel(t, format) }))
      void load()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('webhooks.fixFailed'))
    }
  }

  const addButton = isAdmin && (
    <Button variant="primary" onClick={() => setForm(EMPTY_FORM)}>
      {t('webhooks.add')}
    </Button>
  )

  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.webhooks')} subtitle={t('webhooks.subtitle')} actions={addButton} />

      {error && <Alert title={t('common.error')}>{error}</Alert>}
      {notice && (
        <Alert tone="info" onDismiss={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <Card title={tc('webhooks.count', webhooks.length)} padded={false}>
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="size-6" />
          </div>
        ) : webhooks.length === 0 ? (
          <EmptyState
            title={t('webhooks.empty.title')}
            icon={<WebhookIcon className="size-6" aria-hidden />}
            action={addButton}
          >
            {t('webhooks.empty.body')}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {webhooks.map((webhook) => {
              // L'URL désigne sans ambiguïté le service attendu : un format générique sur une
              // URL Discord ou Slack produit un « 400 Bad Request ».
              const expected = guessFormat(webhook.url)
              const mismatch = expected && expected !== webhook.format ? expected : null

              return (
                <li key={webhook.id} className="px-4 py-3">
                  {/* Identité, adresse et réglages forment une colonne unique ; les actions
                      restent à droite, à hauteur de la ligne d'identité. */}
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div className="min-w-0 flex-1 basis-72 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium text-ink">{webhook.key}</span>
                        {webhook.enabled ? (
                          <Tag tone="good">{t('webhooks.tag.enabled')}</Tag>
                        ) : (
                          <Tag>{t('webhooks.tag.disabled')}</Tag>
                        )}
                        <Tag tone={webhook.format === 'generic' ? 'neutral' : 'accent'}>
                          {webhook.format}
                        </Tag>
                        {webhook.hasHeaders && <Tag>{t('webhooks.tag.headers')}</Tag>}
                      </div>

                      {/* L'adresse complète tient sur une ligne : elle reste lisible en entier
                          au survol et dans le formulaire d'édition. */}
                      <p
                        className="truncate font-mono text-xs text-ink-muted"
                        title={webhook.url}
                      >
                        {webhook.url}
                      </p>

                      <p className="text-xs text-ink-muted">
                        {t('webhooks.fromSeverity', {
                          severity: severityLabel(webhook.minimumSeverity),
                        })}
                        {' · '}
                        {webhook.events.map((event) => eventLabel(t, event)).join(', ')}
                        {' · '}
                        {webhook.connectionName ?? t('webhooks.allInstances')}
                        {webhook.lastAttemptAt && (
                          <>
                            {' · '}
                            {webhook.lastAttemptSucceeded ? (
                              <span className="text-success">
                                {t('webhooks.lastSuccess', {
                                  when: formatRelative(webhook.lastAttemptAt),
                                })}
                              </span>
                            ) : (
                              <span className="break-words text-danger">
                                {t('webhooks.lastFailure', {
                                  when: formatRelative(webhook.lastAttemptAt),
                                  error: webhook.lastError ?? '',
                                })}
                              </span>
                            )}
                          </>
                        )}
                      </p>
                    </div>

                    {isAdmin && (
                      <div className="flex shrink-0 flex-wrap items-center gap-1">
                        <Button variant="ghost" onClick={() => void test(webhook)}>
                          {t('common.test')}
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() =>
                            setForm({
                              id: webhook.id,
                              key: webhook.key,
                              url: webhook.url,
                              enabled: webhook.enabled,
                              minimumSeverity: webhook.minimumSeverity,
                              format: webhook.format,
                              events: webhook.events,
                              connectionId: webhook.connectionId
                                ? String(webhook.connectionId)
                                : '',
                              headers: '',
                              replaceHeaders: false,
                              formatTouched: true,
                            })
                          }
                        >
                          {t('common.edit')}
                        </Button>
                        <Button
                          variant="ghost"
                          className="text-danger hover:text-danger"
                          onClick={async () => {
                            await api.webhooks.remove(webhook.id)
                            void load()
                          }}
                        >
                          {t('common.delete')}
                        </Button>
                      </div>
                    )}
                  </div>

                  {mismatch && (
                    <div className="mt-2">
                      <Alert
                        tone="warning"
                        title={t('webhooks.mismatchTitle', { service: serviceLabel(t, mismatch) })}
                      >
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                          <p className="min-w-0 flex-1 basis-72 text-xs">
                            {t('webhooks.mismatchBody', {
                              format: webhook.format,
                              service: serviceLabel(t, mismatch),
                            })}
                          </p>
                          {isAdmin && (
                            <Button onClick={() => void fixFormat(webhook, mismatch)}>
                              {t('webhooks.switchTo', { format: serviceLabel(t, mismatch) })}
                            </Button>
                          )}
                        </div>
                      </Alert>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <Card title={t('webhooks.history.title', { count: history.length })} padded={false}>
        {history.length === 0 ? (
          <EmptyState title={t('webhooks.history.empty')} />
        ) : (
          <TableScroll minWidth={640}>
            <table className="w-full text-sm">
              <thead className="bg-surface-sunken text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">{t('webhooks.history.date')}</th>
                  <th className="px-4 py-2 font-medium">{t('webhooks.history.webhook')}</th>
                  <th className="px-4 py-2 font-medium">{t('webhooks.history.event')}</th>
                  <th className="px-4 py-2 font-medium">{t('common.severity')}</th>
                  <th className="px-4 py-2 font-medium">{t('webhooks.history.result')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {history.map((entry, index) => (
                  <tr key={index} className="align-top">
                    <td className="whitespace-nowrap px-4 py-2 text-ink-muted">
                      {formatDateTime(entry.at)}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-ink">{entry.webhook}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-ink-muted">
                      {eventLabel(t, entry.event)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-ink-muted">
                      {severityLabel(entry.severity)}
                    </td>
                    <td className="px-4 py-2">
                      {entry.success ? (
                        <Tag tone="good">HTTP {entry.statusCode}</Tag>
                      ) : (
                        <span className="text-xs text-danger">
                          {t('webhooks.history.failure', {
                            attempts: tc('webhooks.history.attempts', entry.attempts),
                            error: entry.error ?? '',
                          })}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      {form && (
        <WebhookForm
          initial={form}
          connections={connections}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null)
            void load()
          }}
        />
      )}
    </div>
  )
}

function WebhookForm({
  initial,
  connections,
  onClose,
  onSaved,
}: {
  initial: FormState
  connections: Connection[]
  onClose: () => void
  onSaved: () => void
}) {
  const t = useT()
  const [form, setForm] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editing = initial.id !== null

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    let headers: Record<string, string> | null = null
    if (form.replaceHeaders) {
      headers = {}
      for (const line of form.headers.split('\n')) {
        const separator = line.indexOf(':')
        if (separator <= 0) continue
        headers[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
      }
    }

    const body = {
      key: form.key,
      url: form.url,
      enabled: form.enabled,
      minimumSeverity: form.minimumSeverity,
      format: form.format,
      events: form.events,
      connectionId: form.connectionId === '' ? null : Number(form.connectionId),
      headers,
    }

    try {
      if (form.id === null) {
        await api.webhooks.create(body)
      } else {
        await api.webhooks.update(form.id, body)
      }
      onSaved()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('webhooks.form.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const guessed = guessFormat(form.url)
  const formatHint = FORMATS.find((item) => item.value === form.format)?.hintKey

  return (
    <Modal
      title={editing ? t('webhooks.form.editTitle', { key: initial.key }) : t('webhooks.form.addTitle')}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button form="webhook-form" type="submit" variant="primary" disabled={busy}>
            {busy && <Spinner />} {t('common.save')}
          </Button>
        </>
      }
    >
      {/* Trois ensembles : où l'on écrit, ce qui déclenche l'envoi, comment la requête est
          signée. Deux colonnes dès qu'il y a la place, pour tenir sans défilement. */}
      <form id="webhook-form" onSubmit={submit} className="space-y-5">
        <FormSection
          title={t('webhooks.form.destination')}
          action={
            <Checkbox
              label={t('webhooks.form.enabled')}
              checked={form.enabled}
              onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
            />
          }
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('webhooks.form.key')} hint={t('webhooks.form.keyHint')}>
              <Input
                value={form.key}
                required
                pattern="[a-z0-9][a-z0-9._-]*"
                onChange={(event) => setForm({ ...form, key: event.target.value })}
              />
            </Field>

            <Field label={t('webhooks.form.url')} className="sm:col-span-2">
              <Input
                type="url"
                value={form.url}
                required
                placeholder={t('webhooks.form.urlPlaceholder')}
                onChange={(event) => {
                  const url = event.target.value
                  // Le format est déduit de l'URL à la saisie, tant que l'opérateur ne l'a pas
                  // choisi lui-même : c'est la cause n°1 d'un HTTP 400 côté Discord ou Slack.
                  const detected = guessFormat(url)
                  setForm((current) => ({
                    ...current,
                    url,
                    format: detected && !current.formatTouched ? detected : current.format,
                  }))
                }}
              />
            </Field>
          </div>

          <Field
            label={t('webhooks.form.format')}
            hint={formatHint ? t(formatHint) : undefined}
          >
            <Select
              value={form.format}
              onChange={(event) =>
                setForm({ ...form, format: event.target.value, formatTouched: true })
              }
            >
              {FORMATS.map((format) => (
                <option key={format.value} value={format.value}>
                  {t(format.labelKey)}
                </option>
              ))}
            </Select>
          </Field>

          {form.format === 'generic' && guessed && (
            <Alert tone="warning">{t('webhooks.form.mismatch', { service: serviceLabel(t, guessed) })}</Alert>
          )}
        </FormSection>

        <FormSection title={t('webhooks.form.trigger')}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('webhooks.form.minimumSeverity')}>
              <Select
                value={form.minimumSeverity}
                onChange={(event) => setForm({ ...form, minimumSeverity: event.target.value })}
              >
                <option value="info">{t('severity.info')}</option>
                <option value="warning">{t('severity.warning')}</option>
                <option value="critical">{t('severity.critical')}</option>
              </Select>
            </Field>

            <Field label={t('webhooks.form.connection')}>
              <Select
                value={form.connectionId}
                onChange={(event) => setForm({ ...form, connectionId: event.target.value })}
              >
                <option value="">{t('webhooks.allInstances')}</option>
                {connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Fieldset legend={t('webhooks.form.events')}>
            {EVENTS.map((event) => (
              <Checkbox
                key={event.value}
                label={t(event.labelKey)}
                checked={form.events.includes(event.value)}
                onChange={(changed) =>
                  setForm({
                    ...form,
                    events: changed.target.checked
                      ? [...form.events, event.value]
                      : form.events.filter((item) => item !== event.value),
                  })
                }
              />
            ))}
          </Fieldset>
        </FormSection>

        <FormSection
          title={t('webhooks.form.transport')}
          action={
            editing && (
              <Checkbox
                label={t('webhooks.form.replaceHeaders')}
                checked={form.replaceHeaders}
                onChange={(event) => setForm({ ...form, replaceHeaders: event.target.checked })}
              />
            )
          }
        >
          {!editing || form.replaceHeaders ? (
            <Field label={t('webhooks.form.headers')} hint={t('webhooks.form.headersHint')}>
              <Textarea
                value={form.headers}
                rows={3}
                spellCheck={false}
                onChange={(event) => setForm({ ...form, headers: event.target.value })}
                className="font-mono text-xs"
                placeholder="Authorization: Bearer ..."
              />
            </Field>
          ) : (
            <p className="text-xs text-ink-muted">{t('webhooks.form.headersKept')}</p>
          )}
        </FormSection>

        {error && <Alert>{error}</Alert>}
      </form>
    </Modal>
  )
}
