import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronRight, FilterX, Workflow } from 'lucide-react'
import type { TopQuery } from '@/api/types'
import { Badge, Button, EmptyState } from '@/components/ui/primitives'
import { FilterInput, type FilterOperator } from '@/components/ui/FilterInput'
import { cn } from '@/lib/utils'
import { useFillHeight } from '@/lib/fillHeight'
import { formatNumber, formatPercent } from '@/lib/format'
import { currentLocale, INTL_LOCALES, useT, useTc } from '@/lib/i18n'
import type { Translator } from '@/lib/i18n'

export type ColumnType = 'text' | 'number' | 'percent' | 'duration'

interface Column {
  key: keyof TopQuery | 'query'
  /** Clé de traduction de l'en-tête : le libellé suit la langue choisie. */
  label: string
  type: ColumnType
  /** Largeur de la piste, en rem. Nombre plutôt que chaîne : la largeur minimale du tableau
      s'en déduit, au lieu d'être une constante qu'on oublie de mettre à jour. */
  width: number
  align?: 'right'
  /** Unité affichée dans le filtre numérique, pour lever l'ambiguïté. */
  unit?: string
}

/**
 * Largeur minimale de la colonne d'identité. Elle seule est large : c'est là qu'on reconnaît la
 * requête, et deux lignes de quarante caractères y suffisent, là où trente n'y suffisaient pas.
 * Les mesures, elles, restent étroites et fixes.
 */
const QUERY_MIN = 22

/** Piste de queue : chevron d'ouverture sur les lignes, effacement des filtres en en-tête. */
const TRAILING = 2.5

/** Gouttière entre colonnes, en rem — la valeur de `gap-x-3`. */
const GUTTER = 0.75

const COLUMNS: Column[] = [
  { key: 'query', label: 'queries.column.query', type: 'text', width: QUERY_MIN },
  { key: 'shareOfTotal', label: 'queries.column.share', type: 'percent', width: 6.5, align: 'right' },
  { key: 'totalExecMs', label: 'queries.column.total', type: 'duration', width: 6.5, align: 'right', unit: 'ms' },
  { key: 'meanExecMs', label: 'queries.column.mean', type: 'duration', width: 6.5, align: 'right', unit: 'ms' },
  { key: 'maxExecMs', label: 'queries.column.max', type: 'duration', width: 6.5, align: 'right', unit: 'ms' },
  { key: 'calls', label: 'queries.column.calls', type: 'number', width: 6.5, align: 'right' },
  { key: 'rowsPerCall', label: 'queries.column.rowsPerCall', type: 'number', width: 6.5, align: 'right' },
  { key: 'cacheHitRatio', label: 'queries.column.cache', type: 'percent', width: 6.5, align: 'right' },
  { key: 'sharedBlksRead', label: 'queries.column.reads', type: 'number', width: 6.5, align: 'right', unit: 'queries.unit.blocks' },
  { key: 'tempBlksWritten', label: 'queries.column.temp', type: 'number', width: 6.5, align: 'right', unit: 'queries.unit.blocks' },
]

/**
 * Colonne qui porte le critère de classement demandé au serveur. Sans cette correspondance, le
 * tableau s'ouvrait trié sur le temps cumulé quel que soit le critère choisi dans la barre :
 * on classait sur une grandeur, on en lisait une autre.
 */
const RANKED_BY: Record<string, Column['key']> = {
  total_time: 'totalExecMs',
  mean_time: 'meanExecMs',
  calls: 'calls',
  rows: 'rowsPerCall',
  io: 'sharedBlksRead',
  temp: 'tempBlksWritten',
}

/** Piste de grille et largeur minimale, déduites des colonnes : une seule source de vérité. */
const TEMPLATE = [
  `minmax(${QUERY_MIN}rem, 3fr)`,
  ...COLUMNS.slice(1).map((column) => `${column.width}rem`),
  `${TRAILING}rem`,
].join(' ')

const MIN_WIDTH = `${
  COLUMNS.reduce((total, column) => total + column.width, 0) + TRAILING + COLUMNS.length * GUTTER
}rem`

