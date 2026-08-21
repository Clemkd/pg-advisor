import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api, onUnauthorized } from '../api/client'
import type { CurrentUser } from '../api/types'
import { AuthContext, type AuthState } from './AuthContext'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setUser(await api.auth.me())
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Une réponse 401 sur n'importe quel appel ramène l'utilisateur à l'écran de connexion.
  useEffect(() => onUnauthorized(() => setUser(null)), [])

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      isAdmin: user?.role === 'Admin',
      refresh,
      login: async (username, password) => {
        setUser(await api.auth.login(username, password))
      },
      logout: async () => {
        await api.auth.logout()
        setUser(null)
      },
    }),
    [user, loading, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
