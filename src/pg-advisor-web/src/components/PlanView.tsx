import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Ban,
  ChevronDown,
  Clock,
  Coins,
  Cpu,
  Maximize2,
  Minus,
  Plus,
  Rows3,
  type LucideIcon,
} from 'lucide-react'
import type { ExplainPlan, PlanNode, PlanWarning, QueryAnalysisResult } from '../api/types'
import { Alert, Card, CodeBlock, Select, Tag } from '@/components/ui'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

type View = 'graph' | 'text' | 'table'

const VIEWS: { value: View; label: string; hint: string }[] = [
  { value: 'graph', label: 'Plan', hint: 'Diagramme de l’arbre d’exécution' },
  { value: 'text', label: 'Raw', hint: 'Sortie textuelle brute d’EXPLAIN' },
  { value: 'table', label: 'Grid', hint: 'Nœuds en grille, triables' },
]

function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (value < 1) return `${value.toFixed(3)} ms`
  if (value < 1000) return `${value.toFixed(2)} ms`
  return `${(value / 1000).toFixed(2)} s`
}

function formatBlocks(blocks: number | null | undefined): string {
  if (blocks === null || blocks === undefined) return '—'
  // Un bloc PostgreSQL vaut 8 kio par défaut.
  const bytes = blocks * 8 * 1024
  if (bytes < 1024 * 1024) return `${formatNumber(blocks)} blocs`
  return `${formatNumber(blocks)} blocs (${(bytes / 1024 / 1024).toFixed(1)} Mio)`
}

/** Écart d'estimation : positif = sous-estimation, négatif = surestimation. */
function formatEstimation(factor: number | null): string {
  if (factor === null) return '—'
  const absolute = Math.abs(factor)
  if (absolute < 1.5) return 'juste'
  return factor > 0 ? `×${absolute.toFixed(1)} de plus` : `×${absolute.toFixed(1)} de moins`
}

function estimationTone(factor: number | null): 'neutral' | 'warn' | 'bad' {
  if (factor === null) return 'neutral'
  const absolute = Math.abs(factor)
  if (absolute >= 100) return 'bad'
  if (absolute >= 10) return 'warn'
  return 'neutral'
}