/** Unité du filtre : les symboles restent tels quels, le reste passe par le catalogue. */
function unitLabel(t: Translator, column: Column): string | undefined {
  if (column.type === 'percent') return '%'
  if (!column.unit) return undefined
  return column.unit === 'ms' ? 'ms' : t(column.unit)
}

type NumericFilter = { operator: FilterOperator; value: string }

/**
 * Durée mesurée. Le séparateur décimal suit la langue : mêlé aux nombres formatés par `Intl`,
 * un point imposé écrivait « 1 234,5 appels » et « 1 234.5 ms » sur la même ligne.
 */
function formatDuration(value: number): string {
  const decimals = (fraction: number) =>
    new Intl.NumberFormat(INTL_LOCALES[currentLocale()], {
      minimumFractionDigits: fraction,
      maximumFractionDigits: fraction,
    }).format(value < 1000 ? value : value < 60_000 ? value / 1000 : value / 60_000)

  if (value < 1) return `${decimals(2)} ms`
  if (value < 1000) return `${decimals(1)} ms`
  if (value < 60_000) return `${decimals(2)} s`
  return `${decimals(1)} min`
}

function renderCell(query: TopQuery, column: Column) {
  const raw = query[column.key as keyof TopQuery]

  switch (column.type) {
    case 'percent':
      return formatPercent(raw as number | null)
    case 'duration':
      return formatDuration(Number(raw ?? 0))
    case 'number':
      return formatNumber(Math.round(Number(raw ?? 0)))
    default:
      return String(raw ?? '')
  }
}

/** Identité d'une ligne : le seul identifiant de requête se répète d'une instance à l'autre. */
function rowKey(query: TopQuery): string {
  return `${query.connectionId}:${query.queryId}`
}

/**
 * Tableau des requêtes : colonnes triables, filtres adaptés au type de chaque colonne et
 * virtualisation. Le filtrage et le tri sont faits en mémoire — la liste est déjà bornée par
 * le nombre de requêtes demandé au serveur.
 *
 * Un seul conteneur défile, sur les deux axes, en-tête compris : la grille est décrite aux
 * technologies d'assistance par les rôles de `grid`, faute de quoi la virtualisation ne laisse
 * lire ni le nombre réel de lignes ni le sens du tri.
 */
