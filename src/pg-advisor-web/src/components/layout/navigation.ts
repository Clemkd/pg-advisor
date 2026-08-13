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

export interface NavLeaf {
  to: string
  label: string
  icon?: LucideIcon
  adminOnly?: boolean
}

export interface NavSection {
  label: string
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
  { label: 'Vue d’ensemble', icon: Gauge, to: '/', end: true },
  {
    label: 'Supervision',
    icon: Database,
    children: [
      { to: '/instances', label: 'Instances', icon: Database },
      { to: '/findings', label: 'Recommandations', icon: Flag },
      { to: '/queries', label: 'Requêtes', icon: Terminal },
    ],
  },
  {
    label: 'Configuration',
    icon: ScrollText,
    children: [
      { to: '/rules', label: 'Règles', icon: ScrollText },
      { to: '/webhooks', label: 'Notifications', icon: Bell },
      { to: '/users', label: 'Utilisateurs', icon: Users, adminOnly: true },
    ],
  },
]
