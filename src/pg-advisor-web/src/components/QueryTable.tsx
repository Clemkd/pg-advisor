import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, Workflow } from 'lucide-react'
import type { TopQuery } from '@/api/types'
import { Badge, Button } from '@/components/ui/primitives'
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
  width: string
  align?: 'right'
  /** Unité affichée sous le filtre numérique, pour lever l'ambiguïté. */
  unit?: string
}

const COLUMNS: Column[] = [
  { key: 'query', label: 'queries.column.query', type: 'text', width: 'minmax(22rem, 3fr)' },
  { key: 'shareOfTotal', label: 'queries.column.share', type: 'percent', width: '7rem', align: 'right' },
  { key: 'totalExecMs', label: 'queries.column.total', type: 'duration', width: '7rem', align: 'right', unit: 'ms' },
  { key: 'meanExecMs', label: 'queries.column.mean', type: 'duration', width: '7rem', align: 'right', unit: 'ms' },
  { key: 'maxExecMs', label: 'queries.column.max', type: 'duration', width: '7rem', align: 'right', unit: 'ms' },
  { key: 'calls', label: 'queries.column.calls', type: 'number', width: '6.5rem', align: 'right' },
  { key: 'rowsPerCall', label: 'queries.column.rowsPerCall', type: 'number', width: '7rem', align: 'right' },
  { key: 'cacheHitRatio', label: 'queries.column.cache', type: 'percent', width: '6.5rem', align: 'right' },
  { key: 'tempBlksWritten', label: 'queries.column.temp', type: 'number', width: '6.5rem', align: 'right', unit: 'queries.unit.blocks' },
]

/** Unité du filtre : les symboles restent tels quels, le reste passe par le catalogue. */
function unitLabel(t: Translator, column: Column): string | undefined {
  if (column.type === 'percent') return '%'
  if (!column.unit) return undefined
  return column.unit === 'ms' ? 'ms' : t(column.unit)
}

type NumericFilter = { operator: FilterOperator; value: string }