export function QueryTable({
  queries,
  onAnalyze,
  showInstance = false,
  rankedBy,
  selected: selectedKey,
}: {
  queries: TopQuery[]
  onAnalyze: (query: TopQuery) => void
  /** Classement fusionné : chaque ligne annonce alors sa base d'origine. */
  showInstance?: boolean
  /** Critère de classement demandé au serveur : le tableau s'ouvre sur la même grandeur. */
  rankedBy?: string
  /** Requête ouverte en dernier : la ligne reste repérable au retour de l'analyse. */
  selected?: string | null
}) {
  const t = useT()
  const tc = useTc()
  const [sortKey, setSortKey] = useState<Column['key']>(
    () => RANKED_BY[rankedBy ?? ''] ?? 'totalExecMs',
  )
  const [descending, setDescending] = useState(true)
  const [textFilter, setTextFilter] = useState('')
  const [numericFilters, setNumericFilters] = useState<Record<string, NumericFilter>>({})

  // Le critère du serveur décide de ce qui est lu : quand il change, la liste change de nature,
  // et la trier encore sur l'ancienne grandeur ferait lire un classement pour un autre.
  const previousRank = useRef(rankedBy)
  if (previousRank.current !== rankedBy) {
    previousRank.current = rankedBy
    const column = RANKED_BY[rankedBy ?? '']
    if (column && column !== sortKey) {
      setSortKey(column)
      setDescending(true)
    }
  }

  // Un seul conteneur défile, dans les deux directions : en séparant l'axe horizontal de
  // l'axe vertical, les lignes défilaient latéralement sans emmener leurs en-têtes.
  const fillBox = useRef<HTMLDivElement>(null)
  const scrollParent = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const available = useFillHeight(fillBox)
  const [listOffset, setListOffset] = useState(0)

  // Les lignes commencent sous l'en-tête collant : le virtualiseur doit connaître ce décalage
  // pour décider quelles lignes monter. Mesuré à chaque rendu — la hauteur de l'en-tête varie
  // avec ses filtres — et sans effet quand la valeur ne change pas.
  const measureOffset = useCallback(() => {
    const offset = list.current?.offsetTop ?? 0
    setListOffset((current) => (current === offset ? current : offset))
  }, [])

  useLayoutEffect(measureOffset)

  const filtered = useMemo(() => {
    const needle = textFilter.trim().toLowerCase()

    return queries.filter((query) => {
      if (needle && !query.query.toLowerCase().includes(needle)) return false

      for (const [key, filter] of Object.entries(numericFilters)) {
        if (!filter.value.trim()) continue

        const threshold = Number(filter.value)
        if (!Number.isFinite(threshold)) continue

        const column = COLUMNS.find((c) => c.key === key)!
        let value = Number(query[key as keyof TopQuery] ?? 0)
        // Les taux sont stockés entre 0 et 1 : le seuil est saisi en pourcentage.
        if (column.type === 'percent') value *= 100

        if (filter.operator === '>=' && !(value >= threshold)) return false
        if (filter.operator === '<=' && !(value <= threshold)) return false
        if (filter.operator === '=' && Math.round(value) !== Math.round(threshold)) return false
      }

      return true
    })
  }, [queries, textFilter, numericFilters])

  const visible = useMemo(
    () =>
      [...filtered].sort((a, b) => {
        const left = a[sortKey as keyof TopQuery]
        const right = b[sortKey as keyof TopQuery]

        const comparison =
          typeof left === 'string' || typeof right === 'string'
            ? // Le tri suit la langue : l'ordre des accents n'est pas le même partout.
              String(left ?? '').localeCompare(String(right ?? ''), INTL_LOCALES[currentLocale()])
            : Number(left ?? 0) - Number(right ?? 0)

        return descending ? -comparison : comparison
      }),
    [filtered, sortKey, descending],
  )

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollParent.current,
    estimateSize: () => 96,
    overscan: 6,
    scrollMargin: listOffset,
    getItemKey: (index) => (visible[index] ? rowKey(visible[index]) : index),
  })

  const filtering = textFilter.trim() !== '' || Object.values(numericFilters).some((f) => f.value.trim() !== '')

  function clearFilters() {
    setTextFilter('')
    setNumericFilters({})
  }

  function toggleSort(key: Column['key']) {
    if (key === sortKey) {
      setDescending((current) => !current)
    } else {
      setSortKey(key)
      setDescending(true)
    }
  }

  return (
    // Le décompte fait partie du bloc mesuré : posé sous la zone défilante, il tombait sous le
    // bord de la fenêtre et c'est la page qui se mettait à défiler — exactement ce qu'une
    // session d'investigation ne doit pas avoir à faire pour lire son classement.
    <div ref={fillBox} style={{ maxHeight: available }} className="flex min-h-64 flex-col">
      <div ref={scrollParent} className="min-h-0 w-full flex-1 overflow-auto">
        <div
          role="grid"
          aria-label={t('queries.list.title')}
          aria-rowcount={visible.length + 1}
          style={{ minWidth: MIN_WIDTH }}
        >
          {/* En-têtes : tri au clic, filtre juste en dessous, adapté au type de la colonne.
              Collés en haut du même conteneur que les lignes, ils suivent le défilement
              horizontal et restent visibles au défilement vertical. */}
          <div
            role="row"
            aria-rowindex={1}
            className="bg-surface-sunken border-border-subtle sticky top-0 z-10 grid gap-x-3 border-b px-4 py-2"
            style={{ gridTemplateColumns: TEMPLATE }}
          >
            {COLUMNS.map((column) => (
              <div
                key={String(column.key)}
                role="columnheader"
                aria-sort={
                  sortKey === column.key ? (descending ? 'descending' : 'ascending') : 'none'
                }
                className={cn('min-w-0', column.align === 'right' && 'text-right')}
              >
                <button
                  type="button"
                  onClick={() => toggleSort(column.key)}
                  aria-label={t('table.sortBy', { label: t(column.label) })}
                  className={cn(
                    'text-ink-muted hover:text-ink text-micro inline-flex max-w-full items-center gap-1 font-semibold tracking-wider uppercase',
                    sortKey === column.key && 'text-ink',
                  )}
                >
                  <span className="truncate">{t(column.label)}</span>
                  {/* Le sens du tri est dit par la flèche et par `aria-sort` : la place de la
                      flèche est réservée en permanence, sans quoi l'en-tête sautait au clic. */}
                  <ChevronRight
                    className={cn(
                      'size-3 shrink-0 transition-transform',
                      sortKey === column.key
                        ? descending
                          ? 'rotate-90'
                          : '-rotate-90'
                        : 'opacity-0',
                    )}
                    aria-hidden
                  />
                </button>

                <div className="mt-1.5">
                  {column.type === 'text' ? (
                    <FilterInput
                      label={t(column.label)}
                      value={textFilter}
                      onValueChange={setTextFilter}
                      placeholder={t('queries.filterPlaceholder')}
                    />
                  ) : (
                    <FilterInput
                      label={t(column.label)}
                      unit={unitLabel(t, column)}
                      value={numericFilters[String(column.key)]?.value ?? ''}
                      operator={numericFilters[String(column.key)]?.operator ?? '>='}
                      onOperatorChange={(operator) =>
                        setNumericFilters((current) => ({
                          ...current,
                          [String(column.key)]: {
                            operator,
                            value: current[String(column.key)]?.value ?? '',
                          },
                        }))
                      }
                      onValueChange={(value) =>
                        setNumericFilters((current) => ({
                          ...current,
                          [String(column.key)]: {
                            operator: current[String(column.key)]?.operator ?? '>=',
                            value,
                          },
                        }))
                      }
                    />
                  )}
                </div>
              </div>
            ))}

            {/* Piste de queue : elle aligne le chevron des lignes. L'effacement des filtres ne
                s'y trouve pas — cette colonne est la dernière d'un tableau qui défile
                latéralement, donc hors de vue au moment précis où l'on voudrait s'en servir.
                Il est posé au pied, à côté du décompte qu'il fait varier. */}
            <div role="columnheader" aria-sort="none" aria-label={t('queries.rowTitle')} />
          </div>

          <div
            ref={list}
            role="rowgroup"
            className="relative w-full"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const query = visible[item.index]

              // Le virtualiseur compte les lignes visibles, donc l'index reste dans les bornes.
              // Le garde n'est pas là pour ce cas-là mais pour le suivant : si la liste change
              // sous ses pieds, ne rien rendre vaut mieux que lire au-delà du tableau.
              if (!query) return null

              const key = rowKey(query)

              return (
                <div
                  key={item.key}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  role="presentation"
                  className="absolute top-0 left-0 w-full"
                  style={{ transform: `translateY(${item.start - listOffset}px)` }}
                >
                  {/* La ligne entière ouvre l'analyse : plus de bouton dédié à viser, et la
                      colonne qu'il occupait revient au contenu. */}
                  <div
                    role="row"
                    aria-rowindex={item.index + 2}
                    aria-selected={key === selectedKey}
                    tabIndex={0}
                    onClick={() => onAnalyze(query)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      onAnalyze(query)
                    }}
                    title={t('queries.rowTitle')}
                    className={cn(
                      'border-border-subtle hover:bg-surface-sunken grid w-full cursor-pointer items-start gap-x-3 border-b px-4 py-2.5 text-left',
                      // La requête ouverte en dernier reste repérable : au retour de la modale,
                      // une liste de deux cents lignes ne dit plus d'où l'on vient.
                      key === selectedKey && 'bg-brand-subtle',
                    )}
                    style={{ gridTemplateColumns: TEMPLATE }}
                  >
                    <span role="gridcell" className="block min-w-0">
                      {/* `line-clamp-2` pose lui-même son mode d'affichage : lui adjoindre
                          `block` l'annulait, et une requête de trente lignes prenait l'écran. */}
                      <span className="text-ink text-body line-clamp-2 font-mono" title={query.query}>
                        {query.query}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        {showInstance && <Badge tone="info">{query.connectionName}</Badge>}
                        <span className="text-ink-muted text-meta font-mono">{query.queryId}</span>
                        {/* Un plan déjà mesuré s'ouvre sans rien exécuter : l'information décide
                            de cliquer ou non sur une requête coûteuse en production. */}
                        {query.hasSavedPlan && (
                          <Badge tone="success" title={t('queries.badge.savedPlanTitle')}>
                            <Workflow className="size-3" aria-hidden />
                            {t('queries.badge.savedPlan')}
                          </Badge>
                        )}
                        {query.fromAdvisor && <Badge>{t('queries.badge.advisor')}</Badge>}
                        {query.hasParameters && <Badge>{t('queries.badge.parameterized')}</Badge>}
                        {query.tempBlksWritten > 0 && (
                          <Badge tone="warning">{t('queries.badge.tempFiles')}</Badge>
                        )}
                      </span>
                    </span>

                    {COLUMNS.slice(1).map((column) => (
                      <span
                        key={String(column.key)}
                        role="gridcell"
                        className={cn(
                          'text-ink text-body block min-w-0 truncate tabular-nums',
                          column.align === 'right' && 'text-right',
                        )}
                      >
                        {column.key === 'shareOfTotal' ? (
                          <span className="inline-flex items-center justify-end gap-1.5">
                            {/* Jauge de comparaison, jamais seule : le pourcentage la double,
                                et sa teinte n'est pas celle de la marque — une part de temps
                                est une mesure, pas quelque chose avec quoi on interagit. */}
                            <span className="bg-surface-sunken h-1.5 w-8 shrink-0 overflow-hidden rounded-full">
                              <span
                                className="bg-info block h-full rounded-full"
                                style={{ width: `${Math.min(100, query.shareOfTotal * 100)}%` }}
                              />
                            </span>
                            {formatPercent(query.shareOfTotal, 1)}
                          </span>
                        ) : (
                          renderCell(query, column)
                        )}
                      </span>
                    ))}

                    <span role="gridcell" className="text-ink-faint flex justify-end">
                      <ChevronRight className="size-4" aria-hidden />
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Un tableau vidé par ses propres filtres n'est pas un tableau vide : le dire, et
            rendre le geste qui le remplit à nouveau. L'en-tête reste au-dessus, sans quoi on
            ne pourrait plus atteindre le filtre qui a tout écarté. Collé à gauche : un tableau
            poussé latéralement ne doit pas emmener son message hors de vue. */}
        {visible.length === 0 && (
          <div className="sticky left-0">
            <EmptyState
              title={t('queries.empty.filtered.title')}
              description={t('queries.empty.filtered.body')}
              action={
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  {t('queries.clearFilters')}
                </Button>
              }
            />
          </div>
        )}
      </div>

      {/* Le décompte dit ce que les filtres ont laissé ; le geste qui les lève se tient juste à
          côté du chiffre qu'il fait bouger. Hauteur minimale fixe : l'apparition du bouton ne
          doit pas reprendre trois pixels au classement. */}
      <div className="border-border-subtle flex min-h-10 shrink-0 items-center justify-between gap-3 border-t px-4">
        <span className="text-ink-muted text-meta min-w-0">
          {tc('queries.footer.shown', visible.length)} {tc('queries.footer.read', queries.length)} —{' '}
          {t('queries.footer.hint')}
        </span>

        {filtering && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            title={t('queries.clearFiltersTitle')}
            className="shrink-0 gap-1.5 px-2"
          >
            <FilterX className="size-4" aria-hidden />
            {t('queries.clearFilters')}
          </Button>
        )}
      </div>
    </div>
  )
}
