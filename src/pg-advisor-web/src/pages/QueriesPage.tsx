import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Clock, Code2, Info, Play, Terminal, Wand2, Workflow, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { api, ApiError, isAbort } from '@/api/client'
import { useAbortable } from '@/lib/useAbortable'
import type {
  AnalysisNote,
  Connection,
  InstanceQueryStatus,
  ParameterSuggestion,
  QueryAnalysisResult,
  TopQuery,
} from '@/api/types'
import { Page } from '@/components/layout/Page'
import { PlanTotals, PlanView } from '@/components/PlanView'
import { QueryTable } from '@/components/QueryTable'
import {
  Badge,
  Button,
  Card,
  Checkbox,
  CopyButton,
  MultiSelect,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  Input,
  LastUpdated,
  LoadingBlock,
  Modal,
  Notice,
  RefreshBar,
  Select,
  Toolbar,
} from '@/components/ui/primitives'
import { formatDateTime, formatRelative, formatSeconds } from '@/lib/format'
import { currentLocale, hasTranslation, tr, useT, useTc } from '@/lib/i18n'
import type { PluralTranslator, Translator } from '@/lib/i18n'
import { SqlCode } from '@/lib/sqlHighlight'
import { cn } from '@/lib/utils'

const SORTS = ['total_time', 'mean_time', 'calls', 'rows', 'io', 'temp']

/** Identité d'une requête dans le classement : l'identifiant seul se répète d'une base à l'autre. */
function queryKey(query: TopQuery): string {
  return `${query.connectionId}:${query.queryId}`
}

