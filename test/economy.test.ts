import { describe, expect, it } from 'vitest'
import type { AgentSummary } from '@shared/types'
import {
  adviseAgent,
  CACHE_COLD_MS,
  COLD_MIN_TOKENS,
  dailyCapHit,
  isCold,
  memoryLevel,
  queryBudget,
  readCost,
  spendSplit,
  wakeCost,
} from '@shared/economy'
import { adviceCopy, costLabel, economyTips, idleLabel, tokensLabel, warnTokens } from '../src/renderer/src/ui/economy-text'

const NOW = 1_800_000_000_000
const agent = (over: Partial<AgentSummary> = {}) =>
  ({
    id: 'a',
    name: 'Ada',
    source: 'office',
    status: 'idle',
    model: 'claude-opus-5-5[1m]',
    context: { used: 300_000, max: 1_000_000, percent: 30 },
    lastTurnAt: NOW - 60_000,
    ...over,
  }) as AgentSummary

describe('custos da memória', () => {
  it('reler e recarregar seguem o preço do modelo (Opus 5.5: 0,2 leitura, 4 entrada x2 na escrita de 1h)', () => {
    expect(readCost('claude-opus-5-5[1m]', 1_000_000)).toBeCloseTo(0.2)
    expect(wakeCost('claude-opus-5-5', 1_000_000)).toBeCloseTo(8)
  })
  it('modelo desconhecido custa como Opus 5.5', () => {
    expect(wakeCost(undefined, 1_000_000)).toBeCloseTo(8)
    expect(readCost('gpt-5', 1_000_000)).toBeCloseTo(0.2)
  })
})

describe('memória fria', () => {
  it('fica fria exatamente quando o cache de 1h expira; sem turno conhecido, nunca', () => {
    expect(isCold({ lastTurnAt: NOW - CACHE_COLD_MS + 1 }, NOW)).toBe(false)
    expect(isCold({ lastTurnAt: NOW - CACHE_COLD_MS }, NOW)).toBe(true)
    expect(isCold({}, NOW)).toBe(false)
  })
})

describe('adviseAgent', () => {
  it('memória grande e quente: sugere limpar ou compactar, com o custo por chamada', () => {
    expect(adviseAgent(agent(), 200_000, NOW)).toEqual({ kind: 'big', tokens: 300_000, usd: expect.closeTo(0.06) })
  })
  it('avisa no limite exato de tokens, não abaixo', () => {
    expect(adviseAgent(agent({ context: { used: 200_000, max: 1e6, percent: 20 } }), 200_000, NOW)?.kind).toBe('big')
    expect(adviseAgent(agent({ context: { used: 199_999, max: 1e6, percent: 20 } }), 200_000, NOW)).toBeNull()
  })
  it('parado além do cache: avisa quanto custa acordar, antes do tamanho', () => {
    const a = agent({ lastTurnAt: NOW - CACHE_COLD_MS - 1 })
    expect(adviseAgent(a, 200_000, NOW)).toMatchObject({
      kind: 'cold',
      tokens: 300_000,
      usd: expect.closeTo(2.4),
      idleMs: CACHE_COLD_MS + 1,
    })
  })
  it('fria só a partir de 50 mil tokens, mesmo com o aviso de tamanho desligado', () => {
    const cold = NOW - 2 * CACHE_COLD_MS
    expect(adviseAgent(agent({ context: { used: COLD_MIN_TOKENS, max: 2e5, percent: 25 }, lastTurnAt: cold }), 0, NOW)?.kind).toBe('cold')
    expect(adviseAgent(agent({ context: { used: COLD_MIN_TOKENS - 1, max: 2e5, percent: 25 }, lastTurnAt: cold }), 0, NOW)).toBeNull()
  })
  it('ocupado, terminal, histórico OpenCode, arquivado, sem contexto ou aviso desligado: nada', () => {
    expect(adviseAgent(agent({ status: 'working' }), 200_000, NOW)).toBeNull()
    expect(adviseAgent(agent({ status: 'waiting' }), 200_000, NOW)).toBeNull()
    expect(adviseAgent(agent({ source: 'terminal' }), 200_000, NOW)).toBeNull()
    expect(adviseAgent(agent({ engine: 'opencode' }), 200_000, NOW)).toBeNull()
    expect(adviseAgent(agent({ departed: true }), 200_000, NOW)).toBeNull()
    expect(adviseAgent(agent({ context: undefined }), 200_000, NOW)).toBeNull()
    expect(adviseAgent(agent(), 0, NOW)).toBeNull()
  })
})

