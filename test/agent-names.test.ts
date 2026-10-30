import { describe, expect, it } from 'vitest'
import { AGENT_NAMES, pickAgentName } from '../src/shared/describe'

describe('pickAgentName (#105)', () => {
  it('tem nomes de sobra e sem repetição no catálogo', () => {
    expect(AGENT_NAMES.length).toBeGreaterThanOrEqual(60)
    expect(new Set(AGENT_NAMES).size).toBe(AGENT_NAMES.length)
  })

  it('sorteia entre os nomes livres, não sempre o primeiro', () => {
    expect(pickAgentName([], [], () => 0)).toBe(AGENT_NAMES[0])
    expect(pickAgentName([], [], () => 0.999)).toBe(AGENT_NAMES[AGENT_NAMES.length - 1])
  })

  it('convocações seguidas não repetem enquanto houver nome nunca usado', () => {
    let seed = 1
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    const past: string[] = []
    for (let i = 0; i < AGENT_NAMES.length; i++) {
      const name = pickAgentName([], past, random)!
      expect(past).not.toContain(name)
      past.push(name)
    }
    // Todos já usados: volta a sortear entre os que ninguém ativo tem.
    expect(pickAgentName(['Ada'], past, () => 0)).not.toBe('Ada')
  })

  it('nada livre: undefined, para o chamador usar o nome reserva', () => {
    expect(pickAgentName(AGENT_NAMES)).toBeUndefined()
  })
})
