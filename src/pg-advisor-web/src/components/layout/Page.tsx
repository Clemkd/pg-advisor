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
          <h1 className="text-ink text-lg font-semibold tracking-tight">{title}</h1>
          {description && <p className="text-ink-muted text-sm">{description}</p>}
          {meta && <div className="flex flex-wrap items-center gap-1.5">{meta}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  )
}

/** Grille de statistiques. */
export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid gap-3 sm:grid-cols-2 lg:grid-cols-4', className)}>{children}</div>
}

/** Tuile de statistique. */
export function Stat({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  tone?: 'default' | 'danger' | 'warning' | 'success'
}) {
  const valueTone = {
    default: 'text-ink',
    danger: 'text-danger',
    warning: 'text-warning',
    success: 'text-success',
  }[tone ?? 'default']

  return (
    <div className="bg-surface border-border-subtle shadow-card min-w-0 rounded-[var(--radius-card)] border px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-ink-muted truncate text-xs font-medium">{label}</p>
        {icon && <span className="text-ink-faint shrink-0">{icon}</span>}
      </div>
      <p className={cn('mt-1.5 text-2xl font-semibold tabular-nums', valueTone)}>{value}</p>
      {hint && <p className="text-ink-faint mt-0.5 truncate text-xs">{hint}</p>}
    </div>
  )
}
