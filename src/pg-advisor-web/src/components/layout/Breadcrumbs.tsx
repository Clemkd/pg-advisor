import { Link, useLocation, useParams } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useT } from '@/lib/i18n'

const SEGMENT_KEYS: Record<string, string> = {
  instances: 'nav.instances',
  findings: 'nav.findings',
  queries: 'nav.queries',
  rules: 'nav.rules',
  webhooks: 'nav.webhooks',
  users: 'nav.users',
  new: 'breadcrumbs.newRule',
}

/**
 * Fil d'Ariane déduit de l'URL. Le dernier segment n'est pas cliquable : c'est la page
 * courante, et un lien vers soi-même n'apporte rien.
 */
export function Breadcrumbs() {
  const location = useLocation()
  const params = useParams()
  const t = useT()

  const segments = location.pathname.split('/').filter(Boolean)

  if (segments.length === 0) {
    return <span className="text-ink truncate text-sm font-medium">{t('nav.overview')}</span>
  }

  const crumbs = segments.map((segment, index) => {
    const to = '/' + segments.slice(0, index + 1).join('/')
    const isIdentifier = Object.values(params).includes(segment)
    const key = SEGMENT_KEYS[segment]
    const label = isIdentifier || !key ? decodeURIComponent(segment) : t(key)
    return { to, label, last: index === segments.length - 1 }
  })

  return (
    <nav aria-label={t('breadcrumbs.aria')} className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-sm">
        <li className="shrink-0">
          <Link to="/" className="text-ink-muted hover:text-ink">
            Advisor
          </Link>
        </li>
        {crumbs.map((crumb) => (
          <li key={crumb.to} className="flex min-w-0 items-center gap-1">
            <ChevronRight className="text-ink-faint size-3.5 shrink-0" aria-hidden />
            {crumb.last ? (
              <span className="text-ink truncate font-medium" aria-current="page">
                {crumb.label}
              </span>
            ) : (
              <Link to={crumb.to} className="text-ink-muted hover:text-ink truncate">
                {crumb.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
