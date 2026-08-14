import { Children, isValidElement, useId, useRef, useState } from 'react'
import type {
  ButtonHTMLAttributes,
  ChangeEvent,
  HTMLAttributes,
  InputHTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  LabelHTMLAttributes,
  OptionHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { useEffect } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Check, ChevronDown, Loader2, X } from 'lucide-react'
import { Bubble, BubbleItem } from '@/components/ui/Bubble'
import { severityLabel } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ Bouton */

const buttonStyles = cva(
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap',
  {
    variants: {
      variant: {
        primary: 'bg-brand text-brand-ink hover:bg-brand-hover',
        secondary: 'bg-surface-sunken text-ink hover:bg-border-subtle',
        outline: 'border border-border-strong text-ink hover:bg-surface-sunken',
        ghost: 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
        danger: 'bg-danger text-white hover:opacity-90',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-10 px-4 text-sm',
        lg: 'h-11 px-5 text-base',
        icon: 'size-9',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'sm' },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonStyles> {
  loading?: boolean
  /** Depuis React 19, `ref` est une prop ordinaire : plus besoin de `forwardRef`. */
  ref?: Ref<HTMLButtonElement>
}

export function Button({ className, variant, size, loading, children, disabled, ...props }: ButtonProps) {
  return (
    <button
      className={cn(buttonStyles({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

/** Largeur du menu déroulant, en pixels : la même valeur sert au style et au placement. */
const MENU_WIDTH = 256

/**
 * Bouton scindé : l'action la plus courante est directement cliquable, les autres sont
 * regroupées derrière un chevron. Évite d'aligner plusieurs boutons de poids visuel égal.
 *
 * Le menu est monté dans `document.body` et positionné en `fixed` : posé dans le flux, il
 * passait sous les lignes suivantes d'une liste virtualisée — chacune est transformée, donc
 * ouvre son propre contexte d'empilement, où un `z-index` local ne pèse rien — et se faisait
 * rogner par le conteneur défilant.
 */
export function SplitButton({
  label,
  onClick,
  options,
  disabled,
  loading,
  variant = 'secondary',
}: {
  label: ReactNode
  onClick: () => void
  options: { label: string; description?: string; onSelect: () => void; disabled?: boolean }[]
  disabled?: boolean
  loading?: boolean
  variant?: NonNullable<VariantProps<typeof buttonStyles>['variant']>
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)

  return (
    <div ref={container} className="relative inline-flex">
      <Button
        variant={variant}
        loading={loading}
        disabled={disabled}
        onClick={onClick}
        className="rounded-r-none"
      >
        {label}
      </Button>

      <Button
        variant={variant}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('common.moreActions')}
        className="w-8 rounded-l-none border-l border-black/10 px-0 dark:border-white/15"
      >
        <ChevronDown className="size-3.5" aria-hidden />
      </Button>

      <Bubble
        anchor={container}
        open={open}
        onClose={() => setOpen(false)}
        align="end"
        width={MENU_WIDTH}
        label={t('common.moreActions')}
      >
        {options.map((option) => (
          <BubbleItem
            key={option.label}
            disabled={option.disabled}
            onSelect={() => {
              setOpen(false)
              option.onSelect()
            }}
          >
            <span className="block min-w-0">
              <span className="text-ink block text-sm font-medium">{option.label}</span>
              {option.description && (
                <span className="text-ink-faint mt-0.5 block text-xs">{option.description}</span>
              )}
            </span>
          </BubbleItem>
        ))}
      </Bubble>
    </div>
  )
}

/* ------------------------------------------------------------------ Champs */

const controlStyles =
  'bg-surface border-border-strong text-ink placeholder:text-ink-faint w-full rounded-[var(--radius-control)] border px-3 text-sm focus:border-brand focus:outline-none disabled:opacity-60'

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input className={cn(controlStyles, 'h-9', className)} {...props} />
}

type Option = { value: string; label: string; disabled?: boolean }

/** Lit les `<option>` fournis par l'appelant : l'API reste celle d'un `select`. */
function readOptions(children: ReactNode): Option[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<OptionHTMLAttributes<HTMLOptionElement>>(child) || child.type !== 'option') {
      return []
    }

    const label = String(child.props.children ?? '')
    return [{ value: String(child.props.value ?? label), label, disabled: child.props.disabled }]
  })
}

/**
 * Liste déroulante maison : une bulle d'options, dessinée avec les jetons du thème.
 *
 * Le `select` natif ouvre une liste peinte par le système : elle reste claire en thème sombre
 * et ignore la typographie de l'application. Les propriétés attendues restent celles d'un
 * `select` — `value`, `onChange`, des `<option>` en enfants — pour que les appels ne changent
 * pas d'écriture.
 */
export function Select({
  className,
  children,
  value,
  onChange,
  disabled,
  id,
  name,
  title,
  'aria-label': ariaLabel,
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const trigger = useRef<HTMLButtonElement>(null)
  const listId = useId()

  const options = readOptions(children)
  const selectedIndex = options.findIndex((option) => option.value === String(value ?? ''))
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined

  const choose = (option: Option) => {
    setOpen(false)
    trigger.current?.focus()
    // Le contrat des appelants est celui d'un événement de `select`.
    onChange?.({
      target: { value: option.value, name: name ?? '' },
      currentTarget: { value: option.value, name: name ?? '' },
    } as unknown as ChangeEvent<HTMLSelectElement>)
  }

  const move = (delta: number) => {
    setActive((current) => {
      const start = current < 0 ? 0 : current
      let next = start
      for (let step = 0; step < options.length; step++) {
        next = (next + delta + options.length) % options.length
        if (!options[next].disabled) return next
      }
      return start
    })
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        setActive(selectedIndex >= 0 ? selectedIndex : 0)
        setOpen(true)
      }
      return
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        move(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        move(-1)
        break
      case 'Home':
        event.preventDefault()
        setActive(0)
        break
      case 'End':
        event.preventDefault()
        setActive(options.length - 1)
        break
      case 'Enter':
      case ' ': {
        event.preventDefault()
        const option = options[active]
        if (option && !option.disabled) choose(option)
        break
      }
    }
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        id={id}
        title={title}
        aria-label={ariaLabel}
        role="combobox"
        aria-controls={listId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
        disabled={disabled}
        onClick={() => {
          setActive(selectedIndex >= 0 ? selectedIndex : 0)
          setOpen((current) => !current)
        }}
        onKeyDown={onKeyDown}
        className={cn(controlStyles, 'flex h-9 items-center justify-between gap-2 text-left', className)}
      >
        <span className={cn('truncate', selected ? 'text-ink' : 'text-ink-faint')}>
          {selected?.label ?? '—'}
        </span>
        <ChevronDown className="text-ink-faint size-3.5 shrink-0" aria-hidden />
      </button>

      <Bubble
        anchor={trigger}
        open={open}
        onClose={() => setOpen(false)}
        width="anchor"
        role="listbox"
        label={ariaLabel ?? title}
      >
        <div id={listId}>
          {options.map((option, index) => (
            <BubbleItem
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              selected={option.value === String(value ?? '')}
              disabled={option.disabled}
              onSelect={() => choose(option)}
            >
              <Check
                className={cn(
                  'size-3.5 shrink-0',
                  option.value === String(value ?? '') ? 'opacity-100' : 'opacity-0',
                )}
                aria-hidden
              />
              <span className="truncate">{option.label}</span>
            </BubbleItem>
          ))}
        </div>
      </Bubble>
    </>
  )
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(controlStyles, 'py-2 leading-relaxed', className)} {...props} />
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-ink-muted mb-1.5 block text-xs font-medium', className)} {...props} />
}

export function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: string
  hint?: ReactNode
  error?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      {/* Association implicite : le champ est enveloppé par le libellé, ce qui lui donne un nom
          accessible sans imposer un `id` à chacun des appelants.
          Indication et erreur partagent la ligne du libellé : même information, une ligne de
          moins par champ — ce qui compte dès qu'une vue aligne une barre de filtres.
          Le contrôle est poussé en bas de la cellule : sur une même rangée de grille, une
          indication qui se replie sur deux lignes ne décale plus la saisie voisine. */}
      <label className="flex flex-1 flex-col">
        <span className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2">
          <span className="text-ink-muted text-xs font-medium">{label}</span>
          {error ? (
            <span className="text-danger text-xs">{error}</span>
          ) : hint ? (
            <span className="text-ink-faint text-xs">{hint}</span>
          ) : null}
        </span>
        <span className="mt-auto block">{children}</span>
      </label>
    </div>
  )
}

/**
 * Groupe de champs d'un formulaire, avec un intitulé de rang inférieur au titre de la modale.
 * Un formulaire de dix champs se lit comme trois ensembles courts au lieu d'une pile : l'œil
 * trouve « où se règle la sévérité » sans relire chaque libellé.
 */
export function FormSection({
  title,
  action,
  className,
  children,
}: {
  title: ReactNode
  /** Contrôle rattaché au groupe — un interrupteur d'activation, par exemple. */
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section className={cn('min-w-0', className)}>
      <div className="border-border-subtle mb-3 flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b pb-1.5">
        <h3 className="text-ink-faint text-[11px] font-semibold tracking-wider uppercase">
          {title}
        </h3>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

/**
 * Groupe de cases à cocher. La légende est dessinée comme un libellé de champ, et les cases se
 * répartissent en colonnes : deux options tiennent alors sur une ligne au lieu d'une pile.
 */
export function Fieldset({
  legend,
  hint,
  columns = 2,
  className,
  children,
}: {
  legend: ReactNode
  hint?: ReactNode
  columns?: 1 | 2 | 3
  className?: string
  children: ReactNode
}) {
  return (
    <fieldset className={cn('min-w-0', className)}>
      <legend className="mb-0.5 flex w-full flex-wrap items-baseline justify-between gap-x-2">
        <span className="text-ink-muted text-xs font-medium">{legend}</span>
        {hint && <span className="text-ink-faint text-xs">{hint}</span>}
      </legend>
      <div
        className={cn(
          'grid gap-x-5',
          columns === 2 && 'sm:grid-cols-2',
          columns === 3 && 'sm:grid-cols-3',
        )}
      >
        {children}
      </div>
    </fieldset>
  )
}

/**
 * Case à cocher. La hauteur minimale sert de cible de clic : deux cases empilées ne se touchent
 * plus, et le libellé entier reste cliquable. L'indication éventuelle suit le libellé sur la
 * même ligne plutôt que de s'empiler dessous — une case, une ligne.
 */
export function Checkbox({
  label,
  hint,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode }) {
  return (
    <label
      className={cn(
        'text-ink flex min-h-8 items-center gap-2.5 text-sm select-none',
        props.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        className,
      )}
    >
      {/* `accent-brand` teinte la case native aux couleurs de l'application, dans les deux
          thèmes, sans avoir à redessiner un contrôle. */}
      <input
        type="checkbox"
        {...props}
        className="accent-brand border-border-strong size-4 shrink-0 rounded"
      />
      <span className="min-w-0">
        {label}
        {hint && <span className="text-ink-faint ml-1.5 text-xs">{hint}</span>}
      </span>
    </label>
  )
}

/**
 * Sélection multiple : même bulle que la liste déroulante, avec des cases. Le déclencheur
 * annonce la sélection en clair — « 3 instances » plutôt qu'une énumération illisible.
 */
export function MultiSelect({
  values,
  options,
  onChange,
  label,
  unit,
  unitPlural,
  className,
  disabled,
}: {
  values: string[]
  options: { value: string; label: string }[]
  onChange: (values: string[]) => void
  label: string
  /** Nom de ce qui est sélectionné, au singulier : « instance », « catégorie »… */
  unit?: string
  /** Pluriel, quand un `s` ne suffit pas. */
  unitPlural?: string
  className?: string
  disabled?: boolean
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)

  const selected = options.filter((option) => values.includes(option.value))
  const singular = unit ?? t('common.item')
  // Le cas vide évite de nommer l'unité : « Aucune élément » guettait la moindre unité
  // masculine, et le pluriel anglais ne se forme pas toujours par un « s ».
  const summary =
    selected.length === 0
      ? t('multiSelect.empty')
      : selected.length === 1
        ? selected[0].label
        : t('multiSelect.count', {
            count: selected.length,
            unit: unitPlural ?? `${singular}s`,
          })

  const toggle = (value: string) => {
    onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value])
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={cn(controlStyles, 'flex h-9 items-center justify-between gap-2 text-left', className)}
      >
        <span className={cn('truncate', selected.length > 0 ? 'text-ink' : 'text-ink-faint')}>
          {summary}
        </span>
        <ChevronDown className="text-ink-faint size-3.5 shrink-0" aria-hidden />
      </button>

      <Bubble anchor={trigger} open={open} onClose={() => setOpen(false)} width="anchor" role="listbox" label={label}>
        {options.length > 1 && (
          <>
            <BubbleItem
              onSelect={() =>
                onChange(
                  values.length === options.length ? [] : options.map((option) => option.value),
                )
              }
            >
              <span className="text-ink-faint text-xs">
                {values.length === options.length ? t('common.clearAll') : t('common.selectAll')}
              </span>
            </BubbleItem>
            <div className="border-border-subtle my-1 border-t" />
          </>
        )}

        {options.map((option) => (
          <BubbleItem
            key={option.value}
            role="option"
            selected={values.includes(option.value)}
            onSelect={() => toggle(option.value)}
          >
            <Check
              className={cn('size-3.5 shrink-0', values.includes(option.value) ? 'opacity-100' : 'opacity-0')}
              aria-hidden
            />
            <span className="truncate">{option.label}</span>
          </BubbleItem>
        ))}
      </Bubble>
    </>
  )
}

/* ------------------------------------------------------------------ Surfaces */

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // min-w-0 : sans cela, un enfant large (tableau, texte long) élargit la carte au-delà
        // de sa colonne de grille et fait déborder la page entière.
        'bg-surface border-border-subtle shadow-card min-w-0 rounded-[var(--radius-card)] border',
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    // Le descriptif suit le titre sur la même ligne et ne passe à la ligne que s'il manque de
    // place : rien n'est perdu, et l'en-tête coûte une ligne au lieu de deux.
    <div className="border-border-subtle flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b px-5 py-3">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5">
        <h2 className="text-ink text-sm font-semibold">{title}</h2>
        {description && <p className="text-ink-muted text-xs">{description}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  )
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)} {...props} />
}

