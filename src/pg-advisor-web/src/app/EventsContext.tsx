import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiError, api, notifyUnauthorized } from '../api/client'
import type { AdvisorEvent } from '../api/types'
import { useAuth } from './AuthContext'

type Handler = (event: AdvisorEvent) => void

interface EventsState {
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

const EventsContext = createContext<EventsState | null>(null)

const EVENT_TYPES = [
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
export function EventsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [connected, setConnected] = useState(false)
  const handlers = useRef(new Map<string, Set<Handler>>())

  useEffect(() => {
    if (!user) {
      setConnected(false)
      return
    }

    const source = new EventSource('/api/events', { withCredentials: true })

    const dispatch = (event: MessageEvent<string>) => {
      let parsed: AdvisorEvent
      try {
        parsed = JSON.parse(event.data) as AdvisorEvent
      } catch {
        return
      }

      handlers.current.get(parsed.type)?.forEach((handler) => handler(parsed))
      handlers.current.get('*')?.forEach((handler) => handler(parsed))
    }

    source.onopen = () => setConnected(true)

    // EventSource ne passe pas par le client d'API : la déconnexion automatique sur 401 lui
    // échappe. Sans ce contrôle, un cookie expiré laisse le navigateur retenter indéfiniment
    // pendant que l'interface se croit connectée. On interroge la session, et on rend la main
    // au contexte d'authentification si elle est bien perdue.
    source.onerror = () => {
      setConnected(false)

      void api.auth.me().catch((cause) => {
        if (cause instanceof ApiError && cause.status === 401) {
          notifyUnauthorized()
        }
      })
    }
    EVENT_TYPES.forEach((type) => source.addEventListener(type, dispatch as EventListener))

    return () => {
      EVENT_TYPES.forEach((type) => source.removeEventListener(type, dispatch as EventListener))
      source.close()
      setConnected(false)
    }
  }, [user])

  const subscribe = useCallback<EventsState['subscribe']>((type, handler) => {
    const set = handlers.current.get(type) ?? new Set<Handler>()
    set.add(handler)
    handlers.current.set(type, set)

    return () => {
      set.delete(handler)
      if (set.size === 0) handlers.current.delete(type)
    }
  }, [])

  const value = useMemo<EventsState>(() => ({ connected, subscribe }), [connected, subscribe])

  return <EventsContext.Provider value={value}>{children}</EventsContext.Provider>
}

export function useEvents(): EventsState {
  const context = useContext(EventsContext)
  if (!context) {
    throw new Error('useEvents doit être utilisé dans un EventsProvider.')
  }
  return context
}

/** Exécute un rappel à chaque événement des types demandés. */
export function useEventListener(types: string[], handler: Handler) {
  const { subscribe } = useEvents()
  const stable = useRef(handler)
  stable.current = handler

  useEffect(() => {
    const unsubscribes = types.map((type) => subscribe(type, (event) => stable.current(event)))
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe, types.join('|')])
}
