import { useEffect, useRef } from 'react'

/**
 * Fournit un signal d'annulation par chargement, et abandonne le précédent.
 *
 * Sans cela, deux chargements déclenchés coup sur coup — un filtre que l'on affine, un onglet que
 * l'on change — courent en parallèle, et rien ne garantit que le dernier parti soit le dernier
 * arrivé : une réponse périmée écrasait alors l'état courant. Le signal est aussi abandonné au
 * démontage, pour ne pas écrire dans un composant qui n'est plus là.
 */
export function useAbortable(): () => AbortSignal {
  const current = useRef<AbortController | null>(null)

  useEffect(() => () => current.current?.abort(), [])

  return () => {
    current.current?.abort()
    current.current = new AbortController()
    return current.current.signal
  }
}
