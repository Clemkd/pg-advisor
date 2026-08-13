import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { AdvisorEvent } from '../api/types'
import { useAuth } from './AuthContext'

type Handler = (event: AdvisorEvent) => void

interface EventsState {
  connected: boolean
  lastEvent: AdvisorEvent | null
  /** S'abonne à un type d'événement, ou à tous avec « * ». */
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
  'stream.open',
]

/**
 * Flux temps réel. EventSource gère lui-même la reconnexion ; on ne s'y branche que
 * lorsqu'une session est ouverte, la route étant protégée par [Authorize].
 */
export function EventsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [connected, setConnected] = useState(false)
  const [lastEvent, setLastEvent] = useState<AdvisorEvent | null>(null)
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

      setLastEvent(parsed)
      handlers.current.get(parsed.type)?.forEach((handler) => handler(parsed))
      handlers.current.get('*')?.forEach((handler) => handler(parsed))
    }

    source.onopen = () => setConnected(true)
    source.onerror = () => setConnected(false)
    EVENT_TYPES.forEach((type) => source.addEventListener(type, dispatch as EventListener))

    return () => {
      EVENT_TYPES.forEach((type) => source.removeEventListener(type, dispatch as EventListener))
      source.close()
      setConnected(false)
    }
  }, [user])

  const value = useMemo<EventsState>(
    () => ({
      connected,
      lastEvent,
      subscribe: (type, handler) => {
        const set = handlers.current.get(type) ?? new Set<Handler>()
        set.add(handler)
        handlers.current.set(type, set)
        return () => set.delete(handler)
      },
    }),
    [connected, lastEvent],
  )

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
