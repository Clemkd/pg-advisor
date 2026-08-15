import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

/** Marge laissée sous le bloc, pour ne pas le coller au bas de la fenêtre. */
const BOTTOM_GAP = 20

/** En deçà, mieux vaut laisser la page défiler que d'écraser la liste. */
const MINIMUM = 220

/** Écart en deçà duquel reposer une hauteur ne vaut pas un rendu de plus. */
const TOLERANCE = 2

/**
 * Hauteur à donner à un bloc défilant pour qu'il occupe exactement la place restante sous lui :
 * la vue tient alors dans la fenêtre et c'est le bloc qui défile, jamais la page.
 *
 * Mesuré plutôt que budgété : un `max-height: calc(100dvh - Nrem)` devient faux dès qu'un
 * filtre, un avertissement ou un en-tête change de hauteur au-dessus du bloc.
 *
 * **La mesure ne doit pas dépendre de ce qu'elle produit.** Lue telle quelle, la position du bloc
 * inclut l'effet de la hauteur qu'on vient de lui poser : le bloc allonge la page, la page pousse
 * ou tire ce qui l'entoure, et la mesure suivante rend une autre valeur. Sur une page assez longue
 * pour défiler, cela donnait un éditeur qui grandissait seul, un peu à chaque rafraîchissement du
 * flux temps réel — sans frappe ni appel serveur. La hauteur est donc effacée le temps de lire la
 * position, ce qui fait de la mesure un point fixe : deux passages consécutifs rendent la même
 * valeur, et `setHeight` ne provoque plus de rendu.
 */
export function useFillHeight<T extends HTMLElement>(ref: RefObject<T | null>): number | undefined {
  const [height, setHeight] = useState<number>()

  /** Dernière hauteur posée, lue sans attendre le rendu qui la reflète. */
  const applied = useRef<number>(undefined)

  const measure = useCallback(() => {
    const element = ref.current
    if (!element) return

    // `minHeight` aussi : une hauteur nulle contrariée par un `min-h-*` laisserait le bloc peser
    // sur la page, et la mesure garderait la dérive qu'on cherche à supprimer.
    const style = element.style
    const keptHeight = style.height
    const keptMinHeight = style.minHeight
    style.height = '0px'
    style.minHeight = '0px'

    const top = element.getBoundingClientRect().top

    style.height = keptHeight
    style.minHeight = keptMinHeight

    const measured = Math.max(MINIMUM, Math.round(window.innerHeight - top - BOTTOM_GAP))
    const current = applied.current
    if (current !== undefined && Math.abs(measured - current) <= TOLERANCE) return

    applied.current = measured
    setHeight(measured)
  }, [ref])

  // À chaque rendu : ce qui précède le bloc a pu changer de hauteur sans que la fenêtre bouge.
  useLayoutEffect(measure)

  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  return height
}
