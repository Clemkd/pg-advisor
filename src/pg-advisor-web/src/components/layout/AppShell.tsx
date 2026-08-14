import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Languages, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Sun, X } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { Breadcrumbs } from './Breadcrumbs'
import { useAuth } from '@/app/AuthContext'
import { useEvents } from '@/app/EventsContext'
import { useTheme } from '@/app/ThemeContext'
import { Bubble, BubbleItem } from '@/components/ui/Bubble'
import { Button } from '@/components/ui/primitives'
import { LOCALES, LOCALE_LABELS, useLocale, useT } from '@/lib/i18n'
import { cn, initials } from '@/lib/utils'

const COLLAPSE_KEY = 'pg-advisor.sidebar.collapsed'

/** Coquille applicative : colonne rétractable, barre supérieure et zone de contenu. */
export function AppShell() {
  const { user, logout } = useAuth()
  const { connected } = useEvents()
  const { resolved, toggle } = useTheme()
  const t = useT()
  const location = useLocation()
  const navigate = useNavigate()

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === 'true')
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, String(collapsed))
  }, [collapsed])

  // Le tiroir mobile se referme à chaque navigation, sinon il masquerait la page atteinte.
  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!drawerOpen) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [drawerOpen])

  const themeLabel = resolved === 'dark' ? t('shell.theme.light') : t('shell.theme.dark')

  return (
    <div className="bg-canvas flex h-dvh overflow-hidden">
      <div className="hidden shrink-0 lg:block">
        <Sidebar collapsed={collapsed} />
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label={t('shell.closeMenu')}
            className="absolute inset-0 bg-black/50"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-64">
            <Sidebar collapsed={false} onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-surface/80 border-border-subtle flex h-14 shrink-0 items-center gap-2 border-b px-3 backdrop-blur sm:px-5">
          {/* Une seule place pour un seul rôle — ouvrir ou fermer la navigation — quelle que
              soit la largeur de l'écran. */}
          <button
            type="button"
            onClick={() => setDrawerOpen((value) => !value)}
            className="text-ink-muted hover:bg-surface-sunken hover:text-ink grid size-9 shrink-0 place-items-center rounded-[var(--radius-control)] lg:hidden"
            aria-label={drawerOpen ? t('shell.closeMenu') : t('shell.openMenu')}
            aria-expanded={drawerOpen}
          >
            {drawerOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>

          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="text-ink-muted hover:bg-surface-sunken hover:text-ink hidden size-9 shrink-0 place-items-center rounded-[var(--radius-control)] lg:grid"
            aria-label={collapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')}
            aria-expanded={!collapsed}
            title={collapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" aria-hidden />
            ) : (
              <PanelLeftClose className="size-4" aria-hidden />
            )}
          </button>

          <Breadcrumbs />

          <div className="ml-auto flex items-center gap-2">
            <span
              className="text-ink-faint flex items-center gap-1.5 text-xs"
              title={connected ? t('shell.connected') : t('shell.disconnected')}
            >
              <span
                aria-hidden
                className={cn('size-2 rounded-full', connected ? 'bg-success' : 'bg-ink-faint')}
              />
              <span className="hidden sm:inline">
                {connected ? t('shell.realtime.on') : t('shell.realtime.off')}
              </span>
            </span>

            <LanguageMenu />

            <Button
              variant="ghost"
              size="icon"
              onClick={toggle}
              aria-label={themeLabel}
              title={themeLabel}
            >
              {resolved === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>

            {/* Bloc informatif, pas un bouton : aucun effet de survol, qui laisserait croire
                à un menu de compte inexistant. */}
            <span
              className="flex h-9 items-center gap-2 rounded-[var(--radius-control)] px-1.5"
              title={user?.role === 'Admin' ? t('role.admin') : t('role.viewer')}
            >
              <span className="bg-brand-subtle text-brand grid size-7 place-items-center rounded-full text-xs font-semibold">
                {initials(user?.username)}
              </span>
              <span className="text-ink hidden max-w-32 truncate text-sm sm:block">
                {user?.username}
              </span>
            </span>

            <Button
              variant="ghost"
              size="icon"
              onClick={async () => {
                await logout()
                navigate('/login')
              }}
              aria-label={t('shell.logout')}
              title={t('shell.logout')}
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </header>

        {/* min-w-0 : sans cela, un tableau large repousse la largeur de la colonne principale
            et fait défiler la page entière au lieu du tableau.
            La marge de page vit ici, et non dans chaque vue : toutes en héritent, y compris
            celles qui n'utilisent pas encore le conteneur `Page`. */}
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1600px] px-4 py-4 sm:px-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}

/**
 * Choix de la langue. Même dessin que les autres menus de l'application : une bulle d'options,
 * et non une liste déroulante native qui ignorerait le thème.
 */
function LanguageMenu() {
  const { locale, setLocale } = useLocale()
  const t = useT()
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        ref={anchor}
        variant="ghost"
        size="icon"
        onClick={() => setOpen((value) => !value)}
        aria-label={t('shell.language')}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${t('shell.language')} — ${LOCALE_LABELS[locale]}`}
      >
        <Languages className="size-4" />
      </Button>

      <Bubble
        anchor={anchor}
        open={open}
        onClose={() => setOpen(false)}
        align="end"
        label={t('shell.language')}
      >
        {LOCALES.map((option) => (
          <BubbleItem
            key={option}
            selected={option === locale}
            onSelect={() => {
              setLocale(option)
              setOpen(false)
            }}
          >
            <span className="w-6 text-xs font-semibold uppercase">{option}</span>
            <span className="truncate">{LOCALE_LABELS[option]}</span>
          </BubbleItem>
        ))}
      </Bubble>
    </>
  )
}
