/**
 * Posição dos cartões da aba Dia da Agenda (AO-90). Função pura: recebe horários "HH:MM" e devolve, por evento,
 * coluna, total de colunas, topo e altura em minutos, mais o intervalo do eixo. Eventos que se sobrepõem formam um
 * grupo e dividem a largura lado a lado, como no Google Agenda; a agenda.md só guarda o início, então o fim vem de
 * uma duração padrão quando não é informado.
 */

export type DayEventInput = {
  /** Início, "HH:MM". */
  at: string
  /** Fim, "HH:MM", quando existir. Fim menor ou igual ao início atravessa a meia-noite. */
  end?: string
  /** Duração usada sem fim. Padrão: 50 min (uma aula). */
  defaultMinutes?: number
}

export type DayEventLayout = {
  /** Posição do evento na lista recebida. */
  index: number
  /** Coluna do evento dentro do seu grupo de sobreposição (0 é a da esquerda). */
  column: number
  /** Quantas colunas o grupo tem; a largura do cartão é 1/columns. */
  columns: number
  startMin: number
  endMin: number
  /** Minutos desde o início do eixo. */
  top: number
  /** Duração em minutos, nunca menor que o mínimo legível. */
  height: number
}

export type DayLayout = {
  events: DayEventLayout[]
  /** Eixo em minutos do dia, sempre em horas cheias. */
  range: { from: number; to: number }
}

export const DEFAULT_EVENT_MINUTES = 50
/** Um cartão mais curto que isto não comporta hora e título; vale também para decidir o que se sobrepõe. */
export const MIN_EVENT_MINUTES = 40
/** Folga de uma hora antes do primeiro e depois do último evento. */
export const RANGE_PADDING_MINUTES = 60
/** Eixo mínimo, para um único evento não virar uma faixa minúscula. */
export const MIN_RANGE_MINUTES = 4 * 60
const DAY_MINUTES = 24 * 60
/** Eixo mostrado quando o dia não tem eventos. */
export const EMPTY_RANGE = { from: 7 * 60, to: 11 * 60 }

export function toMinutes(hm: string): number {
  const [hh, mm] = hm.split(':').map(Number)
  return hh * 60 + mm
}

export function layoutDayEvents(inputs: DayEventInput[]): DayLayout {
  if (inputs.length === 0) return { events: [], range: { ...EMPTY_RANGE } }

  const items = inputs.map((input, index) => {
    const startMin = toMinutes(input.at)
    let endMin: number
    if (input.end) {
      const end = toMinutes(input.end)
      // Fim antes do início: o evento atravessa a meia-noite; o dia mostrado termina em 24h.
      endMin = end > startMin ? end : DAY_MINUTES
    } else {
      endMin = startMin + (input.defaultMinutes ?? DEFAULT_EVENT_MINUTES)
    }
    endMin = Math.max(Math.min(endMin, DAY_MINUTES), startMin + MIN_EVENT_MINUTES)
    return { index, startMin, endMin, column: 0, columns: 1 }
  })

  // Início mais cedo primeiro; no empate, o mais longo primeiro (fica na coluna da esquerda).
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin || a.index - b.index)

  let group: typeof items = []
  let groupEnd = -1
  let columnEnds: number[] = []
  const closeGroup = () => {
    for (const item of group) item.columns = columnEnds.length
    group = []
    columnEnds = []
  }
  for (const item of sorted) {
    if (group.length && item.startMin >= groupEnd) closeGroup()
    // Primeira coluna já livre; só abre outra quando todas estão ocupadas.
    let column = columnEnds.findIndex((end) => end <= item.startMin)
    if (column < 0) column = columnEnds.length
    columnEnds[column] = item.endMin
    item.column = column
    group.push(item)
    groupEnd = group.length === 1 ? item.endMin : Math.max(groupEnd, item.endMin)
  }
  closeGroup()

  const first = Math.min(...items.map((i) => i.startMin))
  const last = Math.max(...items.map((i) => i.endMin))
  let from = Math.max(0, Math.floor((first - RANGE_PADDING_MINUTES) / 60) * 60)
  let to = Math.min(DAY_MINUTES, Math.ceil((last + RANGE_PADDING_MINUTES) / 60) * 60)
  if (to - from < MIN_RANGE_MINUTES) {
    to = Math.min(DAY_MINUTES, from + MIN_RANGE_MINUTES)
    from = Math.max(0, to - MIN_RANGE_MINUTES)
  }
  // Um cartão no fim do dia pode passar de 24h pela altura mínima: o eixo cresce para não cortá-lo.
  to = Math.max(to, Math.ceil(last / 60) * 60)

  return {
    events: items.map((i) => ({
      index: i.index,
      column: i.column,
      columns: i.columns,
      startMin: i.startMin,
      endMin: i.endMin,
      top: i.startMin - from,
      height: i.endMin - i.startMin,
    })),
    range: { from, to },
  }
}
