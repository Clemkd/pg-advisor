import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { CheckCircle2, ChevronRight, ExternalLink, FilterX } from 'lucide-react'
import { api } from '@/api/client'
import type { Connection, Finding, FindingDetail, FindingStatus, FindingSummary } from '@/api/types'
import { useEventListener } from '@/app/EventsContext'
import { Hero, Page } from '@/components/layout/Page'
import { FilterInput } from '@/components/ui/FilterInput'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  KeyValue,
  KeyValueGrid,
  LastUpdated,
  LiveRegion,
  LoadingBlock,
  Modal,
  MultiSelect,
  Notice,
  RefreshBar,
  SeverityBadge,
  SplitButton,
  TBody,
  Table,
  Tabs,
  Td,
  Tr,
} from '@/components/ui/primitives'
import { cn } from '@/lib/utils'
import { useFillHeight } from '@/lib/fillHeight'
import { categoryLabel, formatDateTime, formatRelative, qualifierLabel, statusLabel } from '@/lib/format'
import { currentLocale, INTL_LOCALES, tr, useT, useTc } from '@/lib/i18n'
import { SqlCommand } from '@/lib/sqlHighlight'

const CATEGORIES = [
  'performance',
  'queries',
  'indexes',
  'vacuum',
  'bloat',
  'connections',
  'locks',
  'transactions',
  'checkpoints',
  'configuration',
  'storage',
  'statistics',
  'security',
  'extensions',
]

const SEVERITIES = ['critical', 'warning', 'info']

/**
 * Onglets de statut. Le statut n'est pas une propriété parmi d'autres : c'est le plan de travail
 * — ce qu'on regarde aujourd'hui, ce qu'on a écarté, ce que le moteur a clos. Il reste donc en
 * onglets, au-dessus du tableau, et non en filtre de colonne.
 */
const STATUS_TABS: { value: string; labelKey: string; counter?: 'active' | 'ignored' | 'resolved' }[] = [
  { value: 'active', labelKey: 'findings.tab.active', counter: 'active' },
  { value: 'ignored', labelKey: 'findings.tab.ignored', counter: 'ignored' },
  { value: 'resolved', labelKey: 'findings.tab.resolved', counter: 'resolved' },
  { value: 'all', labelKey: 'findings.tab.all' },
]

/** La sévérité se trie par gravité, jamais par ordre alphabétique. */
const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 }

type SortKey = 'diagnostic' | 'severity' | 'instance' | 'category' | 'detected'

/**
 * Pistes de la grille, en rem. La colonne d'identité est la seule large : c'est là qu'on reconnaît
 * le diagnostic. Les autres sont étroites et fixes, ce qui aligne les valeurs d'une ligne à
 * l'autre — condition d'un balayage vertical.
 */
const COLUMNS = { severity: 7.5, instance: 8, category: 8, detected: 6, actions: 8 }
const IDENTITY_MIN = 16
const GUTTER = 0.75

const TEMPLATE = `minmax(${IDENTITY_MIN}rem, 3fr) ${Object.values(COLUMNS)
  .map((width) => `${width}rem`)
  .join(' ')}`

const MIN_WIDTH = `${
  IDENTITY_MIN + Object.values(COLUMNS).reduce((total, width) => total + width, 0) + 6 * GUTTER
}rem`

/** Pas de pagination : la liste est virtualisée, on charge tout le périmètre du statut courant. */
const PAGE_SIZE = 2000

/** Attente avant d'inscrire la recherche saisie dans l'URL. */
const SEARCH_DELAY = 250

/** Regroupe une rafale d'événements SSE en un seul rechargement. */
const EVENT_COALESCE = 250

/** Filtres de colonne, effaçables d'un geste ; le statut, lui, est l'onglet courant. */
const FILTER_KEYS = ['severity', 'category', 'connectionId', 'search']

type VerdictTone = 'success' | 'warning' | 'danger'

interface Verdict {
  findingId: number
  tone: VerdictTone
  message: string
  durationMs: number
}

/** Retour d'une action réversible : le message, et le geste qui la défait. */
interface ActionNotice {
  message: string
  at: number
  undo: () => void
}

/** Tonalité d'un résultat de vérification : résolu, toujours présent, ou vérification en échec. */
function verdictTone(result: { resolved: boolean; stillPresent: boolean }): VerdictTone {
  if (result.resolved) return 'success'
  return result.stillPresent ? 'warning' : 'danger'
}

