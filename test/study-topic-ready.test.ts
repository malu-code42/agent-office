import { describe, expect, it, vi } from 'vitest'
import { assertTopicReady, type ReadinessSource } from '../src/main/study-readiness'
import { generateProjects } from '../src/main/study-ideas'
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

  it('refuses a title repeated in two disciplines instead of releasing the first one', () => {
    const twice = parseStudyTrail(
      '## 2º período\n### [P2-HW] Hardware I — 60 h\n- [ ] [P2-HW-01] Circuitos elétricos.\n### [P2-ED] Eletrônica — 60 h\n- [ ] [P2-ED-01] Circuitos elétricos.',
    )
    const both: Record<string, StudyReadiness> = {
      'P2-HW': { discipline: 'P2-HW', builtAt: 1, topics: [{ id: 'P2-HW-01', topic: TOPIC, state: 'pronto', reason: '', folders: [] }] },
      'P2-ED': { discipline: 'P2-ED', builtAt: 1, topics: [{ id: 'P2-ED-01', topic: TOPIC, state: 'poucos-trechos', reason: 'Só 2 trecho(s).', folders: [] }] },
    }
    const ambiguous: ReadinessSource = { trail: () => twice, reports: () => both }
    expect(() => assertTopicReady(ambiguous, TOPIC)).toThrow(/mais de uma disciplina/)
    expect(() => assertTopicReady(ambiguous, twice.topics[0]!.label)).not.toThrow()
  })

  it('throws when the topic is not in the trail or in the report', () => {
    expect(() => assertTopicReady(source(report('pronto')), 'Tópico fora da trilha')).toThrow(/não está na trilha/)
    const other: Record<string, StudyReadiness> = { 'P2-HW': { discipline: 'P2-HW', builtAt: 1, topics: [] } }
    expect(() => assertTopicReady(source(other), TOPIC)).toThrow(/não está no relatório/)
  })
})

describe('generateProjects', () => {
  const reply = { projects: [{ title: 'Simulador', description: 'Monte um circuito.', topics: [TOPIC] }], best: { index: 0, reason: 'Cobre o tópico.' } }

  it('does not ask the model for a locked topic', async () => {
    const ask = vi.fn(async () => reply)
    await expect(generateProjects([TOPIC], new Set(), ask, source(report('sem-fonte')))).rejects.toThrow(/ainda não está pronto/)
    expect(ask).not.toHaveBeenCalled()
  })

  it('generates projects for a ready topic', async () => {
    const ask = vi.fn(async () => reply)
    const out = await generateProjects([TOPIC], new Set(), ask, source(report('pronto')))
    expect(ask).toHaveBeenCalledOnce()
    expect(out).toEqual({ drafts: [{ title: 'Simulador', description: 'Monte um circuito.', topics: [TOPIC] }], bestIndex: 0, reason: 'Cobre o tópico.', skipped: [] })
  })
})
