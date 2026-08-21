/**
 * Numéros des lignes de `after` ajoutées ou modifiées par rapport à `before`, à partir de 1.
 *
 * Comparer ligne à ligne par leur rang serait faux dès la première insertion : tout ce qui suit
 * paraîtrait modifié. On passe donc par la plus longue sous-séquence commune, qui aligne les
 * lignes inchangées et ne laisse ressortir que ce qui a bougé.
 *
 * Une suppression n'a pas de ligne à marquer dans le texte courant : elle ne se signale pas ici.
 */
export function changedLines(before: string, after: string): Set<number> {
  const source = before.split('\n')
  const target = after.split('\n')

  // table[i][j] : longueur de la sous-séquence commune de source[i:] et target[j:].
  const table: number[][] = Array.from({ length: source.length + 1 }, () =>
    new Array<number>(target.length + 1).fill(0),
  )

  // Le tableau est rempli de zéros et bordé d'une ligne et d'une colonne : un accès au-delà vaut
  // donc zéro par construction, ce que cet accesseur dit au compilateur sans rien assumer.
  const at = (i: number, j: number) => table[i]?.[j] ?? 0

  for (let i = source.length - 1; i >= 0; i--) {
    const row = table[i]
    if (!row) continue

    for (let j = target.length - 1; j >= 0; j--) {
      row[j] = source[i] === target[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1))
    }
  }

  const changed = new Set<number>()
  let i = 0
  let j = 0

  while (i < source.length && j < target.length) {
    if (source[i] === target[j]) {
      i += 1
      j += 1
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      i += 1
    } else {
      changed.add(j + 1)
      j += 1
    }
  }

  while (j < target.length) {
    changed.add(j + 1)
    j += 1
  }

  return changed
}
