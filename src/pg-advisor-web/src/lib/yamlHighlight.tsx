import { useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Coloration syntaxique YAML minimale, écrite ici pour les mêmes raisons que celle du SQL :
 * une bibliothèque généraliste pèse plus lourd que le besoin, et les couleurs suivent les
 * jetons de design. Elle connaît en plus ce que les règles ajoutent au YAML : les gabarits
 * `{{ … }}` et les paramètres `@nom`.
 */

type TokenKind =
  | 'comment'
  | 'key'
  | 'string'
  | 'number'
  | 'literal'
  | 'template'
  | 'parameter'
  | 'punctuation'
  | 'anchor'
  | 'plain'

const TOKEN_CLASS: Record<TokenKind, string> = {
  comment: 'text-ink-faint italic',
  key: 'text-brand font-semibold',
  string: 'text-success',
  number: 'text-warning',
  literal: 'text-accent',
  template: 'text-danger font-semibold',
  parameter: 'text-accent font-semibold',
  punctuation: 'text-ink-muted',
  anchor: 'text-accent',
  plain: '',
}

interface Token {
  kind: TokenKind
  value: string
}

const LITERALS = new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off', '~'])

/** Découpe une valeur : chaînes, gabarits, paramètres, nombres, littéraux, commentaire final. */
function tokenizeValue(value: string, push: (kind: TokenKind, text: string) => void): void {
  let index = 0

  while (index < value.length) {
    const rest = value.slice(index)

    // Commentaire de fin de ligne : il doit être précédé d'une espace pour ne pas couper
    // une valeur qui contient un « # ».
    if (value[index] === '#' && (index === 0 || /\s/.test(value[index - 1]))) {
      push('comment', rest)
      return
    }

    const quoted = /^(['"])(?:\\.|(?!\1).)*\1?/.exec(rest)
    if (quoted) {
      push('string', quoted[0])
      index += quoted[0].length
      continue
    }

    const template = /^\{\{.*?\}\}/.exec(rest)
    if (template) {
      push('template', template[0])
      index += template[0].length
      continue
    }

    const parameter = /^@[A-Za-z_][A-Za-z0-9_]*/.exec(rest)
    if (parameter) {
      push('parameter', parameter[0])
      index += parameter[0].length
      continue
    }

    const anchor = /^[&*][A-Za-z_][A-Za-z0-9_-]*/.exec(rest)
    if (anchor) {
      push('anchor', anchor[0])
      index += anchor[0].length
      continue
    }

    const number = /^-?\d+(\.\d+)?([eE][+-]?\d+)?(?![\w-])/.exec(rest)
    if (number) {
      push('number', number[0])
      index += number[0].length
      continue
    }

    const word = /^[A-Za-z_~][A-Za-z0-9_]*/.exec(rest)
    if (word) {
      push(LITERALS.has(word[0].toLowerCase()) ? 'literal' : 'plain', word[0])
      index += word[0].length
      continue
    }

    push('plain', value[index])
    index += 1
  }
}

/** Découpe le YAML en jetons colorables. Tolérant : l'inconnu reste neutre. */
export function tokenizeYaml(yaml: string): Token[] {
  const tokens: Token[] = []

  const push = (kind: TokenKind, value: string) => {
    if (value === '') return
    const previous = tokens[tokens.length - 1]
    if (previous && previous.kind === kind) previous.value += value
    else tokens.push({ kind, value })
  }

  const lines = yaml.split('\n')

  lines.forEach((line, index) => {
    if (index > 0) push('plain', '\n')

    const indent = /^\s*/.exec(line)![0]
    push('plain', indent)

    let rest = line.slice(indent.length)

    if (rest.startsWith('#')) {
      push('comment', rest)
      return
    }

    // Élément de liste : le tiret se répète parfois avant une clé imbriquée.
    while (rest.startsWith('- ') || rest === '-') {
      push('punctuation', rest === '-' ? '-' : '- ')
      rest = rest === '-' ? '' : rest.slice(2)
    }

    // Clé : tout ce qui précède un « : » suivi d'une espace ou d'une fin de ligne.
    const key = /^((?:"[^"]*")|(?:'[^']*')|(?:[^:#\s][^:#]*?))\s*:(?=\s|$)/.exec(rest)
    if (key) {
      push('key', key[1])
      push('punctuation', ':')
      rest = rest.slice(key[0].length)
    }

    tokenizeValue(rest, push)
  })

  return tokens
}

function Highlighted({ yaml }: { yaml: string }): ReactNode {
  return tokenizeYaml(yaml).map((token, index) => (
    <span key={index} className={TOKEN_CLASS[token.kind]}>
      {token.value}
    </span>
  ))
}

/** Affiche du YAML coloré, sans édition. */
export function YamlCode({ yaml, className }: { yaml: string; className?: string }): ReactNode {
  return (
    <pre
      className={cn(
        'bg-surface-sunken border-border-subtle text-ink overflow-auto rounded-[var(--radius-control)] border px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre [tab-size:2]',
        className,
      )}
    >
      <code>
        <Highlighted yaml={yaml} />
      </code>
    </pre>
  )
}

/**
 * Éditeur YAML coloré : un calque coloré sous une zone de saisie au texte transparent. Les deux
 * partagent police, interlignage et marges — c'est ce qui aligne le curseur sur les caractères
 * affichés — et le calque suit le défilement de la saisie.
 */
export function YamlEditor({
  value,
  onChange,
  readOnly,
  rows = 28,
  label,
  className,
}: {
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
  rows?: number
  label: string
  className?: string
}) {
  const layer = useRef<HTMLPreElement>(null)

  return (
    <div
      className={cn(
        'border-border-strong bg-surface-sunken focus-within:border-brand focus-within:ring-brand relative overflow-hidden rounded-[var(--radius-control)] border focus-within:ring-1',
        className,
      )}
    >
      <pre
        ref={layer}
        aria-hidden
        className="text-ink pointer-events-none absolute inset-0 overflow-hidden px-3 py-2.5 font-mono text-xs leading-relaxed whitespace-pre [tab-size:2]"
      >
        <code>
          <Highlighted yaml={value} />
          {/* Ligne vide finale : sans elle, le calque est plus court d'une ligne que la saisie. */}
          {'\n'}
        </code>
      </pre>

      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => {
          const element = layer.current
          if (!element) return
          element.scrollTop = event.currentTarget.scrollTop
          element.scrollLeft = event.currentTarget.scrollLeft
        }}
        spellCheck={false}
        // Correction et majuscule automatiques désarmées : elles réécrivent du code.
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        readOnly={readOnly}
        wrap="off"
        rows={rows}
        aria-label={label}
        className={cn(
          'selection:bg-brand/30 relative w-full overflow-auto bg-transparent px-3 py-2.5 font-mono text-xs leading-relaxed text-transparent [tab-size:2] focus:outline-none',
          // En lecture seule — un compte lecteur —, ni curseur de saisie ni poignée de
          // redimensionnement : le cadre annonce ce qu'il est avant qu'on essaie d'y écrire.
          readOnly ? 'caret-transparent cursor-default resize-none' : 'caret-ink resize-y',
        )}
      />
    </div>
  )
}
