import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  LocaleContext,
  STORAGE_KEY,
  setActiveLocale,
  translate,
  translatePlural,
  type Locale,
  type LocaleState,
} from './i18n'

function readStored(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'fr' || stored === 'en') return stored
  // À défaut de choix explicite, la langue du navigateur, français par défaut.
  return navigator.language.toLowerCase().startsWith('en') ? 'en' : 'fr'
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const initial = readStored()
    setActiveLocale(initial)
    document.documentElement.lang = initial
    return initial
  })

  const setLocale = useCallback((next: Locale) => {
    setActiveLocale(next)
    document.documentElement.lang = next
    localStorage.setItem(STORAGE_KEY, next)
    setLocaleState(next)
  }, [])

  const value = useMemo<LocaleState>(
    () => ({
      locale,
      setLocale,
      t: (key, vars) => translate(locale, key, vars),
      tc: (key, count, vars) => translatePlural(locale, key, count, vars),
    }),
    [locale, setLocale],
  )

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}
