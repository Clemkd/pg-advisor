import { createContext } from 'react'

export type Theme = 'light' | 'dark' | 'system'

export const STORAGE_KEY = 'pg-advisor.theme'

export interface ThemeState {
  theme: Theme
  resolved: 'light' | 'dark'
  setTheme: (theme: Theme) => void
  toggle: () => void
}

export const ThemeContext = createContext<ThemeState | null>(null)

