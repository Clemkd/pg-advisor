import type { ReactNode } from 'react'
import { CopyButton } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'

/**
 * Coloration syntaxique SQL minimale. Écrite ici plutôt qu'importée : une bibliothèque
 * généraliste pèse plus lourd que le besoin, et les couleurs suivent les jetons de design.
 */

const KEYWORDS = new Set([
  'select', 'from', 'where', 'join', 'inner', 'left', 'right', 'full', 'outer', 'cross', 'lateral',
  'on', 'group', 'by', 'order', 'having', 'limit', 'offset', 'union', 'all', 'except', 'intersect',
  'with', 'as', 'distinct', 'case', 'when', 'then', 'else', 'end', 'and', 'or', 'not', 'in',
  'exists', 'between', 'like', 'ilike', 'similar', 'is', 'null', 'true', 'false', 'asc', 'desc',
  'nulls', 'first', 'last', 'insert', 'into', 'values', 'update', 'set', 'delete', 'returning',
  'create', 'table', 'index', 'view', 'materialized', 'drop', 'alter', 'add', 'column', 'constraint',
  'primary', 'key', 'foreign', 'references', 'unique', 'check', 'default', 'cascade', 'explain',
  'analyze', 'verbose', 'costs', 'buffers', 'format', 'json', 'settings', 'generic_plan',
  'over', 'partition', 'window', 'filter', 'within', 'rows', 'range', 'preceding', 'following',
  'current', 'row', 'unbounded', 'recursive', 'using', 'natural', 'only', 'tablesample', 'fetch',
  'next', 'ties', 'for', 'share', 'lock', 'nowait', 'skip', 'locked', 'cast', 'interval',
])

const TYPES = new Set([
  'int', 'integer', 'bigint', 'smallint', 'serial', 'bigserial', 'numeric', 'decimal', 'real',
  'double', 'precision', 'float', 'text', 'varchar', 'char', 'character', 'varying', 'boolean',
  'bool', 'date', 'time', 'timestamp', 'timestamptz', 'uuid', 'jsonb', 'bytea', 'array', 'regclass',
])

type TokenKind = 'keyword' | 'type' | 'string' | 'number' | 'comment' | 'parameter' | 'operator' | 'plain'

const TOKEN_CLASS: Record<TokenKind, string> = {
  keyword: 'text-code-key font-semibold',
  type: 'text-code-type',
  string: 'text-code-string',
  number: 'text-code-number',
  // `ink-muted` et non `ink-faint` : un commentaire de code est du texte à lire, et l'encre la
  // plus pâle plafonne sous le contraste que demande du 12 px.
  comment: 'text-ink-muted italic',
  parameter: 'text-code-param font-semibold',
  operator: 'text-ink-muted',
  plain: '',
}

interface Token {
  kind: TokenKind
  value: string
}

