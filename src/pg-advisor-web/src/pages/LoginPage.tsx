import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Database } from 'lucide-react'
import { api, ApiError } from '@/api/client'
import { useAuth } from '@/app/AuthContext'
import {
  Button,
  Card,
  CardBody,
  Field,
  Input,
  LoadingBlock,
  Notice,
} from '@/components/ui/primitives'
import { LOCALES, LOCALE_LABELS, useLocale, useT } from '@/lib/i18n'

/**
 * Connexion — hors coquille applicative.
 *
 * Seule page atteinte sans session : elle porte donc elle-même le choix de la langue, que la
 * barre supérieure offrira ensuite.
 */
export function LoginPage() {
  const { user, loading, login, refresh } = useAuth()
  const navigate = useNavigate()
  const t = useT()

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
      setError(cause instanceof ApiError ? cause.message : t('login.unreachable'))
    } finally {
      setBusy(false)
    }
  }

  async function submitPasswordChange(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    if (newPassword !== confirmation) {
      setError(t('login.passwordMismatch'))
      return
    }

    setBusy(true)
    try {
      await api.auth.changePassword(password, newPassword)
      await refresh()
      navigate('/')
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('login.passwordChangeFailed'))
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
          <h1 className="text-ink text-title font-semibold tracking-tight">{t('login.title')}</h1>
          <p className="text-ink-muted mt-1 text-body">{t('login.subtitle')}</p>
        </div>

        <Card>
          <CardBody>
            {user?.mustChangePassword ? (
              <form onSubmit={submitPasswordChange} className="space-y-3">
                <Notice tone="warning" title={t('login.mustChangeTitle')}>
                  {t('login.mustChangeBody')}
                </Notice>

                <Field label={t('login.newPassword')} hint={t('login.passwordHint')}>
                  <Input
                    type="password"
                    value={newPassword}
                    minLength={10}
                    required
                    autoComplete="new-password"
                    onChange={(event) => setNewPassword(event.target.value)}
                  />
                </Field>

                <Field label={t('login.confirmation')}>
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

                {/* Action principale d'un formulaire rare, et seule cible de la page au doigt. */}
                <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
                  {t('login.saveAndContinue')}
                </Button>
              </form>
            ) : (
              <form onSubmit={submitLogin} className="space-y-3">
                <Field label={t('login.username')}>
                  <Input
                    value={username}
                    required
                    autoFocus
                    autoComplete="username"
                    onChange={(event) => setUsername(event.target.value)}
                  />
                </Field>

                <Field label={t('login.password')}>
                  <Input
                    type="password"
                    value={password}
                    required
                    autoComplete="current-password"
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </Field>

                {error && <Notice tone="danger">{error}</Notice>}

                <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
                  {t('login.submit')}
                </Button>
              </form>
            )}
          </CardBody>
        </Card>

        <p className="text-ink-muted mt-4 text-center text-meta">{t('login.bootstrapHint')}</p>

        {/* Le choix de la langue est offert avant la connexion : la coquille applicative, où il
            vit ensuite, n'est pas encore accessible. */}
        <LocalePicker />
      </div>
    </div>
  )
}

/**
 * Choix de la langue. Des boutons de plein droit, hauts de 32 px : écrits à la main, ils
 * mesuraient 24 px — sous le minimum d'une cible de clic, et c'était la seule de la page.
 */
function LocalePicker() {
  const { locale, setLocale } = useLocale()
  const t = useT()

  return (
    <div role="group" aria-label={t('shell.language')} className="mt-4 flex items-center justify-center gap-1">
      {LOCALES.map((option) => (
        <Button
          key={option}
          size="sm"
          lang={option}
          variant={option === locale ? 'secondary' : 'ghost'}
          aria-pressed={option === locale}
          onClick={() => setLocale(option)}
        >
          {LOCALE_LABELS[option]}
        </Button>
      ))}
    </div>
  )
}
