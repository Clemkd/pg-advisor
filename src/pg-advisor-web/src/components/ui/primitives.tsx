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
  TableHTMLAttributes,
  TdHTMLAttributes,
  TextareaHTMLAttributes,
  ThHTMLAttributes,
} from 'react'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { cva, type VariantProps } from 'class-variance-authority'
import { Check, ChevronDown, ClipboardCheck, Copy, Loader2, X } from 'lucide-react'
import { Bubble, BubbleItem } from '@/components/ui/Bubble'
import { formatDateTime, formatRelative, severityLabel } from '@/lib/format'
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
      /*
       * Trois hauteurs, alignées sur les champs de saisie.
       *
       * `md` est le défaut et vaut 36 px, comme `Input`, `Select` et `MultiSelect` : un bouton de
       * 32 px posé à côté d'un champ de 36 désalignait de 4 px toute barre associant les deux.
       * `sm` reste disponible pour les barres de filtres denses des vues de balayage, `lg` porte
       * l'action principale des formulaires rares et les contextes tactiles.
       */
      size: {
        sm: 'h-[var(--control-sm)] px-3 text-body',
        md: 'h-[var(--control-md)] px-4 text-body',
        lg: 'h-[var(--control-lg)] px-5 text-body',
        icon: 'size-[var(--control-md)]',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
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
              <span className="text-ink block text-body font-medium">{option.label}</span>
              {option.description && (
                <span className="text-ink-muted mt-0.5 block text-meta">{option.description}</span>
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
  'bg-surface border-border-strong text-ink placeholder:text-ink-faint w-full rounded-[var(--radius-control)] border px-3 text-body focus:border-brand focus:outline-none disabled:opacity-60'

/** Hauteur commune à tous les contrôles de saisie, que `Toolbar` peut resserrer d'un cran. */
const controlHeight = 'h-[var(--control-md)]'

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input className={cn(controlStyles, controlHeight, className)} {...props} />
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
        className={cn(
          controlStyles,
          controlHeight,
          'flex items-center justify-between gap-2 text-left',
          className,
        )}
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
  return <label className={cn('text-ink-muted mb-1.5 block text-meta font-medium', className)} {...props} />
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
          <span className="text-ink-muted text-meta font-medium">{label}</span>
          {error ? (
            <span className="text-danger text-meta">{error}</span>
          ) : hint ? (
            <span className="text-ink-muted text-meta">{hint}</span>
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
        <h3 className="text-ink-muted text-micro font-semibold tracking-wider uppercase">
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
        <span className="text-ink-muted text-meta font-medium">{legend}</span>
        {hint && <span className="text-ink-muted text-meta">{hint}</span>}
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
        'text-ink flex min-h-8 items-center gap-2.5 text-body select-none',
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
        {hint && <span className="text-ink-muted ml-1.5 text-meta">{hint}</span>}
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
        className={cn(
          controlStyles,
          controlHeight,
          'flex items-center justify-between gap-2 text-left',
          className,
        )}
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
              <span className="text-ink-muted text-meta">
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
    // La gouttière est celle du corps — 16 px : l'en-tête était en retrait de 20 px et le corps de
    // 16, si bien qu'un titre et ce qu'il annonce ne s'alignaient pas verticalement.
    <div className="border-border-subtle flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
        <h2 className="text-ink text-section font-semibold">{title}</h2>
        {description && <p className="text-ink-muted text-meta">{description}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  )
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)} {...props} />
}

/**
 * Action d'en-tête de carte : « Voir tout », « Gérer ». Le même dessin partout, plutôt qu'un lien
 * rhabillé à chaque vue — cinq écritures différentes du même geste coexistaient.
 *
 * Une carte n'en porte qu'une : au-delà, c'est un `SplitButton`.
 */
export function CardAction({
  to,
  onClick,
  className,
  children,
}: {
  /** Destination interne. À défaut, l'action est un bouton. */
  to?: string
  onClick?: () => void
  className?: string
  children: ReactNode
}) {
  const styles = cn(
    'text-brand text-meta hover:text-brand-hover font-medium whitespace-nowrap hover:underline',
    className,
  )

  if (to) {
    return (
      <Link to={to} className={styles}>
        {children}
      </Link>
    )
  }

  return (
    <button type="button" onClick={onClick} className={styles}>
      {children}
    </button>
  )
}

/**
 * Barre d'outils dense : filtres et actions d'une vue de balayage ou d'étude.
 *
 * Resserre d'un cran la hauteur de tous les contrôles qu'elle contient, en redéfinissant la
 * variable qu'ils lisent. Aucune vue n'a donc à passer `size="sm"` champ par champ, et un contrôle
 * ajouté plus tard suit la densité de la barre sans qu'on y pense.
 */
export function Toolbar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        '[--control-md:var(--control-sm)] flex flex-wrap items-center gap-2',
        className,
      )}
      {...props}
    />
  )
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
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-meta font-medium whitespace-nowrap',
  {
    variants: {
      /*
       * `brand` ne dit jamais un état : il est réservé à ce avec quoi on interagit. Un badge qui
       * annonce une information prend `info`, sans quoi il se lit comme un bouton.
       */
      tone: {
        neutral: 'bg-surface-sunken text-ink-muted',
        brand: 'bg-brand-subtle text-brand',
        info: 'bg-info-subtle text-info-strong',
        success: 'bg-success-subtle text-success-strong',
        warning: 'bg-warning-subtle text-warning-strong',
        danger: 'bg-danger-subtle text-danger-strong',
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

/*
 * Trois sévérités, trois poids visuels — et non trois teintes de même intensité.
 *
 * Une liste où critique, avertissement et information pèsent pareil oblige à lire les mots pour
 * trier, ce qu'un balayage quotidien cherche précisément à éviter. Le critique se voit de loin
 * (fond plein), l'avertissement à la lecture (fond atténué), l'information en la cherchant
 * (contour seul).
 */
const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-danger text-white',
  warning: 'bg-warning-subtle text-warning-strong',
  info: 'border border-border-strong text-ink-muted',
}

export function SeverityBadge({ severity, className }: { severity: string; className?: string }) {
  // Le libellé vient du catalogue partagé : une sévérité s'écrit de la même façon dans un
  // badge, un filtre ou une ligne d'historique, et suit la langue choisie. Le mot fait partie du
  // signal : la sévérité n'est jamais portée par la seule couleur.
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-meta font-medium whitespace-nowrap',
        SEVERITY_STYLES[severity] ?? 'bg-surface-sunken text-ink-muted',
        className,
      )}
    >
      {severityLabel(severity)}
    </span>
  )
}