function formatDuration(value: number): string {
  if (value < 1) return `${value.toFixed(2)} ms`
  if (value < 1000) return `${value.toFixed(1)} ms`
  if (value < 60_000) return `${(value / 1000).toFixed(2)} s`
  return `${(value / 60_000).toFixed(1)} min`
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

/**
 * Tableau des requêtes : colonnes triables, filtres adaptés au type de chaque colonne et
 * virtualisation. Le filtrage et le tri sont faits en mémoire — la liste est déjà bornée par
 * le nombre de requêtes demandé au serveur.
 */
export function QueryTable({
  queries,
  onAnalyze,
  showInstance = false,
}: {
  queries: TopQuery[]
  onAnalyze: (query: TopQuery) => void
  /** Classement fusionné : chaque ligne annonce alors sa base d'origine. */
  showInstance?: boolean
}) {
  const t = useT()
  const tc = useTc()
  const [sortKey, setSortKey] = useState<Column['key']>('totalExecMs')
  const [descending, setDescending] = useState(true)
  const [textFilter, setTextFilter] = useState('')
  const [numericFilters, setNumericFilters] = useState<Record<string, NumericFilter>>({})

  // Un seul conteneur défile, dans les deux directions : en séparant l'axe horizontal de
  // l'axe vertical, les lignes défilaient latéralement sans emmener leurs en-têtes.
  const scrollParent = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const available = useFillHeight(scrollParent)
  const [listOffset, setListOffset] = useState(0)

  // Les lignes commencent sous l'en-tête collant : le virtualiseur doit connaître ce décalage
  // pour décider quelles lignes monter. Mesuré à chaque rendu — la hauteur de l'en-tête varie
  // avec ses filtres — et sans effet quand la valeur ne change pas.
  const measureOffset = useCallback(() => {
    const offset = list.current?.offsetTop ?? 0
    setListOffset((current) => (current === offset ? current : offset))
  }, [])

  useLayoutEffect(measureOffset)

  const visible = useMemo(() => {
    const needle = textFilter.trim().toLowerCase()

    const filtered = queries.filter((query) => {
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

    return [...filtered].sort((a, b) => {
      const left = a[sortKey as keyof TopQuery]
      const right = b[sortKey as keyof TopQuery]

      const comparison =
        typeof left === 'string' || typeof right === 'string'
          ? // Le tri suit la langue de l'interface : l'ordre des accents n'est pas le même partout.
            String(left ?? '').localeCompare(String(right ?? ''), INTL_LOCALES[currentLocale()])
          : Number(left ?? 0) - Number(right ?? 0)

      return descending ? -comparison : comparison
    })
  }, [queries, textFilter, numericFilters, sortKey, descending])

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollParent.current,
    estimateSize: () => 92,
    overscan: 6,
    scrollMargin: listOffset,
    getItemKey: (index) => visible[index].queryId,
  })

  // Dernière piste étroite : « Effacer » dans l'en-tête, chevron d'ouverture sur les lignes.
  const template = COLUMNS.map((column) => column.width).join(' ') + ' 5rem'

  function toggleSort(key: Column['key']) {
    if (key === sortKey) {
      setDescending((current) => !current)
    } else {
      setSortKey(key)
      setDescending(true)
    }
  }

  return (
    <>
      <div
        ref={scrollParent}
        style={{ maxHeight: available }}
        className="min-h-64 w-full overflow-auto"
      >
        <div style={{ minWidth: '78rem' }}>
          {/* En-têtes : tri au clic, filtre juste en dessous, adapté au type de la colonne.
              Collés en haut du même conteneur que les lignes, ils suivent le défilement
              horizontal et restent visibles au défilement vertical. */}
          <div
            className="bg-surface-sunken border-border-subtle sticky top-0 z-10 grid gap-x-3 border-b px-4 py-2"
            style={{ gridTemplateColumns: template }}
          >
            {COLUMNS.map((column) => (
              <div
                key={String(column.key)}
                className={cn('min-w-0', column.align === 'right' && 'text-right')}
              >
                <button
                  type="button"
                  onClick={() => toggleSort(column.key)}
                  className={cn(
                    'text-ink-muted hover:text-ink inline-flex items-center gap-1 text-xs font-medium tracking-wide uppercase',
                    sortKey === column.key && 'text-ink',
                  )}
                >
                  {t(column.label)}
                  {sortKey === column.key ? (
                    descending ? (
                      <ArrowDown className="size-3" aria-hidden />
                    ) : (
                      <ArrowUp className="size-3" aria-hidden />
                    )
                  ) : (
                    <ArrowUpDown className="size-3 opacity-40" aria-hidden />
                  )}
                </button>

                <div className="mt-2">
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

            <div className="flex items-end justify-end">
              <Button
                variant="ghost"
                onClick={() => {
                  setTextFilter('')
                  setNumericFilters({})
                }}
                className="h-7 px-2 text-xs"
              >
                {t('queries.clearFilters')}
              </Button>
            </div>
          </div>

          <div
            ref={list}
            className="relative w-full"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const query = visible[item.index]

              return (
                <div
                  key={item.key}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  className="absolute top-0 left-0 w-full"
                  style={{ transform: `translateY(${item.start - listOffset}px)` }}
                >
                  {/* La ligne entière ouvre l'analyse : plus de bouton dédié à viser, et la
                      colonne qu'il occupait revient au contenu. */}
                  <button
                    type="button"
                    onClick={() => onAnalyze(query)}
                    title={t('queries.rowTitle')}
                    className="border-border-subtle hover:bg-surface-sunken focus-visible:bg-surface-sunken grid w-full items-start gap-x-3 border-b px-4 py-2.5 text-left"
                    style={{ gridTemplateColumns: template }}
                  >
                    <span className="block min-w-0">
                      <span className="text-ink line-clamp-2 block font-mono text-xs">
                        {query.query}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        {showInstance && <Badge tone="brand">{query.connectionName}</Badge>}
                        <span className="text-ink-faint font-mono text-[11px]">{query.queryId}</span>
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
                        className={cn(
                          'text-ink block min-w-0 truncate text-xs tabular-nums',
                          column.align === 'right' && 'text-right',
                        )}
                      >
                        {column.key === 'shareOfTotal' ? (
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <span className="bg-surface-sunken h-1.5 w-10 overflow-hidden rounded-full">
                              <span
                                className="bg-brand block h-full rounded-full"
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

                    <span className="text-ink-faint flex justify-end">
                      <ChevronRight className="size-4" aria-hidden />
                    </span>
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="text-ink-faint border-border-subtle border-t px-4 py-2 text-xs">
        {tc('queries.footer.shown', visible.length)} {tc('queries.footer.read', queries.length)} —{' '}
        {t('queries.footer.hint')}
      </div>
    </>
  )
}
