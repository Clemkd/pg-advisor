import { createContext } from 'react'
import type { AdvisorEvent } from '../api/types'
export type Handler = (event: AdvisorEvent) => void

export interface EventsState {
  connected: boolean

  /**
   * S'abonne à un type d'événement, ou à tous avec « * ».
   *
   * Son identité est stable : elle l'était si peu que le contexte changeait à chaque événement,
   * et tous les abonnés de l'application se désabonnaient puis se réabonnaient à chaque fois —
   * dix fois par minute, le groupe « health » suffisant à l'entretenir.
   */
  subscribe: (type: string, handler: Handler) => () => void
}

export const EventsContext = createContext<EventsState | null>(null)

export const EVENT_TYPES = [
  'finding.created',
  'finding.resolved',
  'finding.updated',
  'health.changed',
  'collection.state',
  'analysis.progress',
  'rules.reloaded',
  'instance.changed',
  // Garde-fou de coût : une règle signalée, écartée, ou rétablie sur une instance. Un type
  // absent d'ici n'est jamais écouté — `EventSource` ne délivre que les noms enregistrés.
  'rule.guard',
  'rule.recovered',
  'stream.open',
]

/**
 * Flux temps réel. EventSource gère lui-même la reconnexion ; on ne s'y branche que
 * lorsqu'une session est ouverte, la route étant protégée par [Authorize].
 */
