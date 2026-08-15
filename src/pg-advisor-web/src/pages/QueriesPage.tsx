import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Clock, Code2, Play, Terminal, Wand2, Workflow } from 'lucide-react'
import { api, ApiError } from '@/api/client'
import type {
  AnalysisNote,
  Connection,
  InstanceQueryStatus,
  ParameterSuggestion,
  QueryAnalysisResult,
  TopQuery,
} from '@/api/types'
import { Page } from '@/components/layout/Page'
import { PlanView } from '@/components/PlanView'
import { QueryTable } from '@/components/QueryTable'
import {
  Badge,
  Button,
  Card,
  Checkbox,
  MultiSelect,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  Notice,
  Select,
} from '@/components/ui/primitives'
import { formatDateTime, formatRelative, formatSeconds } from '@/lib/format'
import { currentLocale, hasTranslation, tr, useT, useTc } from '@/lib/i18n'
import type { PluralTranslator, Translator } from '@/lib/i18n'
import { SqlCode } from '@/lib/sqlHighlight'

const SORTS = ['total_time', 'mean_time', 'calls', 'rows', 'io', 'temp']

export function QueriesPage() {
  const t = useT()
  const [params, setParams] = useSearchParams()
  const [connections, setConnections] = useState<Connection[]>([])
  const [queries, setQueries] = useState<TopQuery[]>([])
  const [statuses, setStatuses] = useState<InstanceQueryStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [target, setTarget] = useState<TopQuery | null>(null)

  // Plusieurs instances peuvent être classées ensemble : la sélection vit dans l'URL, donc
  // une vue comparée se partage par simple lien. La chaîne sert de dépendance stable,
  // contrairement au tableau qui serait reconstruit à chaque rendu.
  const selection = params.get('connectionIds') ?? ''
  const selected = useMemo(() => selection.split(',').filter(Boolean), [selection])
  const sort = params.get('sort') ?? 'total_time'
  const limit = Number(params.get('limit') ?? '50')
  // Les requêtes de l'Advisor sont écartées par défaut : elles parlent de la supervision, pas
  // de l'application supervisée.
  const includeAdvisor = params.get('includeAdvisor') === '1'

  useEffect(() => {
    void api.connections
      .list()
      .then((list) => {
        setConnections(list)
        if (selected.length === 0 && list.length > 0) {
          const next = new URLSearchParams(params)
          next.set('connectionIds', String(list[0].id))
          setParams(next, { replace: true })
        }
      })
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const load = useCallback(async () => {
    if (!selection) {
      setQueries([])
      setStatuses([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const result = await api.queries.across({
        connectionIds: selection,
        sort,
        limit: Math.min(Math.max(limit, 1), 200),
        includeAdvisor,
      })
      setQueries(result.items)
      setStatuses(result.instances)
      setError(null)
    } catch (cause) {
      // `tr` plutôt que `t` : le rappel est mémorisé, et dépendre du traducteur le recréerait
      // à chaque bascule de langue — donc rechargerait la liste pour rien.
      setError(cause instanceof Error ? cause.message : tr('queries.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [selection, sort, limit, includeAdvisor])

  useEffect(() => {
    void load()
  }, [load])

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  return (
    <Page title={t('nav.queries')} description={t('queries.subtitle')} wide>
      <div className="space-y-4">
        <Card>
          <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t('queries.filter.instances')} hint={t('queries.filter.instancesHint')}>
              <MultiSelect
                label={t('queries.filter.instancesLabel')}
                unit={t('common.instance').toLowerCase()}
                values={selected}
                options={connections.map((connection) => ({
                  value: String(connection.id),
                  label: connection.name,
                }))}
                onChange={(values) => setFilter('connectionIds', values.join(','))}
              />
            </Field>

            <Field label={t('queries.filter.sort')} hint={t('queries.filter.sortHint')}>
              <Select
                value={sort}
                aria-label={t('queries.filter.sort')}
                onChange={(event) => setFilter('sort', event.target.value)}
              >
                {SORTS.map((item) => (
                  <option key={item} value={item}>
                    {t(`queries.sort.${item}`)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('queries.filter.limit')} hint={t('queries.filter.limitHint')}>
              <Input
                type="number"
                min={1}
                max={200}
                value={limit}
                onChange={(event) => setFilter('limit', event.target.value)}
              />
            </Field>

            <div className="flex items-end gap-3">
              <Checkbox
                label={t('queries.filter.advisor')}
                title={t('queries.filter.advisorTitle')}
                checked={includeAdvisor}
                onChange={(event) => setFilter('includeAdvisor', event.target.checked ? '1' : '')}
              />
              <Button variant="primary" size="md" onClick={() => void load()} className="ml-auto">
                {t('queries.refresh')}
              </Button>
            </div>
          </CardBody>
        </Card>

        {error && (
          <Notice tone="danger" title={t('common.error')}>
            {error}
          </Notice>
        )}
        {/* Une instance muette ne doit pas passer pour une absence de requêtes. */}
        {statuses
          .filter((instance) => !instance.available)
          .map((instance) => (
            <Notice key={instance.id} tone="warning" title={instance.name}>
              {instance.reason}
            </Notice>
          ))}

        <Card>
          <CardHeader
            title={t('queries.list.title')}
            description={
              selected.length > 1
                ? t('queries.list.merged', { count: selected.length })
                : t('queries.list.single')
            }
          />

          {loading ? (
            <LoadingBlock />
          ) : queries.length === 0 ? (
            <EmptyState
              icon={<Terminal className="size-6" />}
              title={t('queries.empty.title')}
              description={
                statuses.some((instance) => !instance.available)
                  ? t('queries.empty.extension')
                  : t('queries.empty.statistics')
              }
            />
          ) : (
            <QueryTable
              queries={queries}
              showInstance={selected.length > 1}
              onAnalyze={setTarget}
            />
          )}
        </Card>
      </div>

      {target && (
        <AnalysisModal
          query={target}
          onClose={() => setTarget(null)}
          // Le classement porte l'indication « plan enregistré » : une mesure faite depuis la
          // modale doit la faire apparaître sans que l'opérateur ait à recharger la vue.
          onMeasured={() =>
            setQueries((current) =>
              current.map((item) =>
                item.connectionId === target.connectionId && item.queryId === target.queryId
                  ? { ...item, hasSavedPlan: true }
                  : item,
              ),
            )
          }
        />
      )}
    </Page>
  )
}

/**
 * Remarque de l'API rendue dans la langue de l'interface. Le code est stable, le message anglais
 * du serveur ne sert que si l'interface ne connaît pas ce code.
 */
function noteLabel(t: Translator, tc: PluralTranslator, note: AnalysisNote): string {
  const key = `queries.note.${note.code}`
  const locale = currentLocale()

  if (note.count !== null && hasTranslation(locale, `${key}.other`)) {
    return tc(key, note.count)
  }

  return hasTranslation(locale, key) ? t(key) : note.message
}

/**
 * Modale d'analyse. Le diagramme occupe l'essentiel de la surface ; tout ce qui l'entoure tient
 * en trois blocs courts — provenance de la mesure, requête analysée repliable, valeurs des
 * paramètres — chacun présent une seule fois.
 *
 * À l'ouverture, le plan déjà mesuré est relu depuis la base de l'Advisor : rien n'est exécuté
 * sur l'instance supervisée tant que l'opérateur ne demande pas explicitement une mesure.
 */
function AnalysisModal({
  query,
  onClose,
  onMeasured,
}: {
  query: TopQuery
  onClose: () => void
  onMeasured: () => void
}) {
  const t = useT()
  const tc = useTc()
  const connectionId = query.connectionId
  const queryId = query.queryId
  const sql = query.query

  const [result, setResult] = useState<QueryAnalysisResult | null>(null)
  const [reading, setReading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [parameters, setParameters] = useState<string[]>([])
  const [requiredParameters, setRequiredParameters] = useState(0)
  const [suggestions, setSuggestions] = useState<ParameterSuggestion[]>([])
  const [suggesting, setSuggesting] = useState(false)
  const [showSql, setShowSql] = useState(false)
  // L'éditeur de paramètres ne s'ouvre que sur demande dès lors qu'un plan est affiché : ses
  // valeurs se lisent alors en une ligne, et la place gagnée revient au diagramme.
  const [editingParameters, setEditingParameters] = useState(false)

  // Relecture du plan conservé : c'est tout l'intérêt de le conserver, et c'est gratuit pour
  // l'instance supervisée.
  useEffect(() => {
    let abandoned = false

    void api.queries
      .savedPlan(connectionId, { queryId })
      .then((saved) => {
        if (abandoned) return

        if (saved) {
          setResult(saved)
          if (saved.parameters.length > 0) {
            setParameters(saved.parameters)
            setRequiredParameters(saved.parameters.length)
          }
        } else {
          // Sans plan à montrer, la requête elle-même est le contenu le plus utile.
          setShowSql(true)
        }
      })
      .catch(() => setShowSql(true))
      .finally(() => {
        if (!abandoned) setReading(false)
      })

    return () => {
      abandoned = true
    }
  }, [connectionId, queryId])

  /** Remplit les champs avec des valeurs réellement présentes dans la base supervisée. */
  const suggest = useCallback(async () => {
    setSuggesting(true)
    try {
      const proposal = await api.queries.suggestParameters(connectionId, { queryId })

      setSuggestions(proposal.items)
      setParameters((current) => {
        const next = [...current]
        for (const item of proposal.items) {
          // Une valeur déjà saisie par l'opérateur prime sur la proposition.
          if (item.value !== null && !next[item.index - 1]) next[item.index - 1] = item.value
        }
        return next
      })
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : tr('queries.params.suggestFailed'))
    } finally {
      setSuggesting(false)
    }
  }, [connectionId, queryId])

  const run = useCallback(async () => {
    setBusy(true)
    setError(null)

    try {
      const analysis = await api.queries.analyze(connectionId, {
        queryId,
        buffers: true,
        parameters: parameters.length > 0 ? parameters : undefined,
      })
      setResult(analysis)
      setRequiredParameters(analysis.parameters.length)
      setShowSql(false)
      onMeasured()
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 422) {
        // La requête est normalisée : l'interface réclame les valeurs manquantes. Le nombre
        // attendu vient du corps de la réponse, pas d'une lecture du message.
        const required = Number(cause.payload?.requiredParameters ?? 0)
        setRequiredParameters(required)
        setParameters((current) =>
          current.length === required ? current : Array.from({ length: required }, () => ''),
        )
        // Il manque des valeurs : l'éditeur s'ouvre, sinon le message resterait sans réponse.
        setEditingParameters(true)
        setError(cause.message)
      } else {
        setError(cause instanceof ApiError ? cause.message : tr('queries.error.failed'))
      }
    } finally {
      setBusy(false)
    }
  }, [connectionId, queryId, parameters, onMeasured])

  // Les valeurs saisies ne sont plus celles qui ont produit le plan affiché : le dire évite de
  // lire un plan en croyant qu'il répond aux valeurs à l'écran.
  const stale =
    result !== null &&
    requiredParameters > 0 &&
    Array.from({ length: requiredParameters }, (_, index) => parameters[index] ?? '').join('\u0000') !==
      result.parameters.join('\u0000')

  return (
    <Modal
      title={t('queries.modal.title')}
      description={`${query.connectionName} · ${queryId}`}
      onClose={onClose}
      size="full"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button variant="primary" onClick={() => void run()} loading={busy}>
            <Play className="size-3.5" aria-hidden />
            {result ? t('queries.modal.remeasure') : t('queries.modal.measure')}
          </Button>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-3">
        {/* Provenance de ce qui est affiché, et seul endroit où l'analyse est expliquée. */}
        <div className="border-border-subtle bg-surface-sunken shrink-0 rounded-[var(--radius-card)] border px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
            {result ? (
              <>
                <span className="text-ink flex items-center gap-1.5 font-medium">
                  <Clock className="text-ink-faint size-3.5" aria-hidden />
                  <span title={t('queries.plan.measuredOn', { date: formatDateTime(result.measuredAt) })}>
                    {t('queries.plan.measured', { when: formatRelative(result.measuredAt) })}
                  </span>
                </span>
                <span className="text-ink-faint">
                  {t('queries.plan.duration', {
                    duration: formatSeconds(result.durationMs / 1000),
                  })}
                </span>
                {result.fromStorage && (
                  <Badge tone="success" title={t('queries.plan.storedTitle')}>
                    <Workflow className="size-3" aria-hidden />
                    {t('queries.plan.stored')}
                  </Badge>
                )}

                {/* Avec quelles valeurs ce plan a été obtenu — replié, l'éditeur ne dit plus
                    rien, donc les valeurs se lisent ici. Jamais les deux à la fois. */}
                {requiredParameters > 0 && !editingParameters && (
                  <span className="flex flex-wrap items-center gap-1">
                    <span className="text-ink-faint">{t('queries.plan.parameters')}</span>
                    {result.parameters.map((value, index) => (
                      <code
                        key={index}
                        className="bg-surface text-ink border-border-subtle rounded border px-1 font-mono text-[11px]"
                      >
                        ${index + 1} = {value === '' ? 'NULL' : value}
                      </code>
                    ))}
                  </span>
                )}
              </>
            ) : null}
            {/* Rien à dater tant qu'aucune mesure n'existe : l'état vide, plus bas, le dit une
                fois — un texte de remplacement ici le dirait deux fois. */}

            <span className="ml-auto flex items-center gap-1">
              {requiredParameters > 0 && result !== null && (
                <Button
                  variant="ghost"
                  onClick={() => setEditingParameters((current) => !current)}
                  className="h-7 px-2 text-xs"
                >
                  <Wand2 className="size-3.5" aria-hidden />
                  {editingParameters
                    ? t('queries.params.hideEditor')
                    : t('queries.params.showEditor')}
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => setShowSql((current) => !current)}
                className="h-7 px-2 text-xs"
              >
                <Code2 className="size-3.5" aria-hidden />
                {showSql ? t('queries.modal.hideSql') : t('queries.modal.showSql')}
              </Button>
            </span>
          </div>

          <p className="text-ink-faint mt-1 text-xs leading-snug">{t('queries.modal.readOnly')}</p>
        </div>

        {/* Après analyse, le texte réellement passé à EXPLAIN : préfixe retiré, paramètres
            substitués. C'est lui qui explique le plan affiché, et il n'apparaît qu'ici. */}
        {showSql && (
          <div className="shrink-0">
            <p className="text-ink-muted mb-1.5 text-xs font-medium">{t('queries.modal.sqlTitle')}</p>
            <SqlCode sql={result?.sql ?? sql} wrap className="max-h-40" />
          </div>
        )}

        {/* Sans plan à l'écran, les valeurs sont la condition de la mesure : l'éditeur est
            alors ouvert d'office. */}
        {requiredParameters > 0 && (editingParameters || result === null) && (
          <Card className="shrink-0">
            <CardHeader
              title={t('queries.params.title')}
              description={t('queries.params.description')}
              action={
                <Button onClick={() => void suggest()} loading={suggesting}>
                  <Wand2 className="size-3.5" aria-hidden />
                  {t('queries.params.suggest')}
                </Button>
              }
            />
            <CardBody className="grid gap-3 sm:grid-cols-3">
              {Array.from({ length: requiredParameters }, (_, index) => {
                const suggestion = suggestions.find((item) => item.index === index + 1)

                return (
                  <Field
                    key={index}
                    label={suggestion?.column ? `$${index + 1} · ${suggestion.column}` : `$${index + 1}`}
                    hint={
                      // `source` est une donnée de l'API, en anglais comme tout le backend ;
                      // seul le libellé affiché dépend de la langue de l'interface.
                      suggestion?.source === 'statistics'
                        ? t('queries.params.source.statistics')
                        : suggestion?.source === 'sample'
                          ? t('queries.params.source.sample')
                          : undefined
                    }
                  >
                    <Input
                      value={parameters[index] ?? ''}
                      onChange={(event) =>
                        setParameters((current) => {
                          const next = [...current]
                          next[index] = event.target.value
                          return next
                        })
                      }
                    />
                  </Field>
                )
              })}
            </CardBody>
          </Card>
        )}

        {stale && !error && (
          <Notice tone="warning" className="shrink-0">
            {t('queries.plan.stale')}
          </Notice>
        )}

        {error && (
          <Notice
            tone={requiredParameters > 0 ? 'warning' : 'danger'}
            title={t('queries.error.title')}
            className="shrink-0"
          >
            {error}
          </Notice>
        )}

        {/* Remarques propres à cette mesure : préfixe retiré, paramètres substitués. Le caractère
            lecture seule n'y figure pas — il est énoncé une fois, au-dessus. */}
        {result?.notes.map((note) => (
          <Notice key={note.code} tone="info" className="shrink-0">
            {noteLabel(t, tc, note)}
          </Notice>
        ))}

        {reading ? (
          <LoadingBlock label={t('queries.modal.reading')} />
        ) : busy && !result ? (
          <LoadingBlock label={t('queries.modal.loading')} />
        ) : result ? (
          <PlanView result={result} />
        ) : (
          <EmptyState
            icon={<Play className="size-6" />}
            title={t('queries.empty.plan.title')}
            description={t('queries.empty.plan.body')}
          />
        )}
      </div>
    </Modal>
  )
}
