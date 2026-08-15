import type { AdvisorEvent, RuleFailureKind } from '@/api/types'
import { currentLocale, hasTranslation, translate, tr } from './i18n'

/**
 * Garde-fou de coût : ce que l'interface a besoin de savoir d'une règle qui pèse sur la base
 * qu'elle observe.
 *
 * Une règle qui dépasse son délai, échoue, ou réussit trop lentement accumule des incidents par
 * couple (règle, instance). Au seuil d'avertissement elle est *dégradée*, au seuil de quarantaine
 * elle est *écartée* de cette instance pendant quelques heures. Le point important pour l'IHM :
 * une règle écartée cesse de produire son diagnostic, donc la catégorie qu'elle notait cesse
 * d'être notée — et le score de l'instance remonte sans raison. Rien de tout cela ne doit
 * s'apprendre en lisant un score.
 */

/** Les deux types SSE du garde-fou. Toute vue qui affiche un état de santé les écoute. */
export const RULE_GUARD_EVENTS = ['rule.guard', 'rule.recovered']

/** Charge utile diffusée par le serveur. Tous les champs sont facultatifs à la lecture. */
interface GuardPayload {
  connectionId?: number
  connectionName?: string
  ruleId?: string
  ruleName?: string
  state?: string
  strikes?: number
  failureKind?: string
  message?: string
  quarantinedUntil?: string
  reason?: string
}

function payloadOf(event: AdvisorEvent): GuardPayload {
  return typeof event.data === 'object' && event.data !== null ? (event.data as GuardPayload) : {}
}

/**
 * Annonce d'un événement du garde-fou, à confier à `LiveRegion`. La traduction est lue au moment
 * de l'annonce : le message est transitoire, et le rappel qui l'écrit ne dépend pas de la langue.
 */
export function guardAnnouncement(event: AdvisorEvent): string {
  const payload = payloadOf(event)
  const vars = {
    rule: payload.ruleName ?? payload.ruleId ?? '',
    instance: payload.connectionName ?? '',
  }

  if (event.type === 'rule.recovered') return tr('rules.live.recovered', vars)
  if (payload.state === 'quarantined') return tr('rules.live.quarantined', vars)
  return tr('rules.live.degraded', vars)
}

/** Identifiant de la règle concernée, pour ne rafraîchir que la vue qui la regarde. */
export function guardRuleId(event: AdvisorEvent): string | null {
  return payloadOf(event).ruleId ?? null
}

/** Libellé de la nature du dernier incident : dépassement de délai, erreur SQL, ou lenteur. */
export function failureKindLabel(kind: RuleFailureKind | string): string {
  const key = `ruleHealth.kind.${kind}`
  return hasTranslation(currentLocale(), key) ? translate(currentLocale(), key) : kind
}

/** Ce que l'incident dit de la cause : l'instance souffre, ou la règle est fautive. */
export function failureKindHint(kind: RuleFailureKind | string): string | null {
  const key = `ruleHealth.kindHint.${kind}`
  return hasTranslation(currentLocale(), key) ? translate(currentLocale(), key) : null
}
