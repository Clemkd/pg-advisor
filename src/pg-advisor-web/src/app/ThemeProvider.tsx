import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { STORAGE_KEY, ThemeContext, type Theme, type ThemeState } from './ThemeContext'

function readStored(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readStored())
  const [systemDark, setSystemDark] = useState(() => prefersDark())

  // Suit les changements de préférence système tant que l'utilisateur n'a pas choisi.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    media.addEventListener('change', handler)
    return () => media.removeEventListener('change', handler)
  }, [])

  const resolved: 'light' | 'dark' = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark')
  }, [resolved])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    if (next === 'system') {
      localStorage.removeItem(STORAGE_KEY)
    } else {
      localStorage.setItem(STORAGE_KEY, next)
    }
  }, [])

  const value = useMemo<ThemeState>(
    () => ({
      theme,
      resolved,
      setTheme,
      toggle: () => setTheme(resolved === 'dark' ? 'light' : 'dark'),
    }),
    [theme, resolved, setTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
