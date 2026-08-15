import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { navigation, type NavLeaf, type NavSection } from './navigation'
import { useAuth } from '@/app/AuthContext'
import { useT } from '@/lib/i18n'
import type { Translator } from '@/lib/i18n'
import { cn } from '@/lib/utils'

interface SidebarProps {
  collapsed: boolean
  /** Ferme le tiroir après navigation sur mobile. */
  onNavigate?: () => void
}

/**
 * Colonne de navigation rétractable, à sous-menus déroulants. En mode réduit les libellés
 * disparaissent au profit des icônes seules, et les sections à sous-menu passent en bulle.
 */
export function Sidebar({ collapsed, onNavigate }: SidebarProps) {
  const location = useLocation()
  const { isAdmin } = useAuth()
  const t = useT()

  const sections = navigation
    .map((section) => ({
      ...section,
      children: section.children?.filter((child) => !child.adminOnly || isAdmin),
    }))
    .filter((section) => section.to || (section.children && section.children.length > 0))

  return (
    <nav
      aria-label={t('nav.main')}
      className={cn(
        'bg-surface border-border-subtle flex h-full flex-col border-r transition-[width] duration-200',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      <div className="flex h-14 shrink-0 items-center gap-2 px-3">
        <div className="bg-brand text-brand-ink grid size-8 shrink-0 place-items-center rounded-lg text-body font-bold">
          pg
        </div>
        {!collapsed && (
          <span className="text-ink truncate text-body font-semibold tracking-tight">
            PostgreSQL Advisor
          </span>
        )}
      </div>

      <div className="scrollbar-none flex-1 overflow-y-auto px-2 pb-4">
        <ul className="space-y-0.5">
          {sections.map((section) => (
            <li key={section.labelKey}>
              <SidebarSection
                section={section}
                collapsed={collapsed}
                t={t}
                currentPath={location.pathname}
                onNavigate={onNavigate}
              />
            </li>
          ))}
        </ul>
      </div>
    </nav>
  )
}

function SidebarSection({
  section,
  collapsed,
  currentPath,
  onNavigate,
  t,
}: {
  section: NavSection
  collapsed: boolean
  currentPath: string
  onNavigate?: () => void
  t: Translator
}) {
  const children = section.children ?? []
  const hasChildren = children.length > 0
  const containsActive = children.some((child) => isActivePath(currentPath, child.to))

  // Ouvert par défaut lorsque la route courante est dans la section : après un rechargement ou
  // un lien direct, l'utilisateur voit immédiatement où il se trouve.
  const [open, setOpen] = useState(containsActive)
  const panelId = useId()

  useEffect(() => {
    if (containsActive) setOpen(true)
  }, [containsActive])

  if (!hasChildren) {
    const target = section.to ?? '/'
    return (
      <NavLink
        to={target}
        end={section.end}
        onClick={onNavigate}
        title={collapsed ? t(section.labelKey) : undefined}
        className={({ isActive }) => itemClass(isActive, collapsed)}
      >
        <section.icon className="size-4 shrink-0" aria-hidden />
        {!collapsed && <span className="truncate">{t(section.labelKey)}</span>}
      </NavLink>
    )
  }

  if (collapsed) {
    return (
      <CollapsedSection
        section={section}
        entries={children}
        containsActive={containsActive}
        onNavigate={onNavigate}
        t={t}
      />
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          'flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-2 text-body transition-colors',
          containsActive ? 'text-ink font-medium' : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
        )}
      >
        <section.icon className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 truncate text-left">{t(section.labelKey)}</span>
        <ChevronDown className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>

      {open && (
        <ul id={panelId} className="border-border-subtle mt-0.5 ml-4 space-y-0.5 border-l pl-2">
          {children.map((child) => (
            <li key={child.to}>
              <NavLink
                to={child.to}
                onClick={onNavigate}
                className={({ isActive }) => itemClass(isActive, false, true)}
              >
                {child.icon && <child.icon className="size-3.5 shrink-0" aria-hidden />}
                <span className="truncate">{t(child.labelKey)}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Section à sous-menus, colonne réduite : le survol ou le focus clavier fait apparaître une
 * bulle. Elle est positionnée en `fixed` d'après le rectangle de l'entrée, car la colonne
 * défile et une bulle posée à l'intérieur y serait rognée.
 */
function CollapsedSection({
  section,
  entries,
  containsActive,
  onNavigate,
  t,
}: {
  section: NavSection
  entries: NavLeaf[]
  containsActive: boolean
  onNavigate?: () => void
  t: Translator
}) {
  const anchor = useRef<HTMLDivElement>(null)
  const [origin, setOrigin] = useState<{ top: number; left: number } | null>(null)

  const open = useCallback(() => {
    const rect = anchor.current?.getBoundingClientRect()
    if (rect) setOrigin({ top: rect.top, left: rect.right })
  }, [])

  const close = useCallback(() => setOrigin(null), [])

  useEffect(() => {
    if (!origin) return

    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [origin, close])

  return (
    <div
      ref={anchor}
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') close()
      }}
    >
      <button
        type="button"
        onClick={() => (origin ? close() : open())}
        aria-expanded={origin !== null}
        title={t(section.labelKey)}
        className={cn(itemClass(containsActive, true), 'w-full')}
      >
        <section.icon className="size-4 shrink-0" aria-hidden />
        <span className="sr-only">{t(section.labelKey)}</span>
      </button>

      {origin && (
        <div
          // `pl-2` tient lieu de pont : le curseur traverse l'espace entre l'entrée et la bulle
          // sans quitter la zone survolée, qui sinon se refermerait sous lui.
          className="fixed z-50 pl-2"
          style={{ top: origin.top, left: origin.left }}
          role="group"
          aria-label={t(section.labelKey)}
        >
          <div className="bg-surface border-border-subtle shadow-popover min-w-56 rounded-[var(--radius-card)] border p-2">
            <p className="text-ink-muted px-2 pb-2 pt-1 text-meta font-semibold">{t(section.labelKey)}</p>
            <ul className="space-y-0.5">
              {entries.map((entry) => (
                <li key={entry.to}>
                  <NavLink
                    to={entry.to}
                    onClick={() => {
                      close()
                      onNavigate?.()
                    }}
                    className={({ isActive }) => itemClass(isActive, false, true)}
                  >
                    {entry.icon && <entry.icon className="size-3.5 shrink-0" aria-hidden />}
                    <span className="truncate">{t(entry.labelKey)}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

function itemClass(active: boolean, collapsed: boolean, nested = false) {
  return cn(
    'flex items-center gap-2 rounded-[var(--radius-control)] transition-colors',
    nested ? 'px-2 py-1.5 text-body' : 'px-2 py-2 text-body',
    collapsed && 'justify-center',
    active ? 'bg-brand-subtle text-brand font-medium' : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
  )
}

function isActivePath(currentPath: string, target: string) {
  if (target === '/') return currentPath === '/'
  return currentPath === target || currentPath.startsWith(`${target}/`)
}
