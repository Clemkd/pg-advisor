import { createContext, useContext } from 'react'
import { en } from './locales/en'
import { enInstances } from './locales/en.instances'
import { enQueries } from './locales/en.queries'
import { enRules } from './locales/en.rules'
import { fr } from './locales/fr'
import { frInstances } from './locales/fr.instances'
import { frQueries } from './locales/fr.queries'
import { frRules } from './locales/fr.rules'

export type Locale = 'fr' | 'en'

export const LOCALES: Locale[] = ['fr', 'en']

/** Chaque langue est nommée dans sa propre langue : c'est ce qu'un lecteur reconnaît. */
export const LOCALE_LABELS: Record<Locale, string> = { fr: 'Français', en: 'English' }

export const STORAGE_KEY = 'pg-advisor.locale'

// Un catalogue par zone, fusionné ici : les vues d'une zone se traduisent sans toucher au
// fichier des autres.
const CATALOGUES: Record<Locale, Record<string, string>> = {
  fr: { ...fr, ...frQueries, ...frInstances, ...frRules },
  en: { ...en, ...enQueries, ...enInstances, ...enRules },
}

/**
 * Locale courante lisible hors React. Les formatages de lib/format.ts sont appelés depuis
 * partout, y compris dans des fonctions pures ; leur passer la locale en paramètre à chaque
 * appel alourdirait une trentaine de fichiers pour rien.
 */
let activeLocale: Locale = 'fr'

/** Le fournisseur la pose au montage et à chaque bascule. */
export function setActiveLocale(next: Locale): void {
  activeLocale = next
}

export function currentLocale(): Locale {
  return activeLocale
}

export type TranslateVars = Record<string, string | number>

/**
 * Vrai si la clé est connue. Sert aux libellés issus de données : une catégorie inventée par une
 * règle utilisateur doit s'afficher telle quelle, sans avertissement de clé manquante.
 */
export function hasTranslation(locale: Locale, key: string): boolean {
  return CATALOGUES[locale][key] !== undefined || CATALOGUES.fr[key] !== undefined
}

/** Repli en cascade : la langue demandée, puis le français, puis la clé elle-même. */
export function translate(locale: Locale, key: string, vars?: TranslateVars): string {
  const template = CATALOGUES[locale][key] ?? CATALOGUES.fr[key] ?? key

  if (import.meta.env.DEV && CATALOGUES[locale][key] === undefined) {
    console.warn(`[i18n] missing key in "${locale}": ${key}`)
  }

  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    vars[name] === undefined ? `{${name}}` : String(vars[name]),
  )
}

export type Translator = (key: string, vars?: TranslateVars) => string

/**
 * Traduction hors rendu, pour les rappels stables — un chargeur mémorisé par `useCallback`, par
 * exemple. Passer le `t` du contexte y ajouterait une dépendance qui change avec la langue, et
 * recréerait le rappel : les vues se rechargeraient à chaque bascule de langue pour rien.
 */
export function tr(key: string, vars?: TranslateVars): string {
  return translate(activeLocale, key, vars)
}

/** Correspondance avec les locales Intl, partagée avec lib/format.ts. */
export const INTL_LOCALES: Record<Locale, string> = { fr: 'fr-FR', en: 'en-GB' }

const pluralRules = new Map<Locale, Intl.PluralRules>()

/**
 * Accord en nombre. Les catégories viennent d'Intl plutôt que d'une règle écrite à la main :
 * le français range le zéro avec le singulier, l'anglais avec le pluriel, et les deux ont des
 * cas particuliers qu'on aurait tort de deviner. `count` est toujours injecté comme variable.
 */
export function translatePlural(
  locale: Locale,
  key: string,
  count: number,
  vars?: TranslateVars,
): string {
  let rules = pluralRules.get(locale)
  if (!rules) {
    rules = new Intl.PluralRules(INTL_LOCALES[locale])
    pluralRules.set(locale, rules)
  }

  const category = rules.select(count)
  const withCount = { count, ...vars }
  const candidate = `${key}.${category}`
  return hasTranslation(locale, candidate)
    ? translate(locale, candidate, withCount)
    : translate(locale, `${key}.other`, withCount)
}

export type PluralTranslator = (key: string, count: number, vars?: TranslateVars) => string

export interface LocaleState {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: Translator
  /** Variante accordée en nombre : `tc('dashboard.instances', instances.length)`. */
  tc: PluralTranslator
}

export const LocaleContext = createContext<LocaleState | null>(null)

function useLocaleState(): LocaleState {
  const context = useContext(LocaleContext)
  if (!context) {
    throw new Error('useLocale doit être utilisé dans un LocaleProvider.')
  }
  return context
}

export function useLocale(): LocaleState {
  return useLocaleState()
}

/** Raccourci de loin le plus utilisé : `const t = useT()` puis `t('findings.title')`. */
export function useT(): Translator {
  return useLocaleState().t
}

/** Accord en nombre : `const tc = useTc()` puis `tc('dashboard.instances', 3)`. */
export function useTc(): PluralTranslator {
  return useLocaleState().tc
}
