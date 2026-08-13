/**
 * Adaptateur vers le système de composants de `ui/primitives`.
 *
 * Les pages écrites avant la migration visuelle consomment cette surface : chaque composant
 * délègue aux primitives, si bien qu'elles adoptent les jetons de design sans réécriture.
 * Les nouvelles pages importent directement `@/components/ui/primitives`.
 */
import type { ReactNode } from 'react'
import {
  Badge,
  Button as BaseButton,
  Card as BaseCard,
  CardBody,
  CardHeader,
  Checkbox as BaseCheckbox,
  CodeBlock as BaseCodeBlock,
  Dot as BaseDot,
  EmptyState as BaseEmptyState,
  Field as BaseField,
  Input as BaseInput,
  Modal as BaseModal,
  Notice,
  Select as BaseSelect,
  SeverityBadge as BaseSeverityBadge,
  Spinner as BaseSpinner,
  SplitButton as BaseSplitButton,
  TableScroll as BaseTableScroll,
} from './ui/primitives'
import { ScoreBar as BaseScoreBar, ScoreRing as BaseScoreRing } from './ui/score'
import { cn } from '@/lib/utils'

export { CardBody, CardHeader, Badge }
export const Spinner = BaseSpinner
export const Input = BaseInput
export const Select = BaseSelect
export const Checkbox = BaseCheckbox
export const SeverityBadge = BaseSeverityBadge
export const ScoreRing = BaseScoreRing
export const ScoreBar = BaseScoreBar
export const TableScroll = BaseTableScroll
export const CodeBlock = BaseCodeBlock
export const Modal = BaseModal
export const Dot = BaseDot
export const Field = BaseField

type LegacyVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline'

export function Button({
  variant = 'secondary',
  ...props
}: Omit<React.ComponentProps<typeof BaseButton>, 'variant'> & { variant?: LegacyVariant }) {
  return <BaseButton variant={variant} {...props} />
}

export function SplitButton({
  busy,
  ...props
}: Omit<React.ComponentProps<typeof BaseSplitButton>, 'loading'> & { busy?: boolean }) {
  return <BaseSplitButton loading={busy} {...props} />
}

/** Carte à en-tête intégré, forme historique conservée pour les pages non réécrites. */
export function Card({
  title,
  actions,
  children,
  className,
  padded = true,
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  padded?: boolean
}) {
  return (
    <BaseCard className={className}>
      {(title || actions) && <CardHeader title={title} action={actions} />}
      {padded ? <CardBody>{children}</CardBody> : children}
    </BaseCard>
  )
}

const LEGACY_TONES = {
  error: 'danger',
  warning: 'warning',
  success: 'success',
  info: 'info',
} as const

export function Alert({
  tone = 'error',
  title,
  children,
  onDismiss,
}: {
  tone?: keyof typeof LEGACY_TONES
  title?: ReactNode
  children?: ReactNode
  onDismiss?: () => void
}) {
  return (
    <Notice tone={LEGACY_TONES[tone]} title={title} onDismiss={onDismiss}>
      {children}
    </Notice>
  )
}

const TAG_TONES = {
  neutral: 'neutral',
  good: 'success',
  warn: 'warning',
  bad: 'danger',
  accent: 'brand',
} as const

export function Tag({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: keyof typeof TAG_TONES
}) {
  return <Badge tone={TAG_TONES[tone]}>{children}</Badge>
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return <BaseEmptyState title={title} description={children} />
}

/** En-tête de page des vues non encore portées sur le conteneur `Page`. */
export function PageHeader({
  breadcrumb,
  title,
  subtitle,
  actions,
  meta,
  className,
}: {
  breadcrumb?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  meta?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between', className)}>
      <div className="min-w-0">
        {breadcrumb && <p className="text-ink-faint mb-0.5 truncate text-xs">{breadcrumb}</p>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="text-ink text-lg font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="text-ink-muted text-sm">{subtitle}</p>}
          {meta && <div className="flex flex-wrap items-center gap-1.5">{meta}</div>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
