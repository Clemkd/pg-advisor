import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

/** Espace entre l'élément déclencheur et la bulle. */
const GAP = 4

/** Marge minimale conservée avec les bords de la fenêtre. */
const EDGE = 8

/**
 * Bulle flottante ancrée à un élément : menus, listes d'options, sous-menus.
 *
 * Montée dans `document.body` et positionnée en `fixed`, pour deux raisons qui reviennent
 * partout dans l'application : posée dans le flux, elle passe sous les éléments qui ouvrent
 * leur propre contexte d'empilement — une ligne de liste virtualisée, un en-tête collant — et
 * se fait rogner par le premier conteneur défilant rencontré.
 */
export function Bubble({
  anchor,
  open,
  onClose,
  align = 'start',
  width,
  role = 'menu',
  label,
  className,
  children,
}: {
  anchor: RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  /** Bord de la bulle aligné sur le bord correspondant du déclencheur. */
  align?: 'start' | 'end'
  /** Largeur imposée, ou « anchor » pour reprendre celle du déclencheur. */
  width?: number | 'anchor'
  role?: 'menu' | 'listbox' | 'group'
  label?: string
  className?: string
  children: ReactNode
}) {
  const bubble = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number; width?: number } | null>(
    null,
  )

  const place = useCallback(() => {
    const element = anchor.current
    if (!element) return

    const rect = element.getBoundingClientRect()
    const height = bubble.current?.offsetHeight ?? 0
    const measured = bubble.current?.offsetWidth ?? 0
    const finalWidth = width === 'anchor' ? rect.width : (width ?? measured)
    const room = window.innerHeight - rect.bottom

    // Ouverture vers le haut quand le bas de la fenêtre est trop court : une bulle ouverte
    // depuis la dernière ligne d'une liste doit rester entièrement visible.
    const upwards = height > 0 && room < height + GAP && rect.top > room
    const left = align === 'end' ? rect.right - finalWidth : rect.left

    setPosition({
      top: upwards ? Math.max(EDGE, rect.top - height - GAP) : rect.bottom + GAP,
      left: Math.max(EDGE, Math.min(left, window.innerWidth - finalWidth - EDGE)),
      width: width === undefined ? undefined : finalWidth,
    })
  }, [anchor, align, width])

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    // La bulle est déjà montée quand cet effet s'exécute : sa taille est mesurable, et le
    // placement est calculé avant le premier affichage.
    place()
  }, [open, place])

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!anchor.current?.contains(target) && !bubble.current?.contains(target)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    // Capture : le défilement d'une liste interne ne remonte pas jusqu'à la fenêtre.
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)

    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, place, onClose, anchor])

  if (!open) return null

  return createPortal(
    <div
      ref={bubble}
      role={role}
      aria-label={label}
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        width: position?.width,
        // Invisible tant que la place n'est pas calculée : évite le saut du premier affichage.
        visibility: position ? 'visible' : 'hidden',
      }}
      className={cn(
        'bg-surface border-border-subtle shadow-popover fixed z-50 max-h-[60dvh] overflow-auto rounded-[var(--radius-card)] border p-1',
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  )
}

/** Entrée d'une bulle : même dessin pour un menu, une option ou un sous-menu. */
export function BubbleItem({
  selected,
  disabled,
  onSelect,
  role = 'menuitem',
  id,
  children,
}: {
  selected?: boolean
  disabled?: boolean
  onSelect: () => void
  role?: 'menuitem' | 'option'
  id?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role={role}
      id={id}
      aria-selected={role === 'option' ? selected : undefined}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left text-[13px] transition-colors disabled:pointer-events-none disabled:opacity-50',
        selected
          ? 'bg-brand-subtle text-brand font-medium'
          : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}
