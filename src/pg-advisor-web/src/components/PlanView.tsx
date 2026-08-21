import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
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
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CodeBlock,
  CopyButton,
  Notice,
  Select,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Toolbar,
  Tr,
} from '@/components/ui/primitives'
import { formatNumber } from '@/lib/format'
import { currentLocale, hasTranslation, tr, translatePlural, useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

type View = 'graph' | 'text' | 'table'

const VIEWS: View[] = ['graph', 'text', 'table']

function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  // Les symboles d'unité de temps ne se traduisent pas : ms et s sont les mêmes partout.
  if (value < 1) return `${value.toFixed(3)} ms`
  if (value < 1000) return `${value.toFixed(2)} ms`
  return `${(value / 1000).toFixed(2)} s`
}

function formatBlocks(blocks: number | null | undefined): string {
  if (blocks === null || blocks === undefined) return '—'
  // Un bloc PostgreSQL vaut 8 kio par défaut.
  const bytes = blocks * 8 * 1024
  const count = formatNumber(blocks)
  if (bytes < 1024 * 1024) return tr('plan.unit.blocks', { count })
  return tr('plan.unit.blocksWithSize', { count, size: (bytes / 1024 / 1024).toFixed(1) })
}

/** Lignes remontées, accordées en nombre. */
function rowsLabel(count: number): string {
  return translatePlural(currentLocale(), 'plan.rows', count, { count: formatNumber(count) })
}

/** Écart d'estimation : positif = sous-estimation, négatif = surestimation. */
function formatEstimation(factor: number | null): string {
  if (factor === null) return '—'
  const absolute = Math.abs(factor)
  if (absolute < 1.5) return tr('plan.estimation.exact')
  const key = factor > 0 ? 'plan.estimation.more' : 'plan.estimation.less'
  return tr(key, { factor: absolute.toFixed(1) })
}

function estimationTone(factor: number | null): 'neutral' | 'warning' | 'danger' {
  if (factor === null) return 'neutral'
  const absolute = Math.abs(factor)
  if (absolute >= 100) return 'danger'
  if (absolute >= 10) return 'warning'
  return 'neutral'
}

/**
 * Enveloppe commune aux trois vues : une barre d'outils d'une ligne, puis le contenu qui prend
 * tout le reste. Une seule barre pour l'ensemble — sélecteur de vue compris — au lieu d'une
 * rangée d'onglets suivie d'une barre propre au diagramme : chaque rangée retirée revient au
 * plan, qui est le contenu de la modale.
 *
 * `Toolbar` resserre d'elle-même tous les contrôles qu'elle porte au cran dense de la famille
 * étude : aucune vue n'a de taille à répéter contrôle par contrôle.
 */
function PlanShell({ toolbar, children }: { toolbar: ReactNode; children: ReactNode }) {
  return (
    <div className="bg-surface flex h-full min-h-0 flex-col overflow-hidden">
      {/* Une ligne, toujours : la barre ne se replie pas sur deux rangées quand la fenêtre se
          resserre — ce sont les libellés des raccourcis qui s'abrègent. Une rangée de plus ici
          serait une rangée de moins pour le plan, et elle apparaîtrait au pire moment. */}
      <Toolbar className="border-border-subtle shrink-0 flex-nowrap justify-between gap-x-3 overflow-hidden border-b px-3 py-2">
        {toolbar}
      </Toolbar>
      {children}
    </div>
  )
}

/**
 * Plan d'exécution mesuré, en trois vues. Le composant occupe toute la hauteur que son parent
 * lui laisse : dans la modale d'analyse, le diagramme est le contenu principal, et tout ce qui
 * l'entoure doit lui laisser la place.
 */
export function PlanView({ result }: { result: QueryAnalysisResult }) {
  const t = useT()
  const [view, setView] = useState<View>('graph')
  const plan = result.plan

  // Le sélecteur de vue est posé dans la barre de la vue affichée : il ne coûte donc aucune
  // rangée supplémentaire, quelle que soit la vue. Contrôle segmenté, donc `aria-pressed` :
  // `aria-current="page"` annonce la page courante d'une navigation, pas une vue choisie.
  const tabs = (
    <div
      role="group"
      className="border-border-strong bg-surface flex h-8 shrink-0 rounded-[var(--radius-control)] border p-0.5"
      aria-label={t('plan.viewLabel')}
    >
      {VIEWS.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => setView(item)}
          aria-pressed={view === item}
          title={t(`plan.view.${item}Hint`)}
          className={cn(
            'text-meta rounded-[calc(var(--radius-control)-2px)] px-2.5 font-medium transition-colors',
            view === item
              ? 'bg-brand text-brand-ink'
              : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
          )}
        >
          {t(`plan.view.${item}`)}
        </button>
      ))}
    </div>
  )

  if (view === 'graph') return <PlanDiagram plan={plan} tabs={tabs} />

  return (
    <PlanShell toolbar={tabs}>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {view === 'table' ? (
          <PlanTables plan={plan} />
        ) : (
          <div className="space-y-4">
            {/* La requête n'est pas rappelée ici : la modale l'affiche déjà, une seule fois.
                Chaque bloc est copiable : l'Advisor ne corrige rien, tout ce qu'il produit part
                dans un ticket ou dans un autre outil. */}
            <Card>
              <CardHeader
                title={t('plan.text.title')}
                action={<CopyButton value={result.planText} label={t('plan.text.title')} />}
              />
              <CardBody>
                <CodeBlock className="whitespace-pre">{result.planText}</CodeBlock>
              </CardBody>
            </Card>
            <Card>
              <CardHeader
                title={t('plan.json.title')}
                action={<CopyButton value={result.planJson} label={t('plan.json.title')} />}
              />
              <CardBody>
                <CodeBlock className="whitespace-pre">{result.planJson}</CodeBlock>
              </CardBody>
            </Card>
          </div>
        )}
      </div>
    </PlanShell>
  )
}