export function FindingsPage() {
  const t = useT()
  const tc = useTc()
  const [params, setParams] = useSearchParams()

  const [connections, setConnections] = useState<Connection[]>([])
  const [findings, setFindings] = useState<Finding[]>([])
  const [summary, setSummary] = useState<FindingSummary | null>(null)
  const [loadedAt, setLoadedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<ActionNotice | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [verdict, setVerdict] = useState<Verdict | null>(null)

  // Ce que le flux a apporté depuis qu'on regarde ce plan de travail : un décompte, et l'instant
  // où il a bougé. Aucune teinte de ligne — sur un écran qu'on ne fixe pas, un chiffre qui reste
  // dit ce qu'un lavis qui s'efface ne dit plus.
  const [arrival, setArrival] = useState<{ count: number; critical: number; at: number } | null>(null)

  const undoButton = useRef<HTMLButtonElement>(null)
  const snapshot = useRef<{ status: string; ids: Set<number> } | null>(null)
  const eventTimer = useRef<number | undefined>(undefined)

  const status = params.get('status') ?? 'active'
  const search = params.get('search') ?? ''
  const sortKey = (params.get('sort') as SortKey | null) ?? 'severity'
  const descending = params.get('dir') === 'desc'

  const readList = useCallback(
    (key: string) => {
      const raw = params.get(key)
      return raw ? raw.split(',').filter(Boolean) : []
    },
    [params],
  )

  const severityFilter = readList('severity')
  const categoryFilter = readList('category')
  const instanceFilter = readList('connectionId')
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

  /*
   * Une seule requête par plan de travail : tout le statut courant est chargé, et le filtrage se
   * fait ensuite en mémoire. Un filtre de colonne répond alors à la frappe, sans aller-retour ni
   * liseré de rechargement — et une sélection multiple devient possible, là où l'API n'accepte
   * qu'une valeur par critère.
   */
  const load = useCallback(async () => {
    setRefreshing(true)

    try {
      const [result, counts] = await Promise.all([
        api.findings.list({ status, page: 1, pageSize: PAGE_SIZE }),
        api.findings.summary(),
      ])

      // Ce qui vient d'arriver se compte, à plan de travail constant seulement : changer d'onglet
      // renouvelle la liste entière et n'apporte rien de neuf. Le décompte s'ajoute d'un passage à
      // l'autre et ne s'efface pas tout seul — on revient à l'écran bien après l'événement.
      const ids = new Set(result.items.map((item) => item.id))
      const previous = snapshot.current

      if (previous && previous.status === status) {
        const added = result.items.filter((item) => !previous.ids.has(item.id))
        if (added.length > 0) {
          setArrival((current) => ({
            count: (current?.count ?? 0) + added.length,
            critical:
              (current?.critical ?? 0) + added.filter((item) => item.severity === 'critical').length,
            at: Date.now(),
          }))
        }
      } else {
        setArrival(null)
      }

      snapshot.current = { status, ids }

      setFindings(result.items)
      setSummary(counts)
      setLoadedAt(new Date().toISOString())
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr('common.loadFailed'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [status])

  /** Change le statut sans rien annoncer : socle commun à l'action et à son annulation. */
  const applyStatus = useCallback(
    async (finding: Finding, next: FindingStatus) => {
      setBusyId(finding.id)
      setVerdict(null)

      try {
        await api.findings.setStatus(finding.id, next)
        await load()
        return true
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : tr('findings.statusFailed'))
        return false
      } finally {
        setBusyId(null)
      }
    },
    [load],
  )

  /*
   * Ignorer se défait : le geste n'est donc pas confirmé — ce serait un péage sur le travail
   * quotidien — mais le retour porte l'action inverse, à portée de clic et de clavier.
   */
  const changeStatus = useCallback(
    async (finding: Finding, next: FindingStatus, message: string) => {
      setNotice(null)
      if (!(await applyStatus(finding, next))) return

      setNotice({
        message,
        at: Date.now(),
        undo: () => {
          setNotice(null)
          void applyStatus(finding, finding.status)
        },
      })
    },
    [applyStatus],
  )

  /**
   * Rejoue la règle sur l'instance concernée. Si le fait a disparu, le serveur clôt le
   * diagnostic : l'opérateur n'attend pas le prochain passage du scheduler.
   */
  const verify = useCallback(
    async (finding: Finding) => {
      setBusyId(finding.id)
      setNotice(null)
      setVerdict(null)

      try {
        const result = await api.findings.verify(finding.id)
        setVerdict({
          findingId: finding.id,
          tone: verdictTone(result),
          message: result.message,
          durationMs: result.durationMs,
        })

        if (result.resolved || result.stillPresent) {
          await load()
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : tr('findings.verifyFailed'))
      } finally {
        setBusyId(null)
      }
    },
    [load],
  )

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void api.connections.list().then(setConnections).catch(() => undefined)
  }, [])

  // Une rafale d'événements — la fin d'un passage du scheduler en produit plusieurs — ne
  // déclenche qu'un rechargement.
  useEventListener(['finding.created', 'finding.resolved', 'finding.updated'], () => {
    window.clearTimeout(eventTimer.current)
    eventTimer.current = window.setTimeout(() => void load(), EVENT_COALESCE)
  })

  useEffect(() => () => window.clearTimeout(eventTimer.current), [])

  // Le retour d'une action réversible prend le focus : la ligne d'où l'on vient de partir n'est
  // plus dans la liste, et l'action inverse est ce qu'on peut vouloir faire tout de suite.
  useEffect(() => {
    if (notice) undoButton.current?.focus()
  }, [notice])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()

    return findings.filter((finding) => {
      if (severityFilter.length > 0 && !severityFilter.includes(finding.severity)) return false
      if (categoryFilter.length > 0 && !categoryFilter.includes(finding.category)) return false
      if (instanceFilter.length > 0 && !instanceFilter.includes(String(finding.connectionId))) {
        return false
      }
      if (!needle) return true

      // La saisie porte sur ce qui identifie le constat : son titre, l'objet visé, ce qu'il dit,
      // et la règle qui l'a produit.
      return (
        finding.title.toLowerCase().includes(needle) ||
        finding.target.toLowerCase().includes(needle) ||
        finding.message.toLowerCase().includes(needle) ||
        finding.ruleId.toLowerCase().includes(needle)
      )
    })
  }, [findings, search, severityFilter, categoryFilter, instanceFilter])

  const ordered = useMemo(() => {
    const sign = descending ? -1 : 1
    const locale = INTL_LOCALES[currentLocale()]

    const compare = (left: Finding, right: Finding) => {
      switch (sortKey) {
        case 'diagnostic':
          return left.title.localeCompare(right.title, locale)
        case 'instance':
          return left.connectionName.localeCompare(right.connectionName, locale)
        case 'category':
          return categoryLabel(left.category).localeCompare(categoryLabel(right.category), locale)
        case 'detected':
          return left.detectedAt < right.detectedAt ? -1 : left.detectedAt > right.detectedAt ? 1 : 0
        default:
          return (SEVERITY_RANK[left.severity] ?? 9) - (SEVERITY_RANK[right.severity] ?? 9)
      }
    }

    // Le plus récent départage : à gravité égale, c'est l'ordre de la question posée par la vue.
    return [...filtered].sort(
      (left, right) =>
        sign * compare(left, right) ||
        (left.detectedAt < right.detectedAt ? 1 : left.detectedAt > right.detectedAt ? -1 : 0),
    )
  }, [filtered, sortKey, descending])

  // Une seule annonce à la fois, la plus récente : ce qui vient d'arriver par le flux, ou le
  // retour de l'action qu'on vient de faire.
  const announcement =
    arrival && (!notice || arrival.at > notice.at)
      ? arrival.critical > 0
        ? tc('findings.live.newCritical', arrival.critical)
        : tc('findings.live.new', arrival.count)
      : (notice?.message ?? null)

  function clearFilters() {
    const next = new URLSearchParams(params)
    FILTER_KEYS.forEach((key) => next.delete(key))
    setParams(next, { replace: true })
  }

  function toggleSort(key: SortKey) {
    const next = new URLSearchParams(params)
    next.set('sort', key)
    if (key === sortKey && !descending) next.set('dir', 'desc')
    else next.delete('dir')
    setParams(next, { replace: true })
  }

  return (
    <Page title={t('nav.findings')} description={t('findings.subtitle')} wide>
      <div className="space-y-4">
        <LiveRegion message={announcement} />

        {error && (
          <Notice tone="danger" title={t('common.error')}>
            {error}
          </Notice>
        )}
        {notice && (
          <Notice tone="success" onDismiss={() => setNotice(null)}>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="min-w-0">{notice.message}</span>
              <Button ref={undoButton} variant="ghost" size="sm" onClick={notice.undo}>
                {t('common.undo')}
              </Button>
            </span>
          </Notice>
        )}
        {status === 'ignored' && <Notice tone="info">{t('findings.ignoredNotice')}</Notice>}
        {status === 'resolved' && <Notice tone="info">{t('findings.resolvedNotice')}</Notice>}

        {/* Point d'entrée de la vue : le chiffre qui commande la lecture. Le reste de l'écran lui
            est hiérarchiquement inférieur. L'écart depuis la dernière donnée reçue est posé à côté
            du chiffre : devant un écran immobile, la première question est « est-ce à jour ? ».

            En une ligne : le sujet de cette vue est le tableau, et un en-tête empilé lui prenait
            plus de quarante pixels de hauteur utile pour dire cinq choses courtes. */}
        <Hero
          compact
          label={t('severity.critical')}
          value={summary ? summary.critical : '—'}
          tone={summary && summary.critical > 0 ? 'danger' : 'success'}
          hint={summary ? tc('findings.hero.pending', summary.active) : undefined}
          meta={
            summary && (
              <>
                <Badge tone="warning">{tc('findings.hero.warnings', summary.warning)}</Badge>
                <Badge tone="info">{tc('findings.hero.infos', summary.info)}</Badge>
                <LastUpdated at={loadedAt} />
              </>
            )
          }
          action={
            summary &&
            summary.critical > 0 &&
            !(status === 'active' && severityFilter.join() === 'critical') && (
              <Button
                onClick={() => {
                  const next = new URLSearchParams(params)
                  next.set('status', 'active')
                  next.set('severity', 'critical')
                  setParams(next, { replace: true })
                }}
              >
                {t('findings.hero.showCritical')}
              </Button>
            )
          }
        />

        {/* Onglets et tableau dans une seule carte : deux blocs empilés coûtaient une bordure et
            un écart de plus pour une seule et même tâche — choisir un plan de travail, puis le
            parcourir. */}
        <Card>
          <div className="border-border-subtle flex flex-wrap items-center justify-between gap-x-4 border-b px-4">
            <Tabs
              items={STATUS_TABS.map((tab) => ({
                value: tab.value,
                label: t(tab.labelKey),
                count: tab.counter && summary ? summary[tab.counter] : null,
              }))}
              value={status}
              onChange={(value) => setParam('status', value)}
              label={t('findings.statusTabs')}
            />

            {/* Le décompte dit ce que les filtres ont laissé, ce que le flux a apporté depuis
                qu'on regarde, et le geste qui lève les filtres se tient à côté du chiffre qu'il
                fait bouger. */}
            <div className="text-ink-muted flex items-center gap-2 py-1.5 text-meta">
              <span className="tabular-nums">{tc('findings.count', ordered.length)}</span>
              {arrival && <Badge tone="info">{tc('findings.live.new', arrival.count)}</Badge>}
              {findings.length >= PAGE_SIZE && (
                <Badge tone="warning">{t('findings.limited', { count: PAGE_SIZE })}</Badge>
              )}
              {filtering && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1.5">
                  <FilterX className="size-4" aria-hidden />
                  {t('common.clearFilters')}
                </Button>
              )}
            </div>
          </div>

          {/* Rechargement sans clignotement : le tableau reste affiché, seul le liseré dit qu'une
              requête est en cours. Un écran regardé toute la journée ne doit pas se vider à
              chaque événement. */}
          <RefreshBar active={refreshing && !loading} />

          {loading ? (
            <LoadingBlock />
          ) : (
            <FindingsTable
              findings={ordered}
              connections={connections}
              busyId={busyId}
              verdict={verdict}
              refreshing={refreshing}
              selected={selected}
              status={status}
              filtering={filtering}
              search={search}
              severityFilter={severityFilter}
              categoryFilter={categoryFilter}
              instanceFilter={instanceFilter}
              sortKey={sortKey}
              descending={descending}
              onSort={toggleSort}
              onFilter={setParam}
              onClearFilters={clearFilters}
              onOpen={setSelected}
              onIgnore={(finding) =>
                changeStatus(finding, 'ignored', t('findings.notice.ignored', { title: finding.title }))
              }
              onReconsider={(finding) =>
                changeStatus(finding, 'active', t('findings.notice.reconsidered', { title: finding.title }))
              }
              onVerify={verify}
            />
          )}
        </Card>
      </div>

      {selected !== null && (
        <FindingDetailModal id={selected} onClose={() => setSelected(null)} onChanged={() => void load()} />
      )}
    </Page>
  )
}

