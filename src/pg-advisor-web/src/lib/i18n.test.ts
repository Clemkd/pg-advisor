import { describe, expect, it } from 'vitest'
import { en } from './locales/en'
import { enInstances } from './locales/en.instances'
import { enQueries } from './locales/en.queries'
import { enRules } from './locales/en.rules'
import { fr } from './locales/fr'
import { frInstances } from './locales/fr.instances'
import { frQueries } from './locales/fr.queries'
import { frRules } from './locales/fr.rules'
import { translate } from './i18n'

/**
 * Une clé traduite d'un seul côté ne casse rien : `translate` retombe sur le français, puis sur la
 * clé elle-même. Elle passe donc inaperçue jusqu'à ce qu'un utilisateur anglophone lise
 * « rules.editor.saveHint » à l'écran. Ces vérifications remplacent une relecture manuelle.
 */
const catalogues: [string, Record<string, string>, Record<string, string>][] = [
  ['commun', fr, en],
  ['instances', frInstances, enInstances],
  ['requêtes', frQueries, enQueries],
  ['règles', frRules, enRules],
]

describe('catalogues de traduction', () => {
  it.each(catalogues)('%s : les deux langues portent les mêmes clés', (_nom, source, cible) => {
    expect(Object.keys(cible).sort()).toEqual(Object.keys(source).sort())
  })

  it.each(catalogues)('%s : aucune traduction vide', (_nom, source, cible) => {
    const vides = [...Object.entries(source), ...Object.entries(cible)]
      .filter(([, valeur]) => valeur.trim().length === 0)
      .map(([cle]) => cle)

    expect(vides).toEqual([])
  })

  /**
   * Les variables sont substituées par nom : `{count}` absent de la traduction laisse une phrase
   * amputée, et une variable inventée d'un côté ne sera jamais remplacée.
   */
  it.each(catalogues)('%s : les mêmes variables de part et d\'autre', (_nom, source, cible) => {
    const variables = (modele: string) => (modele.match(/\{(\w+)\}/g) ?? []).sort()

    const divergentes = Object.keys(source)
      .filter((cle) => cible[cle] !== undefined)
      .filter((cle) => variables(source[cle]).join() !== variables(cible[cle]).join())

    expect(divergentes).toEqual([])
  })
})

describe('translate', () => {
  it('substitue les variables nommées', () =>
    expect(translate('en', 'error.http', { status: 503 })).toBe('Error 503'))

  it('rend la clé plutôt que rien lorsqu\'elle est inconnue', () =>
    expect(translate('en', 'cette.cle.nexiste.pas')).toBe('cette.cle.nexiste.pas'))
})