/**
 * Compteurs d'ensemble du plan. Ils sont affichés hors du canevas — dans l'en-tête de la modale
 * d'analyse — car ils décrivent la mesure entière, pas une étape : le diagramme garde sa surface.
 */
export function PlanTotals({ plan }: { plan: ExplainPlan }) {
  const t = useT()

  return (
    <span className="text-meta flex flex-wrap items-center gap-x-3 gap-y-0.5">
      {/* Execution Time est le chiffre de la mesure : il ne cède jamais. Les trois autres
          s'effacent sous 1536 px, où la rangée d'en-tête ne peut plus s'étendre qu'aux dépens
          du titre de la modale — et un en-tête qui gagne un compteur en perdant le nom de ce
          qu'il coiffe a fait un mauvais échange. */}
      <Metric label={t('plan.total.execution')} value={formatMs(plan.executionMs)} strong />
      <Metric label={t('plan.total.planning')} value={formatMs(plan.planningMs)} secondary />
      <Metric label={t('plan.total.cost')} value={formatNumber(Math.round(plan.totalCost))} secondary />
      <Metric label={t('plan.total.nodes')} value={String(plan.nodes.length)} secondary />
    </span>
  )
}

function Metric({
  label,
  value,
  strong,
  secondary,
}: {
  label: string
  value: string
  strong?: boolean
  secondary?: boolean
}) {
  return (
    <span className={cn('whitespace-nowrap', secondary && 'hidden 2xl:inline')}>
      <span className="text-ink-muted">{label} </span>
      <span className={cn('text-ink tabular-nums', strong && 'font-semibold')}>{value}</span>
    </span>
  )
}

/* ------------------------------------------------------------------ Diagramme */

const NODE_W = 360
const GAP_X = 32
const GAP_Y = 56
const PAD = 32
const MIN_ZOOM = 0.2
const MAX_ZOOM = 2.5

/** Hauteur supposée d'une carte avant sa première mesure. */
const ESTIMATED_H = 110

/** Plancher de l'ajustement automatique : en deçà, les cartes ne sont plus lisibles. */
const FIT_FLOOR = 0.3

/** Déplacement, en pixels, à partir duquel un appui devient un glisser plutôt qu'un clic. */
const PAN_THRESHOLD = 4

/** Pas des boutons de zoom, en facteur multiplicatif — un zoom se raisonne en proportion. */
const ZOOM_STEP = 1.2

type MetricKey = 'none' | 'self' | 'inclusive' | 'cost' | 'rows'

const METRICS: MetricKey[] = ['self', 'inclusive', 'cost', 'rows', 'none']

/**
 * Sévérité d'une valeur, de 0 (anodin) à 3 (dominant). Une échelle unique pour toutes les
 * métriques : un nœud rouge est toujours celui qui pèse, quelle que soit la grandeur observée.
 */
type Heat = 0 | 1 | 2 | 3

/**
 * La sévérité se lit sur une pastille, jamais sur un fond de carte. Un fond teinté impose sa
 * couleur à tout le texte qu'il porte — libellés, compteurs, conditions — et son contraste
 * change avec le thème ; une pastille colore un point précis et laisse la carte neutre.
 *
 * Le premier cran est bleu et non violet : la marque ne dit jamais un état, elle ne signale que
 * ce avec quoi on interagit. Peinte en violet, une étape « notable » se lisait comme un bouton.
 */
