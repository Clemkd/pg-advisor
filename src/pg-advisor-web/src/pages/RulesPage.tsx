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
import { useT, useTc } from '../lib/i18n'
import type { Translator } from '../lib/i18n'

export function RulesPage() {
  const { isAdmin } = useAuth()
  const t = useT()
  const tc = useTc()
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
      setFailure(cause instanceof Error ? cause.message : t('common.loadFailed'))
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
      setFailure(cause instanceof Error ? cause.message : t('rules.reloadFailed'))
    } finally {
      setReloading(false)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('nav.rules')}
        subtitle={t('rules.subtitle')}
        actions={
          <>
            {loadedAt && (
              <span className="hidden text-xs text-ink-muted sm:inline">
                {t('rules.reloadedAt', { when: formatRelative(loadedAt) })}
              </span>
            )}
            {isAdmin && (
              <>
                <Button onClick={reload} disabled={reloading}>
                  {reloading && <Spinner />} {t('rules.reload')}
                </Button>
                <Link
                  to="/rules/new"
                  className="bg-brand text-brand-ink hover:bg-brand-hover inline-flex h-8 items-center rounded-[var(--radius-control)] px-3 text-sm font-medium"
                >
                  {t('breadcrumbs.newRule')}
                </Link>
              </>
            )}
          </>
        }
      />

      {failure && <Alert title={t('common.error')}>{failure}</Alert>}

      {errors.length > 0 && (
        <Card title={t('rules.failingTitle', { count: errors.length })}>
          <div className="space-y-2">
            {errors.map((ruleError, index) => (
              <Alert key={`${ruleError.file}-${index}`} title={ruleError.ruleId ?? ruleError.file}>
                <p className="text-xs">{ruleError.message}</p>
                <p className="text-xs opacity-70">
                  {ruleError.file} ·{' '}
                  {ruleError.origin === 'user' ? t('rules.customRule') : t('rules.bundledRule')}
                </p>
              </Alert>
            ))}
          </div>
          <p className="mt-3 text-xs text-ink-muted">
            {t('rules.failingHint')}
          </p>
        </Card>
      )}

      <Card
        title={tc('rules.countOf', filtered.length, { total: rules.length })}
        padded={false}
      >
        <div className="grid gap-3 border-b border-border-subtle p-4 sm:grid-cols-3">
          <Field label={t('common.category')}>
            <Select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">{t('common.all')}</option>
              {categories.map((item) => (
                <option key={item} value={item}>
                  {categoryLabel(item)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t('rules.origin')}>
            <Select value={origin} onChange={(event) => setOrigin(event.target.value)}>
              <option value="">{t('common.all')}</option>
              <option value="provided">{t('rules.bundled')}</option>
              <option value="user">{t('rules.custom')}</option>
            </Select>
          </Field>

          <Field label={t('common.search')}>
            <Input
              value={search}
              placeholder={t('rules.searchPlaceholder')}
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
            <EmptyState title={t('rules.noMatch')} />
          </div>
        ) : (
          <>
            <div className="hidden md:block">
              <TableScroll minWidth={880}>
                <table className="w-full text-sm">
                  <thead className="bg-surface-sunken text-left text-xs uppercase tracking-wide text-ink-muted">
                    <tr>
                      <th className="px-4 py-2 font-medium">{t('rules.rule')}</th>
                      <th className="px-4 py-2 font-medium">{t('common.category')}</th>
                      <th className="px-4 py-2 font-medium">{t('common.severity')}</th>
                      <th className="px-4 py-2 font-medium">{t('rules.requirements')}</th>
                      <th className="px-4 py-2 font-medium">{t('rules.origin')}</th>
                      <th className="px-4 py-2 font-medium">{t('common.state')}</th>
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
                          <Requirements rule={rule} t={t} />
                        </td>
                        <td className="px-4 py-2.5">
                          {rule.origin === 'user' ? (
                            <Tag tone="accent">{t('rules.customTag')}</Tag>
                          ) : (
                            <Tag>{t('rules.bundledTag')}</Tag>
                          )}
                          {rule.overridesProvided && (
                            <p className="mt-0.5 text-xs text-ink-muted">{t('rules.replacesBundled')}</p>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {rule.enabled ? (
                            <Tag tone="good">{t('rules.enabledTag')}</Tag>
                          ) : (
                            <Tag tone="warn">{t('rules.disabledTag')}</Tag>
                          )}
                          {rule.overrides.length > 0 && (
                            <p className="mt-0.5 whitespace-nowrap text-xs text-ink-muted">
                              {tc('rules.overrides', rule.overrides.length)}
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
                    {rule.origin === 'user' ? (
                      <Tag tone="accent">{t('rules.customTag')}</Tag>
                    ) : (
                      <Tag>{t('rules.bundledTag')}</Tag>
                    )}
                    {rule.enabled ? (
                      <Tag tone="good">{t('rules.enabledTag')}</Tag>
                    ) : (
                      <Tag tone="warn">{t('rules.disabledTag')}</Tag>
                    )}
                    {rule.overrides.length > 0 && (
                      <Tag>
                        {tc('rules.overrides', rule.overrides.length)}
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

function Requirements({ rule, t }: { rule: Rule; t: Translator }) {
  const parts: string[] = []

  if (rule.requires.extensions.length > 0) {
    parts.push(...rule.requires.extensions)
  }
  if (rule.requires.missingExtensions.length > 0) {
    parts.push(...rule.requires.missingExtensions.map((name) => t('rules.without', { name })))
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
    return (
      <span className="text-xs text-ink-faint">
        {t('rules.viewCount', { count: rule.requires.views.length })}
      </span>
    )
  }

  return (
    <div className="flex flex-wrap gap-1">
      {parts.map((part) => (
        <Tag key={part}>{part}</Tag>
      ))}
    </div>
  )
}