/**
 * Conteneur de tableau à défilement horizontal maîtrisé. Le tableau garde une largeur
 * minimale lisible et c'est ce conteneur qui défile, jamais la page.
 */
export function TableScroll({ children, minWidth = 720 }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="w-full overflow-x-auto overscroll-x-contain">
      <div style={{ minWidth }}>{children}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ Signalétique */

const badgeStyles = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'bg-surface-sunken text-ink-muted',
        brand: 'bg-brand-subtle text-brand',
        success: 'bg-success/15 text-success',
        warning: 'bg-warning/20 text-warning',
        danger: 'bg-danger-subtle text-danger',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export function Badge({
  className,
  tone,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeStyles>) {
  return <span className={cn(badgeStyles({ tone }), className)} {...props} />
}

const SEVERITY_TONE: Record<string, VariantProps<typeof badgeStyles>['tone']> = {
  critical: 'danger',
  warning: 'warning',
  info: 'brand',
}

export function SeverityBadge({ severity }: { severity: string }) {
  // Le libellé vient du catalogue partagé : une sévérité s'écrit de la même façon dans un
  // badge, un filtre ou une ligne d'historique, et suit la langue choisie.
  return <Badge tone={SEVERITY_TONE[severity] ?? 'neutral'}>{severityLabel(severity)}</Badge>
}

const DOT_TONES: Record<string, string> = {
  critical: 'bg-danger',
  warning: 'bg-warning',
  info: 'bg-brand',
  success: 'bg-success',
  neutral: 'bg-ink-faint',
}

export function Dot({ tone }: { tone: string }) {
  return <span aria-hidden className={cn('size-2 shrink-0 rounded-full', DOT_TONES[tone] ?? DOT_TONES.neutral)} />
}

/* ------------------------------------------------------------------ États */

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('text-ink-faint size-4 animate-spin', className)} aria-hidden />
}

