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

export function UsersPage() {
  const { user: current, isAdmin } = useAuth()
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
      setError(cause instanceof Error ? cause.message : 'Chargement impossible.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (!isAdmin) {
    return <Alert tone="warning">Cette page est réservée aux administrateurs.</Alert>
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Utilisateurs"
        subtitle="Un lecteur consulte le dashboard et les recommandations ; un administrateur gère instances, règles et notifications."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            Ajouter un compte
          </Button>
        }
      />

      {error && <Alert title="Erreur">{error}</Alert>}

      <Card title={`${users.length} compte${users.length > 1 ? 's' : ''}`} padded={false}>
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="size-6" />
          </div>
        ) : users.length === 0 ? (
          <div className="p-4">
            <EmptyState title="Aucun compte" />
          </div>
        ) : (
          <TableScroll minWidth={720}>
            <table className="w-full text-sm">
              <thead className="bg-surface-sunken text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Identifiant</th>
                  <th className="px-4 py-2 font-medium">Rôle</th>
                  <th className="px-4 py-2 font-medium">Créé le</th>
                  <th className="px-4 py-2 font-medium">Dernière connexion</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {users.map((account) => (
                  <tr key={account.id} className="hover:bg-surface-sunken">
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium text-ink">{account.username}</span>
                        {account.id === current?.id && <Tag tone="accent">vous</Tag>}
                        {account.mustChangePassword && <Tag tone="warn">mot de passe à changer</Tag>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Select
                        value={account.role}
                        className="max-w-32"
                        onChange={async (event) => {
                          try {
                            await api.auth.updateUser(account.id, { role: event.target.value })
                            void load()
                          } catch (cause) {
                            setError(cause instanceof ApiError ? cause.message : 'Modification impossible.')
                          }
                        }}
                      >
                        <option value="Admin">Administrateur</option>
                        <option value="Viewer">Lecteur</option>
                      </Select>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-ink-muted">
                      {formatDateTime(account.createdAt)}
                    </td>
                    <td
                      className="whitespace-nowrap px-4 py-2.5 text-ink-muted"
                      title={formatDateTime(account.lastLoginAt)}
                    >
                      {account.lastLoginAt ? formatRelative(account.lastLoginAt) : 'jamais'}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" onClick={() => setResetting(account)}>
                          Mot de passe
                        </Button>
                        {account.id !== current?.id && (
                          <Button
                            variant="ghost"
                            onClick={async () => {
                              try {
                                await api.auth.deleteUser(account.id)
                                void load()
                              } catch (cause) {
                                setError(
                                  cause instanceof ApiError ? cause.message : 'Suppression impossible.',
                                )
                              }
                            }}
                          >
                            Supprimer
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
      setError(cause instanceof ApiError ? cause.message : 'Création impossible.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Ajouter un compte"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button form="create-user" type="submit" variant="primary" disabled={busy}>
            {busy && <Spinner />} Créer
          </Button>
        </>
      }
    >
      <form id="create-user" onSubmit={submit} className="space-y-4">
        <Field label="Identifiant">
          <Input
            value={username}
            required
            pattern="[A-Za-z0-9._@\-]+"
            onChange={(event) => setUsername(event.target.value)}
          />
        </Field>

        <Field label="Mot de passe" hint="10 caractères minimum">
          <Input
            type="password"
            value={password}
            required
            minLength={10}
            autoComplete="new-password"
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>

        <Field label="Rôle" hint="Un lecteur consulte le dashboard mais ne modifie rien">
          <Select value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="Viewer">Lecteur</option>
            <option value="Admin">Administrateur</option>
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
      setError(cause instanceof ApiError ? cause.message : 'Modification impossible.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Nouveau mot de passe pour « ${account.username} »`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button form="reset-password" type="submit" variant="primary" disabled={busy}>
            {busy && <Spinner />} Enregistrer
          </Button>
        </>
      }
    >
      <form id="reset-password" onSubmit={submit} className="space-y-4">
        <Field label="Mot de passe" hint="10 caractères minimum">
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
      setNotice('Mot de passe modifié.')
      setCurrentPassword('')
      setNewPassword('')
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Modification impossible.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Changer mon mot de passe">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3 sm:items-end">
        <Field label="Mot de passe actuel">
          <Input
            type="password"
            value={currentPassword}
            required
            autoComplete="current-password"
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </Field>

        <Field label="Nouveau mot de passe" hint="10 caractères minimum">
          <Input
            type="password"
            value={newPassword}
            required
            minLength={10}
            autoComplete="new-password"
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </Field>

        <Button type="submit" variant="primary" disabled={busy}>
          {busy && <Spinner />} Changer
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
