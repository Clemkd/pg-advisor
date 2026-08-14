import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Play, Terminal, Wand2 } from 'lucide-react'
import { api, ApiError } from '@/api/client'
import type {
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
import { SqlCode } from '@/lib/sqlHighlight'

const SORTS = [
  { value: 'total_time', label: 'Temps cumulé' },
  { value: 'mean_time', label: 'Temps moyen' },
  { value: 'calls', label: "Nombre d'appels" },
  { value: 'rows', label: 'Lignes retournées' },
  { value: 'io', label: 'Blocs lus sur disque' },
  { value: 'temp', label: 'Fichiers temporaires' },
]

export function QueriesPage() {
  const [params, setParams] = useSearchParams()
  const [connections, setConnections] = useState<Connection[]>([])
  const [queries, setQueries] = useState<TopQuery[]>([])
  const [statuses, setStatuses] = useState<InstanceQueryStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [target, setTarget] = useState<{ sql?: string; query?: TopQuery } | null>(null)

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
      setError(cause instanceof Error ? cause.message : 'Chargement impossible.')
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
    <Page
      title="Requêtes"
      description="Classement des requêtes d'une ou plusieurs instances, et analyse de leur plan à la demande. L'analyse s'exécute en lecture seule, dans une transaction annulée."
      wide
    >
      <div className="space-y-4">
        <Card>
          <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Instances" hint="Classement fusionné">
              <MultiSelect
                label="Instances à classer"
                unit="instance"
                values={selected}
                options={connections.map((connection) => ({
                  value: String(connection.id),
                  label: connection.name,
                }))}
                onChange={(values) => setFilter('connectionIds', values.join(','))}
              />
            </Field>

            <Field label="Classer par" hint="Critère appliqué côté serveur">
              <Select value={sort} onChange={(event) => setFilter('sort', event.target.value)}>
                {SORTS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Nombre de requêtes à lire" hint="De 1 à 200">
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
                label="Requêtes de l'Advisor"
                title="Règles, collecteurs et analyses lancés par l'Advisor, reconnus au rôle qui les exécute"
                checked={includeAdvisor}
                onChange={(event) => setFilter('includeAdvisor', event.target.checked ? '1' : '')}
              />
              <Button variant="primary" size="md" onClick={() => void load()} className="ml-auto">
                Actualiser
              </Button>
            </div>
          </CardBody>
        </Card>

        {error && (
          <Notice tone="danger" title="Erreur">
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
            title="Requêtes les plus coûteuses"
            description={
              selected.length > 1
                ? `Classement fusionné de ${selected.length} instances ; la part est relative à la base d'origine.`
                : 'Colonnes triables et filtrables ; la liste est virtualisée.'
            }
          />

          {loading ? (
            <LoadingBlock />
          ) : queries.length === 0 ? (
            <EmptyState
              icon={<Terminal className="size-6" />}
              title="Aucune requête à afficher"
              description={
                statuses.some((instance) => !instance.available)
                  ? 'Installez pg_stat_statements sur les instances signalées pour obtenir leur classement.'
                  : 'Aucune requête enregistrée depuis la dernière remise à zéro des statistiques.'
              }
            />
          ) : (
            <QueryTable
              queries={queries}
              showInstance={selected.length > 1}
              onAnalyze={(query) => setTarget({ query })}
            />
          )}
        </Card>
      </div>

      {target?.query && (
        <AnalysisModal
          // L'analyse part vers l'instance d'où vient la requête, pas vers une sélection.
          connectionId={target.query.connectionId}
          sql={target.sql ?? target.query.query}
          queryId={target.query.queryId}
          onClose={() => setTarget(null)}
        />
      )}
    </Page>
  )
}

/**
 * Modale d'analyse : la requête colorée, un bouton d'exécution, puis le plan mesuré en trois
 * vues. L'analyse exécute réellement la requête pour en mesurer les temps ; elle reste donc
 * déclenchée par l'opérateur, jamais à l'ouverture.
 */
function AnalysisModal({
  connectionId,
  sql,
  queryId,
  onClose,
}: {
  connectionId: number
  sql: string
  queryId?: string
  onClose: () => void
}) {
  const [result, setResult] = useState<QueryAnalysisResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [parameters, setParameters] = useState<string[]>([])
  const [requiredParameters, setRequiredParameters] = useState(0)
  const [suggestions, setSuggestions] = useState<ParameterSuggestion[]>([])
  const [suggesting, setSuggesting] = useState(false)

  /** Remplit les champs avec des valeurs réellement présentes dans la base supervisée. */
  const suggest = useCallback(async () => {
    setSuggesting(true)
    try {
      const proposal = await api.queries.suggestParameters(connectionId, {
        sql: queryId ? undefined : sql,
        queryId,
      })

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
      setError(cause instanceof ApiError ? cause.message : 'Aucune valeur n’a pu être proposée.')
    } finally {
      setSuggesting(false)
    }
  }, [connectionId, sql, queryId])

  const run = useCallback(async () => {
    setBusy(true)
    setError(null)

    try {
      const analysis = await api.queries.analyze(connectionId, {
        sql: queryId ? undefined : sql,
        queryId,
        buffers: true,
        parameters: parameters.length > 0 ? parameters : undefined,
      })
      setResult(analysis)
      setRequiredParameters(0)
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 422) {
        // La requête est normalisée : l'interface réclame les valeurs manquantes.
        const required = Number(/(\d+) valeur/.exec(cause.message)?.[1] ?? 0)
        setRequiredParameters(required)
        setParameters((current) =>
          current.length === required ? current : Array.from({ length: required }, () => ''),
        )
        setError(cause.message)
      } else {
        setError(cause instanceof ApiError ? cause.message : "L'analyse a échoué.")
      }
    } finally {
      setBusy(false)
    }
  }, [connectionId, sql, queryId, parameters])

  return (
    <Modal
      title="Analyse de la requête"
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Fermer
          </Button>
          <Button variant="primary" onClick={() => void run()} loading={busy}>
            <Play className="size-3.5" aria-hidden />
            {result ? "Relancer l'analyse" : 'Explain analyze'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="text-ink-muted mb-1.5 text-xs font-medium">Requête concernée</p>
          {/* Après analyse, le texte réellement passé à EXPLAIN : préfixe retiré, paramètres
              substitués. C'est lui qui explique le plan affiché dessous. */}
          <SqlCode sql={result?.sql ?? sql} wrap className="max-h-56" />
          <p className="text-ink-faint mt-1.5 text-xs">
            « Explain analyze » exécute&nbsp;
            <code className="bg-surface-sunken rounded px-1 font-mono">
              EXPLAIN (ANALYZE, COSTS, VERBOSE, BUFFERS, FORMAT JSON)
            </code>
            &nbsp;sur l'instance, dans une transaction annulée et en lecture seule. Les temps
            affichés sont mesurés, jamais estimés.
          </p>
        </div>

        {requiredParameters > 0 && (
          <Card>
            <CardHeader
              title="Valeurs des paramètres"
              description="Le texte est normalisé par pg_stat_statements : ses valeurs ont été remplacées par $1, $2… Le plan dépend des valeurs fournies."
              action={
                <Button onClick={() => void suggest()} loading={suggesting}>
                  <Wand2 className="size-3.5" aria-hidden />
                  Proposer des valeurs
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
                        ? 'valeur la plus fréquente'
                        : suggestion?.source === 'sample'
                          ? 'valeur existante'
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

        {error && (
          <Notice tone={requiredParameters > 0 ? 'warning' : 'danger'} title="Analyse impossible">
            {error}
          </Notice>
        )}

        {busy && !result && <LoadingBlock label="Analyse en cours…" />}

        {!busy && !result && !error && (
          <EmptyState
            icon={<Play className="size-6" />}
            title="Aucun plan pour le moment"
            description="Lancez « Explain analyze » : la requête est exécutée une fois pour produire son plan mesuré."
          />
        )}

        {result && <PlanView result={result} />}
      </div>
    </Modal>
  )
}
