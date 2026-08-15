import { useCallback, useEffect, useState } from 'react'
import { api } from '@/api/client'
import { useEventListener, useEvents } from '@/app/EventsContext'

/**
 * Ce qui fait bouger le décompte : un diagnostic apparaît, le moteur le clôt, un opérateur
 * l'écarte ou le reconsidère, une instance entre ou sort de la supervision.
 */
const LIVE_EVENTS = ['finding.created', 'finding.resolved', 'finding.updated', 'instance.changed']

/** Repli lorsque le flux temps réel est interrompu. Il double le flux tant qu'il vit. */
const FALLBACK_POLL_MS = 60_000

export interface ActiveFindings {
  total: number
  critical: number
  warning: number
}

/**
 * Décompte des diagnostics actifs, pour la pastille de navigation.
 *
 * Lu une seule fois par la coquille puis transmis aux deux colonnes — celle du bureau et celle
 * du tiroir mobile sont montées ensemble, et chacune interrogerait l'API pour afficher le même
 * nombre.
 *
 * Un échec ne rend rien plutôt qu'un zéro : « aucun diagnostic » et « je n'ai pas pu compter »
 * ne se disent pas de la même façon, et un zéro inventé annoncerait le calme.
 */
export function useActiveFindings(): ActiveFindings | null {
  const { connected } = useEvents()
  const [counts, setCounts] = useState<ActiveFindings | null>(null)

  const load = useCallback(async () => {
    try {
      const summary = await api.findings.summary()
      setCounts({
        total: summary.active,
        critical: summary.critical,
        warning: summary.warning,
      })
    } catch {
      setCounts(null)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEventListener(LIVE_EVENTS, () => void load())

  useEffect(() => {
    if (connected) return
    const timer = window.setInterval(() => void load(), FALLBACK_POLL_MS)
    return () => window.clearInterval(timer)
  }, [connected, load])

  return counts
}
