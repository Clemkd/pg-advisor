import { cn } from '@/lib/utils'
import { scoreTone } from '@/lib/format'
import { useT } from '@/lib/i18n'

const SCORE_COLORS: Record<string, { text: string; stroke: string; bar: string }> = {
  good: { text: 'text-success', stroke: 'stroke-success', bar: 'bg-success' },
  warn: { text: 'text-warning', stroke: 'stroke-warning', bar: 'bg-warning' },
  bad: { text: 'text-danger', stroke: 'stroke-danger', bar: 'bg-danger' },
}

/** Jauge circulaire du score de santé. */
export function ScoreRing({
  score,
  size = 120,
  className,
}: {
  score: number | null
  size?: number
  className?: string
}) {
  const t = useT()
  const colors = SCORE_COLORS[score === null ? 'warn' : scoreTone(score)]
  const radius = size / 2 - 8
  const circumference = 2 * Math.PI * radius
  const filled = score === null ? 0 : (score / 100) * circumference

  return (
    <div
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className="fill-none stroke-border-subtle"
          strokeWidth={8}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className={cn('fill-none transition-[stroke-dashoffset] duration-500', colors.stroke)}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - filled}
        />
      </svg>
      {/* La légende ne tient pas dans une petite jauge : sous 96 px, le score parle seul plutôt
          que de déborder de son cercle. */}
      <div className="absolute flex flex-col items-center leading-none">
        <span
          className={cn(
            'font-semibold tabular-nums',
            size < 96 ? 'text-title' : 'text-metric',
            colors.text,
          )}
        >
          {score === null ? '—' : score}
        </span>
        {size >= 96 && (
          <span className="text-ink-muted mt-1 text-micro tracking-wide uppercase">{t('score.outOf')}</span>
        )}
      </div>
    </div>
  )
}

/**
 * Barre horizontale d'un score par catégorie.
 *
 * La colonne d'étiquettes est fixe : c'est la condition pour que les barres d'un même groupe
 * s'alignent et se comparent d'un coup d'œil — sans cet alignement, la jauge ne dit plus rien. Sa
 * largeur est exprimée en `ch`, donc elle suit la taille du texte, et l'anglais — couramment 30 %
 * plus long — dispose de la moitié en plus au-delà de `sm`. Ce qui déborde encore est tronqué et
 * reste lisible en entier au survol.
 */
export function ScoreBar({ label, score }: { label: string; score: number }) {
  const colors = SCORE_COLORS[scoreTone(score)]

  return (
    <div className="flex items-center gap-3">
      <span
        className="text-ink-muted text-meta w-[10ch] shrink-0 truncate sm:w-[15ch]"
        title={label}
      >
        {label}
      </span>
      <div className="bg-surface-sunken h-1.5 min-w-8 flex-1 overflow-hidden rounded-full">
        <div
          className={cn('h-full rounded-full transition-[width] duration-500', colors.bar)}
          style={{ width: `${Math.max(2, score)}%` }}
        />
      </div>
      {/* Le chiffre double la barre : un score porté par la seule longueur d'un trait coloré
          n'est pas lisible pour qui distingue mal les teintes. */}
      <span className={cn('text-meta w-[3ch] shrink-0 text-right font-semibold tabular-nums', colors.text)}>
        {score}
      </span>
    </div>
  )
}
