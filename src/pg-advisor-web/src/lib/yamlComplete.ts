import type { RuleSchema } from '@/api/types'

/**
 * Auto-complétion du YAML des règles.
 *
 * Le format est petit et entièrement connu du serveur : catégories, sévérités, groupes, vues et
 * extensions détectables, handlers, filtres et fonctions de gabarit. Un aide-mémoire posé à côté
 * de l'éditeur obligeait à quitter le texte des yeux, à retenir, puis à revenir écrire. Les mêmes
 * listes proposées à l'endroit du curseur suppriment ce trajet.
 */
export interface Suggestion {
  /** Ce qui est inséré à la place du fragment en cours de frappe. */
  value: string
  /** Précision affichée à droite : ce que la valeur veut dire, ou ce qu'elle attend. */
  detail?: string
  /** Ajouté après l'insertion : « : » derrière une clé, comme le ferait un éditeur de code. */
  suffix?: string
}

export interface Completion {
  items: Suggestion[]
  /** Bornes du fragment remplacé, en décalages absolus dans le texte. */
  from: number
  to: number
}

/** Champs de premier niveau, avec ce qu'ils commandent. */
const TOP_LEVEL: Suggestion[] = [
  { value: 'id', detail: 'category.subject' },
  { value: 'version', detail: '1' },
  { value: 'name', detail: 'short title' },
  { value: 'description', detail: 'optional' },
  { value: 'category', detail: 'scored category' },
  { value: 'severity', detail: 'info | warning | critical' },
  { value: 'group', detail: 'schedule group' },
  { value: 'intervalSeconds', detail: '5 to 86400' },
  { value: 'timeoutSeconds', detail: '1 to 300' },
  { value: 'enabled', detail: 'false ships it disabled' },
  { value: 'requires', detail: 'capability prerequisites' },
  { value: 'parameters', detail: 'thresholds' },
  { value: 'query', detail: 'read-only SQL' },
  { value: 'handler', detail: 'built-in handler' },
  { value: 'condition', detail: 'expression on a row' },
  { value: 'key', detail: 'columns identifying a finding' },
  { value: 'recommendation', detail: 'what the finding says' },
]

const REQUIRES: Suggestion[] = [
  { value: 'views', detail: 'system views read' },
  { value: 'extensions', detail: 'extensions needed' },
  { value: 'minVersion', detail: 'server version, e.g. 14' },
  { value: 'maxVersion', detail: 'server version' },
  { value: 'monitorRole', detail: 'true requires pg_monitor' },
  { value: 'primary', detail: 'true skips replicas' },
]

const RECOMMENDATION: Suggestion[] = [
  { value: 'title', detail: 'finding title' },
  { value: 'message', detail: 'supports {{ column }}' },
  { value: 'impact', detail: 'low | medium | high' },
  { value: 'confidence', detail: 'low | medium | high' },
  { value: 'documentation', detail: 'link' },
  { value: 'sql', detail: 'corrective statement' },
]

const QUALIFIERS: Suggestion[] = [
  { value: 'low' },
  { value: 'medium' },
  { value: 'high' },
]

const BOOLEANS: Suggestion[] = [{ value: 'true' }, { value: 'false' }]

/** Indentation d'une ligne, en nombre d'espaces. */
function indentOf(line: string): number {
  return line.length - line.trimStart().length
}

/**
 * Clé englobante de la ligne courante : la première ligne au-dessus qui ouvre un bloc et qui est
 * moins indentée. C'est ce qui distingue `views:` sous `requires:` de `title:` sous
 * `recommendation:` sans avoir à analyser le document entier.
 */
function parentKey(lines: string[], index: number, indent: number): string | null {
  for (let i = index - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    if (indentOf(line) >= indent) continue

    const match = /^\s*([A-Za-z_][\w-]*)\s*:/.exec(line)
    return match ? match[1] : null
  }

  return null
}

