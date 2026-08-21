import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiError, api, notifyUnauthorized } from '../api/client'
import type { AdvisorEvent } from '../api/types'
import { EVENT_TYPES, EventsContext, type EventsState, type Handler } from './EventsContext'
import { useAuth } from './useAuth'

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