export function QueriesPage() {
  const nextSignal = useAbortable()
  const t = useT()
  const tc = useTc()
  const [params, setParams] = useSearchParams()
  const [connections, setConnections] = useState<Connection[]>([])
  const [queries, setQueries] = useState<TopQuery[]>([])
  const [statuses, setStatuses] = useState<InstanceQueryStatus[]>([])
  const [loading, setLoading] = useState(true)
  // Vrai dès qu'un chargement s'est achevé, réussi ou non : au-delà, la liste déjà affichée
  // reste en place pendant qu'une autre arrive (§ 5, cas 2), au lieu de céder la place à un
  // sablier qui vide l'écran et déplace tout ce qui l'entoure.
  const [settled, setSettled] = useState(false)
  const [loadedAt, setLoadedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [target, setTarget] = useState<TopQuery | null>(null)
  // Dernière requête ouverte, conservée après la fermeture de la modale : au retour, une liste
  // de deux cents lignes ne dit plus d'où l'on vient.
  const [opened, setOpened] = useState<string | null>(null)

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
          next.set('connectionIds', String(list[0]!.id))
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
      setSettled(true)
      return
    }

    setLoading(true)
    const signal = nextSignal()

    try {
      const result = await api.queries.across({
        connectionIds: selection,
        sort,
        limit: Math.min(Math.max(limit, 1), 200),
        includeAdvisor,
      }, signal)
      setQueries(result.items)
      setStatuses(result.instances)
      setLoadedAt(new Date().toISOString())
      setError(null)
    } catch (cause) {
      // Chargement remplacé par un plus récent : sa réponse ne doit ni s'afficher ni alarmer.
      if (isAbort(cause)) return

      // `tr` plutôt que `t` : le rappel est mémorisé, et dépendre du traducteur le recréerait
      // à chaque bascule de langue — donc rechargerait la liste pour rien.
      setError(cause instanceof Error ? cause.message : tr('queries.loadFailed'))
    } finally {
      setLoading(false)
      setSettled(true)
    }
  }, [selection, sort, limit, includeAdvisor, nextSignal])

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
        {/* Barre d'outils de la famille étude : une rangée, contrôles resserrés par `Toolbar`.
            Chaque pixel repris ici revient au classement, dont la hauteur est mesurée sur la
            place restante. Les indications détaillées passent en infobulle : cette vue se
            fréquente, elle ne s'explique pas à chaque ouverture. */}
        <Toolbar className="bg-surface border-border-subtle shadow-card rounded-[var(--radius-card)] border px-4 py-3">
          {/* Les trois contrôles portent leur nom sur la même ligne qu'eux : une étiquette
              posée au-dessus doublerait la hauteur de la barre, et une barre sans étiquette
              oblige à deviner ce que classe « prod-eu-west ». */}
          <span
            className="text-ink-muted text-meta flex items-center gap-2"
            title={t('queries.filter.instancesHint')}
          >
            {t('queries.filter.instances')}
            <MultiSelect
              label={t('queries.filter.instancesLabel')}
              unit={t('common.instance').toLowerCase()}
              className="w-52"
              values={selected}
              options={connections.map((connection) => ({
                value: String(connection.id),
                label: connection.name,
              }))}
              onChange={(values) => setFilter('connectionIds', values.join(','))}
            />
          </span>

          <label className="text-ink-muted text-meta flex items-center gap-2">
            {t('queries.filter.sort')}
            <Select
              value={sort}
              className="w-44"
              title={t('queries.filter.sortHint')}
              aria-label={t('queries.filter.sort')}
              onChange={(event) => setFilter('sort', event.target.value)}
            >
              {SORTS.map((item) => (
                <option key={item} value={item}>
                  {t(`queries.sort.${item}`)}
                </option>
              ))}
            </Select>
          </label>

          <label className="text-ink-muted text-meta flex items-center gap-2">
            {t('queries.filter.limitShort')}
            <Input
              type="number"
              min={1}
              max={200}
              value={limit}
              className="w-20"
              title={`${t('queries.filter.limit')} — ${t('queries.filter.limitHint')}`}
              aria-label={t('queries.filter.limit')}
              onChange={(event) => setFilter('limit', event.target.value)}
            />
          </label>

          <Checkbox
            label={t('queries.filter.advisor')}
            title={t('queries.filter.advisorTitle')}
            checked={includeAdvisor}
            onChange={(event) => setFilter('includeAdvisor', event.target.checked ? '1' : '')}
          />

          <Button variant="primary" onClick={() => void load()} className="ml-auto">
            {t('queries.refresh')}
          </Button>
        </Toolbar>

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
                ? // Décompte injecté : `tc`, sinon « 1 instances » finit par s'écrire.
                  tc('queries.list.merged', selected.length)
                : t('queries.list.single')
            }
            action={loadedAt && <LastUpdated at={loadedAt} />}
          />

          {/* Liseré de rechargement : le classement reste lisible pendant qu'un autre arrive. */}
          <RefreshBar active={loading && settled} />

          {!settled && loading ? (
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
            <div aria-busy={loading}>
              <QueryTable
                queries={queries}
                showInstance={selected.length > 1}
                rankedBy={sort}
                selected={opened}
                onAnalyze={(query) => {
                  setOpened(queryKey(query))
                  setTarget(query)
                }}
              />
            </div>
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

/** Panneaux superposés au diagramme : ce qui n'est pas le plan y est atteignable. */
type Panel = 'sql' | 'params' | 'notes'

/**
 * Modale d'analyse. Le diagramme est le corps de la modale et l'occupe en entier : rien de ce
 * qui n'est pas le plan ne consomme de hauteur en permanence.
 *
 * La provenance de la mesure et les compteurs d'ensemble tiennent dans l'en-tête, dont la
 * hauteur est déjà payée ; la requête analysée, les valeurs des paramètres et les remarques de
 * l'API s'ouvrent dans un panneau qui recouvre le canevas au lieu de le pousser ; les erreurs
 * flottent au-dessus du diagramme. Sans plan à afficher, la mise en page redevient une pile —
 * et c'est alors le texte de la requête, seul objet à étudier, qui prend la hauteur libre.
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
  const [panel, setPanel] = useState<Panel | null>(null)

  // Relecture du plan conservé : c'est tout l'intérêt de le conserver, et c'est gratuit pour
  // l'instance supervisée.
  useEffect(() => {
    let abandoned = false

    void api.queries
      .savedPlan(connectionId, { queryId })
      .then((saved) => {
        if (abandoned || !saved) return

        setResult(saved)
        if (saved.parameters.length > 0) {
          setParameters(saved.parameters)
          setRequiredParameters(saved.parameters.length)
        }
      })
      .catch(() => undefined)
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
      // Le plan vient de changer : le panneau se referme pour rendre la surface au diagramme.
      setPanel(null)
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
        setPanel('params')
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

  const notes = result?.notes ?? []

  const editor = (
    <ParameterEditor
      count={requiredParameters}
      values={parameters}
      suggestions={suggestions}
      suggesting={suggesting}
      onChange={(index, value) =>
        setParameters((current) => {
          const next = [...current]
          next[index] = value
          return next
        })
      }
      onSuggest={() => void suggest()}
    />
  )

  // Les panneaux disponibles, dans l'ordre où ils sont proposés. La même liste sert aux boutons
  // de l'en-tête et aux onglets du panneau : ce qui s'ouvre depuis l'en-tête se retrouve depuis
  // le panneau, sans avoir à le refermer.
  const panels: { key: Panel; icon: LucideIcon; label: string; title: string; count?: number }[] = [
    { key: 'sql', icon: Code2, label: t('queries.panel.sql'), title: t('queries.modal.sqlTitle') },
    ...(requiredParameters > 0
      ? [
          {
            key: 'params' as const,
            icon: Wand2,
            label: t('queries.panel.parameters'),
            title: t('queries.params.title'),
            count: requiredParameters,
          },
        ]
      : []),
    ...(notes.length > 0
      ? [
          {
            key: 'notes' as const,
            icon: Info,
            label: t('queries.panel.notes'),
            title: t('queries.panel.notesTitle'),
            count: notes.length,
          },
        ]
      : []),
  ]

  const buttons = panels.map((item) => (
    <Button
      key={item.key}
      variant={panel === item.key ? 'secondary' : 'ghost'}
      size="sm"
      aria-pressed={panel === item.key}
      title={item.title}
      onClick={() => setPanel((current) => (current === item.key ? null : item.key))}
      className="gap-1.5 px-2"
    >
      <item.icon className="size-4" aria-hidden />
      {item.label}
      {item.count !== undefined && <span className="text-ink-muted tabular-nums">{item.count}</span>}
    </Button>
  ))

  return (
    <Modal
      title={t('queries.modal.title')}
      description={
        <>
          {query.connectionName} · <span className="font-mono">{queryId}</span>
        </>
      }
      // Provenance, compteurs d'ensemble et accès aux panneaux : l'en-tête paie déjà sa hauteur,
      // les y poser ne coûte rien au diagramme.
      actions={
        result && (
          <>
            {/* `min-w-0` : sans lui, cette rangée refuse de se réduire et c'est le titre de la
                modale qui se tronque à sa place. Un en-tête doit céder ses compteurs avant de
                céder le nom de ce qu'il coiffe. */}
            <span className="text-meta flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
              <span
                className="text-ink flex items-center gap-1.5 font-medium"
                title={t('queries.plan.measuredOn', { date: formatDateTime(result.measuredAt) })}
              >
                <Clock className="text-ink-muted size-3.5" aria-hidden />
                {t('queries.plan.measured', { when: formatRelative(result.measuredAt) })}
              </span>
              {/* Combien de temps la mesure a duré : utile, secondaire. S'efface quand la
                  rangée ne tient plus, avant la date de mesure et avant le titre. */}
              <span className="text-ink-muted hidden 2xl:inline">
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
              <PlanTotals plan={result.plan} />
            </span>

            <span className="flex shrink-0 flex-wrap items-center gap-1">{buttons}</span>
          </>
        )
      }
      onClose={onClose}
      size="full"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button variant="primary" onClick={() => void run()} loading={busy}>
            <Play className="size-4" aria-hidden />
            {result ? t('queries.modal.remeasure') : t('queries.modal.measure')}
          </Button>
        </>
      }
    >
      {result ? (
        // Le diagramme prend le corps entier, marges de la modale comprises : la marge est
        // reprise par le retrait négatif, et la hauteur la récupère d'autant. Tout le reste se
        // superpose au canevas au lieu de le rogner.
        <div className="relative -m-5 h-[calc(100%+2.5rem)] overflow-hidden">
          <PlanView result={result} />

          {panel && (
            <div
              role="region"
              aria-label={panels.find((item) => item.key === panel)?.title}
              className="border-border-subtle bg-surface shadow-popover absolute inset-x-0 top-0 z-30 flex max-h-[80%] flex-col border-b"
            >
              <Toolbar className="border-border-subtle shrink-0 gap-1 border-b px-3 py-2">
                {buttons}
                <Button variant="ghost" size="sm" onClick={() => setPanel(null)} className="ml-auto gap-1.5 px-2">
                  <X className="size-4" aria-hidden />
                  {t('common.close')}
                </Button>
              </Toolbar>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                {panel === 'sql' && <AnalysedSql sql={result.sql} />}

                {panel === 'params' && (
                  <div className="space-y-3">
                    {/* Avec quelles valeurs le plan affiché a été obtenu — ce n'est pas
                        forcément ce que portent les champs de saisie. */}
                    <p className="text-meta flex flex-wrap items-center gap-1.5">
                      <span className="text-ink-muted">{t('queries.plan.parameters')}</span>
                      {result.parameters.map((value, index) => (
                        <code
                          key={index}
                          className="bg-surface-sunken text-ink border-border-subtle rounded border px-1.5 font-mono"
                        >
                          ${index + 1} = {value === '' ? 'NULL' : value}
                        </code>
                      ))}
                    </p>
                    {editor}
                  </div>
                )}

                {panel === 'notes' && (
                  <div className="space-y-2">
                    {/* Remarques propres à cette mesure : préfixe retiré, paramètres substitués. */}
                    {notes.map((note) => (
                      <Notice key={note.code} tone="info">
                        {noteLabel(t, tc, note)}
                      </Notice>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Avertissements liés au geste en cours : ils flottent au-dessus du diagramme, dans
              l'angle où il n'y a rien à lire, et ne lui prennent jamais de hauteur. */}
          <div className="pointer-events-none absolute right-3 bottom-3 z-40 flex w-[min(26rem,calc(100%-1.5rem))] flex-col items-end gap-2">
            {/* Pas de fermeture pour celui-ci : l'écart reste vrai tant qu'il n'a pas été levé
                par une nouvelle mesure. */}
            {stale && !error && (
              <Notice tone="warning" className="shadow-popover pointer-events-auto w-full">
                {t('queries.plan.stale')}
              </Notice>
            )}

            {error && (
              <Notice
                tone={requiredParameters > 0 ? 'warning' : 'danger'}
                title={t('queries.error.title')}
                className="shadow-popover pointer-events-auto w-full"
                onDismiss={() => setError(null)}
              >
                {error}
              </Notice>
            )}
          </div>
        </div>
      ) : (
        // Sans plan, le canevas n'a rien à montrer : la modale redevient une pile ordinaire.
        // C'est alors le texte de la requête qui est l'objet étudié — celui qu'on lit avant de
        // décider d'exécuter quoi que ce soit sur une base de production —, et c'est donc lui
        // qui prend toute la hauteur libre.
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div className="shrink-0 space-y-3">
            {reading ? (
              <LoadingBlock label={t('queries.modal.reading')} />
            ) : busy ? (
              <LoadingBlock label={t('queries.modal.loading')} />
            ) : (
              <Notice tone="info" title={t('queries.empty.plan.title')}>
                {t('queries.empty.plan.body')}
              </Notice>
            )}

            {error && (
              <Notice
                tone={requiredParameters > 0 ? 'warning' : 'danger'}
                title={t('queries.error.title')}
                onDismiss={() => setError(null)}
              >
                {error}
              </Notice>
            )}

            {/* Les valeurs sont ici la condition de la mesure : l'éditeur est ouvert d'office. */}
            {requiredParameters > 0 && (
              <Card>
                <CardHeader title={t('queries.params.title')} />
                <CardBody>{editor}</CardBody>
              </Card>
            )}
          </div>

          {/* Le texte prend la hauteur dont il a besoin et cède devant ce qui manque : une
              requête d'une ligne n'a pas à s'étirer en un pavé vide de six cents pixels, et
              une requête de trois cents lignes défile dans ce qui reste. */}
          <AnalysedSql sql={sql} className="min-h-0" />
        </div>
      )}
    </Modal>
  )
}

/**
 * Requête telle qu'elle est soumise à EXPLAIN : après analyse, préfixe retiré et paramètres
 * substitués ; avant, le texte normalisé par pg_stat_statements. Le rappel du mode d'exécution
 * la suit — il décrit ce que la mesure fera de ce texte, et n'a de sens qu'à côté de lui.
 *
 * Toujours copiable : l'Advisor n'agit pas sur l'instance, il livre un texte à porter ailleurs.
 * Un diagnostic qu'il faut resaisir à la main n'est pas exploitable.
 */
function AnalysedSql({ sql, className }: { sql: string; className?: string }) {
  const t = useT()

  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-ink-muted text-micro font-semibold tracking-wider uppercase">
          {t('queries.modal.sqlTitle')}
        </span>
        <CopyButton value={sql} label={t('queries.modal.sqlTitle')} />
      </div>
      {/* La taille du code est celle du socle — `SqlCode` et `CodeBlock` la partagent — et elle
          ne se force pas depuis ici : `cn` ne reconnaît pas les tailles nommées comme des
          tailles de police, si bien qu'une classe passée en appel s'ajoute sans remplacer. */}
      <SqlCode sql={sql} wrap className="min-h-0" />
      <p className="text-ink-muted text-meta mt-1.5 leading-snug">{t('queries.modal.readOnly')}</p>
    </div>
  )
}

/**
 * Saisie des valeurs de $1, $2… Le même éditeur sert dans le panneau superposé au diagramme et
 * dans la pile affichée quand aucun plan n'existe : une seule écriture, deux emplacements.
 */
function ParameterEditor({
  count,
  values,
  suggestions,
  suggesting,
  onChange,
  onSuggest,
}: {
  count: number
  values: string[]
  suggestions: ParameterSuggestion[]
  suggesting: boolean
  onChange: (index: number, value: string) => void
  onSuggest: () => void
}) {
  const t = useT()

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-ink-muted text-meta min-w-0 flex-1">{t('queries.params.description')}</p>
        <Button size="sm" onClick={onSuggest} loading={suggesting}>
          <Wand2 className="size-4" aria-hidden />
          {t('queries.params.suggest')}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: count }, (_, index) => {
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
                value={values[index] ?? ''}
                onChange={(event) => onChange(index, event.target.value)}
              />
            </Field>
          )
        })}
      </div>
    </div>
  )
}