/**
 * Recherche temporisée. La valeur vit dans l'URL — un état d'investigation se partage et survit à
 * un rechargement — mais la frappe ne doit pas y écrire à chaque touche : la saisie est locale, et
 * ne remonte qu'une fois la frappe retombée.
 */
function SearchFilter({
  value,
  label,
  placeholder,
  onChange,
}: {
  value: string
  label: string
  placeholder: string
  onChange: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const applied = useRef(value)

  useEffect(() => {
    if (draft === applied.current) return

    const timer = window.setTimeout(() => {
      applied.current = draft
      onChange(draft)
    }, SEARCH_DELAY)

    return () => window.clearTimeout(timer)
  }, [draft, onChange])

  // Filtre effacé depuis l'extérieur — le bouton « effacer les filtres », un retour d'historique :
  // la saisie suit l'URL, qui reste la source de vérité.
  useEffect(() => {
    if (value === applied.current) return
    applied.current = value
    setDraft(value)
  }, [value])

  return (
    <FilterInput label={label} value={draft} onValueChange={setDraft} placeholder={placeholder} />
  )
}

/** En-tête de colonne : le libellé commande le tri, le contrôle en dessous filtre la colonne. */
function ColumnHeader({
  label,
  sortKey,
  active,
  descending,
  onSort,
  numeric,
  children,
}: {
  label: string
  sortKey: SortKey
  active: boolean
  descending: boolean
  onSort: (key: SortKey) => void
  numeric?: boolean
  children?: React.ReactNode
}) {
  const t = useT()

  return (
    <div
      role="columnheader"
      aria-sort={active ? (descending ? 'descending' : 'ascending') : 'none'}
      className={cn('min-w-0', numeric && 'text-right')}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={t('table.sortBy', { label })}
        className={cn(
          'text-ink-muted hover:text-ink inline-flex max-w-full items-center gap-1 font-semibold tracking-wider uppercase',
          active && 'text-ink',
        )}
      >
        <span className="truncate text-micro">{label}</span>
        {/* Le sens du tri est dit par la flèche et par `aria-sort` : la place de la flèche est
            réservée en permanence, sans quoi l'en-tête sautait au clic. */}
        <ChevronRight
          className={cn(
            'size-3 shrink-0 transition-transform',
            active ? (descending ? 'rotate-90' : '-rotate-90') : 'opacity-0',
          )}
          aria-hidden
        />
      </button>

      {children && <div className="mt-1.5">{children}</div>}
    </div>
  )
}

/**
 * Tableau des diagnostics : filtre et tri dans l'en-tête de chaque colonne, lignes virtualisées.
 *
 * Une grille plutôt qu'un `<table>` : seules les lignes visibles sont montées, ce qu'un corps de
 * tableau ne permet pas sans casser l'alignement des colonnes. Les rôles ARIA de grille rendent
 * alors au lecteur d'écran ce que la virtualisation lui retire — le nombre réel de lignes et le
 * sens du tri.
 */
function FindingsTable({
  findings,
  connections,
  busyId,
  verdict,
  refreshing,
  selected,
  status,
  filtering,
  search,
  severityFilter,
  categoryFilter,
  instanceFilter,
  sortKey,
  descending,
  onSort,
  onFilter,
  onClearFilters,
  onOpen,
  onIgnore,
  onReconsider,
  onVerify,
}: {
  findings: Finding[]
  connections: Connection[]
  busyId: number | null
  verdict: Verdict | null
  refreshing: boolean
  selected: number | null
  status: string
  filtering: boolean
  search: string
  severityFilter: string[]
  categoryFilter: string[]
  instanceFilter: string[]
  sortKey: SortKey
  descending: boolean
  onSort: (key: SortKey) => void
  onFilter: (key: string, value: string) => void
  onClearFilters: () => void
  onOpen: (id: number) => void
  onIgnore: (finding: Finding) => void
  onReconsider: (finding: Finding) => void
  onVerify: (finding: Finding) => void
}) {
  const t = useT()

  const scrollParent = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const available = useFillHeight(scrollParent)
  const [listOffset, setListOffset] = useState(0)

  // Les lignes commencent sous l'en-tête collant : le virtualiseur doit connaître ce décalage
  // pour décider lesquelles monter. Mesuré à chaque rendu — la hauteur de l'en-tête varie avec
  // ses filtres — et sans effet quand la valeur ne change pas.
  const measureOffset = useCallback(() => {
    const offset = list.current?.offsetTop ?? 0
    setListOffset((current) => (current === offset ? current : offset))
  }, [])

  useLayoutEffect(measureOffset)

  const virtualizer = useVirtualizer({
    count: findings.length,
    getScrollElement: () => scrollParent.current,
    estimateSize: () => 64,
    overscan: 10,
    scrollMargin: listOffset,
    getItemKey: (index) => findings[index].id,
  })

  const setList = (key: string) => (values: string[]) => onFilter(key, values.join(','))

  return (
    <div
      ref={scrollParent}
      style={{ maxHeight: available }}
      aria-busy={refreshing}
      className="min-h-72 overflow-auto overscroll-contain"
    >
      <div
        role="grid"
        aria-label={t('nav.findings')}
        aria-rowcount={findings.length + 1}
        style={{ minWidth: MIN_WIDTH }}
      >
        {/*
         * Filtrer et trier se font dans l'en-tête de la colonne concernée : une barre séparée
         * oblige à rétablir de tête le lien entre un contrôle et sa colonne. Les contrôles y sont
         * resserrés d'un cran, comme dans une barre d'outils.
         */}
        <div
          role="row"
          aria-rowindex={1}
          className="bg-surface-sunken border-border-subtle sticky top-0 z-10 grid gap-x-3 border-b px-4 py-2 [--control-md:var(--control-sm)]"
          style={{ gridTemplateColumns: TEMPLATE }}
        >
          <ColumnHeader
            label={t('findings.column.diagnostic')}
            sortKey="diagnostic"
            active={sortKey === 'diagnostic'}
            descending={descending}
            onSort={onSort}
          >
            <SearchFilter
              label={t('findings.column.diagnostic')}
              value={search}
              placeholder={t('findings.searchPlaceholder')}
              onChange={(value) => onFilter('search', value)}
            />
          </ColumnHeader>

          <ColumnHeader
            label={t('common.severity')}
            sortKey="severity"
            active={sortKey === 'severity'}
            descending={descending}
            onSort={onSort}
          >
            <MultiSelect
              label={t('common.severity')}
              values={severityFilter}
              onChange={setList('severity')}
              unit={t('findings.unit.severity')}
              unitPlural={t('findings.unit.severities')}
              options={SEVERITIES.map((value) => ({ value, label: t(`severity.${value}`) }))}
            />
          </ColumnHeader>

          <ColumnHeader
            label={t('common.instance')}
            sortKey="instance"
            active={sortKey === 'instance'}
            descending={descending}
            onSort={onSort}
          >
            <MultiSelect
              label={t('common.instance')}
              values={instanceFilter}
              onChange={setList('connectionId')}
              unit={t('findings.unit.instance')}
              unitPlural={t('findings.unit.instances')}
              options={connections.map((connection) => ({
                value: String(connection.id),
                label: connection.name,
              }))}
            />
          </ColumnHeader>

          <ColumnHeader
            label={t('common.category')}
            sortKey="category"
            active={sortKey === 'category'}
            descending={descending}
            onSort={onSort}
          >
            <MultiSelect
              label={t('common.category')}
              values={categoryFilter}
              onChange={setList('category')}
              unit={t('findings.unit.category')}
              unitPlural={t('findings.unit.categories')}
              options={CATEGORIES.map((value) => ({ value, label: categoryLabel(value) }))}
            />
          </ColumnHeader>

          {/* Détecté : une date. Aucun contrôle plutôt qu'un contrôle inventé — l'application n'a
              pas de filtre de période, et le tri par date répond déjà à « qu'est-ce qui vient
              d'arriver ». */}
          <ColumnHeader
            label={t('findings.column.detected')}
            sortKey="detected"
            active={sortKey === 'detected'}
            descending={descending}
            onSort={onSort}
          />

          <div role="columnheader" aria-sort="none" aria-label={t('common.actions')} />
        </div>

        {findings.length === 0 ? (
          // Un tableau vidé par ses propres filtres n'est pas un tableau vide : le dire, et rendre
          // le geste qui le remplit à nouveau. Collé à gauche, pour qu'un tableau poussé
          // latéralement n'emmène pas son message hors de vue.
          <div className="sticky left-0">
            <EmptyState
              icon={
                filtering ? (
                  <FilterX className="size-6" aria-hidden />
                ) : (
                  <CheckCircle2 className="size-6" aria-hidden />
                )
              }
              title={filtering ? t('findings.empty.filtered') : t('findings.empty.title')}
              description={
                filtering
                  ? t('findings.empty.filteredHint')
                  : status === 'active'
                    ? t('findings.empty.active')
                    : status === 'ignored'
                      ? t('findings.empty.ignored')
                      : t('findings.empty.other')
              }
              action={
                filtering && <Button onClick={onClearFilters}>{t('common.clearFilters')}</Button>
              }
            />
          </div>
        ) : (
          <div
            ref={list}
            role="rowgroup"
            className="relative w-full"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const finding = findings[item.index]

              return (
                <div
                  key={item.key}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  role="presentation"
                  className="absolute top-0 left-0 w-full"
                  style={{ transform: `translateY(${item.start - listOffset}px)` }}
                >
                  <FindingRow
                    finding={finding}
                    index={item.index}
                    busy={busyId === finding.id}
                    selected={selected === finding.id}
                    verdict={verdict?.findingId === finding.id ? verdict : null}
                    onOpen={onOpen}
                    onIgnore={onIgnore}
                    onReconsider={onReconsider}
                    onVerify={onVerify}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function FindingRow({
  finding,
  index,
  busy,
  selected,
  verdict,
  onOpen,
  onIgnore,
  onReconsider,
  onVerify,
}: {
  finding: Finding
  index: number
  busy: boolean
  selected: boolean
  verdict: Verdict | null
  onOpen: (id: number) => void
  onIgnore: (finding: Finding) => void
  onReconsider: (finding: Finding) => void
  onVerify: (finding: Finding) => void
}) {
  const t = useT()
  const tc = useTc()

  const verifyOption = {
    label: t('findings.action.verify'),
    description: t('findings.action.verifyHint'),
    onSelect: () => onVerify(finding),
  }

  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      aria-selected={selected}
      tabIndex={0}
      onClick={() => onOpen(finding.id)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onOpen(finding.id)
      }}
      title={t('findings.rowTitle')}
      className={cn(
        'border-border-subtle hover:bg-surface-sunken grid w-full cursor-pointer items-start gap-x-3 border-b px-4 py-2.5 text-left',
        selected && 'bg-brand-subtle',
      )}
      style={{ gridTemplateColumns: TEMPLATE }}
    >
      {/* Deux niveaux de texte, pas trois : sur trente diagnostics, une ligne de plus par élément
          coûte un écran entier. Le titre est tronqué plutôt que replié, ce qui garde les colonnes
          alignées d'une ligne à l'autre. */}
      <span role="gridcell" className="block min-w-0">
        <span className="flex items-center gap-2">
          <span className="text-ink min-w-0 truncate font-medium" title={finding.title}>
            {finding.title}
          </span>
          {finding.occurrences > 1 && (
            <Badge
              className="shrink-0 tabular-nums"
              title={tc('findings.occurrences', finding.occurrences)}
            >
              ×{finding.occurrences}
            </Badge>
          )}
          {finding.status !== 'active' && (
            <Badge className="shrink-0">{statusLabel(finding.status)}</Badge>
          )}
        </span>

        <span className="text-ink-muted mt-0.5 flex items-baseline gap-2 text-meta">
          {finding.target && (
            <code className="text-ink max-w-64 shrink-0 truncate font-mono">{finding.target}</code>
          )}
          <span className="min-w-0 flex-1 truncate" title={finding.message}>
            {finding.message}
          </span>
        </span>

        {/* Taille et couleur dans la même chaîne, hors de la fusion de classes : celle-ci range
            `text-meta` et `text-warning-strong` dans la même famille et n'en garde qu'une. */}
        {verdict && (
          <span
            className={`mt-1.5 block rounded-[var(--radius-control)] px-2 py-1 text-meta ${
              verdict.tone === 'success'
                ? 'bg-success-subtle text-success-strong'
                : verdict.tone === 'warning'
                  ? 'bg-warning-subtle text-warning-strong'
                  : 'bg-danger-subtle text-danger-strong'
            }`}
          >
            {verdict.message}
            {verdict.durationMs > 0 && ` (${t('findings.durationMs', { ms: Math.round(verdict.durationMs) })})`}
          </span>
        )}
      </span>

      <span role="gridcell" className="block min-w-0">
        <SeverityBadge severity={finding.severity} />
      </span>

      <span role="gridcell" className="text-ink block min-w-0 truncate" title={finding.connectionName}>
        {finding.connectionName}
      </span>

      <span role="gridcell" className="text-ink block min-w-0 truncate">
        {categoryLabel(finding.category)}
      </span>

      <span
        role="gridcell"
        className="text-ink-muted block min-w-0 truncate"
        title={`${t('findings.detail.detectedAt')} ${formatDateTime(finding.detectedAt)}`}
      >
        {formatRelative(finding.detectedAt)}
      </span>

      {/*
       * Un diagnostic n'est pas une tâche à cocher : il décrit un fait constaté, et il disparaît
       * quand le fait disparaît. Le seul jugement qui appartient à l'utilisateur est « ce constat
       * ne m'intéresse pas » — ignorer — et son contraire. La vérification, elle, ne conclut pas :
       * elle rejoue la règle et laisse le moteur trancher.
       *
       * Le clic n'ouvre pas le détail depuis cette cellule : on y agit, on n'y lit pas.
       */}
      <span
        role="gridcell"
        className="flex justify-end"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {finding.status === 'active' && (
          <SplitButton
            label={t('findings.action.ignore')}
            loading={busy}
            disabled={busy}
            onClick={() => onIgnore(finding)}
            options={[verifyOption]}
          />
        )}

        {finding.status === 'ignored' && (
          <SplitButton
            label={t('findings.action.reconsider')}
            loading={busy}
            disabled={busy}
            onClick={() => onReconsider(finding)}
            options={[verifyOption]}
          />
        )}

        {finding.status === 'resolved' && (
          <Button loading={busy} disabled={busy} onClick={() => onVerify(finding)}>
            {t('findings.action.verify')}
          </Button>
        )}
      </span>
    </div>
  )
}

function FindingDetailModal({
  id,
  onClose,
  onChanged,
}: {
  id: number
  onClose: () => void
  onChanged: () => void
}) {
  const t = useT()
  const [detail, setDetail] = useState<FindingDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [verdict, setVerdict] = useState<{ tone: VerdictTone; message: string; durationMs: number } | null>(
    null,
  )
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setDetail(await api.findings.get(id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr('common.loadFailed'))
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function changeStatus(status: FindingStatus) {
    setBusy(true)
    setVerdict(null)

    try {
      await api.findings.setStatus(id, status)
      await load()
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr('findings.statusFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function verify() {
    setBusy(true)

    try {
      const result = await api.findings.verify(id)
      setError(null)
      // Le verdict a sa propre tonalité : un fait toujours constaté est un avertissement, pas une
      // erreur — le peindre en rouge laissait croire à une vérification en échec.
      setVerdict({
        tone: verdictTone(result),
        message: result.message,
        durationMs: result.durationMs,
      })
      await load()
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr('findings.verifyFailed'))
    } finally {
      setBusy(false)
    }
  }

  const finding = detail?.finding
  const evidence = finding?.evidence ? Object.entries(finding.evidence) : []

  return (
    <Modal
      title={finding?.title ?? t('findings.detail.fallbackTitle')}
      // L'instance et l'objet visé identifient le diagnostic : ils tiennent sous le titre plutôt
      // que d'ouvrir le corps de la modale par une ligne de contexte.
      description={
        finding && `${finding.connectionName}${finding.target ? ` · ${finding.target}` : ''}`
      }
      onClose={onClose}
      size="lg"
      // Le pied ne propose que ce qui relève de l'utilisateur — ignorer, se dédire — et la
      // vérification, qui rend la main au moteur : lui seul clôt un diagnostic.
      footer={
        finding && (
          <>
            <Button variant="ghost" onClick={onClose} className="mr-auto">
              {t('common.close')}
            </Button>
            {finding.status === 'ignored' ? (
              <Button disabled={busy} onClick={() => changeStatus('active')}>
                {t('findings.action.reconsider')}
              </Button>
            ) : (
              finding.status === 'active' && (
                <Button disabled={busy} onClick={() => changeStatus('ignored')}>
                  {t('findings.action.ignore')}
                </Button>
              )
            )}
            <Button variant="primary" onClick={verify} loading={busy}>
              {t('findings.action.verify')}
            </Button>
          </>
        )
      }
    >
      {!detail ? (
        <LoadingBlock />
      ) : (
        <div className="space-y-4">
          {error && (
            <Notice tone="danger" title={t('common.error')}>
              {error}
            </Notice>
          )}
          {verdict && (
            <Notice tone={verdict.tone}>
              {verdict.message}
              {verdict.durationMs > 0 && (
                <span className="text-ink-muted">
                  {' '}
                  ({t('findings.durationMs', { ms: Math.round(verdict.durationMs) })})
                </span>
              )}
            </Notice>
          )}

          {/* Le diagnostic ouvre la modale : c'est ce qu'on est venu lire. La signalétique tient
              sur la ligne au-dessus, les mesures qui le qualifient juste en dessous. */}
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={detail.finding.severity} />
            <Badge>{statusLabel(detail.finding.status)}</Badge>
            <Badge tone="info">{categoryLabel(detail.finding.category)}</Badge>
            {detail.finding.documentation && (
              <a
                href={detail.finding.documentation}
                target="_blank"
                rel="noreferrer noopener"
                className="text-brand hover:text-brand-hover ml-auto inline-flex items-center gap-1 text-meta font-medium hover:underline"
              >
                {t('findings.detail.documentation')}
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            )}
          </div>

          <p className="text-ink text-body">{detail.finding.message}</p>

          {/* Le modèle du produit, dit là où l'on cherche quoi faire du diagnostic : ce n'est pas
              une tâche que l'on coche, c'est un fait qui cesse d'être vrai. */}
          <p className="text-ink-muted text-meta">{t('findings.detail.resolutionHint')}</p>

          {/* Les mesures forment une bande de couples courts : lues d'un balayage horizontal,
              elles ne coûtent que deux lignes au lieu de six paires empilées. */}
          <KeyValueGrid columns={3}>
            <KeyValue label={t('findings.detail.impact')}>
              {qualifierLabel(detail.finding.impact)}
            </KeyValue>
            <KeyValue label={t('findings.detail.confidence')}>
              {qualifierLabel(detail.finding.confidence)}
            </KeyValue>
            <KeyValue label={t('findings.detail.occurrences')}>{detail.finding.occurrences}</KeyValue>
            <KeyValue label={t('findings.detail.lastSeen')}>
              {formatRelative(detail.finding.lastSeenAt)}
            </KeyValue>
            <KeyValue label={t('findings.detail.detectedAt')}>
              {formatDateTime(detail.finding.detectedAt)}
            </KeyValue>
            {detail.finding.resolvedAt && (
              <KeyValue label={t('findings.detail.resolvedAt')}>
                {formatDateTime(detail.finding.resolvedAt)}
              </KeyValue>
            )}
          </KeyValueGrid>

          {/* La règle déclenchante tient sur une ligne : libellé, identifiant cliquable, nom
              et version se suivent au lieu de former un bloc à part. */}
          <p className="text-body">
            <span className="text-ink-muted text-micro font-semibold tracking-wider uppercase">
              {t('findings.detail.rule')}
            </span>{' '}
            <Link
              to={`/rules/${encodeURIComponent(detail.finding.ruleId)}`}
              className="text-brand hover:text-brand-hover font-mono hover:underline"
            >
              {detail.finding.ruleId}
            </Link>
            {detail.finding.ruleName && (
              <span className="text-ink-muted"> — {detail.finding.ruleName}</span>
            )}
            <span className="text-ink-muted ml-1 text-meta">
              {t('findings.detail.ruleVersion', { version: detail.finding.ruleVersion })}
            </span>
          </p>
          {detail.finding.ruleMissing && (
            <Notice tone="warning">{t('findings.detail.ruleMissing')}</Notice>
          )}

          {detail.finding.remediationSql && (
            // Zero-touch : l'Advisor n'exécute rien, il donne une commande à lancer ailleurs.
            // Elle est donc copiable — la resaisir à la main depuis un écran de supervision est
            // le meilleur moyen de se tromper d'objet.
            <SqlCommand
              sql={detail.finding.remediationSql}
              label={t('findings.detail.remediation')}
              hint={t('findings.detail.remediationHint')}
              className="max-h-56"
            />
          )}

          {evidence.length > 0 && (
            <Section title={t('findings.detail.evidence')}>
              {/* Hauteur bornée : une preuve à trente entrées repoussait le correctif SQL hors
                  de l'écran. Le tableau défile dans son propre cadre. */}
              <div className="border-border-subtle max-h-56 overflow-auto rounded-[var(--radius-control)] border">
                {/* Le nom d'une preuve est une donnée, pas une étiquette d'interface : il garde
                    sa casse et sa police à chasse fixe. `Th` imposerait des capitales à
                    `last_autovacuum`, ce qui n'est plus le nom de la colonne interrogée. */}
                <Table>
                  <TBody>
                    {evidence.map(([key, value]) => (
                      <Tr key={key}>
                        <Td className="bg-surface-sunken text-ink-muted w-44 align-top font-mono">
                          {key}
                        </Td>
                        <Td className="align-top font-mono break-all">
                          {value === null ? '—' : String(value)}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </div>
            </Section>
          )}

          {/* Deux journaux courts côte à côte dès qu'il y a la place : ils se lisent en un coup
              d'œil au lieu de rallonger la modale de deux blocs. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Section title={t('findings.detail.history')}>
              <ul className="text-ink-muted max-h-44 space-y-1.5 overflow-auto text-meta">
                {detail.history.map((entry, index) => (
                  <li key={index} className="flex flex-wrap gap-x-2">
                    <span className="whitespace-nowrap">{formatDateTime(entry.at)}</span>
                    <span className="text-ink">
                      {entry.fromStatus ? `${statusLabel(entry.fromStatus)} → ` : ''}
                      {statusLabel(entry.toStatus)}
                    </span>
                    {entry.note && <span>({entry.note})</span>}
                    {entry.actor && <span>{t('findings.detail.actor', { actor: entry.actor })}</span>}
                  </li>
                ))}
              </ul>
            </Section>

            {detail.notifications.length > 0 && (
              <Section title={t('findings.detail.notifications')}>
                <ul className="text-ink-muted max-h-44 space-y-1.5 overflow-auto text-meta">
                  {detail.notifications.map((entry, index) => (
                    <li key={index} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="whitespace-nowrap">{formatDateTime(entry.at)}</span>
                      <code className="bg-surface-sunken text-ink rounded px-1 font-mono">
                        {entry.webhook}
                      </code>
                      <span>{entry.event}</span>
                      {entry.success ? (
                        <Badge tone="success">{t('findings.detail.sent')}</Badge>
                      ) : (
                        <Badge tone="danger">
                          {t('findings.detail.failed', { status: entry.statusCode ?? '' })}
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

/** Intitulé de bloc du détail : un rang sous le titre de la modale, sans les écarts d'un formulaire. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0">
      <h3 className="border-border-subtle text-ink-muted mb-2 border-b pb-1 text-micro font-semibold tracking-wider uppercase">
        {title}
      </h3>
      {children}
    </section>
  )
}
