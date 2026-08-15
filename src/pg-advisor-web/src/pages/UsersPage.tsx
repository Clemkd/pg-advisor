import { useCallback, useEffect, useState } from 'react'
import { UserPlus } from 'lucide-react'
import { api, ApiError } from '@/api/client'
import type { UserAccount } from '@/api/types'
import { useAuth } from '@/app/AuthContext'
import { Page } from '@/components/layout/Page'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  Notice,
  Select,
  TBody,
  THead,
  Table,
  TableScroll,
  Td,
  Th,
  Tr,
} from '@/components/ui/primitives'
import { formatDateTime, formatRelative } from '@/lib/format'
import { tr, useT, useTc } from '@/lib/i18n'

/**
 * Comptes — famille *installation*.
 *
 * Deux gestes seulement : ouvrir un accès, le reprendre. Tout le reste — le rôle — se règle sur
 * place, sans aller-retour dans une modale pour un choix binaire.
 */
export function UsersPage() {
  const { user: current, isAdmin } = useAuth()
  const t = useT()
  const tc = useTc()

  const [users, setUsers] = useState<UserAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [resetting, setResetting] = useState<UserAccount | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<UserAccount | null>(null)
  const [deleting, setDeleting] = useState(false)

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

  async function remove() {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await api.auth.deleteUser(confirmDelete.id)
      setConfirmDelete(null)
      void load()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : tr('users.deleteFailed'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  if (!isAdmin) {
    return (
      <Page title={t('nav.users')}>
        <Notice tone="warning">{t('users.adminOnly')}</Notice>
      </Page>
    )
  }

  const addButton = (
    <Button variant="primary" onClick={() => setCreating(true)}>
      {t('users.add')}
    </Button>
  )

  return (
    <Page title={t('nav.users')} description={t('users.subtitle')} actions={addButton}>
      <div className="space-y-4">
        {error && (
          <Notice tone="danger" title={t('common.error')} onDismiss={() => setError(null)}>
            {error}
          </Notice>
        )}

        <Card>
          <CardHeader title={tc('users.count', users.length)} />

          {loading ? (
            <LoadingBlock />
          ) : users.length === 0 ? (
            <EmptyState
              icon={<UserPlus className="size-6" aria-hidden />}
              title={t('users.empty')}
              description={t('users.emptyHint')}
              action={addButton}
            />
          ) : (
            <TableScroll minWidth={760}>
              <Table>
                <THead>
                  <Tr>
                    <Th>{t('users.column.username')}</Th>
                    <Th>{t('users.column.role')}</Th>
                    <Th>{t('users.column.createdAt')}</Th>
                    <Th>{t('users.column.lastLogin')}</Th>
                    <Th>
                      <span className="sr-only">{t('common.actions')}</span>
                    </Th>
                  </Tr>
                </THead>
                <TBody>
                  {users.map((account) => (
                    <Tr key={account.id}>
                      <Td>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-ink font-medium">{account.username}</span>
                          {account.id === current?.id && (
                            <Badge tone="info">{t('users.you')}</Badge>
                          )}
                          {account.mustChangePassword && (
                            <Badge tone="warning">{t('users.mustChangePassword')}</Badge>
                          )}
                        </div>
                      </Td>
                      {/* Le rôle se change sur place : une liste déroulante vaut mieux qu'un
                          aller-retour dans une modale pour un choix binaire. */}
                      <Td>
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
                      </Td>
                      <Td className="text-ink-muted whitespace-nowrap">
                        {formatDateTime(account.createdAt)}
                      </Td>
                      <Td
                        className="text-ink-muted whitespace-nowrap"
                        title={formatDateTime(account.lastLoginAt)}
                      >
                        {account.lastLoginAt
                          ? formatRelative(account.lastLoginAt)
                          : t('common.never')}
                      </Td>
                      <Td>
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" onClick={() => setResetting(account)}>
                            {t('users.resetPassword')}
                          </Button>
                          {/* Un compte ne se supprime pas lui-même : le geste laisserait
                              l'application sans administrateur connecté. */}
                          {account.id !== current?.id && (
                            <Button
                              variant="ghost"
                              className="text-danger-strong hover:text-danger-strong"
                              onClick={() => setConfirmDelete(account)}
                            >
                              {t('common.delete')}
                            </Button>
                          )}
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableScroll>
          )}
        </Card>
      </div>

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

      {confirmDelete && (
        <ConfirmDialog
          title={t('users.delete.title', { name: confirmDelete.username })}
          description={t('users.delete.body')}
          confirmLabel={t('users.delete.confirm')}
          busy={deleting}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void remove()}
        />
      )}
    </Page>
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
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button form="create-user" type="submit" variant="primary" size="lg" loading={busy}>
            {t('users.form.create')}
          </Button>
        </>
      }
    >
      {/* Une colonne : le mot de passe saisi ici n'est plus jamais réaffiché, l'indication le
          dit avant la validation plutôt qu'après. */}
      <form id="create-user" onSubmit={submit} className="space-y-3">
        <Field label={t('users.form.username')} hint={t('users.form.usernameHint')}>
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

        <Field label={t('users.form.role')} hint={t('users.form.roleHint')}>
          <Select value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="Viewer">{t('role.viewer')}</option>
            <option value="Admin">{t('role.admin')}</option>
          </Select>
        </Field>

        {error && <Notice tone="danger">{error}</Notice>}
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
      description={t('users.reset.body')}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button form="reset-password" type="submit" variant="primary" size="lg" loading={busy}>
            {t('users.reset.submit')}
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

        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Modal>
  )
}
