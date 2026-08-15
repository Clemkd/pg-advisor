import { useEffect, useRef, useState } from 'react'

/**
 * Durée du signal de fraîcheur, alignée sur `--motion-fresh`.
 *
 * Six secondes, et non trois cents millisecondes : l'application vit ouverte, souvent sur un
 * second écran, et l'utilisateur regarde *après* le changement. Un éclair qu'il faut avoir vu ne
 * signale rien.
 */
export const FRESH_MS = 6000

/**
 * Vrai pendant la durée du signal qui suit un changement de `watch`.
 *
 * À surveiller : une valeur comparable par identité — un compteur, un horodatage, un statut.
 * Passer un objet reconstruit à chaque chargement marquerait tout à chaque passage, ce qui revient
 * à ne rien marquer.
 *
 * Rien ne s'allume au montage : une liste qui s'affiche n'est pas une liste qui change.
 */
export function useFresh(watch: unknown, ms: number = FRESH_MS): boolean {
  const previous = useRef(watch)
  const [fresh, setFresh] = useState(false)

  useEffect(() => {
    if (Object.is(previous.current, watch)) return

    previous.current = watch
    setFresh(true)
    const timer = window.setTimeout(() => setFresh(false), ms)
    return () => window.clearTimeout(timer)
  }, [watch, ms])

  return fresh
}

/**
 * Classe de mise en évidence à poser sur l'élément qui vient de changer. Tient sur n'importe quel
 * élément, ligne de tableau comprise : le liseré est peint en fond, là où une bordure ou une ombre
 * interne se dérobent sur un `<tr>`.
 */
export function freshClass(fresh: boolean): string {
  return fresh ? 'pg-fresh' : ''
}
