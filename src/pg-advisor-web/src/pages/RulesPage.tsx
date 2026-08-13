import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { Rule, RuleError } from '../api/types'
import { useAuth } from '../app/AuthContext'
import { useEventListener } from '../app/EventsContext'
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  SeverityBadge,
  Spinner,
  TableScroll,
  Tag,
} from '../components/ui'
import { categoryLabel, formatRelative } from '../lib/format'

export function RulesPage() {
  const { isAdmin } = useAuth()
  const [rules, setRules] = useState<Rule[]>([])
  const [errors, setErrors] = useState<RuleError[]>([])
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<string | null>(null)
  const [reloading, setReloading] = useState(false)
  const [loadedAt, setLoadedAt] = useState<string | null>(null)

  const [category, setCategory] = useState('')
  const [origin, setOrigin] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    try {
      const [list, ruleErrors] = await Promise.all([api.rules.list(), api.rules.errors()])
      setRules(list)
      setErrors(ruleErrors)
      setFailure(null)
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Chargement impossible.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEventListener(['rules.reloaded'], (event) => {
    const data = event.data as { loadedAt?: string } | null
    setLoadedAt(data?.loadedAt ?? event.at)
    void load()
  })

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return rules.filter((rule) => {
      if (category && rule.category !== category) return false
      if (origin && rule.origin !== origin) return false
      if (!needle) return true
      return (
        rule.id.toLowerCase().includes(needle) ||
        rule.name.toLowerCase().includes(needle) ||
        (rule.description ?? '').toLowerCase().includes(needle)
      )
    })
  }, [rules, category, origin, search])

  const categories = useMemo(
    () => [...new Set(rules.map((rule) => rule.category))].sort(),
    [rules],
  )

  async function reload() {
    setReloading(true)
    try {
      const status = await api.rules.reload()
      setLoadedAt(status.loadedAt)
      await load()
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Rechargement impossible.')
    } finally {
      setReloading(false)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Règles"
        subtitle="Le YAML fait référence. Les règles modifiées depuis l'interface sont écrites dans le volume de données et rechargées à chaud."
        actions={
          <>
            {loadedAt && (
              <span className="hidden text-xs text-ink-muted sm:inline">
                rechargées {formatRelative(loadedAt)}
              </span>
            )}
            {isAdmin && (
              <>
                <Button onClick={reload} disabled={reloading}>
                  {reloading && <Spinner />} Recharger
                </Button>
                <Link
                  to="/rules/new"
                  className="bg-brand text-brand-ink hover:bg-brand-hover inline-flex h-8 items-center rounded-[var(--radius-control)] px-3 text-sm font-medium"
                >
                  Nouvelle règle
                </Link>
              </>
            )}
          </>
        }
      />

      {failure && <Alert title="Erreur">{failure}</Alert>}

      {errors.length > 0 && (
        <Card title={`Règles en erreur (${errors.length})`}>
          <div className="space-y-2">
            {errors.map((ruleError, index) => (
              <Alert key={`${ruleError.file}-${index}`} title={ruleError.ruleId ?? ruleError.file}>
                <p className="text-xs">{ruleError.message}</p>
                <p className="text-xs opacity-70">
                  {ruleError.file} · {ruleError.origin === 'user' ? 'règle personnalisée' : 'règle intégrée'}
                </p>
              </Alert>
            ))}
          </div>
          <p className="mt-3 text-xs text-ink-muted">
            Une règle invalide est écartée sans interrompre l'application. Corrigez le fichier ou la
            règle depuis l'éditeur : elle sera rechargée automatiquement.
          </p>
        </Card>
      )}

      <Card title={`${filtered.length} règle${filtered.length > 1 ? 's' : ''} sur ${rules.length}`} padded={false}>
        <div className="grid gap-3 border-b border-border-subtle p-4 sm:grid-cols-3">
          <Field label="Catégorie">
            <Select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">Toutes</option>
              {categories.map((item) => (
                <option key={item} value={item}>
                  {categoryLabel(item)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Origine">
            <Select value={origin} onChange={(event) => setOrigin(event.target.value)}>
              <option value="">Toutes</option>
              <option value="provided">Intégrées</option>
              <option value="user">Personnalisées</option>
            </Select>
          </Field>

          <Field label="Recherche">
            <Input
              value={search}
              placeholder="identifiant, nom, description"
              onChange={(event) => setSearch(event.target.value)}
            />
          </Field>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="size-6" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-4">
            <EmptyState title="Aucune règle pour ces filtres" />
          </div>
        ) : (
          <>
            <div className="hidden md:block">
              <TableScroll minWidth={880}>
                <table className="w-full text-sm">
                  <thead className="bg-surface-sunken text-left text-xs uppercase tracking-wide text-ink-muted">
                    <tr>
                      <th className="px-4 py-2 font-medium">Règle</th>
                      <th className="px-4 py-2 font-medium">Catégorie</th>
                      <th className="px-4 py-2 font-medium">Sévérité</th>
                      <th className="px-4 py-2 font-medium">Prérequis</th>
                      <th className="px-4 py-2 font-medium">Origine</th>
                      <th className="px-4 py-2 font-medium">État</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {filtered.map((rule) => (
                      <tr key={rule.id} className="align-top hover:bg-surface-sunken">
                        <td className="px-4 py-2.5">
                          <Link
                            to={`/rules/${encodeURIComponent(rule.id)}`}
                            className="font-medium text-ink hover:text-brand hover:underline"
                          >
                            {rule.name}
                          </Link>
                          <p className="font-mono text-xs text-ink-muted">{rule.id}</p>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-ink-muted">
                          {categoryLabel(rule.category)}
                        </td>
                        <td className="px-4 py-2.5">
                          <SeverityBadge severity={rule.severity} />
                        </td>
                        <td className="px-4 py-2.5">
                          <Requirements rule={rule} />
                        </td>
                        <td className="px-4 py-2.5">
                          {rule.origin === 'user' ? (
                            <Tag tone="accent">personnalisée</Tag>
                          ) : (
                            <Tag>intégrée</Tag>
                          )}
                          {rule.overridesProvided && (
                            <p className="mt-0.5 text-xs text-ink-muted">remplace la version intégrée</p>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {rule.enabled ? (
                            <Tag tone="good">activée</Tag>
                          ) : (
                            <Tag tone="warn">désactivée</Tag>
                          )}
                          {rule.overrides.length > 0 && (
                            <p className="mt-0.5 whitespace-nowrap text-xs text-ink-muted">
                              {rule.overrides.length} surcharge{rule.overrides.length > 1 ? 's' : ''}
                            </p>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </div>

            <ul className="divide-y divide-border-subtle md:hidden">
              {filtered.map((rule) => (
                <li key={rule.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      to={`/rules/${encodeURIComponent(rule.id)}`}
                      className="min-w-0 font-medium text-ink"
                    >
                      {rule.name}
                    </Link>
                    <SeverityBadge severity={rule.severity} />
                  </div>

                  <p className="mt-0.5 truncate font-mono text-xs text-ink-muted">{rule.id}</p>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Tag tone="accent">{categoryLabel(rule.category)}</Tag>
                    {rule.origin === 'user' ? <Tag tone="accent">personnalisée</Tag> : <Tag>intégrée</Tag>}
                    {rule.enabled ? <Tag tone="good">activée</Tag> : <Tag tone="warn">désactivée</Tag>}
                    {rule.overrides.length > 0 && (
                      <Tag>
                        {rule.overrides.length} surcharge{rule.overrides.length > 1 ? 's' : ''}
                      </Tag>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  )
}

function Requirements({ rule }: { rule: Rule }) {
  const parts: string[] = []

  if (rule.requires.extensions.length > 0) {
    parts.push(...rule.requires.extensions)
  }
  if (rule.requires.missingExtensions.length > 0) {
    parts.push(...rule.requires.missingExtensions.map((name) => `sans ${name}`))
  }
  if (rule.requires.minVersion) {
    parts.push(`PG ≥ ${rule.requires.minVersion}`)
  }
  if (rule.requires.maxVersion) {
    parts.push(`PG ≤ ${rule.requires.maxVersion}`)
  }
  if (rule.requires.monitorRole) {
    parts.push('pg_monitor')
  }
  if (rule.handler) {
    parts.push('handler')
  }

  if (parts.length === 0) {
    return <span className="text-xs text-ink-faint">{rule.requires.views.length} vue(s)</span>
  }

  return (
    <div className="flex flex-wrap gap-1">
      {parts.map((part) => (
        <Tag key={part}>{part}</Tag>
      ))}
    </div>
  )
}