export function PlanView({ result }: { result: QueryAnalysisResult }) {
  const [view, setView] = useState<View>('graph')
  const plan = result.plan

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav
          className="border-border-strong bg-surface flex rounded-[var(--radius-control)] border p-0.5"
          aria-label="Vue du plan"
        >
          {VIEWS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setView(item.value)}
              aria-current={view === item.value ? 'true' : undefined}
              title={item.hint}
              className={`rounded-[calc(var(--radius-control)-2px)] px-3 py-1.5 text-sm font-medium transition-colors ${
                view === item.value
                  ? 'bg-brand text-brand-ink'
                  : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="text-ink-muted flex flex-wrap items-center gap-3 text-xs">
          <Metric label="Exécution" value={formatMs(plan.executionMs)} strong />
          <Metric label="Planification" value={formatMs(plan.planningMs)} />
          <Metric label="Coût total" value={formatNumber(Math.round(plan.totalCost))} />
          <Metric label="Nœuds" value={String(plan.nodes.length)} />
        </div>
      </div>

      {result.notes.map((note) => (
        <Alert key={note} tone="info">
          {note}
        </Alert>
      ))}

      {view === 'graph' && <PlanDiagram plan={plan} />}
      {view === 'table' && <PlanTables plan={plan} />}
      {view === 'text' && (
        <div className="space-y-3">
          {/* La requête n'est pas rappelée ici : elle est déjà affichée au-dessus du plan. */}
          <Card title="Plan d'exécution (EXPLAIN, format texte)">
            <CodeBlock className="max-h-[28rem] overflow-y-auto whitespace-pre">
              {result.planText}
            </CodeBlock>
          </Card>
          <Card title="Plan brut (format JSON)">
            <CodeBlock className="max-h-[24rem] overflow-y-auto whitespace-pre">
              {result.planJson}
            </CodeBlock>
          </Card>
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-ink-faint">{label} </span>
      <span className={strong ? 'font-semibold text-ink' : 'text-ink'}>{value}</span>
    </span>
  )
}

/* ------------------------------------------------------------------ Diagramme */

const NODE_W = 340
const GAP_X = 32
const GAP_Y = 56
const PAD = 32
const MIN_ZOOM = 0.35
const MAX_ZOOM = 1.6

/** Hauteur supposée d'une carte avant sa première mesure. */
const ESTIMATED_H = 96

/** Plancher de l'ajustement automatique : en deçà, les cartes ne sont plus lisibles. */
const FIT_FLOOR = 0.4

/** Déplacement, en pixels, à partir duquel un appui devient un glisser plutôt qu'un clic. */
const PAN_THRESHOLD = 4

type MetricKey = 'none' | 'self' | 'inclusive' | 'cost' | 'rows'

const METRICS: { value: MetricKey; label: string }[] = [
  { value: 'self', label: 'Temps propre' },
  { value: 'inclusive', label: 'Temps cumulé' },
  { value: 'cost', label: 'Coût propre' },
  { value: 'rows', label: 'Lignes' },
  { value: 'none', label: 'Aucune' },
]

/**
 * Sévérité d'une valeur, de 0 (anodin) à 3 (dominant). Une échelle unique pour toutes les
 * métriques : un nœud rouge est toujours celui qui pèse, quelle que soit la grandeur observée.
 */
type Heat = 0 | 1 | 2 | 3

const HEAT_TOKEN: Record<Heat, string> = {
  0: '--color-ink-faint',
  1: '--color-brand',
  2: '--color-warning',
  3: '--color-danger',
}

const HEAT_BADGE: Record<Heat, string> = {
  0: 'bg-surface-sunken text-ink-muted',
  1: 'bg-brand-subtle text-brand',
  2: 'bg-warning-subtle text-warning',
  3: 'bg-danger-subtle text-danger',
}

function heatOfShare(fraction: number): Heat {
  if (fraction >= 0.6) return 3
  if (fraction >= 0.3) return 2
  if (fraction >= 0.1) return 1
  return 0
}

/** Un facteur d'estimation devient inquiétant bien avant de dominer le plan. */
function heatOfEstimation(factor: number | null): Heat {
  if (factor === null) return 0
  const absolute = Math.abs(factor)
  if (absolute >= 100) return 3
  if (absolute >= 10) return 2
  if (absolute >= 2) return 1
  return 0
}

/** Ce que fait chaque type de nœud, en une phrase : la lecture d'un plan commence par là. */
const NODE_DESCRIPTIONS: Record<string, string> = {
  Aggregate: 'Regroupe les lignes et calcule les agrégats (count, sum, avg…).',
  Append: 'Concatène les résultats de plusieurs sous-plans, sans les trier.',
  'Bitmap Heap Scan': 'Relit la table aux emplacements désignés par un index, dans l’ordre des blocs.',
  'Bitmap Index Scan': 'Parcourt un index pour construire la carte des blocs à relire.',
  'CTE Scan': 'Lit le résultat matérialisé d’une expression WITH.',
  'Function Scan': 'Lit les lignes produites par une fonction.',
  Gather: 'Rassemble les lignes des processus parallèles, sans ordre garanti.',
  'Gather Merge': 'Rassemble les lignes des processus parallèles en conservant leur tri.',
  Group: 'Regroupe une entrée déjà triée par la clé de regroupement.',
  GroupAggregate: 'Calcule les agrégats sur une entrée déjà triée par la clé de regroupement.',
  Hash: 'Charge son entrée dans une table de hachage, pour la jointure située au-dessus.',
  HashAggregate: 'Regroupe les lignes par clé dans une table de hachage, puis calcule les agrégats.',
  'Hash Join': 'Joint deux ensembles en sondant la table de hachage construite sur le plus petit.',
  'Incremental Sort': 'Trie par paquets, en profitant d’un tri partiel déjà présent.',
  'Index Only Scan': 'Lit l’index seul, sans toucher la table quand la carte de visibilité le permet.',
  'Index Scan': 'Parcourt l’index, puis lit dans la table les lignes correspondantes.',
  Limit: 'Ne remonte que le nombre de lignes demandé, puis interrompt son entrée.',
  LockRows: 'Pose les verrous demandés par FOR UPDATE / FOR SHARE sur les lignes remontées.',
  Materialize: 'Conserve son entrée en mémoire pour pouvoir la relire plusieurs fois.',
  Memoize: 'Met en cache les résultats de la boucle interne pour les clés déjà rencontrées.',
  'Merge Append': 'Concatène plusieurs sous-plans déjà triés en conservant l’ordre.',
  'Merge Join': 'Joint deux entrées triées en les parcourant de front.',
  ModifyTable: 'Applique les INSERT, UPDATE ou DELETE aux lignes reçues.',
  'Nested Loop': 'Pour chaque ligne de l’entrée externe, parcourt l’entrée interne.',
  ProjectSet: 'Développe les fonctions qui retournent plusieurs lignes.',
  'Recursive Union': 'Enchaîne le terme initial et le terme récursif d’un WITH RECURSIVE.',
  Result: 'Évalue une expression sans lire de table, ou filtre sur une condition constante.',
  'Sample Scan': 'Lit un échantillon de la table (TABLESAMPLE).',
  'Seq Scan': 'Lit la table entière, bloc par bloc, sans passer par un index.',
  SetOp: 'Applique INTERSECT ou EXCEPT à deux entrées triées.',
  Sort: 'Trie son entrée ; au-delà de work_mem, le tri déborde sur disque.',
  'Subquery Scan': 'Lit le résultat d’une sous-requête.',
  'Tid Scan': 'Lit directement les lignes désignées par leur ctid.',
  Unique: 'Élimine les doublons consécutifs d’une entrée triée.',
  'Values Scan': 'Lit les lignes littérales d’une clause VALUES.',
  WindowAgg: 'Calcule les fonctions de fenêtrage sur une entrée triée par partition.',
}

function describe(nodeType: string): string {
  return (
    NODE_DESCRIPTIONS[nodeType] ??
    NODE_DESCRIPTIONS[nodeType.replace(/^Parallel /, '')] ??
    'Étape d’exécution du plan.'
  )
}

const WARNING_LABELS: Record<string, string> = {
  'seq-scan': 'parcours complet',
  'bad-estimate': 'estimation fausse',
  hotspot: 'temps concentré',
  'sort-on-disk': 'tri sur disque',
  'temp-blocks': 'fichiers temporaires',
  'many-loops': 'boucles nombreuses',
  'heap-fetches': 'accès au heap',
}

/** Lignes réellement remontées par le nœud, boucles comprises. */
function rowsOf(node: PlanNode): number {
  if (node.actualRows === null) return node.planRows
  return node.actualRows * Math.max(1, node.actualLoops ?? 1)
}

function weightOf(node: PlanNode, metric: MetricKey, ownCost: number): number {
  switch (metric) {
    case 'none':
      return 0
    case 'self':
      return node.selfMs ?? 0
    case 'inclusive':
      return node.inclusiveMs ?? 0
    case 'cost':
      return ownCost
    case 'rows':
      return rowsOf(node)
  }
}

/**
 * Coût propre au nœud, enfants déduits — le pendant du temps propre. Le coût brut est cumulatif :
 * s'y fier peindrait en rouge tous les ancêtres du vrai coupable.
 */
function ownCosts(nodes: PlanNode[]): ReadonlyMap<number, number> {
  const fromChildren = new Map<number, number>()

  for (const node of nodes) {
    if (node.parentId === null) continue
    fromChildren.set(node.parentId, (fromChildren.get(node.parentId) ?? 0) + node.totalCost)
  }

  return new Map(
    nodes.map((node) => [node.id, Math.max(0, node.totalCost - (fromChildren.get(node.id) ?? 0))]),
  )
}

/** Sous-titre à la manière d'EXPLAIN : sur quoi le nœud travaille. */
function subtitleOf(node: PlanNode): string | null {
  const alias = node.alias && node.alias !== node.relationName ? ` as ${node.alias}` : ''

  if (node.indexName && node.relationName) return `using ${node.indexName} on ${node.relationName}${alias}`
  if (node.indexName) return `using ${node.indexName}`
  if (node.relationName) return `on ${node.relationName}${alias}`
  if (node.hashCondition) return `on ${node.hashCondition}`
  if (node.joinFilter) return `on ${node.joinFilter}`
  if (node.groupKey) return `by ${node.groupKey}`
  if (node.sortKey) return `by ${node.sortKey}`
  if (node.filter) return `filter ${node.filter}`
  return null
}

type TreeNode = { node: PlanNode; children: TreeNode[] }

/** Reconstruit l'arbre à partir des liens parent/enfant du plan aplati. */
function buildForest(nodes: PlanNode[]): TreeNode[] {
  const byId = new Map<number, TreeNode>(nodes.map((node) => [node.id, { node, children: [] }]))
  const roots: TreeNode[] = []

  for (const node of nodes) {
    const entry = byId.get(node.id)!
    const parent = node.parentId === null ? undefined : byId.get(node.parentId)
    if (parent) parent.children.push(entry)
    else roots.push(entry)
  }

  return roots
}

function descendantCount(entry: TreeNode): number {
  return entry.children.reduce((total, child) => total + 1 + descendantCount(child), 0)
}

type Placed = {
  node: PlanNode
  x: number
  y: number
  height: number
  /** Nombre d'enfants directs, repliés ou non : conditionne la pastille de pliage. */
  childCount: number
  /** Nœuds masqués sous ce nœud lorsque sa branche est repliée. */
  hidden: number
}

type Layout = { placed: Placed[]; width: number; height: number }

/** Références auxquelles rapporter les compteurs d'un nœud pour en juger la sévérité. */
type Scales = { time: number; rows: number; cost: number }

/**
 * Placement de l'arbre : une rangée par profondeur, dimensionnée sur la carte la plus haute de
 * la rangée, et des feuilles empaquetées de gauche à droite, chaque parent se centrant sur ses
 * enfants. Une branche repliée compte comme une feuille : la replier resserre le diagramme.
 */
function layout(
  roots: TreeNode[],
  folded: ReadonlySet<number>,
  heights: ReadonlyMap<number, number>,
): Layout {
  const rowHeights: number[] = []

  const measure = (entry: TreeNode, depth: number) => {
    rowHeights[depth] = Math.max(rowHeights[depth] ?? 0, heights.get(entry.node.id) ?? ESTIMATED_H)
    if (folded.has(entry.node.id)) return
    for (const child of entry.children) measure(child, depth + 1)
  }

  for (const root of roots) measure(root, 0)

  const rowY: number[] = []
  let bottom = 0
  rowHeights.forEach((rowHeight, depth) => {
    rowY[depth] = bottom
    bottom += rowHeight + GAP_Y
  })

  const placed: Placed[] = []
  let cursor = 0

  const walk = (entry: TreeNode, depth: number): number => {
    const isFolded = folded.has(entry.node.id)
    const children = isFolded ? [] : entry.children

    let center: number
    if (children.length === 0) {
      center = cursor + NODE_W / 2
      cursor += NODE_W + GAP_X
    } else {
      const centers = children.map((child) => walk(child, depth + 1))
      center = (centers[0] + centers[centers.length - 1]) / 2
    }

    placed.push({
      node: entry.node,
      x: center - NODE_W / 2,
      y: rowY[depth],
      height: heights.get(entry.node.id) ?? ESTIMATED_H,
      childCount: entry.children.length,
      hidden: isFolded ? descendantCount(entry) : 0,
    })

    return center
  }

  for (const root of roots) walk(root, 0)

  return {
    placed,
    width: Math.max(NODE_W, cursor - GAP_X),
    height: Math.max(ESTIMATED_H, bottom - GAP_Y),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Diagramme du plan : chaque étape est une carte dépliable, reliée à ses entrées par des
 * connecteurs coudés. Racine en haut, les données remontent des feuilles ; l'épaisseur d'un
 * connecteur dit le nombre de lignes qui remontent.
 */
function PlanDiagram({ plan }: { plan: ExplainPlan }) {
  const [metric, setMetric] = useState<MetricKey>('self')
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set<number>())
  const [folded, setFolded] = useState<ReadonlySet<number>>(() => new Set<number>())
  const [heights, setHeights] = useState<ReadonlyMap<number, number>>(() => new Map())
  const [selected, setSelected] = useState<number | null>(null)
  const [focus, setFocus] = useState<number | null>(null)
  const [zoom, setZoom] = useState(1)

  const viewport = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    pointerId: number
    x: number
    y: number
    left: number
    top: number
    moved: boolean
  } | null>(null)
  const swallow = useRef(false)
  const fitted = useRef(false)

  const roots = useMemo(() => buildForest(plan.nodes), [plan.nodes])
  const { placed, width, height } = useMemo(
    () => layout(roots, folded, heights),
    [roots, folded, heights],
  )
  const visible = useMemo(() => new Map(placed.map((item) => [item.node.id, item])), [placed])

  const costs = useMemo(() => ownCosts(plan.nodes), [plan.nodes])

  const maxWeight = useMemo(
    () => Math.max(0, ...plan.nodes.map((node) => weightOf(node, metric, costs.get(node.id) ?? 0))),
    [plan.nodes, metric, costs],
  )

  // Références de sévérité : le temps se rapporte à l'exécution entière et le coût au coût du
  // plan — un nœud « rouge » est donc rouge dans l'absolu, pas seulement par rapport aux autres.
  const scales = useMemo<Scales>(
    () => ({
      time: plan.executionMs ?? Math.max(0, ...plan.nodes.map((node) => node.selfMs ?? 0)),
      rows: Math.max(1, ...plan.nodes.map(rowsOf)),
      cost: plan.totalCost > 0 ? plan.totalCost : Math.max(1, ...plan.nodes.map((n) => n.totalCost)),
    }),
    [plan],
  )

  /** Les nœuds que PEV2 met en avant : le plus lent, le plus gros, le plus coûteux. */
  const culprits = useMemo(() => {
    const best = (score: (node: PlanNode) => number) =>
      plan.nodes.reduce<PlanNode | null>(
        (winner, node) => (winner === null || score(node) > score(winner) ? node : winner),
        null,
      )

    return {
      slowest: best((node) => node.selfMs ?? 0),
      largest: best(rowsOf),
      costliest: best((node) => costs.get(node.id) ?? 0),
    }
  }, [plan.nodes, costs])

  const edges = useMemo(() => {
    // Échelle logarithmique bornée aux liens réellement présents : sur un plan dont tous les
    // nœuds remontent des centaines de milliers de lignes, une échelle absolue les rendrait
    // tous identiques.
    const magnitudes = placed
      .filter((item) => item.node.parentId !== null && visible.has(item.node.parentId))
      .map((item) => Math.log10(1 + rowsOf(item.node)))
    const floor = Math.min(...magnitudes)
    const span = Math.max(...magnitudes) - floor

    return placed.flatMap((child) => {
      if (child.node.parentId === null) return []
      const parent = visible.get(child.node.parentId)
      if (!parent) return []

      const childX = child.x + NODE_W / 2
      const childTop = child.y
      const parentX = parent.x + NODE_W / 2
      const parentBottom = parent.y + parent.height
      const midY = (parentBottom + childTop) / 2
      const rows = rowsOf(child.node)
      const magnitude = span > 0 ? (Math.log10(1 + rows) - floor) / span : 0.5

      return [
        {
          id: child.node.id,
          // Connecteur coudé : montée depuis la carte, traverse à mi-hauteur, remonte au parent.
          path: `M ${childX} ${childTop} V ${midY} H ${parentX} V ${parentBottom}`,
          rows,
          thickness: 1.25 + 4 * magnitude,
          labelX: childX,
          labelY: (childTop + midY) / 2,
        },
      ]
    })
  }, [placed, visible])

  const fit = useCallback(() => {
    const element = viewport.current
    if (!element) return

    // Les deux dimensions : un plan profond déborde par le bas bien avant de déborder à droite.
    const horizontal = (element.clientWidth - 16) / (width + PAD * 2)
    const vertical = (element.clientHeight - 16) / (height + PAD * 2)
    setZoom(clamp(Math.min(horizontal, vertical), FIT_FLOOR, 1))
  }, [width, height])

  useEffect(() => {
    // Une seule fois, et seulement quand toutes les cartes se sont mesurées : ajuster plus tôt
    // reviendrait à cadrer sur des hauteurs estimées, et le refaire ensuite reprendrait la main
    // sur le zoom choisi par l'opérateur.
    if (fitted.current || placed.length === 0 || heights.size < placed.length) return
    fitted.current = true
    fit()
  }, [fit, placed.length, heights.size])

  useEffect(() => {
    // Les hauteurs ne sont pas remises à zéro : chaque carte remonte la sienne en se montant,
    // et l'effet du parent s'exécute après ceux des enfants — il effacerait leurs mesures.
    setExpanded(new Set<number>())
    setFolded(new Set<number>())
    setSelected(null)
  }, [plan])

  // Centrage différé : la cible peut être sous une branche repliée, dépliée juste avant.
  useEffect(() => {
    if (focus === null) return

    const item = visible.get(focus)
    const element = viewport.current
    if (!item || !element) return

    element.scrollLeft = (item.x + NODE_W / 2 + PAD) * zoom - element.clientWidth / 2
    element.scrollTop = (item.y + item.height / 2 + PAD) * zoom - element.clientHeight / 2
    setFocus(null)
  }, [focus, visible, zoom])

  const reveal = useCallback((id: number) => {
    setSelected(id)
    setFolded(new Set<number>())
    setFocus(id)
  }, [])

  const report = useCallback((id: number, measured: number) => {
    setHeights((current) => {
      if (current.get(id) === measured) return current
      const next = new Map(current)
      next.set(id, measured)
      return next
    })
  }, [])

  const toggleDetails = useCallback((id: number) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }, [])

  const toggleBranch = useCallback((id: number) => {
    setFolded((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }, [])

  function startPan(event: React.PointerEvent<HTMLDivElement>) {
    const element = viewport.current
    if (!element || event.button !== 0) return

    // Le glisser part de n'importe où, cartes comprises : sur un diagramme large, le fond
    // visible ne suffit pas à attraper la vue. Le seuil ci-dessous distingue clic et glisser.
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: element.scrollLeft,
      top: element.scrollTop,
      moved: false,
    }
  }

  function pan(event: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current
    const element = viewport.current
    if (!state || !element || state.pointerId !== event.pointerId) return

    const deltaX = event.clientX - state.x
    const deltaY = event.clientY - state.y

    if (!state.moved) {
      if (Math.abs(deltaX) < PAN_THRESHOLD && Math.abs(deltaY) < PAN_THRESHOLD) return
      state.moved = true

      try {
        // La capture n'est prise qu'une fois le geste reconnu, sinon elle volerait le clic.
        element.setPointerCapture(event.pointerId)
      } catch {
        // Pointeur déjà relâché : le glisser reste utilisable, il s'arrêtera en sortant.
      }
    }

    element.scrollLeft = state.left - deltaX
    element.scrollTop = state.top - deltaY
  }

  function endPan(event: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current
    if (state?.pointerId !== event.pointerId) return

    if (state.moved) {
      if (viewport.current?.hasPointerCapture(event.pointerId)) {
        viewport.current.releasePointerCapture(event.pointerId)
      }
      // Le relâchement d'un glisser ne doit pas déplier la carte sous le curseur.
      swallow.current = true
    }

    drag.current = null
  }

  function swallowClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!swallow.current) return
    swallow.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  function wheel(event: React.WheelEvent<HTMLDivElement>) {
    const element = viewport.current
    if (!element) return

    // Molette horizontale et déplacement latéral au shift : les deux façons habituelles de
    // parcourir un canevas plus large que sa fenêtre.
    if (event.shiftKey && event.deltaX === 0) {
      element.scrollLeft += event.deltaY
    }
  }

  if (plan.nodes.length === 0) {
    return <Alert tone="warning">Le plan n'a pas pu être structuré ; utilisez la vue texte brut.</Alert>
  }

  return (
    <Card padded={false}>
      <div className="border-border-subtle flex flex-wrap items-center justify-between gap-3 border-b px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-ink-muted flex items-center gap-2 text-xs">
            Mettre en évidence
            <Select
              value={metric}
              className="w-36"
              onChange={(event) => setMetric(event.target.value as MetricKey)}
            >
              {METRICS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
          </label>

          {/* Raccourcis vers les nœuds qui décident du temps de la requête. */}
          <CulpritChip
            icon={Clock}
            label="le plus lent"
            node={culprits.slowest}
            value={formatMs(culprits.slowest?.selfMs)}
            onSelect={reveal}
          />
          <CulpritChip
            icon={Rows3}
            label="le plus gros"
            node={culprits.largest}
            value={culprits.largest ? `${formatNumber(Math.round(rowsOf(culprits.largest)))} lignes` : '—'}
            onSelect={reveal}
          />
          <CulpritChip
            icon={Coins}
            label="le plus coûteux"
            node={culprits.costliest}
            value={
              culprits.costliest
                ? formatNumber(Math.round(costs.get(culprits.costliest.id) ?? 0))
                : '—'
            }
            onSelect={reveal}
          />
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() =>
              setExpanded((current) =>
                current.size === plan.nodes.length
                  ? new Set<number>()
                  : new Set(plan.nodes.map((node) => node.id)),
              )
            }
            className="border-border-strong text-ink-muted hover:border-brand hover:text-brand h-7 rounded-[var(--radius-control)] border px-2 text-xs"
          >
            {expanded.size === plan.nodes.length ? 'Tout replier' : 'Tout déplier'}
          </button>

          <ZoomButton label="Dézoomer" onClick={() => setZoom((z) => clamp(z - 0.15, MIN_ZOOM, MAX_ZOOM))}>
            <Minus className="size-3.5" aria-hidden />
          </ZoomButton>
          <span className="text-ink-muted w-12 text-center text-xs tabular-nums">
            {Math.round(zoom * 100)} %
          </span>
          <ZoomButton label="Zoomer" onClick={() => setZoom((z) => clamp(z + 0.15, MIN_ZOOM, MAX_ZOOM))}>
            <Plus className="size-3.5" aria-hidden />
          </ZoomButton>
          <ZoomButton label="Ajuster à la fenêtre" onClick={fit}>
            <Maximize2 className="size-3.5" aria-hidden />
          </ZoomButton>
        </div>
      </div>

      <div
        ref={viewport}
        onPointerDown={startPan}
        onPointerMove={pan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onClickCapture={swallowClick}
        onWheel={wheel}
        // Hauteur rapportée à la fenêtre : la modale occupant presque tout l'écran, le canevas
        // suit, sans dépendre d'une chaîne de conteneurs flex qui traverse la modale.
        className="bg-surface-sunken relative h-[58dvh] min-h-[22rem] cursor-grab touch-none overflow-auto active:cursor-grabbing"
      >
        <div style={{ width: (width + PAD * 2) * zoom, height: (height + PAD * 2) * zoom }}>
          <div
            className="relative"
            style={{
              width: width + PAD * 2,
              height: height + PAD * 2,
              transform: `scale(${zoom})`,
              transformOrigin: 'top left',
            }}
          >
            <svg
              className="pointer-events-none absolute inset-0"
              width={width + PAD * 2}
              height={height + PAD * 2}
              aria-hidden
            >
              <defs>
                <marker
                  id="plan-flow"
                  markerWidth="9"
                  markerHeight="9"
                  refX="9"
                  refY="4.5"
                  orient="auto"
                  markerUnits="userSpaceOnUse"
                >
                  <path d="M0,0 L9,4.5 L0,9 z" className="fill-border-strong" />
                </marker>
              </defs>

              <g transform={`translate(${PAD},${PAD})`}>
                {edges.map((edge) => (
                  <path
                    key={edge.id}
                    d={edge.path}
                    fill="none"
                    strokeWidth={edge.thickness}
                    strokeLinejoin="round"
                    markerEnd="url(#plan-flow)"
                    className="stroke-border-strong"
                  />
                ))}

                {edges.map((edge) => (
                  <text
                    key={`label-${edge.id}`}
                    x={edge.labelX + 6}
                    y={edge.labelY}
                    dominantBaseline="middle"
                    fontSize={10}
                    className="fill-ink-faint"
                    style={{
                      paintOrder: 'stroke',
                      stroke: 'var(--color-surface-sunken)',
                      strokeWidth: 4,
                    }}
                  >
                    {formatNumber(Math.round(edge.rows))}
                  </text>
                ))}
              </g>
            </svg>

            {placed.map((item) => {
              const ownCost = costs.get(item.node.id) ?? 0
              const intensity = maxWeight > 0 ? weightOf(item.node, metric, ownCost) / maxWeight : 0

              return (
                <PlanNodeCard
                  key={item.node.id}
                  item={item}
                  scales={scales}
                  ownCost={ownCost}
                  intensity={intensity}
                  heat={heatOfShare(intensity)}
                  selected={selected === item.node.id}
                  open={expanded.has(item.node.id)}
                  folded={folded.has(item.node.id)}
                  onSelect={setSelected}
                  onToggleDetails={toggleDetails}
                  onToggleBranch={toggleBranch}
                  onMeasure={report}
                />
              )
            })}
          </div>
        </div>
      </div>

      <p className="text-ink-faint border-border-subtle border-t px-3 py-2 text-xs">
        Les données remontent des feuilles vers la racine ; l'épaisseur d'un connecteur et le
        nombre qui l'accompagne donnent les lignes remontées. Chaque compteur d'une carte est
        coloré selon son poids — <span className="text-brand">notable</span>,{' '}
        <span className="text-warning">lourd</span>, <span className="text-danger">dominant</span>{' '}
        — et la teinte d'une carte suit la métrique mise en évidence. Le chevron ouvre le détail
        de l'étape, la pastille sous une carte replie sa branche.
      </p>
    </Card>
  )
}

function CulpritChip({
  icon: Icon,
  label,
  value,
  node,
  onSelect,
}: {
  icon: LucideIcon
  label: string
  value: string
  node: PlanNode | null
  onSelect: (id: number) => void
}) {
  if (node === null) return null

  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      title={`${node.label} — ${value}`}
      className="border-border-subtle bg-surface-sunken text-ink-muted hover:border-brand hover:text-brand flex h-7 items-center gap-1.5 rounded-[var(--radius-control)] border px-2 text-xs"
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="hidden sm:inline">{label}</span>
      <span className="text-ink font-medium">{node.nodeType}</span>
      <span className="text-ink-faint tabular-nums">{value}</span>
    </button>
  )
}

function ZoomButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="border-border-strong text-ink-muted hover:border-brand hover:text-brand flex size-7 items-center justify-center rounded-[var(--radius-control)] border"
    >
      {children}
    </button>
  )
}

/**
 * Carte d'une étape : en-tête toujours visible, détail dépliable réparti en onglets. La carte
 * mesure sa propre hauteur et la remonte au diagramme, qui replace les rangées en conséquence.
 */
function PlanNodeCard({
  item,
  scales,
  ownCost,
  intensity,
  heat,
  selected,
  open,
  folded,
  onSelect,
  onToggleDetails,
  onToggleBranch,
  onMeasure,
}: {
  item: Placed
  scales: Scales
  ownCost: number
  intensity: number
  heat: Heat
  selected: boolean
  open: boolean
  folded: boolean
  onSelect: (id: number) => void
  onToggleDetails: (id: number) => void
  onToggleBranch: (id: number) => void
  onMeasure: (id: number, height: number) => void
}) {
  const { node } = item
  const card = useRef<HTMLDivElement>(null)
  const alert = node.warnings.some((warning) => warning.severity === 'warning')
  const subtitle = subtitleOf(node)
  const workers = node.workersLaunched ?? node.workersPlanned

  useLayoutEffect(() => {
    const element = card.current
    if (!element) return

    // Mesure directe à chaque pliage/dépliage — c'est ce qui replace les rangées — et
    // observateur pour les variations qui ne passent pas par cet état (polices, largeur).
    onMeasure(node.id, element.offsetHeight)

    const observer = new ResizeObserver(() => onMeasure(node.id, element.offsetHeight))
    observer.observe(element)

    return () => observer.disconnect()
  }, [node.id, open, onMeasure])

  return (
    <div className="absolute" style={{ left: item.x + PAD, top: item.y + PAD, width: NODE_W }}>
      {/* Étiquette de sous-plan : une branche nommée (CTE, InitPlan) se repère avant sa carte. */}
      {node.subplanName && (
        <span className="bg-brand-subtle text-brand mb-1 inline-block rounded-full px-2 py-0.5 font-mono text-[10px]">
          {node.subplanName}
        </span>
      )}

      <div
        ref={card}
        className={cn(
          'bg-surface shadow-card overflow-hidden rounded-[var(--radius-card)] border',
          node.neverExecuted && 'opacity-70',
          selected
            ? 'border-brand ring-brand ring-2'
            : alert
              ? 'border-warning/60'
              : 'border-border-strong',
        )}
      >
        <button
          type="button"
          onClick={() => {
            onSelect(node.id)
            onToggleDetails(node.id)
          }}
          aria-expanded={open}
          // La teinte de l'en-tête suit la sévérité du nœud pour la métrique mise en évidence,
          // calculée sur les jetons du thème : elle reste juste en mode sombre.
          style={{
            backgroundColor:
              intensity > 0
                ? `color-mix(in oklab, var(${HEAT_TOKEN[heat]}) ${(8 + intensity * 26).toFixed(1)}%, var(--color-surface))`
                : undefined,
          }}
          className="hover:bg-surface-sunken/40 block w-full px-3 py-2.5 text-left"
        >
          <span className="flex items-start gap-2">
            <ChevronDown
              aria-hidden
              className={cn(
                'text-ink-faint mt-0.5 size-4 shrink-0 transition-transform',
                open ? '' : '-rotate-90',
              )}
            />

            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-ink text-sm font-semibold">{node.nodeType}</span>
                {node.joinType && (
                  <span className="text-ink-faint text-[10px] tracking-wide uppercase">
                    {node.joinType}
                  </span>
                )}
                {/* « hotspot » n'apparaît pas ici : le badge de durée dit déjà la même chose,
                    et le message complet reste dans le détail de l'étape. */}
                {node.warnings
                  .filter((warning) => warning.kind !== 'hotspot')
                  .map((warning) => (
                    <WarningPill key={warning.kind} warning={warning} />
                  ))}
              </span>

              {subtitle && (
                <span className="text-ink-muted mt-0.5 block truncate font-mono text-[11px]">
                  {subtitle}
                </span>
              )}
            </span>

            <span className="text-ink-faint shrink-0 text-[11px] tabular-nums">#{node.id + 1}</span>
          </span>

          {/* Les compteurs du nœud, chacun coloré par sa propre sévérité : le coupable se voit
              sans avoir à ouvrir la carte. */}
          <span className="mt-2 flex flex-wrap items-center gap-1">
            {node.neverExecuted ? (
              <MetricBadge icon={Ban} heat={0} label="jamais exécuté" title="Branche non atteinte à l'exécution" />
            ) : (
              <>
                <MetricBadge
                  icon={Clock}
                  heat={heatOfShare(scales.time > 0 ? (node.selfMs ?? 0) / scales.time : 0)}
                  label={
                    node.selfSharePercent === null
                      ? formatMs(node.selfMs)
                      : `${formatMs(node.selfMs)} · ${node.selfSharePercent.toFixed(0)} %`
                  }
                  title="Temps propre, hors sous-arbre"
                />
                <MetricBadge
                  icon={Rows3}
                  heat={heatOfShare(scales.rows > 0 ? rowsOf(node) / scales.rows : 0)}
                  label={formatNumber(Math.round(rowsOf(node)))}
                  title="Lignes remontées, boucles comprises"
                />
                {node.estimationFactor !== null && Math.abs(node.estimationFactor) >= 1.5 && (
                  <MetricBadge
                    icon={node.estimationFactor > 0 ? ArrowUp : ArrowDown}
                    heat={heatOfEstimation(node.estimationFactor)}
                    label={`×${Math.abs(node.estimationFactor).toFixed(1)}`}
                    title={`Lignes ${node.estimationFactor > 0 ? 'sous-estimées' : 'surestimées'} par le planificateur`}
                  />
                )}
                <MetricBadge
                  icon={Coins}
                  heat={heatOfShare(scales.cost > 0 ? ownCost / scales.cost : 0)}
                  label={formatNumber(Math.round(ownCost))}
                  title={`Coût propre au nœud, enfants déduits — coût cumulé ${formatNumber(Math.round(node.totalCost))}`}
                />
                {(node.parallelAware || workers) && (
                  <MetricBadge
                    icon={Cpu}
                    heat={0}
                    label={workers ? `×${workers}` : 'parallèle'}
                    title={`Parcours parallèle${workers ? ` : ${workers} processus` : ''}`}
                  />
                )}
              </>
            )}
          </span>
        </button>

        {open && <NodeDetails node={node} />}
      </div>

      {item.childCount > 0 && (
        <button
          type="button"
          onClick={() => onToggleBranch(node.id)}
          title={folded ? 'Déplier cette branche' : 'Replier cette branche'}
          className="border-border-strong bg-surface text-ink-muted hover:border-brand hover:text-brand absolute -bottom-2.5 left-1/2 z-10 min-w-5 -translate-x-1/2 rounded-full border px-1.5 text-[10px] leading-4 tabular-nums"
        >
          {folded ? `+${item.hidden}` : '−'}
        </button>
      )}
    </div>
  )
}

function MetricBadge({
  icon: Icon,
  heat,
  label,
  title,
}: {
  icon: LucideIcon
  heat: Heat
  label: string
  title: string
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums',
        HEAT_BADGE[heat],
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      {label}
    </span>
  )
}

function WarningPill({ warning }: { warning: PlanWarning }) {
  return (
    <span
      title={warning.message}
      className={cn(
        'rounded-full px-1.5 py-px text-[10px] font-medium',
        warning.severity === 'warning'
          ? 'bg-warning-subtle text-warning'
          : 'bg-surface-sunken text-ink-muted',
      )}
    >
      {WARNING_LABELS[warning.kind] ?? warning.kind}
    </span>
  )
}

type TabKey = 'general' | 'io' | 'output' | 'workers' | 'misc'

const TABS: { value: TabKey; label: string }[] = [
  { value: 'general', label: 'Général' },
  { value: 'io', label: 'E/S & tampons' },
  { value: 'output', label: 'Sortie' },
  { value: 'workers', label: 'Parallélisme' },
  { value: 'misc', label: 'Divers' },
]

type TabContent = {
  /** Couples courts, affichés sur deux colonnes. */
  pairs: [string, string][]
  /** Valeurs longues (conditions SQL), affichées pleine largeur. */
  blocks: [string, string][]
}

function tabContent(node: PlanNode, tab: TabKey): TabContent {
  const pair = (label: string, value: string | null): [string, string][] =>
    value === null ? [] : [[label, value]]

  switch (tab) {
    case 'general':
      return {
        pairs: [
          ['Temps propre', formatMs(node.selfMs)],
          ['Temps cumulé', formatMs(node.inclusiveMs)],
          ['Lignes réelles', formatNumber(Math.round(node.actualRows ?? 0))],
          ['Lignes estimées', formatNumber(Math.round(node.planRows))],
          ['Écart d’estimation', formatEstimation(node.estimationFactor)],
          ['Boucles', formatNumber(node.actualLoops ?? 1)],
          ['Coût de démarrage', formatNumber(Math.round(node.startupCost))],
          ['Coût cumulé', formatNumber(Math.round(node.totalCost))],
          ['Largeur', `${node.planWidth} o`],
        ],
        blocks: [],
      }

    case 'io':
      return {
        pairs: [
          ['Blocs en cache', formatBlocks(node.sharedHitBlocks)],
          ['Blocs lus sur disque', formatBlocks(node.sharedReadBlocks)],
          ...pair('Blocs salis', node.sharedDirtiedBlocks === null ? null : formatBlocks(node.sharedDirtiedBlocks)),
          ...pair('Blocs écrits', node.sharedWrittenBlocks === null ? null : formatBlocks(node.sharedWrittenBlocks)),
          ...pair('Blocs temporaires lus', node.tempReadBlocks === null ? null : formatBlocks(node.tempReadBlocks)),
          ...pair('Blocs temporaires écrits', node.tempWrittenBlocks === null ? null : formatBlocks(node.tempWrittenBlocks)),
          ...pair('Accès au heap', node.heapFetches === null ? null : formatNumber(node.heapFetches)),
          ...pair('Méthode de tri', node.sortMethod),
          ...pair('Espace de tri', node.sortSpaceUsedKb === null ? null : `${formatNumber(node.sortSpaceUsedKb)} kio (${node.sortSpaceType ?? '?'})`),
        ],
        blocks: [],
      }

    case 'output':
      return {
        pairs: pair(
          'Lignes écartées par le filtre',
          node.rowsRemovedByFilter === null ? null : formatNumber(node.rowsRemovedByFilter),
        ),
        blocks: [
          ...pair('Condition d’index', node.indexCondition),
          ...pair('Filtre', node.filter),
          ...pair('Revérification', node.recheckCondition),
          ...pair('Condition de hachage', node.hashCondition),
          ...pair('Filtre de jointure', node.joinFilter),
          ...pair('Clé de tri', node.sortKey),
          ...pair('Clé de regroupement', node.groupKey),
        ],
      }

    case 'workers':
      return {
        pairs: [
          ['Parcours parallèle', node.parallelAware ? 'oui' : 'non'],
          ['Processus prévus', node.workersPlanned === null ? 'aucun' : String(node.workersPlanned)],
          ['Processus lancés', node.workersLaunched === null ? 'aucun' : String(node.workersLaunched)],
          ...pair('Boucles', node.actualLoops === null ? null : formatNumber(node.actualLoops)),
        ],
        blocks: [],
      }

    case 'misc':
      return {
        pairs: [
          ['Type de nœud', node.nodeType],
          ...pair('Sous-plan', node.subplanName),
          ...pair('Relation', node.relationName),
          ...pair('Alias', node.alias),
          ...pair('Index', node.indexName),
          ...pair('Type de jointure', node.joinType),
          ...pair('Sens de parcours', node.scanDirection),
          ...pair('Rôle chez le parent', node.parentRelationship),
          ['Part du coût', `${node.costSharePercent.toFixed(1)} %`],
          ...(node.neverExecuted ? ([['Exécution', 'branche jamais atteinte']] as [string, string][]) : []),
        ],
        blocks: [],
      }
  }
}

function NodeDetails({ node }: { node: PlanNode }) {
  const [tab, setTab] = useState<TabKey>('general')
  const content = tabContent(node, tab)

  return (
    <div className="border-border-subtle border-t">
      <p className="text-ink-muted px-3 py-2 text-[11px] leading-snug">{describe(node.nodeType)}</p>

      {node.warnings.length > 0 && (
        <ul className="space-y-1 px-3 pb-2">
          {node.warnings.map((warning) => (
            <li
              key={warning.kind}
              className={cn(
                'text-[11px] leading-snug',
                warning.severity === 'warning' ? 'text-warning' : 'text-ink-muted',
              )}
            >
              {warning.message}
            </li>
          ))}
        </ul>
      )}

      <div className="border-border-subtle bg-surface-sunken flex gap-0.5 overflow-x-auto border-y px-2 py-1">
        {TABS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setTab(item.value)}
            aria-current={tab === item.value ? 'true' : undefined}
            className={cn(
              'rounded-[calc(var(--radius-control)-2px)] px-2 py-1 text-[11px] font-medium whitespace-nowrap',
              tab === item.value
                ? 'bg-surface text-ink shadow-card'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {content.pairs.length === 0 && content.blocks.length === 0 ? (
        <p className="text-ink-faint px-3 py-2 text-[11px]">Rien à afficher pour cette étape.</p>
      ) : (
        <div className="px-3 py-2">
          {content.pairs.length > 0 && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
              {content.pairs.map(([label, value]) => (
                <Detail key={label} label={label} value={value} />
              ))}
            </dl>
          )}

          {content.blocks.length > 0 && (
            <dl className={cn('space-y-1.5', content.pairs.length > 0 && 'mt-2')}>
              {content.blocks.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-ink-faint text-[10px] tracking-wide uppercase">{label}</dt>
                  <dd className="text-ink font-mono text-[11px] break-all">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-ink-faint truncate text-[10px] tracking-wide uppercase">{label}</dt>
      <dd className="text-ink truncate text-[11px] tabular-nums">{value}</dd>
    </div>
  )
}

type SortKey = 'self' | 'inclusive' | 'cost' | 'rows' | 'estimation' | 'reads'

/** Vue tableaux : le même plan trié selon le critère qui intéresse, plus un cumul par relation. */
function PlanTables({ plan }: { plan: ExplainPlan }) {
  const [sort, setSort] = useState<SortKey>('self')

  const sorted = useMemo(() => {
    const nodes = [...plan.nodes]
    const value = (node: PlanNode): number => {
      switch (sort) {
        case 'self':
          return node.selfMs ?? 0
        case 'inclusive':
          return node.inclusiveMs ?? 0
        case 'cost':
          return node.totalCost
        case 'rows':
          return node.actualRows ?? node.planRows
        case 'estimation':
          return Math.abs(node.estimationFactor ?? 0)
        case 'reads':
          return node.sharedReadBlocks ?? 0
      }
    }
    return nodes.sort((a, b) => value(b) - value(a))
  }, [plan.nodes, sort])

  const byRelation = useMemo(() => {
    const map = new Map<string, { selfMs: number; cost: number; rows: number; nodes: number }>()

    for (const node of plan.nodes) {
      if (!node.relationName) continue
      const current = map.get(node.relationName) ?? { selfMs: 0, cost: 0, rows: 0, nodes: 0 }
      current.selfMs += node.selfMs ?? 0
      current.cost += node.totalCost
      current.rows += node.actualRows ?? node.planRows
      current.nodes += 1
      map.set(node.relationName, current)
    }

    return [...map.entries()].sort((a, b) => b[1].selfMs - a[1].selfMs || b[1].cost - a[1].cost)
  }, [plan.nodes])

  return (
    <div className="space-y-4">
      <Card
        title="Nœuds du plan"
        actions={
          <label className="text-ink-muted flex items-center gap-2 text-xs">
            Trier par
            <Select
              value={sort}
              className="w-44"
              onChange={(event) => setSort(event.target.value as SortKey)}
            >
              <option value="self">Temps propre</option>
              <option value="inclusive">Temps cumulé</option>
              <option value="cost">Coût</option>
              <option value="rows">Lignes</option>
              <option value="estimation">Écart d’estimation</option>
              <option value="reads">Blocs lus sur disque</option>
            </Select>
          </label>
        }
        padded={false}
      >
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="bg-surface-sunken text-ink-muted text-left text-xs tracking-wide uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">Nœud</th>
                <th className="px-3 py-2 font-medium">Coût</th>
                <th className="px-3 py-2 font-medium">Temps propre</th>
                <th className="px-3 py-2 font-medium">Cumulé</th>
                <th className="px-3 py-2 font-medium">Lignes</th>
                <th className="px-3 py-2 font-medium">Estimation</th>
                <th className="px-3 py-2 font-medium">Blocs lus</th>
              </tr>
            </thead>
            <tbody className="divide-border-subtle divide-y">
              {sorted.map((node) => (
                <tr key={node.id} className="hover:bg-surface-sunken align-top">
                  <td className="px-3 py-2">
                    <span className="text-ink font-medium">{node.nodeType}</span>
                    {node.relationName && (
                      <p className="text-ink-muted truncate font-mono text-xs">{node.relationName}</p>
                    )}
                  </td>
                  <td className="text-ink px-3 py-2 tabular-nums whitespace-nowrap">
                    {formatNumber(Math.round(node.totalCost))}
                  </td>
                  <td className="text-ink px-3 py-2 tabular-nums whitespace-nowrap">
                    {formatMs(node.selfMs)}
                    {node.selfSharePercent !== null && (
                      <span className="text-ink-faint ml-1 text-xs">
                        {node.selfSharePercent.toFixed(1)} %
                      </span>
                    )}
                  </td>
                  <td className="text-ink px-3 py-2 tabular-nums whitespace-nowrap">
                    {formatMs(node.inclusiveMs)}
                  </td>
                  <td className="text-ink px-3 py-2 tabular-nums whitespace-nowrap">
                    {formatNumber(Math.round(node.actualRows ?? node.planRows))}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Tag tone={estimationTone(node.estimationFactor)}>
                      {formatEstimation(node.estimationFactor)}
                    </Tag>
                  </td>
                  <td className="text-ink px-3 py-2 tabular-nums whitespace-nowrap">
                    {node.sharedReadBlocks === null ? '—' : formatNumber(node.sharedReadBlocks)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {byRelation.length > 0 && (
        <Card title="Cumul par relation" padded={false}>
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="bg-surface-sunken text-ink-muted text-left text-xs tracking-wide uppercase">
                <tr>
                  <th className="px-3 py-2 font-medium">Relation</th>
                  <th className="px-3 py-2 font-medium">Nœuds</th>
                  <th className="px-3 py-2 font-medium">Temps propre</th>
                  <th className="px-3 py-2 font-medium">Coût cumulé</th>
                  <th className="px-3 py-2 font-medium">Lignes</th>
                </tr>
              </thead>
              <tbody className="divide-border-subtle divide-y">
                {byRelation.map(([relation, totals]) => (
                  <tr key={relation} className="hover:bg-surface-sunken">
                    <td className="text-ink px-3 py-2 font-mono text-xs">{relation}</td>
                    <td className="text-ink px-3 py-2 tabular-nums">{totals.nodes}</td>
                    <td className="text-ink px-3 py-2 tabular-nums whitespace-nowrap">
                      {formatMs(totals.selfMs)}
                    </td>
                    <td className="text-ink px-3 py-2 tabular-nums">
                      {formatNumber(Math.round(totals.cost))}
                    </td>
                    <td className="text-ink px-3 py-2 tabular-nums">
                      {formatNumber(Math.round(totals.rows))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {Object.keys(plan.settings).length > 0 && (
        <Card title="Paramètres non standard actifs à la planification">
          <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            {Object.entries(plan.settings).map(([name, value]) => (
              <Detail key={name} label={name} value={value} />
            ))}
          </dl>
        </Card>
      )}
    </div>
  )
}
