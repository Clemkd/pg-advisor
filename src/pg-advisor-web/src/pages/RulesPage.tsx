import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { FilterX, ScrollText } from 'lucide-react'
import { api } from '@/api/client'
import type { Rule, RuleError } from '@/api/types'
import { useAuth } from '@/app/AuthContext'
import { useEventListener } from '@/app/EventsContext'
import { Page } from '@/components/layout/Page'
import { FilterInput } from '@/components/ui/FilterInput'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  LastUpdated,
  LiveRegion,
  LoadingBlock,
  MultiSelect,
  Notice,
  RefreshBar,
  SeverityBadge,
  TBody,
  THead,
  Table,
  TableScroll,
  Td,
  Th,
  Tr,
} from '@/components/ui/primitives'
import { categoryLabel, severityLabel } from '@/lib/format'
import { tr, useT, useTc } from '@/lib/i18n'
import type { PluralTranslator, Translator } from '@/lib/i18n'
import { guardAnnouncement, RULE_GUARD_EVENTS } from '@/lib/ruleGuard'

/** Colonnes triables. Le tri se fait ici : le catalogue tient en mémoire, il est chargé en entier. */
type SortKey = 'rule' | 'category' | 'severity' | 'origin' | 'state'

/** La sévérité se trie par gravité, jamais par ordre alphabétique. */
const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 }

const SEVERITIES = ['critical', 'warning', 'info']

/**
 * Valeurs de la colonne d'état. L'activation vient de la règle, la santé du garde-fou : une règle
 * activée peut être écartée d'une instance, et c'est justement ce qu'il faut pouvoir retrouver.
 */
function stateTags(rule: Rule): string[] {
  const tags = [rule.enabled ? 'enabled' : 'disabled']
  if (degradedOn(rule) > 0) tags.push('degraded')
  if (quarantinedOn(rule) > 0) tags.push('quarantined')
  return tags
}

/** Le plus préoccupant d'abord : écartée, dégradée, puis l'ordre d'activation habituel. */
function stateRank(rule: Rule): number {
  if (quarantinedOn(rule) > 0) return 0
  if (degradedOn(rule) > 0) return 1
  return rule.enabled ? 2 : 3
}

/*
 * Une API antérieure au garde-fou ne renvoie pas ces décomptes. Zéro se lit alors comme
 * « rien à signaler », ce qui est exactement ce qu'une telle API sait dire.
 */
const degradedOn = (rule: Rule) => rule.degradedInstances ?? 0
const quarantinedOn = (rule: Rule) => rule.quarantinedInstances ?? 0

/*
 * Capitales de l'en-tête. `Th` les pose sur la cellule, mais le libellé triable vit dans un
 * bouton, et la remise à zéro du navigateur annule l'héritage de `text-transform` sur les
 * boutons : sans cela, les colonnes triables s'écrivaient en minuscules et la seule qui ne l'est
 * pas ressortait.
 */
const HEAD = '[&>button]:uppercase whitespace-nowrap'

/** Largeur en deçà de laquelle le tableau défile plutôt que d'écraser ses colonnes. */
const TABLE_MIN_WIDTH = 940

/** Paramètres d'URL portant l'état du tableau : une vue filtrée se partage par simple lien. */
const FILTER_KEYS = ['q', 'category', 'severity', 'origin', 'state']

