import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import type { UserAccount } from '../api/types'
import { useAuth } from '../app/AuthContext'
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  TableScroll,
  Tag,
} from '../components/ui'
import { formatDateTime, formatRelative } from '../lib/format'
import { tr, useT, useTc } from '../lib/i18n'

export function UsersPage() {
  const { user: current, isAdmin } = useAuth()
  const t = useT()
  const tc = useTc()
  const [users, setUsers] = useState<UserAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [resetting, setResetting] = useState<UserAccount | null>(null)

  const load = useCallback(async () => {
    try {
      setUsers(await api.auth.users())
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr('common.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (!isAdmin) {
    return <Alert tone="warning">{t('users.adminOnly')}</Alert>
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('nav.users')}
        subtitle={t('users.subtitle')}
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            {t('users.add')}
          </Button>
        }
      />

      {error && <Alert title={t('common.error')}>{error}</Alert>}

      <Card title={tc('users.count', users.length)} padded={false}>
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="size-6" />
          </div>
        ) : users.length === 0 ? (
          <EmptyState title={t('users.empty')} />
        ) : (
          <TableScroll minWidth={720}>
            <table className="w-full text-sm">
              <thead className="bg-surface-sunken text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">{t('users.column.username')}</th>
                  <th className="px-4 py-2 font-medium">{t('users.column.role')}</th>
                  <th className="px-4 py-2 font-medium">{t('users.column.createdAt')}</th>
                  <th className="px-4 py-2 font-medium">{t('users.column.lastLogin')}</th>
                  <th className="px-4 py-2">
                    <span className="sr-only">{t('common.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {users.map((account) => (
                  <tr key={account.id} className="hover:bg-surface-sunken">
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium text-ink">{account.username}</span>
                        {account.id === current?.id && <Tag tone="accent">{t('users.you')}</Tag>}
                        {account.mustChangePassword && (
                          <Tag tone="warn">{t('users.mustChangePassword')}</Tag>
                        )}
                      </div>
                    </td>
                    {/* Le rôle se change sur place : une liste déroulante vaut mieux qu'un
                        aller-retour dans une modale pour un choix binaire. */}
                    <td className="px-4 py-2.5">
                      <Select
                        value={account.role}
                        className="max-w-40"
                        aria-label={t('users.roleFor', { name: account.username })}
                        onChange={async (event) => {
                          try {
                            await api.auth.updateUser(account.id, { role: event.target.value })
                            void load()
                          } catch (cause) {
                            setError(
                              cause instanceof ApiError ? cause.message : t('users.updateFailed'),
                            )
                          }
                        }}
                      >
                        <option value="Admin">{t('role.admin')}</option>
                        <option value="Viewer">{t('role.viewer')}</option>
                      </Select>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-ink-muted">
                      {formatDateTime(account.createdAt)}
                    </td>
                    <td
                      className="whitespace-nowrap px-4 py-2.5 text-ink-muted"
                      title={formatDateTime(account.lastLoginAt)}
                    >
                      {account.lastLoginAt ? formatRelative(account.lastLoginAt) : t('common.never')}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" onClick={() => setResetting(account)}>
                          {t('users.resetPassword')}
                        </Button>
                        {account.id !== current?.id && (
                          <Button
                            variant="ghost"
                            className="text-danger hover:text-danger"
                            onClick={async () => {
                              try {
                                await api.auth.deleteUser(account.id)
                                void load()
                              } catch (cause) {
                                setError(
                                  cause instanceof ApiError
                                    ? cause.message
                                    : t('users.deleteFailed'),
                                )
                              }
                            }}
                          >
                            {t('common.delete')}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      <ChangeOwnPassword />

      {creating && (
        <CreateUser
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false)
            void load()
          }}
        />
      )}

      {resetting && (
        <ResetPassword
          account={resetting}
          onClose={() => setResetting(null)}
          onSaved={() => {
            setResetting(null)
            void load()
          }}
        />
      )}
    </div>
  )
}

function CreateUser({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const t = useT()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('Viewer')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      await api.auth.createUser(username, password, role)
      onSaved()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('users.createFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('users.add')}
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button form="create-user" type="submit" variant="primary" disabled={busy}>
            {busy && <Spinner />} {t('common.create')}
          </Button>
        </>
      }
    >
      {/* Identifiant et mot de passe se saisissent d'affilée : côte à côte, ils tiennent sur
          une ligne, et le rôle garde la sienne avec son explication. */}
      <form id="create-user" onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('users.form.username')}>
            <Input
              value={username}
              required
              pattern="[A-Za-z0-9._@\-]+"
              autoComplete="off"
              onChange={(event) => setUsername(event.target.value)}
            />
          </Field>

          <Field label={t('users.form.password')} hint={t('users.form.passwordHint')}>
            <Input
              type="password"
              value={password}
              required
              minLength={10}
              autoComplete="new-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
        </div>

        <Field label={t('users.form.role')} hint={t('users.form.roleHint')}>
          <Select value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="Viewer">{t('role.viewer')}</option>
            <option value="Admin">{t('role.admin')}</option>
          </Select>
        </Field>

        {error && <Alert>{error}</Alert>}
      </form>
    </Modal>
  )
}

function ResetPassword({
  account,
  onClose,
  onSaved,
}: {
  account: UserAccount
  onClose: () => void
  onSaved: () => void
}) {
  const t = useT()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      await api.auth.updateUser(account.id, { password })
      onSaved()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('users.updateFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('users.reset.title', { name: account.username })}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button form="reset-password" type="submit" variant="primary" disabled={busy}>
            {busy && <Spinner />} {t('common.save')}
          </Button>
        </>
      }
    >
      <form id="reset-password" onSubmit={submit} className="space-y-3">
        <Field label={t('users.form.password')} hint={t('users.form.passwordHint')}>
          <Input
            type="password"
            value={password}
            required
            minLength={10}
            autoComplete="new-password"
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>

        {error && <Alert>{error}</Alert>}
      </form>
    </Modal>
  )
}

function ChangeOwnPassword() {
  const t = useT()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)

    try {
      await api.auth.changePassword(currentPassword, newPassword)
      setNotice(t('users.changeOwn.done'))
      setCurrentPassword('')
      setNewPassword('')
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('users.updateFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={t('users.changeOwn.title')}>
      {/* Les deux champs et le bouton partagent une ligne, à une largeur de saisie raisonnable :
          un mot de passe n'a pas besoin de toute la largeur de la page pour être lisible. */}
      <form
        onSubmit={submit}
        className="grid gap-3 sm:grid-cols-[minmax(0,18rem)_minmax(0,18rem)_auto] sm:items-end sm:justify-start"
      >
        <Field label={t('users.changeOwn.current')}>
          <Input
            type="password"
            value={currentPassword}
            required
            autoComplete="current-password"
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </Field>

        <Field label={t('users.changeOwn.new')} hint={t('users.form.passwordHint')}>
          <Input
            type="password"
            value={newPassword}
            required
            minLength={10}
            autoComplete="new-password"
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </Field>

        <Button type="submit" variant="primary" size="md" disabled={busy}>
          {busy && <Spinner />} {t('users.changeOwn.submit')}
        </Button>
      </form>

      {notice && (
        <div className="mt-3">
          <Alert tone="success" onDismiss={() => setNotice(null)}>
            {notice}
          </Alert>
        </div>
      )}
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
    </Card>
  )
}