/** Valeurs proposées pour une clé donnée, dans son bloc. */
function valuesFor(key: string, parent: string | null, schema: RuleSchema): Suggestion[] {
  if (parent === 'recommendation') {
    return key === 'impact' || key === 'confidence' ? QUALIFIERS : []
  }

  if (parent === 'requires') {
    return key === 'monitorRole' || key === 'primary' ? BOOLEANS : []
  }

  switch (key) {
    case 'category':
      return schema.categories.map((value) => ({ value }))
    case 'severity':
      return schema.severities.map((value) => ({ value }))
    case 'group':
      return schema.groups.map((value) => ({ value }))
    case 'enabled':
      return BOOLEANS
    case 'handler':
      return schema.handlers.map((handler) => ({
        value: handler.name,
        detail: handler.description,
      }))
    default:
      return []
  }
}

/** Clés proposées dans un bloc. */
function keysFor(parent: string | null): Suggestion[] {
  if (parent === 'requires') return REQUIRES
  if (parent === 'recommendation') return RECOMMENDATION
  return parent === null ? TOP_LEVEL : []
}

/** Éléments d'une liste à puces, selon le bloc qui la porte. */
function itemsFor(parent: string | null, schema: RuleSchema): Suggestion[] {
  if (parent === 'views') return schema.knownViews.map((value) => ({ value }))
  if (parent === 'extensions') return schema.notableExtensions.map((value) => ({ value }))
  return []
}

/**
 * Ce qui peut être proposé à cet endroit du texte, et le fragment que la proposition remplace.
 *
 * Rend `null` quand rien n'a de sens ici — au milieu d'une requête SQL, par exemple : proposer
 * des noms de champs YAML dans un `SELECT` ne ferait que gêner la frappe.
 */
export function completionAt(yaml: string, offset: number, schema: RuleSchema): Completion | null {
  const before = yaml.slice(0, offset)
  const lineStart = before.lastIndexOf('\n') + 1
  const lineIndex = before.split('\n').length - 1
  const lines = yaml.split('\n')
  const line = lines[lineIndex] ?? ''
  const typed = before.slice(lineStart)

  // Un commentaire ne se complète pas.
  if (typed.trimStart().startsWith('#')) return null

  const indent = indentOf(line)
  const parent = parentKey(lines, lineIndex, indent)

  // Un gabarit `{{ ... }}` : filtres après une barre verticale, fonctions sinon.
  const open = typed.lastIndexOf('{{')
  if (open !== -1 && typed.indexOf('}}', open) === -1) {
    const fragment = typed.slice(open + 2)
    const pipe = fragment.lastIndexOf('|')
    const word = /[A-Za-z_][\w]*$/.exec(fragment)?.[0] ?? ''
    const source = pipe === -1 ? schema.functions : schema.filters
    const items = source.map((value) => ({
      value,
      detail: pipe === -1 ? 'function' : 'filter',
    }))

    return narrow(items, word, offset)
  }

  // Sous `query:` ou `condition:` en bloc littéral, le texte n'est plus du YAML.
  if (parent === 'query') return null

  const bullet = /^\s*-\s*(.*)$/.exec(typed)
  if (bullet) {
    return narrow(itemsFor(parent, schema), bullet[1].trim(), offset)
  }

  const colon = typed.indexOf(':')
  if (colon === -1) {
    // Avant les deux-points : on écrit une clé, et la compléter pose son « : ».
    const keys = keysFor(parent).map((item) => ({ ...item, suffix: ': ' }))
    return narrow(keys, typed.trim(), offset)
  }

  const key = typed.slice(0, colon).trim()
  const written = typed.slice(colon + 1).trim()
  return narrow(valuesFor(key, parent, schema), written, offset)
}

/**
 * Restreint les propositions au fragment déjà écrit, et rend les bornes à remplacer. Un fragment
 * vide propose tout : c'est ce qu'on attend d'un appel explicite au raccourci.
 */
function narrow(items: Suggestion[], fragment: string, offset: number): Completion | null {
  if (items.length === 0) return null

  const needle = fragment.toLowerCase()
  const matching = needle
    ? items.filter((item) => item.value.toLowerCase().startsWith(needle))
    : items

  if (matching.length === 0) return null

  return { items: matching, from: offset - fragment.length, to: offset }
}