export function RulesPage() {
  const { isAdmin } = useAuth()
  const navigate = useNavigate()
  const t = useT()
  const tc = useTc()
  const [params, setParams] = useSearchParams()

  const [rules, setRules] = useState<Rule[]>([])
  const [errors, setErrors] = useState<RuleError[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [reloading, setReloading] = useState(false)
  const [loadedAt, setLoadedAt] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState<string | null>(null)

  const search = params.get('q') ?? ''
  const sortKey = (params.get('sort') as SortKey | null) ?? 'rule'
  const descending = params.get('dir') === 'desc'

  const readList = useCallback(
    (key: string) => {
      const raw = params.get(key)
      return raw ? raw.split(',').filter(Boolean) : []
    },
    [params],
  )

  const categoryFilter = readList('category')
  const severityFilter = readList('severity')
  const originFilter = readList('origin')
  const stateFilter = readList('state')
  const filtering = FILTER_KEYS.some((key) => params.get(key))

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params)
      if (value) next.set(key, value)
      else next.delete(key)
      setParams(next, { replace: true })
    },
    [params, setParams],
  )

  const load = useCallback(async () => {
    setRefreshing(true)

    try {
      const [list, ruleErrors] = await Promise.all([api.rules.list(), api.rules.errors()])
      setRules(list)
      setErrors(ruleErrors)
      setLoadedAt(new Date().toISOString())
      setFailure(null)
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : tr('common.loadFailed'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Les règles se rechargent à chaud, y compris depuis un fichier déposé sur le volume : la vue
  // le dit au lieu d'afficher un catalogue périmé sans le savoir.
  useEventListener(['rules.reloaded'], () => {
    setAnnouncement(tr('rules.live.reloaded'))
    void load()
  })

  // Le garde-fou change l'état d'une règle sans qu'on ait rien demandé : la liste se remet à jour
  // sans se vider, et l'annonce dit laquelle, sur quelle instance.
  useEventListener(RULE_GUARD_EVENTS, (event) => {
    setAnnouncement(guardAnnouncement(event))
    void load()
  })

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()

    return rules.filter((rule) => {
      if (categoryFilter.length > 0 && !categoryFilter.includes(rule.category)) return false
      if (severityFilter.length > 0 && !severityFilter.includes(rule.severity)) return false
      if (originFilter.length > 0 && !originFilter.includes(rule.origin)) return false
      if (stateFilter.length > 0 && !stateTags(rule).some((tag) => stateFilter.includes(tag))) {
        return false
      }
      if (!needle) return true

      // La recherche porte sur ce qui identifie la règle et sur ce qu'elle dit d'elle-même :
      // on cherche aussi bien « bloat » que « lignes mortes ».
      return (
        rule.id.toLowerCase().includes(needle) ||
        rule.name.toLowerCase().includes(needle) ||
        (rule.description ?? '').toLowerCase().includes(needle)
      )
    })
  }, [rules, search, categoryFilter, severityFilter, originFilter, stateFilter])

  const ordered = useMemo(() => {
    const sign = descending ? -1 : 1

    const compare = (left: Rule, right: Rule) => {
      switch (sortKey) {
        case 'category':
          return categoryLabel(left.category).localeCompare(categoryLabel(right.category))
        case 'severity':
          return (SEVERITY_RANK[left.severity] ?? 9) - (SEVERITY_RANK[right.severity] ?? 9)
        case 'origin':
          return left.origin.localeCompare(right.origin)
        case 'state':
          return stateRank(left) - stateRank(right)
        default:
          return 0
      }
    }

    // Le nom départage toujours : deux règles de même catégorie gardent un ordre stable d'un
    // affichage à l'autre, sans quoi la liste bouge à chaque rechargement du catalogue.
    return [...filtered].sort(
      (left, right) => sign * (compare(left, right) || left.name.localeCompare(right.name)),
    )
  }, [filtered, sortKey, descending])

  const categories = useMemo(() => [...new Set(rules.map((rule) => rule.category))].sort(), [rules])

  // Une règle écartée cesse de produire son diagnostic : la catégorie qu'elle notait n'est plus
  // notée. Le dire en tête de la vue, et pas seulement au fond d'une colonne.
  const quarantined = useMemo(() => rules.filter((rule) => quarantinedOn(rule) > 0), [rules])
  const degraded = useMemo(
    () => rules.filter((rule) => degradedOn(rule) > 0 && quarantinedOn(rule) === 0),
    [rules],
  )

  async function reload() {
    setReloading(true)

    try {
      await api.rules.reload()
      await load()
      setAnnouncement(tr('rules.live.reloaded'))
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : tr('rules.reloadFailed'))
    } finally {
      setReloading(false)
    }
  }

  function clearFilters() {
    const next = new URLSearchParams(params)
    FILTER_KEYS.forEach((key) => next.delete(key))
    setParams(next, { replace: true })
  }

  function toggleSort(key: SortKey) {
    const next = new URLSearchParams(params)
    next.set('sort', key)
    // Une nouvelle colonne s'ouvre en ordre croissant ; la même colonne s'inverse.
    if (key === sortKey && !descending) next.set('dir', 'desc')
    else next.delete('dir')
    setParams(next, { replace: true })
  }

  const sortOf = (key: SortKey) => (sortKey === key ? (descending ? 'desc' : 'asc') : null)
  const setList = (key: string) => (values: string[]) => setParam(key, values.join(','))

  /** Ramène le tableau sur les seules règles que le garde-fou a signalées. */
  function showGuarded() {
    setParam(
      'state',
      [quarantined.length > 0 ? 'quarantined' : '', degraded.length > 0 ? 'degraded' : '']
        .filter(Boolean)
        .join(','),
    )
  }

  return (
    <Page
      title={t('nav.rules')}
      description={t('rules.subtitle')}
      meta={<LastUpdated at={loadedAt} />}
      actions={
        isAdmin && (
          <>
            <Button onClick={reload} loading={reloading}>
              {t('rules.reload')}
            </Button>
            {/* Action principale d'une vue d'installation : 44 px, et un verbe. */}
            <Button variant="primary" size="lg" onClick={() => navigate('/rules/new')}>
              {t('rules.new')}
            </Button>
          </>
        )
      }
      wide
    >
      <div className="space-y-4">
        <LiveRegion message={announcement} />

        {failure && (
          <Notice tone="danger" title={t('common.error')}>
            {failure}
          </Notice>
        )}

        {/* Les règles en erreur passent avant le catalogue : une règle écartée ne produit plus
            aucun diagnostic, et rien d'autre dans l'application ne le signale. */}
        {errors.length > 0 && (
          <Card>
            <CardHeader title={tc('rules.failing', errors.length)} description={t('rules.failingHint')} />
            <CardBody className="space-y-2">
              {errors.map((ruleError, index) => (
                <div
                  key={`${ruleError.file}-${index}`}
                  className="border-danger bg-danger-subtle rounded-[var(--radius-control)] border-l-2 px-3 py-2"
                >
                  <p className="text-ink font-mono font-medium">{ruleError.ruleId ?? ruleError.file}</p>
                  <p className="text-ink">{ruleError.message}</p>
                  <p className="text-ink-muted text-meta">
                    <span className="font-mono">{ruleError.file}</span> ·{' '}
                    {ruleError.origin === 'user' ? t('rules.customRule') : t('rules.bundledRule')}
                  </p>
                </div>
              ))}
            </CardBody>
          </Card>
        )}

        {/* Le garde-fou passe avant le catalogue, pour la même raison que les règles en erreur :
            une règle écartée ne produit plus de diagnostic, et le score de l'instance remonte
            sans que rien d'autre ne le dise. */}
        {(quarantined.length > 0 || degraded.length > 0) && (
          <Notice
            tone="warning"
            title={
              quarantined.length > 0
                ? tc('rules.guard.quarantinedTitle', quarantined.length)
                : tc('rules.guard.degradedTitle', degraded.length)
            }
          >
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-2">
              <p className="min-w-0 flex-1 basis-72">
                {quarantined.length > 0 ? t('rules.guard.quarantinedBody') : t('rules.guard.degradedBody')}
                {quarantined.length > 0 && degraded.length > 0 && (
                  <> {tc('rules.guard.alsoDegraded', degraded.length)}</>
                )}
              </p>
              <Button onClick={showGuarded}>{t('rules.guard.show')}</Button>
            </div>
          </Notice>
        )}

        <Card>
          {/* Le décompte dit ce que les filtres ont laissé, et le geste qui les lève se tient
              juste à côté du chiffre qu'il fait bouger. */}
          <CardHeader
            title={t('rules.catalog')}
            description={tc('rules.countOf', ordered.length, { total: rules.length })}
            action={
              filtering && (
                <Button variant="ghost" onClick={clearFilters} className="gap-1.5">
                  <FilterX className="size-4" aria-hidden />
                  {t('common.clearFilters')}
                </Button>
              )
            }
          />

          <RefreshBar active={refreshing && !loading} />

          {loading ? (
            <LoadingBlock />
          ) : rules.length === 0 ? (
            <EmptyState
              icon={<ScrollText className="size-6" aria-hidden />}
              title={t('rules.empty.title')}
              description={t('rules.empty.hint')}
              // Un état vide d'installation porte le geste attendu, pas un constat.
              action={
                isAdmin && (
                  <Button variant="primary" size="lg" onClick={() => navigate('/rules/new')}>
                    {t('rules.new')}
                  </Button>
                )
              }
            />
          ) : (
            <div aria-busy={refreshing}>
              <TableScroll minWidth={TABLE_MIN_WIDTH}>
                <Table>
                  {/*
                   * Filtre et tri sont posés dans l'en-tête de la colonne qu'ils gouvernent : une
                   * barre séparée oblige à faire le lien de tête entre un champ et sa colonne, et
                   * coûte une carte entière de hauteur. Le contrôle suit la nature de la donnée —
                   * saisie libre pour du texte, sélection multiple pour une valeur énumérée.
                   */}
                  <THead>
                    <Tr>
                      {/* La colonne d'identité prend la largeur ; les autres restent étroites. */}
                      {/* La colonne d'identité absorbe la place restante — `w-full` sur une
                          seule cellule, la règle habituelle des tableaux à disposition
                          automatique — et garde un minimum : sans lui, une colonne qui peut se
                          replier cède tout à celles qui ne le peuvent pas, et le nom de la règle
                          finissait sur trois lignes pendant qu'une liste de prérequis s'étalait. */}
                      <Th
                        className={`w-full min-w-56 ${HEAD}`}
                        sort={sortOf('rule')}
                        onSort={() => toggleSort('rule')}
                      >
                        {t('rules.rule')}
                      </Th>
                      <Th className={HEAD} sort={sortOf('category')} onSort={() => toggleSort('category')}>
                        {t('common.category')}
                      </Th>
                      <Th className={HEAD} sort={sortOf('severity')} onSort={() => toggleSort('severity')}>
                        {t('common.severity')}
                      </Th>
                      <Th className="whitespace-nowrap">{t('rules.requirements')}</Th>
                      <Th className={HEAD} sort={sortOf('origin')} onSort={() => toggleSort('origin')}>
                        {t('rules.origin')}
                      </Th>
                      <Th className={HEAD} sort={sortOf('state')} onSort={() => toggleSort('state')}>
                        {t('common.state')}
                      </Th>
                    </Tr>

                    {/* Rangée de filtres : les contrôles y sont resserrés d'un cran, comme dans
                        une barre d'outils, et la casse revient à la normale — l'en-tête est en
                        capitales, et un champ de saisie en hérite.
                        Largeur imposée aux sélecteurs : le résumé d'une sélection vide s'écrit
                        « Aucune sélection », et cette phrase dictait la largeur de quatre
                        colonnes — le tableau débordait de 150 px sur une fenêtre de 1280. */}
                    <Tr className="[--control-md:var(--control-sm)] normal-case">
                      <Th className="font-normal normal-case">
                        <FilterInput
                          label={t('rules.rule')}
                          value={search}
                          onValueChange={(value) => setParam('q', value)}
                          placeholder={t('rules.searchPlaceholder')}
                        />
                      </Th>
                      <Th className="font-normal normal-case">
                        <MultiSelect
                          className="w-28"
                          label={t('common.category')}
                          values={categoryFilter}
                          onChange={setList('category')}
                          unit={t('rules.unit.category')}
                          unitPlural={t('rules.unit.categories')}
                          options={categories.map((item) => ({
                            value: item,
                            label: categoryLabel(item),
                          }))}
                        />
                      </Th>
                      <Th className="font-normal normal-case">
                        <MultiSelect
                          className="w-28"
                          label={t('common.severity')}
                          values={severityFilter}
                          onChange={setList('severity')}
                          unit={t('rules.unit.severity')}
                          unitPlural={t('rules.unit.severities')}
                          options={SEVERITIES.map((item) => ({
                            value: item,
                            label: severityLabel(item),
                          }))}
                        />
                      </Th>
                      {/* Prérequis : une liste hétérogène d'extensions, de versions et de rôles.
                          Aucun filtre n'y aurait de sens qui ne soit pas trompeur. */}
                      <Th />
                      <Th className="font-normal normal-case">
                        <MultiSelect
                          className="w-28"
                          label={t('rules.origin')}
                          values={originFilter}
                          onChange={setList('origin')}
                          unit={t('rules.unit.origin')}
                          unitPlural={t('rules.unit.origins')}
                          options={[
                            { value: 'provided', label: t('rules.bundled') },
                            { value: 'user', label: t('rules.custom') },
                          ]}
                        />
                      </Th>
                      <Th className="font-normal normal-case">
                        {/* Un cran plus large que les autres colonnes : quatre états à nommer,
                            dont deux mots longs — « désactivée » y était déjà tronqué. */}
                        <MultiSelect
                          className="w-32"
                          label={t('common.state')}
                          values={stateFilter}
                          onChange={setList('state')}
                          unit={t('rules.unit.state')}
                          unitPlural={t('rules.unit.states')}
                          options={[
                            { value: 'enabled', label: t('rules.enabledTag') },
                            { value: 'disabled', label: t('rules.disabledTag') },
                            // L'activation vient de la règle, la santé du garde-fou : les deux
                            // se filtrent depuis la même colonne, c'est là qu'elles se lisent.
                            { value: 'degraded', label: t('rules.degradedTag') },
                            { value: 'quarantined', label: t('rules.quarantinedTag') },
                          ]}
                        />
                      </Th>
                    </Tr>
                  </THead>

                  <TBody>
                    {ordered.length === 0 ? (
                      <Tr>
                        {/* L'état vide reste sous l'en-tête : le filtre qui a tout écarté doit
                            rester à portée de main pour être levé. */}
                        <Td colSpan={6}>
                          <EmptyState
                            icon={<FilterX className="size-6" aria-hidden />}
                            title={t('rules.noMatch')}
                            description={t('rules.noMatchHint')}
                            action={<Button onClick={clearFilters}>{t('common.clearFilters')}</Button>}
                          />
                        </Td>
                      </Tr>
                    ) : (
                      ordered.map((rule) => (
                        <Tr key={rule.id}>
                          <Td className="align-top">
                            <Link
                              to={`/rules/${encodeURIComponent(rule.id)}`}
                              className="text-ink hover:text-brand font-medium hover:underline"
                              title={rule.description ?? undefined}
                            >
                              {rule.name}
                            </Link>
                            <p className="text-ink-muted font-mono text-meta">{rule.id}</p>
                          </Td>
                          <Td className="align-top whitespace-nowrap">{categoryLabel(rule.category)}</Td>
                          <Td className="align-top">
                            <SeverityBadge severity={rule.severity} />
                          </Td>
                          <Td className="align-top">
                            <Requirements rule={rule} t={t} tc={tc} />
                          </Td>
                          <Td className="align-top">
                            {rule.origin === 'user' ? (
                              <Badge tone="info">{t('rules.customTag')}</Badge>
                            ) : (
                              <Badge>{t('rules.bundledTag')}</Badge>
                            )}
                            {rule.overridesProvided && (
                              <p className="text-ink-muted mt-1 text-meta">{t('rules.replacesBundled')}</p>
                            )}
                          </Td>
                          <Td className="align-top">
                            {/* Activation puis santé, l'une sous l'autre : une règle activée
                                peut être écartée d'une instance, et les deux se lisent. */}
                            <div className="flex flex-col items-start gap-1">
                              {rule.enabled ? (
                                <Badge tone="success">{t('rules.enabledTag')}</Badge>
                              ) : (
                                <Badge tone="warning">{t('rules.disabledTag')}</Badge>
                              )}
                              {quarantinedOn(rule) > 0 && (
                                <Badge tone="danger">
                                  {tc('rules.quarantinedOn', quarantinedOn(rule))}
                                </Badge>
                              )}
                              {degradedOn(rule) > 0 && (
                                <Badge tone="warning">
                                  {tc('rules.degradedOn', degradedOn(rule))}
                                </Badge>
                              )}
                              {rule.overrides.length > 0 && (
                                <p className="text-ink-muted whitespace-nowrap text-meta">
                                  {tc('rules.overrides', rule.overrides.length)}
                                </p>
                              )}
                            </div>
                          </Td>
                        </Tr>
                      ))
                    )}
                  </TBody>
                </Table>
              </TableScroll>
            </div>
          )}
        </Card>
      </div>
    </Page>
  )
}

