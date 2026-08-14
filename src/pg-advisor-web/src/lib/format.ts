import { currentLocale, hasTranslation, INTL_LOCALES, translate } from './i18n'

/**
 * Formatages partagés par les vues. Unités binaires pour les octets, et tout ce qui dépend de la
 * langue est lu au moment de l'appel : un changement de locale re-rend l'arbre, donc les valeurs
 * déjà affichées se reformatent.
 */

function t(key: string, vars?: Record<string, string | number>): string {
  return translate(currentLocale(), key, vars)
}

function intlLocale(): string {
  return INTL_LOCALES[currentLocale()]
}

/** Libellé issu d'une donnée : traduit s'il est connu, rendu tel quel sinon. */
function dataLabel(prefix: string, value: string): string {
  const key = `${prefix}.${value}`
  return hasTranslation(currentLocale(), key) ? t(key) : value
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—'
  }
  return new Intl.NumberFormat(intlLocale()).format(value)
}

export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—'
  }

  const units = [
    t('format.bytes.b'),
    t('format.bytes.kib'),
    t('format.bytes.mib'),
    t('format.bytes.gib'),
    t('format.bytes.tib'),
    t('format.bytes.pib'),
  ]
  let magnitude = Math.abs(value)
  let unit = 0

  while (magnitude >= 1024 && unit < units.length - 1) {
    magnitude /= 1024
    unit += 1
  }

  const decimals = unit === 0 ? 0 : magnitude < 10 ? 1 : 0
  return `${(value < 0 ? -magnitude : magnitude).toFixed(decimals)} ${units[unit]}`
}

export function formatPercent(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—'
  }
  // Le français sépare le nombre du signe pour cent, l'anglais le colle.
  const separator = currentLocale() === 'fr' ? ' ' : ''
  return `${(value * 100).toFixed(decimals)}${separator}%`
}

export function formatSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) {
    return '—'
  }

  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} h`
  return t('format.duration.days', { value: (seconds / 86400).toFixed(1) })
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(intlLocale(), { dateStyle: 'short', timeStyle: 'medium' })
}

/** Écart relatif lisible : « il y a 3 min », « 3 min ago ». */
export function formatRelative(value: string | null | undefined): string {
  if (!value) return t('common.never')

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return t('common.never')

  const seconds = (Date.now() - date.getTime()) / 1000
  const absolute = Math.abs(seconds)

  if (absolute < 10) return t('format.relative.now')
  if (absolute < 60) return t('format.relative.seconds', { value: Math.round(absolute) })
  if (absolute < 3600) return t('format.relative.minutes', { value: Math.round(absolute / 60) })
  if (absolute < 86400) return t('format.relative.hours', { value: Math.round(absolute / 3600) })
  return t('format.relative.days', { value: Math.round(absolute / 86400) })
}

export function categoryLabel(category: string): string {
  return dataLabel('category', category)
}

export function severityLabel(severity: string): string {
  return dataLabel('severity', severity)
}

export function statusLabel(status: string): string {
  return dataLabel('status', status)
}

export function collectionStateLabel(state: string): string {
  return dataLabel('collectionState', state)
}

export function qualifierLabel(value: string | null): string {
  if (!value) return '—'
  return dataLabel('qualifier', value)
}

/** Couleur du score : vert au-dessus de 90, ambre à partir de 70, rouge en dessous. */
export function scoreTone(score: number): 'good' | 'warn' | 'bad' {
  if (score >= 90) return 'good'
  if (score >= 70) return 'warn'
  return 'bad'
}
