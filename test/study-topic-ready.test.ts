import { describe, expect, it, vi } from 'vitest'
import { assertTopicReady, type ReadinessSource } from '../src/main/study-readiness'
import { generateIdeas } from '../src/main/study-ideas'
import type { StudyReadiness, StudyReadinessState } from '../src/shared/study-readiness'
import { parseStudyTrail } from '../src/shared/study-trail'

const TRAIL = parseStudyTrail('## 2º período\n### [P2-HW] Hardware I — 60 h\n- [ ] [P2-HW-01] Circuitos elétricos.')
const TOPIC = TRAIL.topics[0]!.title

const report = (state: StudyReadinessState): Record<string, StudyReadiness> => ({
  'P2-HW': { discipline: 'P2-HW', builtAt: 1, topics: [{ id: 'P2-HW-01', topic: TOPIC, state, reason: 'Só 2 trecho(s).', folders: [] }] },
})
const source = (reports: Record<string, StudyReadiness>): ReadinessSource => ({ trail: () => TRAIL, reports: () => reports })

describe('assertTopicReady', () => {
  it('passes a topic whose stored report is pronto', () => {
    expect(() => assertTopicReady(source(report('pronto')), TOPIC)).not.toThrow()
  })

  it('throws the reason of a locked topic', () => {
    expect(() => assertTopicReady(source(report('poucos-trechos')), TOPIC)).toThrow('"Circuitos elétricos" ainda não está pronto: Só 2 trecho(s).')
  })

  it('throws when the discipline has no stored report', () => {
    expect(() => assertTopicReady(source({}), TOPIC)).toThrow(/relatório de prontidão da disciplina P2-HW/)
  })

  it('throws when the topic is not in the trail or in the report', () => {
    expect(() => assertTopicReady(source(report('pronto')), 'Tópico fora da trilha')).toThrow(/não está na trilha/)
    const other: Record<string, StudyReadiness> = { 'P2-HW': { discipline: 'P2-HW', builtAt: 1, topics: [] } }
    expect(() => assertTopicReady(source(other), TOPIC)).toThrow(/não está no relatório/)
  })
})

describe('generateIdeas', () => {
  it('does not ask the model for a locked topic', async () => {
    const ask = vi.fn(async () => ({ ideas: [{ title: 'Simulador', description: 'Monte um circuito.' }] }))
    await expect(generateIdeas(TOPIC, ask, source(report('sem-fonte')))).rejects.toThrow(/ainda não está pronto/)
    expect(ask).not.toHaveBeenCalled()
  })

  it('generates ideas for a ready topic as before', async () => {
    const ask = vi.fn(async () => ({ ideas: [{ title: 'Simulador', description: 'Monte um circuito.' }] }))
    const set = await generateIdeas(TOPIC, ask, source(report('pronto')), 5)
    expect(ask).toHaveBeenCalledOnce()
    expect(set).toEqual({ topic: TOPIC, generatedAt: 5, ideas: [{ title: 'Simulador', description: 'Monte um circuito.' }] })
  })
})
