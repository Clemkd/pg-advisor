import { useCallback, useEffect, useState } from 'react'
import { Webhook as WebhookIcon } from 'lucide-react'
import { api, ApiError } from '@/api/client'
import type { Connection, NotificationHistoryEntry, WebhookConfiguration } from '@/api/types'
import { useAuth } from '@/app/useAuth'
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
  Fieldset,
  FormSection,
  Input,
  LoadingBlock,
  Modal,
  Notice,
  Select,
  SeverityBadge,
  TBody,
  THead,
  Table,
  TableScroll,
  Td,
  Textarea,
  Th,
  Tr,
} from '@/components/ui/primitives'
import { formatDateTime, formatRelative, severityLabel } from '@/lib/format'
import { tr, useT, useTc } from '@/lib/i18n'
import type { Translator } from '@/lib/i18n'

/**
 * Événements offerts à l'abonnement. La liste renvoyée à l'enregistrement est complète : tout
 * événement absent d'ici serait désabonné en silence au premier passage dans le formulaire.
 * Elle doit donc suivre `NotificationEvents.All` côté serveur.
 */
const EVENTS = [
  {
    value: 'new_finding',
    labelKey: 'webhooks.event.newFinding',
    hintKey: 'webhooks.event.newFindingHint',
  },
  {
    value: 'finding_resolved',
    labelKey: 'webhooks.event.findingResolved',
    hintKey: 'webhooks.event.findingResolvedHint',
  },
  {
    value: 'rule_degraded',
    labelKey: 'webhooks.event.ruleDegraded',
    hintKey: 'webhooks.event.ruleDegradedHint',
  },
  {
    value: 'rule_quarantined',
    labelKey: 'webhooks.event.ruleQuarantined',
    hintKey: 'webhooks.event.ruleQuarantinedHint',
  },
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

/** Le nom long explique le choix dans une liste ; une pastille n'a la place que du nom court. */
function formatBadgeLabel(t: Translator, value: string): string {
  return value === 'generic' ? t('webhooks.format.genericShort') : serviceLabel(t, value)
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
  // Mêmes abonnements par défaut que le serveur : un garde-fou dont personne n'est prévenu
  // laisse une base souffrir sans témoin.
  events: EVENTS.map((event) => event.value),
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

/**
 * Notifications — famille *installation*.
 *
 * On y branche une destination puis on n'y revient qu'en cas d'envoi en échec : l'historique doit
 * donc dire lisiblement ce qui est parti et ce qui a été refusé.
 */
export function WebhooksPage() {
  const { isAdmin } = useAuth()
  const t = useT()
  const tc = useTc()

  const [webhooks, setWebhooks] = useState<WebhookConfiguration[]>([])
  const [connections, setConnections] = useState<Connection[]>([])
  const [history, setHistory] = useState<NotificationHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Le retour d'un test porte son issue : un envoi refusé ne se lit pas comme un envoi réussi.
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger' | 'info'; message: string } | null>(
    null,
  )
  const [confirmDelete, setConfirmDelete] = useState<WebhookConfiguration | null>(null)
  const [deleting, setDeleting] = useState(false)
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

    try {
      const result = await api.webhooks.test(webhook.id)
      setNotice(
        result.success
          ? {
              tone: 'success',
              message: t('webhooks.testSent', {
                key: webhook.key,
                status: result.statusCode ?? '—',
              }),
            }
          : {
              tone: 'danger',
              message: t('webhooks.testFailed', { key: webhook.key, error: result.error ?? '' }),
            },
      )
      void load()
    } catch (cause) {
      // Seule action de la page dépourvue de garde : un 403 ou un 500 y produisait un rejet de
      // promesse non capturé, sans le moindre retour à l'écran.
      setError(cause instanceof ApiError ? cause.message : t('webhooks.testFailed', {
        key: webhook.key,
        error: '',
      }))
    }
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
      setNotice({
        tone: 'info',
        message: t('webhooks.formatFixed', { key: webhook.key, format: serviceLabel(t, format) }),
      })
      void load()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('webhooks.fixFailed'))
    }
  }

  async function remove() {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await api.webhooks.remove(confirmDelete.id)
      setConfirmDelete(null)
      void load()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : tr('webhooks.deleteFailed'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  const addButton = isAdmin ? (
    <Button variant="primary" onClick={() => setForm(EMPTY_FORM)}>
      {t('webhooks.add')}
    </Button>
  ) : null

  return (
    <Page title={t('nav.webhooks')} description={t('webhooks.subtitle')} actions={addButton}>
      <div className="space-y-4">
        {error && (
          <Notice tone="danger" title={t('common.error')} onDismiss={() => setError(null)}>
            {error}
          </Notice>
        )}

        {notice && (
          <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>
            {notice.message}
          </Notice>
        )}

        {!isAdmin && <Notice tone="info">{t('webhooks.viewerNotice')}</Notice>}

        <Card>
          <CardHeader title={tc('webhooks.count', webhooks.length)} />

          {loading ? (
            <LoadingBlock />
          ) : webhooks.length === 0 ? (
            <EmptyState
              icon={<WebhookIcon className="size-6" aria-hidden />}
              title={t('webhooks.empty.title')}
              description={t('webhooks.empty.body')}
              action={addButton}
            />
          ) : (
            <ul className="divide-border-subtle divide-y">
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
                          <span className="text-ink text-body font-medium">{webhook.key}</span>
                          {webhook.enabled ? (
                            <Badge tone="success">{t('webhooks.tag.enabled')}</Badge>
                          ) : (
                            <Badge>{t('webhooks.tag.disabled')}</Badge>
                          )}
                          <Badge tone={webhook.format === 'generic' ? 'neutral' : 'info'}>
                            {formatBadgeLabel(t, webhook.format)}
                          </Badge>
                          {webhook.hasHeaders && <Badge>{t('webhooks.tag.headers')}</Badge>}
                        </div>

                        {/* L'adresse complète tient sur une ligne : elle reste lisible en entier
                            au survol et dans le formulaire d'édition. */}
                        <p className="text-ink-muted truncate font-mono text-meta" title={webhook.url}>
                          {webhook.url}
                        </p>

                        <p className="text-ink-muted text-meta">
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
                                <span className="text-success-strong">
                                  {t('webhooks.lastSuccess', {
                                    when: formatRelative(webhook.lastAttemptAt),
                                  })}
                                </span>
                              ) : (
                                <span className="text-danger-strong break-words">
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
                            className="text-danger-strong hover:text-danger-strong"
                            onClick={() => setConfirmDelete(webhook)}
                          >
                            {t('common.delete')}
                          </Button>
                        </div>
                      )}
                    </div>

                    {mismatch && (
                      <Notice
                        tone="warning"
                        className="mt-2"
                        title={t('webhooks.mismatchTitle', { service: serviceLabel(t, mismatch) })}
                      >
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                          <p className="min-w-0 flex-1 basis-72">
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
                      </Notice>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title={t('webhooks.history.title', { count: history.length })} />

          {history.length === 0 ? (
            <EmptyState title={t('webhooks.history.empty')} />
          ) : (
            <TableScroll minWidth={720}>
              <Table>
                <THead>
                  <Tr>
                    <Th>{t('webhooks.history.date')}</Th>
                    <Th>{t('webhooks.history.webhook')}</Th>
                    <Th>{t('webhooks.history.event')}</Th>
                    <Th>{t('common.severity')}</Th>
                    <Th>{t('webhooks.history.result')}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {history.map((entry, index) => (
                    <Tr key={`${entry.at}-${entry.webhook}-${index}`}>
                      <Td className="text-ink-muted whitespace-nowrap">
                        {formatDateTime(entry.at)}
                      </Td>
                      <Td className="font-mono">{entry.webhook}</Td>
                      <Td className="whitespace-nowrap">{eventLabel(t, entry.event)}</Td>
                      <Td>
                        <SeverityBadge severity={entry.severity} />
                      </Td>
                      <Td>
                        {entry.success ? (
                          <Badge tone="success">HTTP {entry.statusCode}</Badge>
                        ) : (
                          <span className="text-danger-strong">
                            {t('webhooks.history.failure', {
                              attempts: tc('webhooks.history.attempts', entry.attempts),
                              error: entry.error ?? '',
                            })}
                          </span>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableScroll>
          )}
        </Card>
      </div>

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

      {confirmDelete && (
        <ConfirmDialog
          title={t('webhooks.delete.title', { name: confirmDelete.key })}
          description={t('webhooks.delete.body')}
          confirmLabel={t('webhooks.delete.confirm')}
          busy={deleting}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void remove()}
        />
      )}
    </Page>
  )
}

/**
 * Formulaire d'une destination. Une colonne, trois ensembles : où l'on écrit, ce qui déclenche
 * l'envoi, comment la requête est signée.
 */
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
      size="md"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button form="webhook-form" type="submit" variant="primary" size="lg" loading={busy}>
            {editing ? t('webhooks.form.submit') : t('webhooks.form.create')}
          </Button>
        </>
      }
    >
      <form id="webhook-form" onSubmit={submit} className="space-y-5">
        {error && <Notice tone="danger">{error}</Notice>}

        <FormSection title={t('webhooks.form.destination')}>
          <Field label={t('webhooks.form.key')} hint={t('webhooks.form.keyHint')}>
            <Input
              value={form.key}
              required
              pattern="[a-z0-9][a-z0-9._-]*"
              onChange={(event) => setForm({ ...form, key: event.target.value })}
            />
          </Field>

          <Field label={t('webhooks.form.url')} hint={t('webhooks.form.urlHint')}>
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

          <Field label={t('webhooks.form.format')} hint={formatHint ? t(formatHint) : undefined}>
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
            <Notice tone="warning">
              {t('webhooks.form.mismatch', { service: serviceLabel(t, guessed) })}
            </Notice>
          )}

          <Checkbox
            label={t('webhooks.form.enabled')}
            hint={t('webhooks.form.enabledHint')}
            checked={form.enabled}
            onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
          />
        </FormSection>

        <FormSection title={t('webhooks.form.trigger')}>
          <Field
            label={t('webhooks.form.minimumSeverity')}
            hint={t('webhooks.form.minimumSeverityHint')}
          >
            <Select
              value={form.minimumSeverity}
              onChange={(event) => setForm({ ...form, minimumSeverity: event.target.value })}
            >
              <option value="info">{t('severity.info')}</option>
              <option value="warning">{t('severity.warning')}</option>
              <option value="critical">{t('severity.critical')}</option>
            </Select>
          </Field>

          <Field label={t('webhooks.form.connection')} hint={t('webhooks.form.connectionHint')}>
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

          {/* Une colonne : chaque événement porte l'indication de ce qu'il déclenche, et quatre
              lignes courtes se lisent mieux qu'une grille où l'indication se replie. */}
          <Fieldset
            legend={t('webhooks.form.events')}
            hint={t('webhooks.form.eventsHint')}
            columns={1}
          >
            {EVENTS.map((event) => (
              <Checkbox
                key={event.value}
                label={t(event.labelKey)}
                hint={t(event.hintKey)}
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
                className="font-mono"
                placeholder="Authorization: Bearer ..."
              />
            </Field>
          ) : (
            <p className="text-ink-muted text-body">{t('webhooks.form.headersKept')}</p>
          )}
        </FormSection>
      </form>
    </Modal>
  )
}
