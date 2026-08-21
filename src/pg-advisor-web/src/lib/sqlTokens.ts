/**
 * Lexeur SQL, séparé des composants qui l'affichent : un module qui exporte à la fois une
 * fonction et un composant force un rechargement complet de la page au lieu d'un remplacement à
 * chaud, à chaque frappe dans l'éditeur.
 */
export type TokenKind =
  | 'keyword'
  | 'type'
  | 'string'
  | 'number'
  | 'comment'
  | 'parameter'
  | 'operator'
  | 'plain'

export interface Token {
  kind: TokenKind
  value: string
}

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
    const character = sql[index]!

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
      // La garde ci-dessus a vu un chiffre : le motif ancré correspond donc, et sur au moins un
      // caractère. Un repli sur la chaîne vide ferait boucler l'analyseur indéfiniment.
      const number = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(sql.slice(index))![0]
      push('number', number)
      index += number.length
      continue
    }

    if (/[A-Za-z_]/.test(character)) {
      const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(index))![0]
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
