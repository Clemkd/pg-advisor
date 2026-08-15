import { useState } from 'react'
import { api, ApiError } from '@/api/client'
import { useAuth } from '@/app/AuthContext'
import { Page } from '@/components/layout/Page'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  KeyValue,
  KeyValueGrid,
  Notice,
} from '@/components/ui/primitives'
import { useT } from '@/lib/i18n'

/**
 * Mon profil — famille *installation*.
 *
 * Ce qu'un compte peut faire sur lui-même, et rien d'autre : se reconnaître, changer son mot de
 * passe. Le changement vivait au bas de la page Comptes, derrière la garde qui la réserve aux
 * administrateurs — un lecteur n'avait donc aucun moyen de changer son propre mot de passe.
 */
export function ProfilePage() {
  const { user, refresh } = useAuth()
  const t = useT()

  return (
    <Page title={t('shell.profile')} description={t('profile.subtitle')}>
      <div className="space-y-4">
        {user?.mustChangePassword && (
          <Notice tone="warning" title={t('profile.mustChange')}>
            {t('profile.mustChangeHint')}
          </Notice>
        )}

        <Card>
          <CardHeader title={t('profile.identity')} />
          <CardBody>
            <KeyValueGrid columns={2}>
              <KeyValue label={t('users.column.username')}>{user?.username ?? '—'}</KeyValue>
              <KeyValue label={t('users.column.role')}>
                <Badge tone={user?.role === 'Admin' ? 'info' : 'neutral'}>
                  {user?.role === 'Admin' ? t('role.admin') : t('role.viewer')}
                </Badge>
              </KeyValue>
            </KeyValueGrid>
          </CardBody>
        </Card>

        <ChangeOwnPassword onChanged={() => void refresh()} />
      </div>
    </Page>
  )
}

/**
 * Changement du mot de passe par son propriétaire. L'ancien est demandé : une session laissée
 * ouverte ne doit pas suffire à verrouiller son titulaire hors de son propre compte.
 */
function ChangeOwnPassword({ onChanged }: { onChanged: () => void }) {
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
      // Le drapeau « mot de passe à changer » vient de tomber : le relire éteint l'avertissement.
      onChanged()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('users.updateFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader title={t('users.changeOwn.title')} description={t('users.changeOwn.hint')} />
      <CardBody className="space-y-3">
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

          <Button type="submit" variant="primary" size="lg" loading={busy}>
            {t('users.changeOwn.submit')}
          </Button>
        </form>

        {notice && (
          <Notice tone="success" onDismiss={() => setNotice(null)}>
            {notice}
          </Notice>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
      </CardBody>
    </Card>
  )
}
