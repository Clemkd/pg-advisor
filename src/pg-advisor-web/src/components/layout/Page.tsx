import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Conteneur de page : largeur, marges et en-tête homogènes sur toute l'application. */
export function Page({
  title,
  description,
  actions,
  meta,
  children,
  wide,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  meta?: ReactNode
  children: ReactNode
  wide?: boolean
}) {
  // La marge extérieure est posée par la coquille : ici, seule la largeur de lecture varie.
  return (
    <div className={cn('mx-auto w-full', wide ? 'max-w-none' : 'max-w-6xl')}>
      {/* Titre, descriptif et méta sur une même ligne, qui ne se replie que par manque de
          place : l'en-tête de page conserve son contenu en coûtant une ligne au lieu de trois. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="text-ink text-title font-semibold tracking-tight">{title}</h1>
          {description && <p className="text-ink-muted text-body">{description}</p>}
          {meta && <div className="flex flex-wrap items-center gap-1.5">{meta}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  )
}

const VALUE_TONES = {
  default: 'text-ink',
  danger: 'text-danger',
  warning: 'text-warning',
  success: 'text-success',
  info: 'text-info',
} as const

export type ValueTone = keyof typeof VALUE_TONES

/** Grille de statistiques. */
export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-4', className)}>{children}</div>
}

/**
 * Tuile de statistique. Une tuile ne porte jamais le chiffre qui commande la lecture : quatre
 * tuiles identiques n'offrent aucun point d'entrée, et l'œil doit lire les quatre libellés pour
 * savoir laquelle compte. Ce chiffre-là revient à `Hero`.
 *
 * `className` accueille la marque de fraîcheur (`freshClass`) quand la valeur vient de changer.
 */
export function Stat({
  label,
  value,
  hint,
  icon,
  tone,
  className,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  tone?: ValueTone
  className?: string
}) {
  return (
    <div
      className={cn(
        'bg-surface border-border-subtle shadow-card min-w-0 rounded-[var(--radius-card)] border px-4 py-3',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-ink-muted text-meta truncate font-medium">{label}</p>
        {icon && <span className="text-ink-faint shrink-0">{icon}</span>}
      </div>
      <p className={cn('text-metric mt-1.5 font-semibold tabular-nums', VALUE_TONES[tone ?? 'default'])}>
        {value}
      </p>
      {hint && <p className="text-ink-muted text-meta mt-0.5">{hint}</p>}
    </div>
  )
}

/**
 * Point d'entrée d'une vue de balayage : le chiffre qui commande la lecture, et lui seul.
 *
 * Un écran lu tous les jours en diagonale a besoin d'un endroit où l'œil se pose sans chercher.
 * D'où la taille — `text-display` — et la teinte prise sur la valeur : le score se lit avant d'être
 * lu. `aside` accueille une jauge, `meta` les badges qui qualifient, `action` le pas suivant.
 *
 * `compact` range les mêmes éléments sur une seule ligne au lieu de les empiler. Une vue dont
 * l'essentiel est la liste en dessous ne peut pas donner cent quarante pixels à son en-tête ;
 * la ligne se replie d'elle-même sur un écran étroit, où l'empilement revient sans être décidé.
 */
export function Hero({
  label,
  value,
  hint,
  tone,
  aside,
  meta,
  action,
  compact = false,
  className,
}: {
  label: ReactNode
  value: ReactNode
  hint?: ReactNode
  tone?: ValueTone
  /** Représentation visuelle du même chiffre — une jauge, par exemple. */
  aside?: ReactNode
  meta?: ReactNode
  action?: ReactNode
  /** Tout sur une ligne, pour une vue où l'en-tête n'est pas le sujet. */
  compact?: boolean
  className?: string
}) {
  const number = (
    <p
      className={cn(
        'font-semibold tabular-nums',
        // Sur un téléphone, la ligne se replie et le chiffre n'a plus rien à dominer : il reste
        // le plus gros élément de l'écran à 24 px, et rend huit pixels à la liste.
        compact ? 'text-metric sm:text-display' : 'text-display',
        VALUE_TONES[tone ?? 'default'],
      )}
    >
      {value}
    </p>
  )

  return (
    <section
      className={cn(
        'bg-surface border-border-subtle shadow-card flex min-w-0 flex-wrap items-center gap-x-6 gap-y-4 rounded-[var(--radius-card)] border p-4',
        className,
      )}
    >
      {aside && <div className="shrink-0">{aside}</div>}

      {compact ? (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
          {/* Le chiffre et ce qu'il compte ne se séparent pas : même groupe, aligné sur la
              ligne de base, pour qu'un repli les emporte ensemble. */}
          <div className="flex items-baseline gap-2">
            {number}
            <p className="text-ink-muted text-micro font-semibold tracking-wider uppercase">
              {label}
            </p>
          </div>

          {hint && <p className="text-ink-muted min-w-0 text-meta">{hint}</p>}
          {meta && <div className="flex flex-wrap items-center gap-1.5">{meta}</div>}
        </div>
      ) : (
        <div className="min-w-0 flex-1">
          <p className="text-ink-muted text-micro font-semibold tracking-wider uppercase">{label}</p>
          <div className="mt-1">{number}</div>
          {hint && <p className="text-ink-muted text-meta mt-1">{hint}</p>}
          {meta && <div className="mt-2 flex flex-wrap items-center gap-1.5">{meta}</div>}
        </div>
      )}

      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </section>
  )
}