/**
 * Ce que la règle exige de l'instance pour être exécutable. Sans prérequis, la seule chose à dire
 * est le nombre de vues interrogées : une règle qui ne demande rien s'exécute partout.
 */
function Requirements({ rule, t, tc }: { rule: Rule; t: Translator; tc: PluralTranslator }) {
  const parts: string[] = []

  if (rule.requires.extensions.length > 0) {
    parts.push(...rule.requires.extensions)
  }
  if (rule.requires.missingExtensions.length > 0) {
    parts.push(...rule.requires.missingExtensions.map((name) => t('rules.without', { name })))
  }
  if (rule.requires.minVersion) {
    parts.push(`PG ≥ ${rule.requires.minVersion}`)
  }
  if (rule.requires.maxVersion) {
    parts.push(`PG ≤ ${rule.requires.maxVersion}`)
  }
  if (rule.requires.monitorRole) {
    parts.push('pg_monitor')
  }
  if (rule.handler) {
    parts.push('handler')
  }

  if (parts.length === 0) {
    return <span className="text-ink-muted">{tc('rules.viewCount', rule.requires.views.length)}</span>
  }

  return (
    <div className="flex flex-wrap gap-1">
      {parts.map((part) => (
        <Badge key={part}>{part}</Badge>
      ))}
    </div>
  )
}
