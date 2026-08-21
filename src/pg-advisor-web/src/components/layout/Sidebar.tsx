import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { navigation, type NavLeaf, type NavSection } from './navigation'
import type { ActiveFindings } from './useActiveFindings'
import { useAuth } from '@/app/useAuth'
import { Badge } from '@/components/ui/primitives'
import { useT, useTc } from '@/lib/i18n'
import type { PluralTranslator, Translator } from '@/lib/i18n'
import { cn } from '@/lib/utils'

interface SidebarProps {
  collapsed: boolean
  /** Diagnostics actifs, comptés une fois par la coquille et affichés en pastille. */
  findings?: ActiveFindings | null
  /** Ferme le tiroir après navigation sur mobile. */
  onNavigate?: () => void
}

/**
 * Colonne de navigation rétractable, à sous-menus déroulants. En mode réduit les libellés
 * disparaissent au profit des icônes seules, et les sections à sous-menu passent en bulle.
 */
export function Sidebar({ collapsed, findings, onNavigate }: SidebarProps) {
  const location = useLocation()
  const { isAdmin } = useAuth()
  const t = useT()
  const tc = useTc()

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
                findings={findings ?? null}
                t={t}
                tc={tc}
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
  findings,
  currentPath,
  onNavigate,
  t,
  tc,
}: {
  section: NavSection
  collapsed: boolean
  findings: ActiveFindings | null
  currentPath: string
  onNavigate?: () => void
  t: Translator
  tc: PluralTranslator
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
        findings={findings}
        onNavigate={onNavigate}
        t={t}
        tc={tc}
      />
    )
  }

  // Section repliée : le décompte de ses entrées remonte sur son titre. Sans cela, replier
  // « Supervision » ferait disparaître le nombre de diagnostics en attente — replier un menu
  // range des liens, cela n'éteint pas ce qu'ils annoncent.
  const rolledUp = open ? null : rollUp(children, findings)

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
        {rolledUp && <CountBadge counts={rolledUp} tc={tc} />}
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
                <span className="flex-1 truncate">{t(child.labelKey)}</span>
                <LeafBadge leaf={child} findings={findings} tc={tc} />
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
  findings,
  onNavigate,
  t,
  tc,
}: {
  section: NavSection
  entries: NavLeaf[]
  containsActive: boolean
  findings: ActiveFindings | null
  onNavigate?: () => void
  t: Translator
  tc: PluralTranslator
}) {
  const anchor = useRef<HTMLDivElement>(null)
  const [origin, setOrigin] = useState<{ top: number; left: number } | null>(null)

  const open = useCallback(() => {
    const rect = anchor.current?.getBoundingClientRect()
    if (rect) setOrigin({ top: rect.top, left: rect.right })
  }, [])

  const close = useCallback(() => setOrigin(null), [])
  const rolledUp = rollUp(entries, findings)

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
        title={rolledUp ? `${t(section.labelKey)} — ${countLabel(rolledUp, tc)}` : t(section.labelKey)}
        className={cn(itemClass(containsActive, true), 'relative w-full')}
      >
        <section.icon className="size-4 shrink-0" aria-hidden />
        <span className="sr-only">
          {rolledUp ? `${t(section.labelKey)} — ${countLabel(rolledUp, tc)}` : t(section.labelKey)}
        </span>
        {rolledUp && <CountDot counts={rolledUp} />}
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
                    <span className="flex-1 truncate">{t(entry.labelKey)}</span>
                    <LeafBadge leaf={entry} findings={findings} tc={tc} />
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

/**
 * Pastille de décompte.
 *
 * Sa teinte suit la sévérité la plus haute présente — le violet de marque est réservé à ce avec
 * quoi on interagit, et ne dit jamais un état. La couleur ne porte rien seule : le libellé
 * complet reste lisible au survol et aux lecteurs d'écran.
 */
function CountBadge({ counts, tc }: { counts: ActiveFindings; tc: PluralTranslator }) {
  const label = countLabel(counts, tc)

  return (
    <Badge
      tone={toneFor(counts)}
      title={label}
      className="shrink-0 px-1.5 py-0 text-micro leading-4 tabular-nums"
    >
      <span aria-hidden>{counts.total > 99 ? '99+' : counts.total}</span>
      <span className="sr-only">{label}</span>
    </Badge>
  )
}

/**
 * Même signal, en colonne réduite : un point et non un nombre.
 *
 * Le rail fait 64 px : un décompte à trois chiffres y recouvrait l'icône, et la section n'était
 * plus reconnaissable. Le point dit qu'il y a quelque chose ; le nombre reste dans l'infobulle
 * et dans la colonne dépliée, où il a la place d'être lu.
 */
function CountDot({ counts }: { counts: ActiveFindings }) {
  return (
    <span
      aria-hidden
      className={cn(
        // `ring` de la couleur du fond : posé au bord de l'icône, le point s'en détache.
        'ring-surface absolute top-1 right-1.5 size-2 rounded-full ring-2',
        DOT_TONES[toneFor(counts)],
      )}
    />
  )
}

const DOT_TONES: Record<string, string> = {
  danger: 'bg-danger',
  warning: 'bg-warning',
  neutral: 'bg-ink-faint',
}

/** Le ton suit la sévérité la plus haute présente. */
function toneFor(counts: ActiveFindings): 'danger' | 'warning' | 'neutral' {
  if (counts.critical > 0) return 'danger'
  return counts.warning > 0 ? 'warning' : 'neutral'
}

function LeafBadge({
  leaf,
  findings,
  tc,
}: {
  leaf: NavLeaf
  findings: ActiveFindings | null
  tc: PluralTranslator
}) {
  const counts = countsFor(leaf, findings)
  return counts ? <CountBadge counts={counts} tc={tc} /> : null
}

/**
 * Décompte porté par une entrée, s'il y en a un et qu'il vaut la peine d'être montré. À zéro,
 * rien : un « 0 » permanent occuperait la navigation pour dire qu'il ne se passe rien.
 */
function countsFor(leaf: NavLeaf, findings: ActiveFindings | null): ActiveFindings | null {
  if (leaf.count !== 'activeFindings') return null
  return findings && findings.total > 0 ? findings : null
}

/** Somme des décomptes des entrées d'une section, pour son titre replié. */
function rollUp(entries: NavLeaf[], findings: ActiveFindings | null): ActiveFindings | null {
  const counted = entries
    .map((entry) => countsFor(entry, findings))
    .filter((counts): counts is ActiveFindings => counts !== null)

  if (counted.length === 0) return null

  return counted.reduce((sum, counts) => ({
    total: sum.total + counts.total,
    critical: sum.critical + counts.critical,
    warning: sum.warning + counts.warning,
  }))
}

function countLabel(counts: ActiveFindings, tc: PluralTranslator): string {
  const active = tc('nav.activeFindings', counts.total)
  return counts.critical > 0 ? `${active} · ${tc('dashboard.criticalCount', counts.critical)}` : active
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
