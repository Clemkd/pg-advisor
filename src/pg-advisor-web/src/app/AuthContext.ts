import { createContext } from 'react'
import type { CurrentUser } from '../api/types'

export interface AuthState {
  user: CurrentUser | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
  isAdmin: boolean
}

export const AuthContext = createContext<AuthState | null>(null)