/** Découpe le SQL en jetons colorables. Tolérant : tout ce qui n'est pas reconnu reste neutre. */
export function tokenizeSql(sql: string): Token[] {
  const tokens: Token[] = []
  let index = 0

  const push = (kind: TokenKind, value: string) => {
    const previous = tokens[tokens.length - 1]
    if (previous && previous.kind === kind) {
      previous.value += value
    } else {
      tokens.push({ kind, value })
    }
  }

  while (index < sql.length) {
    const character = sql[index]

    // Commentaire de fin de ligne
    if (character === '-' && sql[index + 1] === '-') {
      const end = sql.indexOf('\n', index)
      const stop = end === -1 ? sql.length : end
      push('comment', sql.slice(index, stop))
      index = stop
      continue
    }

    // Commentaire de bloc
    if (character === '/' && sql[index + 1] === '*') {
      const end = sql.indexOf('*/', index + 2)
      const stop = end === -1 ? sql.length : end + 2
      push('comment', sql.slice(index, stop))
      index = stop
      continue
    }

    // Chaîne littérale, délimiteur doublé pour l'échapper
    if (character === "'" || character === '"') {
      let cursor = index + 1
      while (cursor < sql.length) {
        if (sql[cursor] === character) {
          if (sql[cursor + 1] === character) {
            cursor += 2
            continue
          }
          cursor += 1
          break
        }
        cursor += 1
      }
      push('string', sql.slice(index, cursor))
      index = cursor
      continue
    }

    // Chaîne délimitée par $$ ou $tag$
    if (character === '$') {
      const tagMatch = /^\$[A-Za-z_]*\$/.exec(sql.slice(index))
      if (tagMatch) {
        const tag = tagMatch[0]
        const end = sql.indexOf(tag, index + tag.length)
        const stop = end === -1 ? sql.length : end + tag.length
        push('string', sql.slice(index, stop))
        index = stop
        continue
      }

      // Paramètre normalisé $1, $2…
      const parameterMatch = /^\$\d+/.exec(sql.slice(index))
      if (parameterMatch) {
        push('parameter', parameterMatch[0])
        index += parameterMatch[0].length
        continue
      }
    }

    if (/\d/.test(character)) {
      const match = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(sql.slice(index))!
      push('number', match[0])
      index += match[0].length
      continue
    }

    if (/[A-Za-z_]/.test(character)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(index))!
      const word = match[0]
      const lower = word.toLowerCase()
      push(KEYWORDS.has(lower) ? 'keyword' : TYPES.has(lower) ? 'type' : 'plain', word)
      index += word.length
      continue
    }

    if (/[=<>!+\-*/%|&^~:,;().[\]]/.test(character)) {
      push('operator', character)
      index += 1
      continue
    }

    push('plain', character)
    index += 1
  }

  return tokens
}

/** Rend une requête SQL colorée. `wrap` autorise le retour à la ligne plutôt que le défilement. */
export function SqlCode({
  sql,
  className,
  wrap = false,
}: {
  sql: string
  className?: string
  wrap?: boolean
}): ReactNode {
  return (
    <pre
      // `cn` pour ce que l'appelant peut remplacer — une hauteur maximale, un fond différent.
      // La taille reste en dehors : la fusion de classes range `text-meta` et `text-ink` dans la
      // même famille et n'en garderait qu'une, ce qui rendrait le code à 14 px.
      className={`text-meta ${cn(
        'bg-surface-sunken border-border-subtle text-ink overflow-auto rounded-[var(--radius-control)] border px-3 py-2 font-mono leading-relaxed',
        wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre',
        className,
      )}`}
    >
      <code>
        {tokenizeSql(sql).map((token, index) => (
          <span key={index} className={TOKEN_CLASS[token.kind]}>
            {token.value}
          </span>
        ))}
      </code>
    </pre>
  )
}

/**
 * Commande SQL corrective : le produit même de l'Advisor, qui n'agit jamais sur l'instance.
 *
 * Même anatomie que `CommandBlock` — intitulé, copie, accusé — mais le texte reste coloré : une
 * commande qu'on s'apprête à exécuter sur une base de production se relit, et le monochrome ne
 * distingue plus le nom d'objet du mot-clé. `className` s'applique au bloc de code, ce qui permet
 * d'en borner la hauteur.
 */
export function SqlCommand({
  sql,
  label,
  hint,
  className,
}: {
  sql: string
  /** Nom de ce qu'on s'apprête à copier. */
  label: string
  /** Conséquence de l'exécution, tenue sur la ligne de l'intitulé. */
  hint?: ReactNode
  className?: string
}): ReactNode {
  return (
    <div className="min-w-0">
      {/* L'intitulé et la copie partagent une ligne, la conséquence tient sur la suivante : elle
          reste sous les yeux au moment de copier, sans repousser le bloc de deux paragraphes. */}
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3">
        <span className="text-ink-muted text-micro font-semibold tracking-wider uppercase">
          {label}
        </span>
        <CopyButton value={sql} label={label} />
      </div>
      {hint && <p className="text-ink-muted mb-1 text-meta">{hint}</p>}
      <SqlCode sql={sql} wrap className={className} />
    </div>
  )
}
