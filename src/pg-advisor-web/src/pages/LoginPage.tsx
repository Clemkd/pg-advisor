import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Database } from 'lucide-react'
import { api, ApiError } from '@/api/client'
import { useAuth } from '@/app/AuthContext'
import { Button, Card, Field, Input, LoadingBlock, Notice } from '@/components/ui/primitives'

export function LoginPage() {
  const { user, loading, login, refresh } = useAuth()
  const navigate = useNavigate()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Changement de mot de passe imposé après un bootstrap avec mot de passe généré.
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')

  if (loading) {
    return (
      <div className="bg-canvas grid min-h-dvh place-items-center">
        <LoadingBlock />
      </div>
    )
  }

  if (user && !user.mustChangePassword) {
    return <Navigate to="/" replace />
  }

  async function submitLogin(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)

    try {
      await login(username, password)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Connexion impossible.')
    } finally {
      setBusy(false)
    }
  }

  async function submitPasswordChange(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    if (newPassword !== confirmation) {
      setError('Les deux saisies du nouveau mot de passe diffèrent.')
      return
    }

    setBusy(true)
    try {
      await api.auth.changePassword(password, newPassword)
      await refresh()
      navigate('/')
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Changement de mot de passe impossible.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-canvas flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="bg-brand text-brand-ink mb-3 grid size-11 place-items-center rounded-[var(--radius-card)]">
            <Database className="size-5" aria-hidden />
          </span>
          <h1 className="text-ink text-lg font-semibold tracking-tight">PostgreSQL Advisor</h1>
          <p className="text-ink-muted mt-1 text-sm">Supervision en lecture seule de vos instances</p>
        </div>

        <Card className="p-5">
          {user?.mustChangePassword ? (
            <form onSubmit={submitPasswordChange} className="space-y-4">
              <Notice tone="warning" title="Mot de passe à changer">
                Ce compte utilise le mot de passe généré au premier démarrage.
              </Notice>

              <Field label="Nouveau mot de passe" hint="10 caractères minimum">
                <Input
                  type="password"
                  value={newPassword}
                  minLength={10}
                  required
                  autoComplete="new-password"
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </Field>

              <Field label="Confirmation">
                <Input
                  type="password"
                  value={confirmation}
                  minLength={10}
                  required
                  autoComplete="new-password"
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </Field>

              {error && <Notice tone="danger">{error}</Notice>}

              <Button type="submit" variant="primary" size="md" className="w-full" loading={busy}>
                Enregistrer et continuer
              </Button>
            </form>
          ) : (
            <form onSubmit={submitLogin} className="space-y-4">
              <Field label="Identifiant">
                <Input
                  value={username}
                  required
                  autoFocus
                  autoComplete="username"
                  onChange={(event) => setUsername(event.target.value)}
                />
              </Field>

              <Field label="Mot de passe">
                <Input
                  type="password"
                  value={password}
                  required
                  autoComplete="current-password"
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>

              {error && <Notice tone="danger">{error}</Notice>}

              <Button type="submit" variant="primary" size="md" className="w-full" loading={busy}>
                Se connecter
              </Button>
            </form>
          )}
        </Card>

        <p className="text-ink-faint mt-4 text-center text-xs">
          Le mot de passe du compte administrateur initial figure une seule fois dans les journaux du
          conteneur.
        </p>
      </div>
    </div>
  )
}
