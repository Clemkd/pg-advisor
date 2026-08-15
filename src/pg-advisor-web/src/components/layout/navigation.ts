import {
  Bell,
  Database,
  Flag,
  Gauge,
  ScrollText,
  Terminal,
  Users,
  type LucideIcon,
} from 'lucide-react'

/** Décompte affiché en pastille à côté d'une entrée. Une seule sorte pour l'instant. */
export type NavCount = 'activeFindings'

export interface NavLeaf {
  to: string
  /** Clé de traduction : la navigation est décrite une fois, traduite au rendu. */
  labelKey: string
  icon?: LucideIcon
  adminOnly?: boolean
  count?: NavCount
}

export interface NavSection {
  labelKey: string
  icon: LucideIcon
  to?: string
  end?: boolean
  children?: NavLeaf[]
}

/**
 * Deux sections : ce qu'on observe au quotidien, et ce qu'on paramètre. La supervision est
 * dépliée par défaut, la configuration se consulte plus rarement.
 */
export const navigation: NavSection[] = [
  { labelKey: 'nav.overview', icon: Gauge, to: '/', end: true },
  {
    labelKey: 'nav.supervision',
    icon: Database,
    children: [
      { to: '/instances', labelKey: 'nav.instances', icon: Database },
      { to: '/findings', labelKey: 'nav.findings', icon: Flag, count: 'activeFindings' },
      { to: '/queries', labelKey: 'nav.queries', icon: Terminal },
    ],
  },
  {
    labelKey: 'nav.configuration',
    icon: ScrollText,
    children: [
      { to: '/rules', labelKey: 'nav.rules', icon: ScrollText },
      { to: '/webhooks', labelKey: 'nav.webhooks', icon: Bell },
      { to: '/users', labelKey: 'nav.users', icon: Users, adminOnly: true },
    ],
  },
]