describe('memoryLevel', () => {
  it('avisa pelo tamanho mesmo com a janela de 1M quase vazia', () => {
    expect(memoryLevel({ used: 300_000, max: 1_000_000, percent: 30 }, 200_000)).toBe('warn')
    expect(memoryLevel({ used: 300_000, max: 1_000_000, percent: 30 }, 0)).toBe('ok')
    expect(memoryLevel({ used: 120_000, max: 200_000, percent: 60 }, 0)).toBe('warn')
    expect(memoryLevel({ used: 180_000, max: 200_000, percent: 90 }, 500_000)).toBe('full')
  })
})

describe('spendSplit', () => {
  it('a escrita de cache é o que sobra depois de leitura, saída e entrada', () => {
    const s = spendSplit('claude-opus-5-5[1m]', { costUsd: 10, inputTokens: 0, outputTokens: 100_000, cacheReadTokens: 10_000_000 })
    expect(s.read).toBeCloseTo(2)
    expect(s.output).toBeCloseTo(2)
    expect(s.write).toBeCloseTo(6)
  })
  it('sem preço: tudo conta como entrada', () => {
    expect(spendSplit('gpt-5', { costUsd: 1, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 })).toEqual({
      read: 0,
      write: 0,
      output: 0,
      input: 1,
    })
  })
})

describe('teto diário', () => {
  it('0 = sem teto; com teto, para a um centavo dele', () => {
    expect(dailyCapHit(0, 1_000)).toBe(false)
    expect(dailyCapHit(10, 9.98)).toBe(false)
    expect(dailyCapHit(10, 9.99)).toBe(true)
    expect(dailyCapHit(10, 12)).toBe(true)
  })
  it('a consulta recebe o que sobra do teto mais apertado, nunca menos de um centavo', () => {
    expect(queryBudget({ agentBudgetUsd: 0, dailyBudgetUsd: 0 }, 5, 50)).toBeUndefined()
    expect(queryBudget({ agentBudgetUsd: 10, dailyBudgetUsd: 0 }, 4, 50)).toBeCloseTo(6)
    expect(queryBudget({ agentBudgetUsd: 0, dailyBudgetUsd: 20 }, 4, 15)).toBeCloseTo(5)
    expect(queryBudget({ agentBudgetUsd: 10, dailyBudgetUsd: 20 }, 4, 18)).toBeCloseTo(2)
    expect(queryBudget({ agentBudgetUsd: 10, dailyBudgetUsd: 20 }, 4, 25)).toBe(0.01)
  })
})

describe('textos da economia', () => {
  it('tokens, tempo parado e custo em pt-BR', () => {
    expect(tokensLabel(330_000)).toBe('330 mil tokens')
    expect(tokensLabel(1_234_567)).toBe('1,2 mi tokens')
    expect(idleLabel(45 * 60_000)).toBe('45 min')
    expect(idleLabel(3 * 3_600_000)).toBe('3h')
    expect(idleLabel(50 * 3_600_000)).toBe('2 dias')
    expect(costLabel(0)).toBe('$0,00')
    expect(costLabel(0.004)).toBe('<$0,01')
    expect(costLabel(2.4)).toBe('$2,40')
  })
  it('aviso padrão de 200 mil quando a configuração não tem o campo', () => {
    expect(warnTokens({} as never)).toBe(200_000)
    expect(warnTokens({ contextWarnTokens: 0 })).toBe(0)
  })
  it('o cartão diz o custo de retomar e o de cada chamada', () => {
    expect(adviceCopy({ kind: 'cold', tokens: 300_000, usd: 2.4, idleMs: 3 * 3_600_000 }).title).toBe('Memória fria · retomar custa ~$2,40')
    expect(adviceCopy({ kind: 'big', tokens: 300_000, usd: 0.06 }).detail).toContain('~$0,06 por chamada')
  })
  it('dicas: releitura alta, recarga alta e chaves desligadas', () => {
    const on = { dailyBudgetUsd: 10, freshTicketSession: true, freshSquadCycle: true }
    const quiet = { read: 1, write: 0.1, output: 1, input: 0, readTokens: 1_000 }
    expect(economyTips(quiet, 10, on)).toEqual([])
    const heavy = { read: 1, write: 1, output: 1, input: 0, readTokens: 2_000_000 }
    const tips = economyTips(heavy, 10, { dailyBudgetUsd: 0, freshTicketSession: false, freshSquadCycle: false })
    expect(tips).toHaveLength(5)
    expect(tips[0]).toContain('200 mil tokens')
    expect(tips[1]).toMatch(/^33% foi recarga/)
  })
})
