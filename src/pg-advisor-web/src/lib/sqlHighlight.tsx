import { tokenizeSql, type TokenKind } from './sqlTokens'
import type { ReactNode } from 'react'
import { CopyButton } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'

/**
 * Coloration syntaxique SQL minimale. Écrite ici plutôt qu'importée : une bibliothèque
 * généraliste pèse plus lourd que le besoin, et les couleurs suivent les jetons de design.
 */

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

/** Découpe le SQL en jetons colorables. Tolérant : tout ce qui n'est pas reconnu reste neutre. */

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