const DOT_TONES: Record<string, string> = {
  critical: 'bg-danger',
  warning: 'bg-warning',
  info: 'bg-info',
  success: 'bg-success',
  fresh: 'bg-fresh',
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
    <div className="text-ink-muted flex items-center justify-center gap-2 py-16 text-body">
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
      <p className="text-ink text-body font-medium">{title}</p>
      {description && (
        <div className="text-ink-muted mt-1 max-w-md text-meta leading-relaxed">{description}</div>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

const noticeStyles = cva('rounded-[var(--radius-card)] border px-4 py-3 text-body', {
  variants: {
    tone: {
      info: 'bg-info-subtle border-info/25 text-ink',
      success: 'bg-success-subtle border-success/30 text-ink',
      warning: 'bg-warning-subtle border-warning/40 text-ink',
      danger: 'bg-danger-subtle border-danger/30 text-danger-strong',
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
        {children && <div className={cn(title && 'mt-0.5', 'text-body')}>{children}</div>}
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
  actions,
  onClose,
  children,
  footer,
  size = 'md',
  wide = false,
}: {
  title: ReactNode
  /** Contexte de la modale, sur la ligne sous le titre : évite d'ouvrir le corps par un pavé. */
  description?: ReactNode
  /**
   * Emplacement d'en-tête, entre le titre et la fermeture. Ce qui décrit le contenu de la
   * modale — provenance d'une mesure, compteurs d'ensemble, accès à un panneau — y tient sans
   * rien prendre au corps, dont la hauteur est le bien le plus rare d'une modale pleine page.
   */
  actions?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: ModalSize
  /** Forme historique de `size="full"`, conservée pour les vues déjà écrites. */
  wide?: boolean
}) {
  const panel = useRef<HTMLDivElement>(null)

  // La fermeture est lue au moment où elle sert. Les appelants passent couramment une fonction
  // écrite sur place, dont l'identité change à chaque rendu : mise en dépendance, elle relancerait
  // l'effet ci-dessous en boucle, et donc le placement du focus.
  const close = useRef(onClose)
  close.current = onClose

  /*
   * Piège de focus, focus initial et restitution.
   *
   * Sans cela, la tabulation quittait la modale dès le premier `Tab` et poursuivait dans la page
   * recouverte : au clavier, on parcourait un contenu masqué et inerte sans pouvoir revenir. En
   * sortant, le focus retourne à l'élément qui a ouvert la modale — sinon il repart du haut du
   * document et fait perdre la ligne où l'on travaillait.
   */
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null

    const focusable = () =>
      Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.offsetParent !== null)

    // Le premier élément atteignable dans l'ordre du document. L'action destructrice d'une
    // confirmation est en dernier, dans le pied : elle n'est jamais celle qui prend le focus.
    focusable()[0]?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close.current()
        return
      }
      if (event.key !== 'Tab') return

      const elements = focusable()
      if (elements.length === 0) return

      const first = elements[0]
      const last = elements[elements.length - 1]
      const active = document.activeElement

      if (event.shiftKey && (active === first || !panel.current?.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      opener?.focus?.()
    }
  }, [])

  const t = useT()
  const titleId = useId()
  const resolved: ModalSize = wide ? 'full' : size

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div
        ref={panel}
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
              className="text-ink text-section truncate font-semibold"
              title={typeof title === 'string' ? title : undefined}
            >
              {title}
            </h2>
            {description && (
              <p className="text-ink-muted mt-0.5 text-meta leading-snug">{description}</p>
            )}
          </div>
          {actions && (
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1">
              {actions}
            </div>
          )}
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

/* ------------------------------------------------------------------ Confirmation */

/**
 * Confirmation d'une action irréversible. Trois vues écrivaient la même modale à la main, avec
 * chacune son ordre de boutons.
 *
 * Un seul pas : une action qui mérite deux confirmations mérite surtout d'être annulable. Le
 * geste réversible — résoudre ou ignorer une recommandation — n'en demande aucune : la confirmer
 * serait un péage sur le travail quotidien.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
}: {
  title: ReactNode
  /** Ce que l'action emporte. À défaut, le caractère définitif est rappelé. */
  description?: ReactNode
  /** Porte le verbe : « Supprimer l'instance », jamais « OK ». */
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
}) {
  const t = useT()

  return (
    <Modal
      title={title}
      size="sm"
      onClose={onCancel}
      footer={
        <>
          {/* L'annulation d'abord : elle est à la fois le repli et le premier arrêt du focus. */}
          <Button onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-ink text-body">{description ?? t('confirm.irreversible')}</p>
    </Modal>
  )
}

/* ------------------------------------------------------------------ Temps réel */

/**
 * Écart depuis la dernière donnée reçue, réactualisé tout seul.
 *
 * Toute vue qui se met à jour sans intervention en porte un : devant un écran immobile, la
 * première question est « est-ce à jour ? », et une valeur figée n'y répond pas — elle ne dit même
 * pas si le flux est mort.
 */
export function LastUpdated({ at, className }: { at: string | null; className?: string }) {
  const t = useT()
  const [, redraw] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => redraw((count) => count + 1), 10_000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <span
      className={cn('text-ink-muted text-meta whitespace-nowrap', className)}
      title={formatDateTime(at)}
    >
      {t('live.updated', { when: formatRelative(at) })}
    </span>
  )
}

/**
 * Annonce ce qui vient d'arriver aux technologies d'assistance. Invisible à l'écran : le signal
 * visuel est porté par `useFresh`.
 *
 * Une interface qui se réécrit seule sans région live est muette pour un lecteur d'écran — c'était
 * le cas de l'application entière.
 */
export function LiveRegion({ message }: { message: string | null }) {
  return (
    <p role="status" aria-live="polite" className="sr-only">
      {message ?? ''}
    </p>
  )
}

/**
 * Liseré de progression posé en tête d'un bloc qui se recharge sans se vider.
 *
 * Remplacer une liste par un sablier à chaque événement fait clignoter un écran qu'on regarde
 * toute la journée, et décale la mise en page à chaque retour. Le contenu reste donc affiché, et
 * seul ce trait dit que quelque chose arrive.
 */
export function RefreshBar({ active }: { active: boolean }) {
  const t = useT()
  if (!active) return null

  return (
    <div
      className="bg-brand/15 h-0.5 w-full overflow-hidden"
      role="status"
      aria-label={t('live.refreshing')}
    >
      <div className="bg-brand h-full w-1/3 animate-[pg-sweep_1.1s_ease-in-out_infinite]" />
    </div>
  )
}

/** Substitut aux dimensions du contenu attendu : rien ne saute quand il arrive. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('bg-surface-sunken block animate-pulse rounded-[var(--radius-control)]', className)}
    />
  )
}

/* ------------------------------------------------------------------ Couples */

/**
 * Couple étiquette / valeur. L'étiquette est en `text-micro`, la valeur en `text-body` : une
 * mesure se lit plus gros que son nom, faute de quoi rien ne ressort d'une grille de mesures.
 */
export function KeyValue({
  label,
  children,
  className,
}: {
  label: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-ink-muted text-micro truncate font-semibold tracking-wider uppercase">
        {label}
      </dt>
      <dd className="text-ink text-body mt-0.5 truncate tabular-nums">{children}</dd>
    </div>
  )
}

/** Grille de couples. Les colonnes se réduisent avant que le texte ne se tronque. */
export function KeyValueGrid({
  columns = 4,
  className,
  children,
}: {
  columns?: 2 | 3 | 4
  className?: string
  children: ReactNode
}) {
  return (
    <dl
      className={cn(
        'grid grid-cols-2 gap-x-4 gap-y-3',
        columns === 3 && 'sm:grid-cols-3',
        columns === 4 && 'sm:grid-cols-4',
        className,
      )}
    >
      {children}
    </dl>
  )
}

/* ------------------------------------------------------------------ Onglets */

export interface TabItem {
  value: string
  label: string
  /** Décompte affiché en pastille. `null` quand il n'est pas encore connu. */
  count?: number | null
}

/**
 * Onglets de filtrage — les statuts d'une liste de recommandations, par exemple.
 *
 * Rôles ARIA véritables : les onglets étaient des boutons portant `aria-current="page"`, qui
 * annonce la page courante d'une navigation et non l'onglet sélectionné d'un groupe.
 *
 * La rangée ne se replie pas : en largeur réduite elle défile latéralement, ce qui la garde sur
 * une ligne au lieu de trois — sur une vue de balayage, trois lignes d'onglets valent un tiers de
 * l'écran utile.
 */
export function Tabs({
  items,
  value,
  onChange,
  label,
  className,
}: {
  items: TabItem[]
  value: string
  onChange: (value: string) => void
  label: string
  className?: string
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn('scrollbar-none -mb-px flex max-w-full items-center gap-1 overflow-x-auto', className)}
    >
      {items.map((item) => {
        const active = item.value === value

        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              'text-body flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 font-medium whitespace-nowrap transition-colors',
              active
                ? 'border-brand text-brand'
                : 'text-ink-muted hover:border-border-strong hover:text-ink border-transparent',
            )}
          >
            {item.label}
            {item.count !== null && item.count !== undefined && (
              <span
                className={cn(
                  'text-meta rounded-full px-1.5 py-0.5 tabular-nums',
                  active ? 'bg-brand-subtle text-brand' : 'bg-surface-sunken text-ink-muted',
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ Tableau */

export function Table({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full border-collapse text-body', className)} {...props} />
}

/** En-tête collant : le nom des colonnes reste lisible quand le corps défile. */
export function THead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn('bg-surface-sunken text-ink-muted sticky top-0 z-10', className)}
      {...props}
    />
  )
}

export function TBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-border-subtle divide-y', className)} {...props} />
}

export function Tr({
  selected,
  className,
  ...props
}: HTMLAttributes<HTMLTableRowElement> & { selected?: boolean }) {
  return (
    <tr
      aria-selected={selected}
      className={cn(
        'hover:bg-surface-sunken transition-colors',
        selected && 'bg-brand-subtle',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Cellule d'en-tête. `numeric` aligne à droite, comme la colonne qu'elle coiffe.
 *
 * Le tri se déclare par `sort` et `onSort` : la direction est portée par une icône **et** par
 * `aria-sort`, jamais par la seule flèche.
 */
export function Th({
  numeric,
  sort,
  onSort,
  className,
  children,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & {
  numeric?: boolean
  sort?: 'asc' | 'desc' | null
  onSort?: () => void
}) {
  const t = useT()
  const label = typeof children === 'string' ? children : ''

  return (
    <th
      scope="col"
      aria-sort={sort === 'asc' ? 'ascending' : sort === 'desc' ? 'descending' : undefined}
      className={cn(
        'text-micro px-3 py-2 font-semibold tracking-wider uppercase',
        numeric ? 'text-right' : 'text-left',
        className,
      )}
      {...props}
    >
      {onSort ? (
        <button
          type="button"
          onClick={onSort}
          aria-label={label ? t('table.sortBy', { label }) : undefined}
          className={cn(
            'hover:text-ink inline-flex items-center gap-1',
            numeric && 'flex-row-reverse',
            sort && 'text-ink',
          )}
        >
          {children}
          <ChevronDown
            className={cn(
              'size-3 transition-transform',
              sort === 'asc' && 'rotate-180',
              !sort && 'opacity-0',
            )}
            aria-hidden
          />
        </button>
      ) : (
        children
      )}
    </th>
  )
}

/**
 * Cellule. `numeric` aligne à droite et passe en chiffres tabulaires : sans quoi une colonne de
 * mesures ne s'aligne pas d'une ligne à l'autre et cesse d'être comparable d'un coup d'œil.
 */
export function Td({
  numeric,
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        'text-ink px-3 py-2 align-middle',
        numeric && 'text-right tabular-nums',
        className,
      )}
      {...props}
    />
  )
}

/* ------------------------------------------------------------------ Code */

export function CodeBlock({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <pre
      className={cn(
        'bg-surface-sunken border-border-subtle text-ink overflow-x-auto rounded-[var(--radius-control)] border px-3 py-2 font-mono text-meta leading-relaxed',
        className,
      )}
    >
      <code>{children}</code>
    </pre>
  )
}

/**
 * Copie vers le presse-papiers, avec accusé.
 *
 * L'application n'en comportait aucune, alors que l'Advisor ne corrige rien : tout ce qu'il
 * produit est une commande à exécuter ailleurs. Un diagnostic qu'il faut resaisir à la main n'est
 * pas exploitable.
 */
export function CopyButton({
  value,
  label,
  className,
}: {
  value: string
  /** Nom de ce qui est copié, pour l'intitulé accessible. */
  label?: string
  className?: string
}) {
  const t = useT()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  return (
    <Button
      variant="ghost"
      size="sm"
      className={className}
      aria-label={label ? `${t('common.copy')} — ${label}` : t('common.copy')}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(
          () => setCopied(true),
          () => undefined,
        )
      }}
    >
      {copied ? (
        <ClipboardCheck className="text-success size-3.5" aria-hidden />
      ) : (
        <Copy className="size-3.5" aria-hidden />
      )}
      <span className="text-meta">{copied ? t('common.copied') : t('common.copy')}</span>
    </Button>
  )
}

/**
 * Commande à exécuter ailleurs : le produit même de l'Advisor, qui n'agit jamais sur l'instance.
 * Toujours copiable, et annoncée par un intitulé pour qu'on sache ce qu'on s'apprête à lancer.
 */
export function CommandBlock({
  command,
  label,
  className,
}: {
  command: string
  label?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="mb-1 flex items-center justify-between gap-2">
        {label ? (
          <span className="text-ink-muted text-micro font-semibold tracking-wider uppercase">
            {label}
          </span>
        ) : (
          <span />
        )}
        <CopyButton value={command} label={typeof label === 'string' ? label : undefined} />
      </div>
      <CodeBlock className="whitespace-pre-wrap">{command}</CodeBlock>
    </div>
  )
}
