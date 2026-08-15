import { useEffect, useRef, useState } from 'react'

/**
 * Durée du signal de fraîcheur, alignée sur `--motion-fresh`.
 *
 * Six secondes, et non trois cents millisecondes : l'application vit ouverte, souvent sur un
 * second écran, et l'utilisateur regarde *après* le changement.
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
 *
 * Sert désormais à déclencher une annonce (`LiveRegion`), non à peindre : voir `freshClass`.
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
 * Ne peint plus rien, et le restera.
 *
 * Le marquage par teinte demandait d'avoir regardé au bon moment : six secondes plus tard, la
 * carte ne disait plus rien. Pire, sur un écran qui se recharge seul toute la journée, la teinte
 * finissait par se lire comme un état de la donnée plutôt que comme l'instant du chargement. La
 * fraîcheur se dit par un chiffre qui reste vrai — `LastUpdated`, « Mis à jour il y a 5 s ».
 *
 * La fonction subsiste le temps que les appels disparaissent des vues, et sera retirée ensuite.
 */
export function freshClass(_fresh: boolean): string {
  return ''
}
