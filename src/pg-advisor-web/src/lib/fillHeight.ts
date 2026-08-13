import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react'

/** Marge laissée sous le bloc, pour ne pas le coller au bas de la fenêtre. */
const BOTTOM_GAP = 20

/** En deçà, mieux vaut laisser la page défiler que d'écraser la liste. */
const MINIMUM = 220

/**
 * Hauteur à donner à un bloc défilant pour qu'il occupe exactement la place restante sous lui :
 * la vue tient alors dans la fenêtre et c'est le bloc qui défile, jamais la page.
 *
 * Mesuré plutôt que budgété : un `max-height: calc(100dvh - Nrem)` devient faux dès qu'un
 * filtre, un avertissement ou un en-tête change de hauteur au-dessus du bloc.
 */
export function useFillHeight<T extends HTMLElement>(ref: RefObject<T | null>): number | undefined {
  const [height, setHeight] = useState<number>()

  const measure = useCallback(() => {
    const element = ref.current
    if (!element) return

    const top = element.getBoundingClientRect().top
    setHeight(Math.max(MINIMUM, Math.round(window.innerHeight - top - BOTTOM_GAP)))
  }, [ref])

  // À chaque rendu : ce qui précède le bloc a pu changer de hauteur sans que la fenêtre bouge.
  // React ignore une valeur identique, la mesure converge donc en un seul passage.
  useLayoutEffect(measure)

  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  return height
}
