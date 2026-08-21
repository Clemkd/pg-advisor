/**
 * Localisation de la ligne fautive d'un YAML, séparée des composants qui l'affichent : un module
 * exportant à la fois une fonction et un composant force un rechargement complet de la page
 * plutôt qu'un remplacement à chaud, à chaque frappe dans l'éditeur de règles.
 */

/** Numéro de la première ligne déclarant `path`, en suivant l'indentation. */
function findPath(lines: string[], path: string[]): number | null {
  let found: number | null = null
  let parentIndent = -1
  let from = 0

  for (const segment of path) {
    let hit: number | null = null

    for (let index = from; index < lines.length; index++) {
      const match = /^(\s*)(?:- )?["']?([\w.-]+)["']?\s*:/.exec(lines[index] ?? '')
      if (!match) continue

      const indent = match[1]!.length
      // Sorti du bloc du parent : le segment cherché n'y était pas.
      if (parentIndent >= 0 && indent <= parentIndent) break
      if (match[2] === segment) {
        hit = index
        break
      }
    }

    if (hit === null) return found
    found = hit
    parentIndent = /^(\s*)/.exec(lines[hit] ?? '')![1]!.length
    from = hit + 1
  }

  return found === null ? null : found + 1
}

/**
 * Ligne visée par un message de validation, quand elle est identifiable.
 *
 * Les messages du serveur portent, selon les cas, une position (« (line 14) »), un chemin de
 * champ entre guillemets (« "recommendation.title" ») ou le seul nom du champ fautif. Aucun n'est
 * garanti : la fonction rend `null` plutôt que de désigner une ligne au hasard, et l'erreur reste
 * alors lisible dans la liste.
 */
export function errorLine(message: string, yaml: string): number | null {
  const explicit = /\(line\s+(\d+)\)/i.exec(message)
  if (explicit) return Number(explicit[1])

  const lines = yaml.split('\n')

  const quoted = /"([A-Za-z][\w.]*)"/.exec(message)
  if (quoted) {
    const byPath = findPath(lines, (quoted[1] ?? '').split('.'))
    if (byPath !== null) return byPath
  }

  // À défaut, le premier mot du message qui nomme une clé présente dans le document. Les plus
  // longs d'abord : « recommendation » l'emporte sur « id ».
  const words = [...new Set(message.match(/[A-Za-z][\w]{1,}/g) ?? [])].sort(
    (left, right) => right.length - left.length,
  )
  for (const word of words) {
    const byKey = findPath(lines, [word])
    if (byKey !== null) return byKey
  }

  return null
}