export function LoadingBlock({ label }: { label?: string }) {
  const t = useT()

  return (
    <div className="text-ink-muted flex items-center justify-center gap-2 py-16 text-sm">
      <Spinner className="size-5" />
      {label ?? t('common.loading')}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    // Assez d'air pour que l'état vide se distingue d'un contenu manquant, pas au point de
    // repousser hors de l'écran ce qui suit la carte.
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="text-ink-faint mb-2">{icon}</div>}
      <p className="text-ink text-sm font-medium">{title}</p>
      {description && (
        <div className="text-ink-muted mt-1 max-w-md text-xs leading-relaxed">{description}</div>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

const noticeStyles = cva('rounded-[var(--radius-card)] border px-4 py-3 text-sm', {
  variants: {
    tone: {
      info: 'bg-brand-subtle border-brand/20 text-ink',
      success: 'bg-success-subtle border-success/30 text-ink',
      warning: 'bg-warning-subtle border-warning/40 text-ink',
      danger: 'bg-danger-subtle border-danger/30 text-danger',
    },
  },
  defaultVariants: { tone: 'danger' },
})

export function Notice({
  tone,
  title,
  children,
  onDismiss,
  className,
}: VariantProps<typeof noticeStyles> & {
  title?: ReactNode
  children?: ReactNode
  onDismiss?: () => void
  className?: string
}) {
  const t = useT()

  return (
    <div className={cn(noticeStyles({ tone }), 'flex items-start gap-3', className)}>
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'text-sm')}>{children}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('common.dismiss')}
          className="text-ink-faint hover:text-ink shrink-0"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ Modale */

/**
 * Largeurs de modale. Le contenu commande : une confirmation d'une phrase n'a pas besoin de la
 * largeur d'un formulaire à deux colonnes, et un formulaire à deux colonnes n'a rien à faire
 * dans une colonne de 512 px où chaque champ tombe l'un sous l'autre.
 */
const MODAL_WIDTHS = {
  /** Confirmation, message court, un champ. */
  sm: 'sm:max-w-md',
  /** Formulaire simple, une colonne. */
  md: 'sm:max-w-xl',
  /** Formulaire à deux colonnes, listes côte à côte. */
  lg: 'sm:max-w-3xl',
  /** Plan de requête, tableau : presque toute la fenêtre. */
  full: 'sm:h-[94dvh] sm:max-w-[1600px]',
} as const

export type ModalSize = keyof typeof MODAL_WIDTHS

export function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  size = 'md',
  wide = false,
}: {
  title: ReactNode
  /** Contexte de la modale, sur la ligne sous le titre : évite d'ouvrir le corps par un pavé. */
  description?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: ModalSize
  /** Forme historique de `size="full"`, conservée pour les vues déjà écrites. */
  wide?: boolean
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const t = useT()
  const titleId = useId()
  const resolved: ModalSize = wide ? 'full' : size

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div
        className={cn(
          'bg-surface shadow-popover flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[var(--radius-card)] sm:rounded-[var(--radius-card)]',
          resolved === 'full' ? MODAL_WIDTHS.full : cn('sm:max-h-[88dvh]', MODAL_WIDTHS[resolved]),
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {/* Le titre et le bouton de fermeture partagent une ligne, centrés l'un sur l'autre :
            le titre est tronqué plutôt que de se replier sous la croix, et il reste lisible en
            entier au survol. Le descriptif éventuel s'aligne dessous, dans la même colonne. */}
        <div className="border-border-subtle flex shrink-0 items-center gap-3 border-b px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              className="text-ink truncate text-base leading-6 font-semibold"
              title={typeof title === 'string' ? title : undefined}
            >
              {title}
            </h2>
            {description && (
              <p className="text-ink-muted mt-0.5 text-xs leading-snug">{description}</p>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label={t('common.close')}
            className="-mr-1.5 shrink-0"
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>

        {/* min-h-0 : indispensable pour que la zone défilante se limite à la hauteur restante. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>

        {footer && (
          <div className="border-border-subtle bg-surface-sunken flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Code */

export function CodeBlock({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <pre
      className={cn(
        'bg-surface-sunken border-border-subtle text-ink overflow-x-auto rounded-[var(--radius-control)] border px-3 py-2 font-mono text-xs leading-relaxed',
        className,
      )}
    >
      <code>{children}</code>
    </pre>
  )
}
