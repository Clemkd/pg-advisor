import { useContext, useEffect, useRef } from 'react'
import { EventsContext, type EventsState, type Handler } from './EventsContext'

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
