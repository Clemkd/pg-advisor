import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

/** Marge laissée sous le bloc, pour ne pas le coller au bas de la fenêtre. */
const BOTTOM_GAP = 20

/** En deçà, mieux vaut laisser la page défiler que d'écraser la liste. */
const MINIMUM = 220

/** Écart en deçà duquel reposer une hauteur ne vaut pas un rendu de plus. */
const TOLERANCE = 2

/**
 * Passages consécutifs accordés à la mesure avant de la tenir pour non convergente.
 *
 * Trois suffisent à absorber un ascenseur qui apparaît ou un bandeau qui se replie ; au-delà,
 * c'est que la hauteur posée modifie ce qui la détermine, et poursuivre ne rapprocherait de rien.
 */
const MAX_PASSES = 3

/**
 * Hauteur à donner à un bloc défilant pour qu'il occupe exactement la place restante sous lui :
 * la vue tient alors dans la fenêtre et c'est le bloc qui défile, jamais la page.
 *
 * Mesuré plutôt que budgété : un `max-height: calc(100dvh - Nrem)` devient faux dès qu'un
 * filtre, un avertissement ou un en-tête change de hauteur au-dessus du bloc.
 *
 * La mesure se rattrape elle-même. Poser la hauteur change la hauteur de la page, donc son
 * défilement, donc la position du bloc, donc la hauteur mesurée : sur une page assez longue pour
 * défiler, les deux valeurs s'appellent sans fin et React finit par lever « Maximum update depth
 * exceeded ». Le nombre de passages consécutifs est donc borné — la dernière hauteur tenue reste
 * en place, à quelques pixels près de l'idéal, ce qui ne se voit pas ; la boucle, elle, se voyait.
 */
export function useFillHeight<T extends HTMLElement>(ref: RefObject<T | null>): number | undefined {
  const [height, setHeight] = useState<number>()

  /** Dernière hauteur posée, lue sans attendre le rendu qui la reflète. */
  const applied = useRef<number>(undefined)

  /** Passages de la salve en cours. Remis à zéro dès qu'une mesure vient d'ailleurs. */
  const passes = useRef(0)

  /** Vrai lorsque le rendu qui suit est celui que cette mesure a provoqué. */
  const chained = useRef(false)

  const measure = useCallback(() => {
    const element = ref.current
    if (!element) return

    // Une mesure qui ne fait pas suite à la nôtre vient d'un vrai changement de la vue : la
    // salve précédente est close, celle-ci a droit à ses propres passages.
    if (!chained.current) passes.current = 0
    chained.current = false

    const top = element.getBoundingClientRect().top
    const measured = Math.max(MINIMUM, Math.round(window.innerHeight - top - BOTTOM_GAP))
    const current = applied.current

    if (current !== undefined && Math.abs(measured - current) <= TOLERANCE) {
      passes.current = 0
      return
    }

    if (passes.current >= MAX_PASSES) return

    passes.current += 1
    applied.current = measured
    chained.current = true
    setHeight(measured)
  }, [ref])

  // À chaque rendu : ce qui précède le bloc a pu changer de hauteur sans que la fenêtre bouge.
  useLayoutEffect(measure)

  useEffect(() => {
    // Redimensionner la fenêtre rebat les cartes : la salve repart de zéro.
    const onResize = () => {
      passes.current = 0
      chained.current = false
      measure()
    }

    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [measure])

  return height
}
