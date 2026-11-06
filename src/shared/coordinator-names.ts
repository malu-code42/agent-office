/**
 * AO-107: nomes dos coordenadores (orquestradores) das salas de squad.
 * Figuras marcantes da história da tecnologia e da ciência, no lugar do nome do grupo de tickets:
 * o vínculo com o grupo aparece no rótulo da sala e no subtítulo do crachá, não no nome.
 * Lista versionada: ao mudar a ordem ou os nomes, suba a versão (coordenadores existentes guardam o nome que já têm).
 */
export const COORDINATOR_NAMES_VERSION = 1

export const COORDINATOR_NAMES: readonly string[] = [
  'Ada Lovelace',
  'Alan Turing',
  'Grace Hopper',
  'Marie Curie',
  'Katherine Johnson',
  'Margaret Hamilton',
  'Claude Shannon',
  'Dorothy Vaughan',
  'Nikola Tesla',
  'Rosalind Franklin',
  'Linus Torvalds',
  'Hedy Lamarr',
  'Charles Babbage',
  'Barbara Liskov',
  'Edsger Dijkstra',
  'Mary Jackson',
]

/** FNV-1a de 32 bits: estável entre execuções, ao contrário de Math.random. */
function hash(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

function roman(n: number): string {
  const table: [number, string][] = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ]
  let rest = n
  let out = ''
  for (const [value, symbol] of table)
    while (rest >= value) {
      out += symbol
      rest -= value
    }
  return out
}

/**
 * Escolhe o nome do coordenador de uma sala. Pura: o mesmo `seed` (ex.: pasta + código da sala) e os mesmos
 * nomes ativos dão sempre o mesmo nome. Começa num ponto da lista derivado do seed e anda até o primeiro
 * nome livre; com a lista esgotada reaproveita o primeiro livre com sufixo ("Ada Lovelace II", "III"…).
 */
export function pickCoordinatorName(seed: string, active: Iterable<string>, names: readonly string[] = COORDINATOR_NAMES): string {
  const taken = new Set(active)
  const start = hash(seed) % names.length
  for (let round = 1; ; round++) {
    for (let i = 0; i < names.length; i++) {
      const base = names[(start + i) % names.length]!
      const candidate = round === 1 ? base : `${base} ${roman(round)}`
      if (!taken.has(candidate)) return candidate
    }
  }
}
