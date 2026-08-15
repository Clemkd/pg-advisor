import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * Tailles de police nommées par rôle, déclarées dans `index.css`.
 *
 * Sans cette déclaration, tailwind-merge ne peut pas savoir que `text-display` est une taille :
 * il la range avec les couleurs, `text-display` et `text-danger` se disputent la même famille, et
 * la dernière écrite gagne. Un chiffre de tableau de bord teinté par sa valeur retombait ainsi à
 * la taille du corps de texte — 14 px au lieu de 32 — sans que rien ne le signale.
 */
const FONT_SIZES = ['display', 'metric', 'title', 'section', 'body', 'meta', 'micro']

const merge = extendTailwindMerge({
  extend: { classGroups: { 'font-size': [{ text: FONT_SIZES }] } },
})

/** Fusionne des classes conditionnelles en résolvant les conflits Tailwind. */
export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs))
}

/** Initiales d'un identifiant, pour la pastille de compte. */
export function initials(name?: string | null): string {
  if (!name) return '?'
  return name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}
