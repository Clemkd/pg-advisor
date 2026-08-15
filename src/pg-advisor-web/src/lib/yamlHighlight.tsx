import { useRef, type ReactNode, type RefObject } from 'react'
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
  comment: 'text-ink-muted italic',
  key: 'text-code-key font-semibold',
  string: 'text-code-string',
  number: 'text-code-number',
  literal: 'text-code-type',
  template: 'text-code-param font-semibold',
  parameter: 'text-code-param font-semibold',
  punctuation: 'text-ink-muted',
  anchor: 'text-code-type',
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

/**
 * Découpe le YAML en jetons colorables, ligne par ligne. Tolérant : l'inconnu reste neutre.
 *
 * Le découpage par ligne n'est pas un détail de mise en œuvre : c'est ce qui permet de signaler
 * une ligne fautive là où elle est, plutôt que de renvoyer l'auteur à une liste d'erreurs en
 * tête de page.
 */
function tokenizeYamlLines(yaml: string): Token[][] {
  return yaml.split('\n').map((line) => {
    const tokens: Token[] = []

    const push = (kind: TokenKind, value: string) => {
      if (value === '') return
      const previous = tokens[tokens.length - 1]
      if (previous && previous.kind === kind) previous.value += value
      else tokens.push({ kind, value })
    }

    const indent = /^\s*/.exec(line)![0]
    push('plain', indent)

    let rest = line.slice(indent.length)

    if (rest.startsWith('#')) {
      push('comment', rest)
      return tokens
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
    return tokens
  })
}

/** Numéro de la première ligne déclarant `path`, en suivant l'indentation. */
function findPath(lines: string[], path: string[]): number | null {
  let found: number | null = null
  let parentIndent = -1
  let from = 0

  for (const segment of path) {
    let hit: number | null = null

    for (let index = from; index < lines.length; index++) {
      const match = /^(\s*)(?:- )?["']?([\w.-]+)["']?\s*:/.exec(lines[index])
      if (!match) continue

      const indent = match[1].length
      // Sorti du bloc du parent : le segment cherché n'y était pas.
      if (parentIndent >= 0 && indent <= parentIndent) break
      if (match[2] === segment) {
        hit = index
        break
      }
    }

    if (hit === null) return found
    found = hit
    parentIndent = /^(\s*)/.exec(lines[hit])![1].length
    from = hit + 1
  }

  return found === null ? null : found + 1
}

/**
 * Ligne visée par un message de validation, quand elle est identifiable.
 *
 * Les messages du serveur portent, selon les cas, une position (« (line 14) »), un chemin de
 * champ entre guillemets (« "recommendation.title" ») ou le seul nom du champ fautif. Aucun n'est
 * garanti : la fonction rend `null` plutôt que de désigner une ligne au hasard, et l'erreur reste
 * alors lisible dans la liste.
 */
export function errorLine(message: string, yaml: string): number | null {
  const explicit = /\(line\s+(\d+)\)/i.exec(message)
  if (explicit) return Number(explicit[1])

  const lines = yaml.split('\n')

  const quoted = /"([A-Za-z][\w.]*)"/.exec(message)
  if (quoted) {
    const byPath = findPath(lines, quoted[1].split('.'))
    if (byPath !== null) return byPath
  }

  // À défaut, le premier mot du message qui nomme une clé présente dans le document. Les plus
  // longs d'abord : « recommendation » l'emporte sur « id ».
  const words = [...new Set(message.match(/[A-Za-z][\w]{1,}/g) ?? [])].sort(
    (left, right) => right.length - left.length,
  )
  for (const word of words) {
    const byKey = findPath(lines, [word])
    if (byKey !== null) return byKey
  }

  return null
}

function Highlighted({
  yaml,
  errorLines,
  changedLines,
}: {
  yaml: string
  errorLines?: ReadonlySet<number>
  changedLines?: ReadonlySet<number>
}): ReactNode {
  return tokenizeYamlLines(yaml).map((tokens, index) => (
    /*
     * Une ligne, un bloc : c'est ce qui permet de teinter la ligne fautive sur toute sa largeur.
     * Une ligne vide garde sa hauteur grâce à l'espace sans chasse, sinon le calque coloré se
     * décale d'une ligne par rapport à la saisie.
     *
     * Fond et ombre intérieure seulement : une bordure ou une marge décalerait les caractères du
     * calque d'un ou deux pixels, et le curseur de la saisie cesserait de tomber dessus.
     */
    <span
      key={index}
      className={cn(
        'block',
        errorLines?.has(index + 1)
          ? 'bg-danger-subtle'
          : changedLines?.has(index + 1) &&
            'bg-info-subtle shadow-[inset_2px_0_0_0_var(--color-info)]',
      )}
    >
      {tokens.length === 0
        ? '​'
        : tokens.map((token, position) => (
            <span key={position} className={TOKEN_CLASS[token.kind]}>
              {token.value}
            </span>
          ))}
    </span>
  ))
}

/** Affiche du YAML coloré, sans édition. */
export function YamlCode({ yaml, className }: { yaml: string; className?: string }): ReactNode {
  return (
    <pre
      className={cn(
        'bg-surface-sunken border-border-subtle text-ink overflow-auto rounded-[var(--radius-control)] border px-3 py-2 font-mono text-meta leading-relaxed whitespace-pre [tab-size:2]',
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
  errorLines,
  changedLines,
  textareaRef,
  fill = false,
}: {
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
  rows?: number
  label: string
  className?: string
  /** Lignes signalées par la validation, numérotées à partir de 1. */
  errorLines?: ReadonlySet<number>
  /** Lignes modifiées depuis le dernier enregistrement, numérotées à partir de 1. */
  changedLines?: ReadonlySet<number>
  /** Donne la main sur la saisie : y poser le curseur sur une ligne, par exemple. */
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  /** L'éditeur prend toute la hauteur que son conteneur lui laisse, au lieu de compter ses lignes. */
  fill?: boolean
}) {
  const layer = useRef<HTMLPreElement>(null)

  return (
    <div
      className={cn(
        'border-border-strong bg-surface-sunken focus-within:border-brand focus-within:ring-brand relative overflow-hidden rounded-[var(--radius-control)] border focus-within:ring-1',
        fill && 'min-h-0 flex-1',
        className,
      )}
    >
      <pre
        ref={layer}
        aria-hidden
        className="text-ink pointer-events-none absolute inset-0 overflow-hidden px-3 py-2.5 font-mono text-meta leading-relaxed whitespace-pre [tab-size:2]"
      >
        <code>
          <Highlighted yaml={value} errorLines={errorLines} changedLines={changedLines} />
          {/* Ligne vide finale : sans elle, le calque est plus court d'une ligne que la saisie. */}
          <span className="block">{'​'}</span>
        </code>
      </pre>

      <textarea
        ref={textareaRef}
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
        rows={fill ? undefined : rows}
        aria-label={label}
        /*
         * Taille et couleur écrites côte à côte, hors de la fusion de classes : celle-ci range
         * `text-meta` et `text-transparent` dans la même famille et n'en garde qu'une. La saisie
         * passerait alors à 14 px quand le calque coloré reste à 12, et le curseur cesserait de
         * tomber sur les caractères affichés.
         */
        className={`selection:bg-brand/30 relative w-full overflow-auto bg-transparent px-3 py-2.5 font-mono text-meta leading-relaxed text-transparent [tab-size:2] focus:outline-none ${cn(
          fill ? 'h-full resize-none' : readOnly ? 'resize-none' : 'resize-y',
          // En lecture seule — un compte lecteur —, ni curseur de saisie ni poignée de
          // redimensionnement : le cadre annonce ce qu'il est avant qu'on essaie d'y écrire.
          readOnly ? 'caret-transparent cursor-default' : 'caret-ink',
        )}`}
      />
    </div>
  )
}
