/** Formatages partagés par les vues. Locale française, unités binaires pour les octets. */

const numberFormat = new Intl.NumberFormat('fr-FR')

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—'
  }
  return numberFormat.format(value)
}

export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—'
  }

  const units = ['o', 'Kio', 'Mio', 'Gio', 'Tio', 'Pio']
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
  return `${(value * 100).toFixed(decimals)} %`
}

export function formatSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) {
    return '—'
  }

  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} h`
  return `${(seconds / 86400).toFixed(1)} j`
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })
}

/** Écart relatif lisible : « il y a 3 min », « dans 2 h ». */
export function formatRelative(value: string | null | undefined): string {
  if (!value) return 'jamais'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'jamais'

  const seconds = (Date.now() - date.getTime()) / 1000
  const absolute = Math.abs(seconds)

  if (absolute < 10) return "à l'instant"
  if (absolute < 60) return `il y a ${Math.round(absolute)} s`
  if (absolute < 3600) return `il y a ${Math.round(absolute / 60)} min`
  if (absolute < 86400) return `il y a ${Math.round(absolute / 3600)} h`
  return `il y a ${Math.round(absolute / 86400)} j`
}

const CATEGORY_LABELS: Record<string, string> = {
  performance: 'Performance',
  queries: 'Requêtes',
  indexes: 'Index',
  vacuum: 'Vacuum',
  bloat: 'Espace perdu',
  connections: 'Connexions',
  locks: 'Verrous',
  transactions: 'Transactions',
  checkpoints: 'Checkpoints',
  configuration: 'Configuration',
  storage: 'Stockage',
  statistics: 'Statistiques',
  security: 'Sécurité',
  timescaledb: 'TimescaleDB',
  extensions: 'Extensions',
}

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category
}

const SEVERITY_LABELS: Record<string, string> = {
  critical: 'Critique',
  warning: 'Avertissement',
  info: 'Information',
}

export function severityLabel(severity: string): string {
  return SEVERITY_LABELS[severity] ?? severity
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Actif',
  resolved: 'Résolu',
  ignored: 'Ignoré',
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

const COLLECTION_STATE_LABELS: Record<string, string> = {
  unknown: 'En attente',
  collecting: 'Collecte',
  analyzing: 'Analyse',
  idle: 'À jour',
  error: 'Erreur',
  disabled: 'Désactivée',
}

export function collectionStateLabel(state: string): string {
  return COLLECTION_STATE_LABELS[state] ?? state
}

const QUALIFIER_LABELS: Record<string, string> = {
  low: 'faible',
  medium: 'moyen',
  high: 'élevé',
}

export function qualifierLabel(value: string | null): string {
  if (!value) return '—'
  return QUALIFIER_LABELS[value] ?? value
}

/** Couleur du score : vert au-dessus de 90, ambre à partir de 70, rouge en dessous. */
export function scoreTone(score: number): 'good' | 'warn' | 'bad' {
  if (score >= 90) return 'good'
  if (score >= 70) return 'warn'
  return 'bad'
}
