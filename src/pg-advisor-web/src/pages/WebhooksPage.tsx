import { useCallback, useEffect, useState } from 'react'
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
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  TableScroll,
  Tag,
} from '../components/ui'
import { formatDateTime, formatRelative, severityLabel } from '../lib/format'

const EVENTS = [
  { value: 'new_finding', label: 'Nouveau finding' },
  { value: 'finding_resolved', label: 'Finding résolu' },
]

/** Formats de charge : Discord et Slack refusent un JSON quelconque. */
const FORMATS = [
  {
    value: 'generic',
    label: 'Générique (JSON complet)',
    hint: 'Charge complète : instance, finding, preuves. Pour un webhook maison ou un routeur d’alertes.',
  },
  {
    value: 'discord',
    label: 'Discord',
    hint: 'Embed Discord coloré par sévérité. Obligatoire pour une URL discord.com/api/webhooks/…',
  },
  {
    value: 'slack',
    label: 'Slack',
    hint: 'Message Slack avec pièce jointe colorée. Pour une URL hooks.slack.com/services/…',
  },
]

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
      setError(cause instanceof Error ? cause.message : 'Chargement impossible.')
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
        ? `Test envoyé à « ${webhook.key} » (HTTP ${result.statusCode}).`
        : `Test en échec pour « ${webhook.key} » : ${result.error}`,
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
      setNotice(`« ${webhook.key} » émet désormais au format ${format}. Relancez un test pour confirmer.`)
      void load()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Correction impossible.')
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications"
        subtitle="Chaque épisode de finding n'est notifié qu'une seule fois par destination."
        actions={
          isAdmin && (
            <Button variant="primary" onClick={() => setForm(EMPTY_FORM)}>
              Ajouter un webhook
            </Button>
          )
        }
      />

      {error && <Alert title="Erreur">{error}</Alert>}
      {notice && (
        <Alert tone="info" onDismiss={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <Card title={`${webhooks.length} webhook${webhooks.length > 1 ? 's' : ''}`} padded={false}>
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="size-6" />
          </div>
        ) : webhooks.length === 0 ? (
          <div className="p-4">
            <EmptyState title="Aucun webhook configuré">
              Un webhook reçoit les nouveaux findings et leurs résolutions. Chaque épisode n'est
              notifié qu'une fois par destination.
            </EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {webhooks.map((webhook) => (
              <li key={webhook.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1 basis-64">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink">{webhook.key}</span>
                    {webhook.enabled ? <Tag tone="good">actif</Tag> : <Tag>inactif</Tag>}
                    <Tag tone={webhook.format === 'generic' ? 'neutral' : 'accent'}>
                      {webhook.format}
                    </Tag>
                    {webhook.hasHeaders && <Tag>en-têtes</Tag>}
                  </div>
                  <p className="mt-0.5 break-all font-mono text-xs text-ink-muted">{webhook.url}</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    à partir de {severityLabel(webhook.minimumSeverity)} ·{' '}
                    {webhook.events
                      .map((event) => EVENTS.find((item) => item.value === event)?.label ?? event)
                      .join(', ')}
                    {' · '}
                    {webhook.connectionName ?? 'toutes les instances'}
                  </p>
                  {webhook.lastAttemptAt && (
                    <p className="mt-1 text-xs">
                      {webhook.lastAttemptSucceeded ? (
                        <span className="text-success">
                          dernier envoi réussi {formatRelative(webhook.lastAttemptAt)}
                        </span>
                      ) : (
                        <span className="break-words text-danger">
                          dernier envoi en échec {formatRelative(webhook.lastAttemptAt)} —{' '}
                          {webhook.lastError}
                        </span>
                      )}
                    </p>
                  )}

                  {/* L'URL désigne sans ambiguïté le service attendu : un format générique
                      sur une URL Discord ou Slack produit un « 400 Bad Request ». */}
                  {(() => {
                    const expected = guessFormat(webhook.url)
                    if (!expected || expected === webhook.format) {
                      return null
                    }

                    return (
                      <div className="mt-2">
                        <Alert tone="warning" title={`Format inadapté pour cette URL ${expected}`}>
                          <p className="text-xs">
                            La charge est émise au format « {webhook.format} », que {expected} refuse
                            avec « Cannot send an empty message ».
                          </p>
                          {isAdmin && (
                            <Button
                              className="mt-2"
                              onClick={() => void fixFormat(webhook, expected)}
                            >
                              Passer au format {expected}
                            </Button>
                          )}
                        </Alert>
                      </div>
                    )
                  })()}
                </div>

                {isAdmin && (
                  <div className="flex gap-1">
                    <Button variant="ghost" onClick={() => void test(webhook)}>
                      Tester
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
                          connectionId: webhook.connectionId ? String(webhook.connectionId) : '',
                          headers: '',
                          replaceHeaders: false,
                          formatTouched: true,
                        })
                      }
                    >
                      Modifier
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        await api.webhooks.remove(webhook.id)
                        void load()
                      }}
                    >
                      Supprimer
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Historique des notifications (${history.length})`} padded={false}>
        {history.length === 0 ? (
          <div className="p-4">
            <EmptyState title="Aucune notification envoyée" />
          </div>
        ) : (
          <TableScroll minWidth={640}>
            <table className="w-full text-sm">
              <thead className="bg-surface-sunken text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Webhook</th>
                  <th className="px-4 py-2 font-medium">Événement</th>
                  <th className="px-4 py-2 font-medium">Sévérité</th>
                  <th className="px-4 py-2 font-medium">Résultat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {history.map((entry, index) => (
                  <tr key={index} className="align-top">
                    <td className="whitespace-nowrap px-4 py-2 text-ink-muted">
                      {formatDateTime(entry.at)}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-ink">{entry.webhook}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-ink-muted">{entry.event}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-ink-muted">
                      {severityLabel(entry.severity)}
                    </td>
                    <td className="px-4 py-2">
                      {entry.success ? (
                        <Tag tone="good">HTTP {entry.statusCode}</Tag>
                      ) : (
                        <span className="text-xs text-danger">
                          échec après {entry.attempts} tentative{entry.attempts > 1 ? 's' : ''} —{' '}
                          {entry.error}
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
      setError(cause instanceof ApiError ? cause.message : 'Enregistrement impossible.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={editing ? `Modifier « ${initial.key} »` : 'Ajouter un webhook'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button form="webhook-form" type="submit" variant="primary" disabled={busy}>
            {busy && <Spinner />} Enregistrer
          </Button>
        </>
      }
    >
      <form id="webhook-form" onSubmit={submit} className="space-y-4">
        <Field label="Identifiant" hint="Minuscules, sans espace : sert de référence dans les logs">
          <Input
            value={form.key}
            required
            pattern="[a-z0-9][a-z0-9._-]*"
            onChange={(event) => setForm({ ...form, key: event.target.value })}
          />
        </Field>

        <Field label="URL">
          <Input
            type="url"
            value={form.url}
            required
            placeholder="https://hooks.exemple.local/pg-advisor"
            onChange={(event) => {
              const url = event.target.value
              // Le format est déduit de l'URL à la saisie, tant que l'opérateur ne l'a pas
              // choisi lui-même : c'est la cause n°1 d'un HTTP 400 côté Discord ou Slack.
              const guessed = guessFormat(url)
              setForm((current) => ({
                ...current,
                url,
                format: guessed && !current.formatTouched ? guessed : current.format,
              }))
            }}
          />
        </Field>

        <Field label="Format de la charge" hint={FORMATS.find((f) => f.value === form.format)?.hint}>
          <Select
            value={form.format}
            onChange={(event) => setForm({ ...form, format: event.target.value, formatTouched: true })}
          >
            {FORMATS.map((format) => (
              <option key={format.value} value={format.value}>
                {format.label}
              </option>
            ))}
          </Select>
        </Field>

        {form.format === 'generic' && guessFormat(form.url) && (
          <Alert tone="warning">
            Cette URL ressemble à un webhook {guessFormat(form.url)} : avec le format générique, le
            service répondra « HTTP 400 Bad Request ». Choisissez le format correspondant.
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Sévérité minimale">
            <Select
              value={form.minimumSeverity}
              onChange={(event) => setForm({ ...form, minimumSeverity: event.target.value })}
            >
              <option value="info">Information</option>
              <option value="warning">Avertissement</option>
              <option value="critical">Critique</option>
            </Select>
          </Field>

          <Field label="Instance concernée">
            <Select
              value={form.connectionId}
              onChange={(event) => setForm({ ...form, connectionId: event.target.value })}
            >
              <option value="">Toutes les instances</option>
              {connections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <fieldset>
          <legend className="mb-1 text-xs font-medium text-ink-muted">Événements</legend>
          <div className="space-y-1">
            {EVENTS.map((event) => (
              <Checkbox
                key={event.value}
                label={event.label}
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
          </div>
        </fieldset>

        <Checkbox
          label="Webhook actif"
          checked={form.enabled}
          onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
        />

        {editing && (
          <Checkbox
            label="Remplacer les en-têtes HTTP enregistrés"
            checked={form.replaceHeaders}
            onChange={(event) => setForm({ ...form, replaceHeaders: event.target.checked })}
          />
        )}

        {(!editing || form.replaceHeaders) && (
          <Field
            label="En-têtes HTTP"
            hint="Un par ligne, au format Nom: valeur. Peut contenir un jeton : jamais renvoyé par l'API."
          >
            <textarea
              value={form.headers}
              rows={3}
              spellCheck={false}
              onChange={(event) => setForm({ ...form, headers: event.target.value })}
              className="w-full rounded-md border border-border-strong px-2.5 py-1.5 font-mono text-xs focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              placeholder="Authorization: Bearer ..."
            />
          </Field>
        )}

        {error && <Alert>{error}</Alert>}
      </form>
    </Modal>
  )
}
