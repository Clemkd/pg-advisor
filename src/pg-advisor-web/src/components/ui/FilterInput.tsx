import { useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Bubble, BubbleItem } from '@/components/ui/Bubble'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export type FilterOperator = '>=' | '<=' | '='

const OPERATORS: { value: FilterOperator; symbol: string; labelKey: string }[] = [
  { value: '>=', symbol: '≥', labelKey: 'filter.operator.gte' },
  { value: '<=', symbol: '≤', labelKey: 'filter.operator.lte' },
  { value: '=', symbol: '=', labelKey: 'filter.operator.eq' },
]

/**
 * Filtre de colonne : une seule zone de saisie. Pour une valeur numérique, l'opérateur se
 * choisit dans un menu discret posé à l'intérieur du champ, à gauche, et l'unité reste
 * affichée à droite — la condition se lit alors d'un trait : « ≥ 500 ms ».
 */
export function FilterInput({
  value,
  onValueChange,
  operator,
  onOperatorChange,
  unit,
  placeholder,
  label,
  className,
}: {
  value: string
  onValueChange: (value: string) => void
  /** Absent : le champ est un simple filtre texte. */
  operator?: FilterOperator
  onOperatorChange?: (operator: FilterOperator) => void
  unit?: string
  placeholder?: string
  label: string
  className?: string
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const numeric = operator !== undefined && onOperatorChange !== undefined

  const current = OPERATORS.find((item) => item.value === operator) ?? OPERATORS[0]

  return (
    <div
      ref={container}
      className={cn(
        'bg-surface border-border-strong focus-within:border-brand relative flex h-7 items-center rounded-[var(--radius-control)] border',
        className,
      )}
    >
      {numeric && (
        <>
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={`${t('filter.operatorFor', { label })} : ${t(current.labelKey)}`}
            title={t(current.labelKey)}
            className="text-ink-muted hover:text-ink hover:bg-surface-sunken flex h-full shrink-0 items-center gap-0.5 rounded-l-[calc(var(--radius-control)-1px)] pl-1.5 pr-1 text-meta font-semibold"
          >
            {current.symbol}
            <ChevronDown className="size-2.5 opacity-60" aria-hidden />
          </button>

          {/* Même bulle que les autres menus : sinon celle-ci se ferait rogner par l'en-tête
              défilant du tableau qui l'héberge. */}
          <Bubble
            anchor={container}
            open={open}
            onClose={() => setOpen(false)}
            width={176}
            label={t('filter.operatorFor', { label })}
          >
            {OPERATORS.map((item) => (
              <BubbleItem
                key={item.value}
                selected={item.value === operator}
                onSelect={() => {
                  onOperatorChange?.(item.value)
                  setOpen(false)
                }}
              >
                <span className="w-3 font-semibold">{item.symbol}</span>
                <span className="flex-1 truncate">{t(item.labelKey)}</span>
                {item.value === operator && <Check className="size-3 shrink-0" aria-hidden />}
              </BubbleItem>
            ))}
          </Bubble>
        </>
      )}

      <input
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        aria-label={t('filter.fieldFor', { label })}
        inputMode={numeric ? 'decimal' : undefined}
        className={cn(
          'text-ink placeholder:text-ink-faint h-full w-full min-w-0 bg-transparent px-1.5 text-meta focus:outline-none',
          numeric && 'text-right tabular-nums',
        )}
      />

      {unit && (
        <span className="text-ink-muted shrink-0 pr-2 text-micro leading-none" aria-hidden>
          {unit}
        </span>
      )}
    </div>
  )
}