const HEAT_DOT: Record<Heat, string> = {
  0: 'bg-ink-faint/40',
  1: 'bg-info',
  2: 'bg-warning',
  3: 'bg-danger',
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

/** Ce que fait le nœud, en une phrase : la lecture d'un plan commence par là. */
function describe(nodeType: string): string {
  const locale = currentLocale()
  const direct = `plan.describe.${nodeType}`
  if (hasTranslation(locale, direct)) return tr(direct)

  // « Parallel Seq Scan » fait le même travail qu'un « Seq Scan », en plusieurs processus.
  const base = `plan.describe.${nodeType.replace(/^Parallel /, '')}`
  if (hasTranslation(locale, base)) return tr(base)

  return tr('plan.describe.default')
}

/** Libellé d'un avertissement du parseur ; son code brut si l'interface ne le connaît pas. */
function warningLabel(kind: string): string {
  const key = `plan.warning.${kind}`
  return hasTranslation(currentLocale(), key) ? tr(key) : kind
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

/**
 * Sous-titre à la manière d'EXPLAIN : sur quoi le nœud travaille. Les mots-outils restent ceux
 * de la sortie de PostgreSQL — c'est le vocabulaire que l'opérateur retrouve dans psql.
 */
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
      center = (centers[0]! + centers[centers.length - 1]!) / 2
    }

    placed.push({
      node: entry.node,
      x: center - NODE_W / 2,
      y: rowY[depth] ?? 0,
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
 * Cadrage du canevas : facteur d'échelle et translation, exprimés dans le repère de la fenêtre.
 * Un seul état pour les trois valeurs, car un zoom au curseur les modifie ensemble — les tenir
 * séparés obligerait à lire l'une pendant qu'on met l'autre à jour.
 */
type Viewbox = { zoom: number; x: number; y: number }

/**
 * Diagramme du plan : chaque étape est une carte dépliable, reliée à ses entrées par des
 * connecteurs coudés. Racine en haut, les données remontent des feuilles ; l'épaisseur d'un
 * connecteur dit le nombre de lignes qui remontent.
 *
 * Le canevas se déplace par transformation, non par défilement : le glisser part de n'importe
 * quel point — carte comprise —, porte sur les deux axes sans butée, et le zoom se fait au
 * curseur, ce qu'une barre de défilement ne sait pas faire.
 *
 * Le sélecteur de vue est fourni par l'appelant et prend place dans la barre du diagramme : le
 * canevas occupe alors tout ce qui reste sous une unique rangée de contrôles, et la légende se
 * pose dessus plutôt qu'en dessous.
 */
function PlanDiagram({ plan, tabs }: { plan: ExplainPlan; tabs: ReactNode }) {
  const t = useT()
  const [metric, setMetric] = useState<MetricKey>('self')
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set<number>())
  const [folded, setFolded] = useState<ReadonlySet<number>>(() => new Set<number>())
  const [heights, setHeights] = useState<ReadonlyMap<number, number>>(() => new Map())
  const [selected, setSelected] = useState<number | null>(null)
  const [focus, setFocus] = useState<number | null>(null)
  const [box, setBox] = useState<Viewbox>({ zoom: 1, x: PAD, y: PAD })
  const [dragging, setDragging] = useState(false)

  const viewport = useRef<HTMLDivElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    pointerId: number
    x: number
    y: number
    originX: number
    originY: number
    nextX: number
    nextY: number
    moved: boolean
  } | null>(null)
  /** Vrai tant qu'un bouton est enfoncé sur le canevas : sert à étouffer la sélection de texte. */
  const pressed = useRef(false)
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

  /** Les nœuds qui décident du temps de la requête : le plus lent, le plus gros, le plus coûteux. */
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

  // Le cadrage est posé directement sur le nœud, sans passer par le rendu : pendant un glisser,
  // repasser par l'état re-rendrait toutes les cartes à chaque mouvement de souris.
  const paint = useCallback((next: Viewbox) => {
    const element = layer.current
    if (!element) return
    element.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.zoom})`
  }, [])

  useLayoutEffect(() => paint(box), [box, paint])

  const fit = useCallback(() => {
    const element = viewport.current
    if (!element) return

    const contentWidth = width + PAD * 2
    const contentHeight = height + PAD * 2
    // Les deux dimensions : un plan profond déborde par le bas bien avant de déborder à droite.
    const scale = clamp(
      Math.min(element.clientWidth / contentWidth, element.clientHeight / contentHeight),
      FIT_FLOOR,
      1,
    )

    const scaledHeight = contentHeight * scale
    setBox({
      zoom: scale,
      // Centré horizontalement, y compris lorsque le plan déborde : la racine reste au milieu.
      x: (element.clientWidth - contentWidth * scale) / 2,
      // Verticalement, un plan trop haut se cale en haut : sa racine se lit avant ses feuilles.
      y: scaledHeight <= element.clientHeight ? (element.clientHeight - scaledHeight) / 2 : 0,
    })
  }, [width, height])

  /** Zoom autour d'un point de la fenêtre : ce point reste sous le curseur. */
  const zoomAt = useCallback((factor: number, pivotX: number, pivotY: number) => {
    setBox((current) => {
      const zoom = clamp(current.zoom * factor, MIN_ZOOM, MAX_ZOOM)
      if (zoom === current.zoom) return current

      const ratio = zoom / current.zoom
      return {
        zoom,
        x: pivotX - (pivotX - current.x) * ratio,
        y: pivotY - (pivotY - current.y) * ratio,
      }
    })
  }, [])

  /** Zoom depuis les boutons : le centre de la fenêtre sert de point fixe. */
  const zoomFromCenter = useCallback(
    (factor: number) => {
      const element = viewport.current
      if (!element) return
      zoomAt(factor, element.clientWidth / 2, element.clientHeight / 2)
    },
    [zoomAt],
  )

  useEffect(() => {
    // Une seule fois, et seulement quand toutes les cartes se sont mesurées : ajuster plus tôt
    // reviendrait à cadrer sur des hauteurs estimées, et le refaire ensuite reprendrait la main
    // sur le cadrage choisi par l'opérateur.
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

  // Molette et sélection sont posées à la main : React attache « wheel » en écoute passive, où
  // preventDefault n'a aucun effet, et ne connaît pas « selectstart ».
  useEffect(() => {
    const element = viewport.current
    if (!element) return

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()

      const rect = element.getBoundingClientRect()

      // Maj + molette : déplacement latéral, l'habitude des canevas larges.
      if (event.shiftKey) {
        setBox((current) => ({ ...current, x: current.x - event.deltaY }))
        return
      }

      // deltaMode 1 = lignes plutôt que pixels, sur certaines souris et sous Firefox.
      const step = event.deltaMode === 1 ? 0.05 : 0.0015
      zoomAt(Math.exp(-event.deltaY * step), event.clientX - rect.left, event.clientY - rect.top)
    }

    const onSelectStart = (event: Event) => {
      // Un appui maintenu sur le canevas est un déplacement, jamais une sélection de texte :
      // sans cela, glisser depuis une carte surlignait son contenu au lieu de bouger le plan.
      if (pressed.current) event.preventDefault()
    }

    element.addEventListener('wheel', onWheel, { passive: false })
    element.addEventListener('selectstart', onSelectStart)

    return () => {
      element.removeEventListener('wheel', onWheel)
      element.removeEventListener('selectstart', onSelectStart)
    }
  }, [zoomAt])

  // Raccourci de réajustement. Les champs de saisie gardent la main : la modale en contient.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '0' || event.ctrlKey || event.metaKey || event.altKey) return

      const target = event.target as HTMLElement | null
      if (target?.isContentEditable) return
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return

      event.preventDefault()
      fit()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [fit])

  // Centrage différé : la cible peut être sous une branche repliée, dépliée juste avant.
  useEffect(() => {
    if (focus === null) return

    const item = visible.get(focus)
    const element = viewport.current
    if (!item || !element) {
      setFocus(null)
      return
    }

    setBox((current) => ({
      ...current,
      x: element.clientWidth / 2 - (item.x + PAD + NODE_W / 2) * current.zoom,
      y: element.clientHeight / 2 - (item.y + PAD + item.height / 2) * current.zoom,
    }))
    setFocus(null)
  }, [focus, visible])

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
    // Bouton gauche ou bouton du milieu : les deux gestes de déplacement d'un canevas.
    if (event.button !== 0 && event.button !== 1) return

    // Un glisser précédent qui ne s'est pas terminé par un clic — pointeur relâché hors de la
    // fenêtre, geste interrompu — laisserait sa consigne d'étouffement derrière lui, et c'est
    // le clic suivant, légitime, qui serait avalé.
    swallow.current = false
    pressed.current = true
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      originX: box.x,
      originY: box.y,
      nextX: box.x,
      nextY: box.y,
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
      setDragging(true)

      // Une sélection déjà commencée avant l'appui ne doit pas suivre le déplacement.
      document.getSelection()?.removeAllRanges()

      try {
        // La capture n'est prise qu'une fois le geste reconnu, sinon elle volerait le clic.
        element.setPointerCapture(event.pointerId)
      } catch {
        // Pointeur déjà relâché : le glisser reste utilisable, il s'arrêtera en sortant.
      }
    }

    // Le déplacement est libre sur les deux axes et sans butée : un plan large se saisit par
    // n'importe quel point, et rien n'empêche de l'amener au bord de la fenêtre.
    state.nextX = state.originX + deltaX
    state.nextY = state.originY + deltaY
    paint({ zoom: box.zoom, x: state.nextX, y: state.nextY })
  }

  function endPan(event: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current
    pressed.current = false
    if (state?.pointerId !== event.pointerId) return

    if (state.moved) {
      if (viewport.current?.hasPointerCapture(event.pointerId)) {
        viewport.current.releasePointerCapture(event.pointerId)
      }
      setDragging(false)
      // Le nœud porte déjà la position : l'état la rattrape, sans nouveau tracé.
      setBox((current) => ({ ...current, x: state.nextX, y: state.nextY }))
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

  if (plan.nodes.length === 0) {
    return (
      <PlanShell toolbar={tabs}>
        <div className="p-4">
          <Notice tone="warning">{t('plan.unstructured')}</Notice>
        </div>
      </PlanShell>
    )
  }

  return (
    <PlanShell
      toolbar={
        <>
          <div className="flex min-w-0 items-center gap-2">
            {tabs}

            <label className="text-ink-muted text-meta flex shrink-0 items-center gap-2">
              {t('plan.highlight')}
              <Select
                value={metric}
                className="w-36"
                aria-label={t('plan.highlight')}
                onChange={(event) => setMetric(event.target.value as MetricKey)}
              >
                {METRICS.map((item) => (
                  <option key={item} value={item}>
                    {t(`plan.metric.${item}`)}
                  </option>
                ))}
              </Select>
            </label>

            {/* Raccourcis vers les nœuds qui décident du temps de la requête. */}
            <CulpritChip
              icon={Clock}
              label={t('plan.culprit.slowest')}
              node={culprits.slowest}
              value={formatMs(culprits.slowest?.selfMs)}
              onSelect={reveal}
            />
            <CulpritChip
              icon={Rows3}
              label={t('plan.culprit.largest')}
              node={culprits.largest}
              value={culprits.largest ? rowsLabel(Math.round(rowsOf(culprits.largest))) : '—'}
              onSelect={reveal}
            />
            <CulpritChip
              icon={Coins}
              label={t('plan.culprit.costliest')}
              node={culprits.costliest}
              value={
                culprits.costliest
                  ? formatNumber(Math.round(costs.get(culprits.costliest.id) ?? 0))
                  : '—'
              }
              onSelect={reveal}
            />
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="px-2"
              onClick={() =>
                setExpanded((current) =>
                  current.size === plan.nodes.length
                    ? new Set<number>()
                    : new Set(plan.nodes.map((node) => node.id)),
                )
              }
            >
              {expanded.size === plan.nodes.length ? t('plan.collapseAll') : t('plan.expandAll')}
            </Button>

            <Button
              variant="outline"
              size="icon"
              title={t('plan.zoomOut')}
              aria-label={t('plan.zoomOut')}
              onClick={() => zoomFromCenter(1 / ZOOM_STEP)}
            >
              <Minus className="size-4" aria-hidden />
            </Button>
            <span className="text-ink-muted text-meta w-12 text-center tabular-nums">
              {Math.round(box.zoom * 100)} %
            </span>
            <Button
              variant="outline"
              size="icon"
              title={t('plan.zoomIn')}
              aria-label={t('plan.zoomIn')}
              onClick={() => zoomFromCenter(ZOOM_STEP)}
            >
              <Plus className="size-4" aria-hidden />
            </Button>
            <Button
              variant="outline"
              size="icon"
              title={t('plan.fit')}
              aria-label={t('plan.fit')}
              onClick={fit}
            >
              <Maximize2 className="size-4" aria-hidden />
            </Button>
          </div>
        </>
      }
    >
      <div
        ref={viewport}
        role="application"
        aria-label={`${t('plan.canvasLabel')} — ${t('plan.legend.controls')}`}
        onPointerDown={startPan}
        onPointerMove={pan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onClickCapture={swallowClick}
        className={cn(
          // Le canevas ne défile pas : c'est la couche transformée qui bouge, sur les deux axes
          // et sans butée. `touch-none` réserve le geste au déplacement plutôt qu'au navigateur.
          'bg-surface-sunken relative min-h-[18rem] flex-1 touch-none overflow-hidden',
          dragging ? 'cursor-grabbing select-none' : 'cursor-grab',
        )}
      >
        <div
          ref={layer}
          className="absolute top-0 left-0 origin-top-left will-change-transform"
          style={{ width: width + PAD * 2, height: height + PAD * 2 }}
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
                  fontSize={11}
                  className="fill-ink-muted"
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
                heat={heatOfShare(intensity)}
                highlighted={metric !== 'none'}
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

        {/* Clé des pastilles, et rien d'autre : c'est la seule part de la légende qu'on relit.
            Le sens de lecture du diagramme et les gestes du canevas se disent une fois, dans
            l'infobulle et dans l'intitulé du canevas — quatre lignes de prose posées à demeure
            sur le plan finissent par cacher ce qu'elles expliquent. */}
        <p
          title={t('plan.legend.flow')}
          className="border-border-subtle bg-surface/85 text-ink-muted text-meta pointer-events-none absolute bottom-2 left-2 z-10 flex items-center gap-x-2 rounded-[var(--radius-control)] border px-2 py-1 backdrop-blur-sm"
        >
          <span>{t('plan.legend.heat')}</span>
          <span className="inline-flex items-center gap-1">
            <HeatDot heat={1} />
            {t('plan.legend.notable')}
          </span>
          <span className="inline-flex items-center gap-1">
            <HeatDot heat={2} />
            {t('plan.legend.heavy')}
          </span>
          <span className="inline-flex items-center gap-1">
            <HeatDot heat={3} />
            {t('plan.legend.dominant')}
          </span>
        </p>
      </div>
    </PlanShell>
  )
}

/**
 * Raccourci vers un nœud remarquable. La pastille cède du terrain avant la barre entière : ses
 * textes s'abrègent quand la place manque, et l'infobulle garde l'énoncé complet.
 */
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
      title={`${label} — ${node.label} — ${value}`}
      className="border-border-subtle bg-surface-sunken text-ink-muted hover:border-brand hover:text-brand text-meta flex h-8 min-w-0 shrink items-center gap-1.5 rounded-[var(--radius-control)] border px-2"
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {/* Ce qui cède en premier, c'est le qualificatif — « le plus lent » — et non le nom de
          l'étape ni sa mesure : trois textes tronqués côte à côte ne disent plus rien, quand
          « Seq Scan 1.20 s » se lit encore. L'énoncé complet reste dans l'infobulle. */}
      <span className="hidden truncate 2xl:inline">{label}</span>
      <span className="text-ink truncate font-medium">{node.nodeType}</span>
      <span className="text-ink-muted shrink-0 tabular-nums">{value}</span>
    </button>
  )
}

/** Pastille de sévérité : le seul porteur de couleur de la carte. */
function HeatDot({ heat, className }: { heat: Heat; className?: string }) {
  return <span aria-hidden className={cn('size-2 shrink-0 rounded-full', HEAT_DOT[heat], className)} />
}

/**
 * Carte d'une étape : en-tête toujours visible, détail dépliable réparti en onglets. La carte
 * mesure sa propre hauteur et la remonte au diagramme, qui replace les rangées en conséquence.
 *
 * Le fond reste neutre dans les deux thèmes : la sévérité passe par des pastilles, une par
 * compteur, plus celle qui précède le nom de l'étape pour la métrique mise en évidence.
 */
function PlanNodeCard({
  item,
  scales,
  ownCost,
  heat,
  highlighted,
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
  heat: Heat
  /** Faux lorsque la mise en évidence est désactivée : la pastille de tête disparaît alors. */
  highlighted: boolean
  selected: boolean
  open: boolean
  folded: boolean
  onSelect: (id: number) => void
  onToggleDetails: (id: number) => void
  onToggleBranch: (id: number) => void
  onMeasure: (id: number, height: number) => void
}) {
  const t = useT()
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
        <span className="bg-brand-subtle text-brand text-meta mb-1 inline-block rounded-full px-2 py-0.5 font-mono">
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
                {/* Sévérité de l'étape pour la métrique mise en évidence, réduite à un point :
                    la carte reste neutre et son texte garde son contraste dans les deux thèmes. */}
                <span
                  className="inline-flex items-center gap-1.5"
                  title={
                    highlighted
                      ? t('plan.node.heatTitle', { level: t(`plan.node.heat.${heat}`) })
                      : undefined
                  }
                >
                  {highlighted && <HeatDot heat={heat} className="size-2.5" />}
                  <span className="text-ink text-body font-semibold">{node.nodeType}</span>
                </span>
                {node.joinType && (
                  <span className="text-ink-muted text-meta">{node.joinType}</span>
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
                <span className="text-ink-muted text-meta mt-0.5 block truncate font-mono" title={subtitle}>
                  {subtitle}
                </span>
              )}
            </span>

            <span className="text-ink-muted text-meta shrink-0 tabular-nums">#{node.id + 1}</span>
          </span>

          {/* Les compteurs du nœud, chacun porteur de sa propre pastille : le coupable se voit
              sans avoir à ouvrir la carte. */}
          <span className="mt-2 flex flex-wrap items-center gap-1">
            {node.neverExecuted ? (
              <MetricBadge
                icon={Ban}
                heat={0}
                label={t('plan.node.neverExecuted')}
                title={t('plan.node.neverExecutedTitle')}
              />
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
                  title={t('plan.node.selfTitle')}
                />
                <MetricBadge
                  icon={Rows3}
                  heat={heatOfShare(scales.rows > 0 ? rowsOf(node) / scales.rows : 0)}
                  label={formatNumber(Math.round(rowsOf(node)))}
                  title={t('plan.node.rowsTitle')}
                />
                {node.estimationFactor !== null && Math.abs(node.estimationFactor) >= 1.5 && (
                  <MetricBadge
                    icon={node.estimationFactor > 0 ? ArrowUp : ArrowDown}
                    heat={heatOfEstimation(node.estimationFactor)}
                    label={`×${Math.abs(node.estimationFactor).toFixed(1)}`}
                    title={
                      node.estimationFactor > 0
                        ? t('plan.node.underestimated')
                        : t('plan.node.overestimated')
                    }
                  />
                )}
                <MetricBadge
                  icon={Coins}
                  heat={heatOfShare(scales.cost > 0 ? ownCost / scales.cost : 0)}
                  label={formatNumber(Math.round(ownCost))}
                  title={t('plan.node.costTitle', {
                    total: formatNumber(Math.round(node.totalCost)),
                  })}
                />
                {(node.parallelAware || workers) && (
                  <MetricBadge
                    icon={Cpu}
                    heat={0}
                    label={workers ? `×${workers}` : t('plan.node.parallel')}
                    title={
                      workers
                        ? t('plan.node.parallelWorkers', { count: workers })
                        : t('plan.node.parallelTitle')
                    }
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
          title={folded ? t('plan.node.unfoldBranch') : t('plan.node.foldBranch')}
          aria-label={folded ? t('plan.node.unfoldBranch') : t('plan.node.foldBranch')}
          className="border-border-strong bg-surface text-ink-muted hover:border-brand hover:text-brand text-meta absolute -bottom-3 left-1/2 z-10 min-w-6 -translate-x-1/2 rounded-full border px-1.5 leading-5 tabular-nums"
        >
          {folded ? `+${item.hidden}` : '−'}
        </button>
      )}
    </div>
  )
}

/**
 * Compteur d'un nœud : pastille de sévérité, icône de la grandeur, valeur. Le contour remplace
 * l'ancien fond teinté — la valeur garde ainsi la couleur du texte courant, lisible dans les
 * deux thèmes, et c'est la pastille qui porte l'alerte.
 */
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
      className="border-border-subtle text-ink text-meta inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-medium tabular-nums"
    >
      <HeatDot heat={heat} className="size-1.5" />
      <Icon className="text-ink-muted size-3 shrink-0" aria-hidden />
      {label}
    </span>
  )
}

function WarningPill({ warning }: { warning: PlanWarning }) {
  return (
    <span
      title={warning.message}
      className={cn(
        'text-meta rounded-full px-1.5 py-px font-medium',
        // Encre « strong » sur fond « subtle » : le jeton nu remplit une pastille, il ne porte
        // pas de texte sur son propre fond clair, où il tombait sous 3,5:1.
        warning.severity === 'warning'
          ? 'bg-warning-subtle text-warning-strong'
          : 'bg-surface-sunken text-ink-muted',
      )}
    >
      {warningLabel(warning.kind)}
    </span>
  )
}

type TabKey = 'general' | 'io' | 'output' | 'workers' | 'misc'

const TABS: TabKey[] = ['general', 'io', 'output', 'workers', 'misc']

type TabContent = {
  /** Couples courts, affichés sur deux colonnes. */
  pairs: [string, string][]
  /** Valeurs longues (conditions SQL), affichées pleine largeur. */
  blocks: [string, string][]
}

function tabContent(node: PlanNode, tab: TabKey): TabContent {
  const pair = (label: string, value: string | null): [string, string][] =>
    value === null ? [] : [[tr(label), value]]

  const always = (label: string, value: string): [string, string] => [tr(label), value]

  switch (tab) {
    case 'general':
      return {
        pairs: [
          always('plan.field.selfMs', formatMs(node.selfMs)),
          always('plan.field.inclusiveMs', formatMs(node.inclusiveMs)),
          always('plan.field.actualRows', formatNumber(Math.round(node.actualRows ?? 0))),
          always('plan.field.planRows', formatNumber(Math.round(node.planRows))),
          always('plan.field.estimation', formatEstimation(node.estimationFactor)),
          always('plan.field.loops', formatNumber(node.actualLoops ?? 1)),
          always('plan.field.startupCost', formatNumber(Math.round(node.startupCost))),
          always('plan.field.totalCost', formatNumber(Math.round(node.totalCost))),
          always('plan.field.width', tr('plan.unit.bytes', { count: node.planWidth })),
        ],
        blocks: [],
      }

    case 'io':
      return {
        pairs: [
          always('plan.field.sharedHit', formatBlocks(node.sharedHitBlocks)),
          always('plan.field.sharedRead', formatBlocks(node.sharedReadBlocks)),
          ...pair('plan.field.sharedDirtied', node.sharedDirtiedBlocks === null ? null : formatBlocks(node.sharedDirtiedBlocks)),
          ...pair('plan.field.sharedWritten', node.sharedWrittenBlocks === null ? null : formatBlocks(node.sharedWrittenBlocks)),
          ...pair('plan.field.tempRead', node.tempReadBlocks === null ? null : formatBlocks(node.tempReadBlocks)),
          ...pair('plan.field.tempWritten', node.tempWrittenBlocks === null ? null : formatBlocks(node.tempWrittenBlocks)),
          ...pair('plan.field.heapFetches', node.heapFetches === null ? null : formatNumber(node.heapFetches)),
          ...pair('plan.field.sortMethod', node.sortMethod),
          ...pair(
            'plan.field.sortSpace',
            node.sortSpaceUsedKb === null
              ? null
              : tr('plan.unit.sortSpace', {
                  size: formatNumber(node.sortSpaceUsedKb),
                  type: node.sortSpaceType ?? '?',
                }),
          ),
        ],
        blocks: [],
      }

    case 'output':
      return {
        pairs: pair(
          'plan.field.rowsRemoved',
          node.rowsRemovedByFilter === null ? null : formatNumber(node.rowsRemovedByFilter),
        ),
        blocks: [
          ...pair('plan.field.indexCondition', node.indexCondition),
          ...pair('plan.field.filter', node.filter),
          ...pair('plan.field.recheck', node.recheckCondition),
          ...pair('plan.field.hashCondition', node.hashCondition),
          ...pair('plan.field.joinFilter', node.joinFilter),
          ...pair('plan.field.sortKey', node.sortKey),
          ...pair('plan.field.groupKey', node.groupKey),
        ],
      }

    case 'workers':
      return {
        pairs: [
          always('plan.field.parallelAware', node.parallelAware ? tr('common.yes') : tr('common.no')),
          always(
            'plan.field.workersPlanned',
            node.workersPlanned === null ? tr('plan.value.none') : String(node.workersPlanned),
          ),
          always(
            'plan.field.workersLaunched',
            node.workersLaunched === null ? tr('plan.value.none') : String(node.workersLaunched),
          ),
          ...pair('plan.field.loops', node.actualLoops === null ? null : formatNumber(node.actualLoops)),
        ],
        blocks: [],
      }

    case 'misc':
      return {
        pairs: [
          always('plan.field.nodeType', node.nodeType),
          ...pair('plan.field.subplan', node.subplanName),
          ...pair('plan.field.relation', node.relationName),
          ...pair('plan.field.alias', node.alias),
          ...pair('plan.field.index', node.indexName),
          ...pair('plan.field.joinType', node.joinType),
          ...pair('plan.field.scanDirection', node.scanDirection),
          ...pair('plan.field.parentRelationship', node.parentRelationship),
          always('plan.field.costShare', `${node.costSharePercent.toFixed(1)} %`),
          ...(node.neverExecuted
            ? [always('plan.field.execution', tr('plan.value.skipped'))]
            : []),
        ],
        blocks: [],
      }
  }
}

function NodeDetails({ node }: { node: PlanNode }) {
  const t = useT()
  const [tab, setTab] = useState<TabKey>('general')
  const content = tabContent(node, tab)
  const panelId = useId()

  return (
    <div className="border-border-subtle border-t">
      <p className="text-ink-muted text-meta px-3 py-2 leading-snug">{describe(node.nodeType)}</p>

      {node.warnings.length > 0 && (
        <ul className="space-y-1 px-3 pb-2">
          {node.warnings.map((warning) => (
            <li
              key={warning.kind}
              className={cn(
                'text-meta leading-snug',
                warning.severity === 'warning' ? 'text-warning-strong' : 'text-ink-muted',
              )}
            >
              {warning.message}
            </li>
          ))}
        </ul>
      )}

      {/* Onglets véritables : le panneau qu'ils commandent est juste dessous, et il est nommé. */}
      <div
        role="tablist"
        aria-label={t('plan.tab.label')}
        className="border-border-subtle bg-surface-sunken flex gap-0.5 overflow-x-auto border-y px-2 py-1"
      >
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            id={`${panelId}-${item}`}
            aria-selected={tab === item}
            aria-controls={panelId}
            onClick={() => setTab(item)}
            className={cn(
              'text-meta rounded-[calc(var(--radius-control)-2px)] px-2 py-1 font-medium whitespace-nowrap',
              tab === item ? 'bg-surface text-ink shadow-card' : 'text-ink-muted hover:text-ink',
            )}
          >
            {t(`plan.tab.${item}`)}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={panelId} aria-labelledby={`${panelId}-${tab}`}>
        {content.pairs.length === 0 && content.blocks.length === 0 ? (
          <p className="text-ink-muted text-meta px-3 py-2">{t('plan.detail.empty')}</p>
        ) : (
          <div className="px-3 py-2">
            {content.pairs.length > 0 && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {content.pairs.map(([label, value]) => (
                  <Detail key={label} label={label} value={value} />
                ))}
              </dl>
            )}

            {content.blocks.length > 0 && (
              <dl className={cn('space-y-1.5', content.pairs.length > 0 && 'mt-3')}>
                {content.blocks.map(([label, value]) => (
                  <div key={label}>
                    {/* Pas de capitales forcées : ces intitulés sont les noms qu'EXPLAIN imprime,
                        et c'est sous cette graphie qu'on les retrouve dans la documentation. */}
                    <dt className="text-ink-muted text-micro font-medium">{label}</dt>
                    <dd className="text-ink text-body font-mono break-all">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Couple étiquette / valeur d'une étape. La valeur se lit plus gros que son nom : c'est elle
 * qu'on est venu chercher. `KeyValue` ne convient pas ici — il met l'étiquette en capitales,
 * quand « Rows Removed by Filter » doit garder la graphie de la sortie d'EXPLAIN.
 */
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-ink-muted text-micro truncate font-medium">{label}</dt>
      <dd className="text-ink text-body truncate tabular-nums" title={value}>
        {value}
      </dd>
    </div>
  )
}

/**
 * En-tête de colonne portant un nom de sortie d'EXPLAIN. `Th` met ses intitulés en capitales —
 * c'est la règle pour une étiquette d'interface, jamais pour « Actual Rows » ou « Shared Read
 * Blocks », qu'on doit retrouver ici sous la graphie de la documentation de PostgreSQL. La
 * taille et le contraste de l'étiquette restent ceux de la primitive.
 */
const PG_HEADER = 'normal-case tracking-normal'

type SortKey = 'node' | 'self' | 'inclusive' | 'cost' | 'rows' | 'estimation' | 'reads'

/** Colonnes de la vue tableaux : le tri se prend au clic sur l'en-tête, comme partout ailleurs. */
const NODE_COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'node', label: 'plan.table.column.node', numeric: false },
  { key: 'cost', label: 'plan.table.column.cost', numeric: true },
  { key: 'self', label: 'plan.table.column.self', numeric: true },
  { key: 'inclusive', label: 'plan.table.column.inclusive', numeric: true },
  { key: 'rows', label: 'plan.table.column.rows', numeric: true },
  { key: 'estimation', label: 'plan.table.column.estimation', numeric: false },
  { key: 'reads', label: 'plan.table.column.reads', numeric: true },
]

function sortValue(node: PlanNode, key: SortKey): number | string {
  switch (key) {
    case 'node':
      return node.nodeType
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

/**
 * Vue tableaux : le même plan trié selon le critère qui intéresse, plus un cumul par relation.
 *
 * Le critère se prend dans l'en-tête de colonne plutôt que dans une liste déroulante posée à
 * côté : c'est le geste attendu d'un tableau, et le sens du tri se lit alors là où il s'applique.
 */
function PlanTables({ plan }: { plan: ExplainPlan }) {
  const t = useT()
  const [sort, setSort] = useState<SortKey>('self')
  const [descending, setDescending] = useState(true)

  const sorted = useMemo(() => {
    return [...plan.nodes].sort((a, b) => {
      const left = sortValue(a, sort)
      const right = sortValue(b, sort)
      const comparison =
        typeof left === 'string'
          ? left.localeCompare(String(right))
          : Number(left) - Number(right)
      return descending ? -comparison : comparison
    })
  }, [plan.nodes, sort, descending])

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

  function toggleSort(key: SortKey) {
    if (key === sort) {
      setDescending((current) => !current)
    } else {
      setSort(key)
      // Une grandeur se lit du plus gros au plus petit ; un nom, de A à Z.
      setDescending(key !== 'node')
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t('plan.table.title')} />
        <div className="w-full overflow-x-auto">
          <Table className="min-w-[52rem]">
            <THead>
              <Tr className="hover:bg-transparent">
                {NODE_COLUMNS.map((column) => (
                  <Th
                    key={column.key}
                    numeric={column.numeric}
                    sort={sort === column.key ? (descending ? 'desc' : 'asc') : null}
                    onSort={() => toggleSort(column.key)}
                    // `normal-case` : ces intitulés sont les noms qu'EXPLAIN imprime. « Actual
                    // Rows » se cherche tel quel dans la documentation, pas en capitales.
                    className={PG_HEADER}
                  >
                    {t(column.label)}
                  </Th>
                ))}
              </Tr>
            </THead>
            <TBody>
              {sorted.map((node) => (
                <Tr key={node.id} className="align-top">
                  <Td>
                    <span className="text-ink font-medium">{node.nodeType}</span>
                    {node.relationName && (
                      <p className="text-ink-muted text-meta truncate font-mono">
                        {node.relationName}
                      </p>
                    )}
                  </Td>
                  <Td numeric className="whitespace-nowrap">
                    {formatNumber(Math.round(node.totalCost))}
                  </Td>
                  <Td numeric className="whitespace-nowrap">
                    {formatMs(node.selfMs)}
                    {node.selfSharePercent !== null && (
                      <span className="text-ink-muted text-meta ml-1">
                        {node.selfSharePercent.toFixed(1)} %
                      </span>
                    )}
                  </Td>
                  <Td numeric className="whitespace-nowrap">
                    {formatMs(node.inclusiveMs)}
                  </Td>
                  <Td numeric className="whitespace-nowrap">
                    {formatNumber(Math.round(node.actualRows ?? node.planRows))}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {/* Une estimation juste ne mérite pas de badge : le signal ne vaut que
                        s'il est rare. Seul l'écart s'annonce. */}
                    {node.estimationFactor === null ? (
                      <span className="text-ink-muted">—</span>
                    ) : (
                      <Badge tone={estimationTone(node.estimationFactor)}>
                        {formatEstimation(node.estimationFactor)}
                      </Badge>
                    )}
                  </Td>
                  <Td numeric className="whitespace-nowrap">
                    {node.sharedReadBlocks === null ? '—' : formatNumber(node.sharedReadBlocks)}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      </Card>

      {byRelation.length > 0 && (
        <Card>
          <CardHeader title={t('plan.relations.title')} />
          <div className="w-full overflow-x-auto">
            <Table className="min-w-[34rem]">
              <THead>
                <Tr className="hover:bg-transparent">
                  <Th className={PG_HEADER}>{t('plan.relations.column.relation')}</Th>
                  <Th numeric className={PG_HEADER}>
                    {t('plan.relations.column.nodes')}
                  </Th>
                  <Th numeric className={PG_HEADER}>
                    {t('plan.table.column.self')}
                  </Th>
                  <Th numeric className={PG_HEADER}>
                    {t('plan.field.totalCost')}
                  </Th>
                  <Th numeric className={PG_HEADER}>
                    {t('plan.table.column.rows')}
                  </Th>
                </Tr>
              </THead>
              <TBody>
                {byRelation.map(([relation, totals]) => (
                  <Tr key={relation}>
                    <Td className="font-mono">{relation}</Td>
                    <Td numeric>{totals.nodes}</Td>
                    <Td numeric className="whitespace-nowrap">
                      {formatMs(totals.selfMs)}
                    </Td>
                    <Td numeric>{formatNumber(Math.round(totals.cost))}</Td>
                    <Td numeric>{formatNumber(Math.round(totals.rows))}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        </Card>
      )}

      {Object.keys(plan.settings).length > 0 && (
        <Card>
          <CardHeader title={t('plan.settings.title')} />
          <CardBody>
            {/* Noms de paramètres PostgreSQL : graphie d'origine, jamais de capitales forcées. */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              {Object.entries(plan.settings).map(([name, value]) => (
                <Detail key={name} label={name} value={value} />
              ))}
            </dl>
          </CardBody>
        </Card>
      )}
    </div>
  )
}
