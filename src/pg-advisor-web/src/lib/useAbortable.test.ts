import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useAbortable } from './useAbortable'

/**
 * Le défaut que ce crochet corrige : deux chargements lancés coup sur coup, et rien qui garantisse
 * que le dernier parti soit le dernier arrivé. La réponse périmée écrasait l'état courant.
 */
describe('useAbortable', () => {
  it('abandonne le chargement précédent quand un nouveau démarre', () => {
    const { result } = renderHook(() => useAbortable())

    const premier = result.current()
    expect(premier.aborted).toBe(false)

    const second = result.current()

    expect(premier.aborted).toBe(true)
    expect(second.aborted).toBe(false)
  })

  it('rend un signal distinct à chaque appel', () => {
    const { result } = renderHook(() => useAbortable())

    expect(result.current()).not.toBe(result.current())
  })

  it('abandonne au démontage, pour ne pas écrire dans un composant disparu', () => {
    const { result, unmount } = renderHook(() => useAbortable())

    const signal = result.current()
    unmount()

    expect(signal.aborted).toBe(true)
  })
})
