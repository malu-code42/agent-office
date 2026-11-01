import { DEFAULT_CONTEXT_WARN_TOKENS, type Advice, type SpendSplit } from '@shared/economy'
import type { Settings } from '@shared/types'

// Token economy, the words: the panel warning, the cold-memory question and the Relatórios tips.
// No DOM here, so it is tested in Node (tsconfig.test.json).

export function warnTokens(s: Pick<Settings, 'contextWarnTokens'>): number {
  return s.contextWarnTokens ?? DEFAULT_CONTEXT_WARN_TOKENS
}

/** 330 mil tokens · 1,2 mi tokens */
export function tokensLabel(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} mi tokens` : `${Math.round(n / 1000)} mil tokens`
}

/** 45 min · 3h · 2 dias */
export function idleLabel(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 120) return `${min} min`
  const hours = Math.round(min / 60)
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)} dias`
}

/** $2,40 · <$0,01 (as formatCost in ui/dom.ts, but never empty). */
export function costLabel(usd: number): string {
  if (!(usd > 0)) return '$0,00'
  return usd < 0.01 ? '<$0,01' : `$${usd.toFixed(2).replace('.', ',')}`
}

export function adviceCopy(a: Advice): { title: string; detail: string } {
  if (a.kind === 'cold') {
    return {
      title: `Memória fria · retomar custa ~${costLabel(a.usd)}`,
      detail: `Parado há ${idleLabel(a.idleMs)}. A próxima mensagem recarrega ${tokensLabel(a.tokens)} de conversa. Tarefa nova? Limpe antes e comece quase de graça.`,
    }
  }
  return {
    title: `Memória grande · ${tokensLabel(a.tokens)}`,
    detail: `Cada chamada relê a conversa toda (~${costLabel(a.usd)} por chamada). Tarefa nova? Limpe. Mesma tarefa? Compacte.`,
  }
}

/** Where the money went, in the order the report shows it. */
export const SPEND_PARTS = [
  { key: 'read', label: 'Releitura da memória', title: 'Cada chamada relê a conversa inteira do cache. Cresce com o tamanho da conversa.' },
  {
    key: 'write',
    label: 'Recarga da memória',
    title: 'Escrever a conversa no cache: no começo e quando um agente volta depois de 1h parado.',
  },
  { key: 'output', label: 'Respostas', title: 'O que o modelo escreveu: texto, código e chamadas de ferramenta.' },
  { key: 'input', label: 'Entrada nova', title: 'Tokens enviados fora do cache.' },
] as const

const WHERE = 'Configurações › Economia de tokens'

/** What to change, from the period's spend and the economy switches; empty = nothing to adjust. */
export function economyTips(
  split: SpendSplit & { readTokens: number },
  turns: number,
  s: Pick<Settings, 'dailyBudgetUsd' | 'freshTicketSession' | 'freshSquadCycle'>,
): string[] {
  const tips: string[] = []
  const total = split.read + split.write + split.output + split.input
  const perTurn = turns > 0 ? split.readTokens / turns : 0
  if (perTurn >= 100_000)
    tips.push(
      `Cada chamada releu em média ${tokensLabel(perTurn)} de conversa. Limpar a memória entre tarefas diferentes é o que mais economiza.`,
    )
  if (total > 0 && split.write / total >= 0.2)
    tips.push(
      `${Math.round((split.write / total) * 100)}% foi recarga de memória: agentes voltando depois de parados com a conversa cheia. Limpe antes de mandar tarefa nova a um agente parado.`,
    )
  if (!(s.dailyBudgetUsd > 0)) tips.push(`Sem teto de custo por dia. Defina um em ${WHERE} para o escritório parar sozinho.`)
  if (s.freshTicketSession === false)
    tips.push(`Tickets delegados continuam a conversa anterior do agente. Ligue "conversa nova" para tickets em ${WHERE}.`)
  if (s.freshSquadCycle === false)
    tips.push(`Cada ciclo de squad relê todos os ciclos anteriores. Ligue "conversa nova por ciclo" em ${WHERE}.`)
  return tips
}
