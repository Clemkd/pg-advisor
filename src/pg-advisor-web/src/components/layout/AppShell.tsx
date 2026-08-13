import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Sun, X } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { Breadcrumbs } from './Breadcrumbs'
import { useAuth } from '@/app/AuthContext'
import { useEvents } from '@/app/EventsContext'
import { useTheme } from '@/app/ThemeContext'
import { Button } from '@/components/ui/primitives'
import { cn, initials } from '@/lib/utils'

const COLLAPSE_KEY = 'pg-advisor.sidebar.collapsed'

/** Coquille applicative : colonne rétractable, barre supérieure et zone de contenu. */
export function AppShell() {
  const { user, logout } = useAuth()
  const { connected } = useEvents()
  const { resolved, toggle } = useTheme()
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

  return (
    <div className="bg-canvas flex h-dvh overflow-hidden">
      <div className="hidden shrink-0 lg:block">
        <Sidebar collapsed={collapsed} />
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Fermer le menu"
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
            aria-label={drawerOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
            aria-expanded={drawerOpen}
          >
            {drawerOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>

          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="text-ink-muted hover:bg-surface-sunken hover:text-ink hidden size-9 shrink-0 place-items-center rounded-[var(--radius-control)] lg:grid"
            aria-label={collapsed ? 'Déplier le menu' : 'Replier le menu'}
            aria-expanded={!collapsed}
            title={collapsed ? 'Déplier le menu' : 'Replier le menu'}
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
              title={connected ? 'Flux temps réel connecté' : 'Flux temps réel interrompu'}
            >
              <span
                aria-hidden
                className={cn('size-2 rounded-full', connected ? 'bg-success' : 'bg-ink-faint')}
              />
              <span className="hidden sm:inline">{connected ? 'temps réel' : 'hors ligne'}</span>
            </span>

            <Button
              variant="ghost"
              size="icon"
              onClick={toggle}
              aria-label={resolved === 'dark' ? 'Passer en thème clair' : 'Passer en thème sombre'}
              title={resolved === 'dark' ? 'Passer en thème clair' : 'Passer en thème sombre'}
            >
              {resolved === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>

            <span
              className="hover:bg-surface-sunken flex h-9 items-center gap-2 rounded-[var(--radius-control)] px-2"
              title={user?.role === 'Admin' ? 'Administrateur' : 'Lecteur'}
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
              aria-label="Se déconnecter"
              title="Se déconnecter"
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
