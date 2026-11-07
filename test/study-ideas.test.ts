import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { generateIdeas, generateSpec, STUDY_IDEAS_FILE, StudyIdeaStore } from '../src/main/study-ideas'
import type { ReadinessSource } from '../src/main/study-readiness'
import { parseIdeas, parseSpec, SPEC_SECTION_MAX, SPEC_SECTIONS, specFileName, studiedTopics } from '../src/shared/study-ideas'
import { topicName } from '../src/shared/study-trail'
import type { StudyCycle, StudyCycleState } from '../src/shared/study-cycle'
import type { StudyReadiness } from '../src/shared/study-readiness'
import { parseStudyTrail } from '../src/shared/study-trail'

const cycle = (topic: string, stage: StudyCycle['stage'], updatedAt: number): StudyCycle => ({
  id: `${topic}-${updatedAt}`,
  topic,
  stage,
  startedAt: 0,
  updatedAt,
  questions: [],
  practiceRounds: [],
  notes: [],
  retests: [],
})

describe('studiedTopics', () => {
  it('lists each topic once, newest first, completed if any cycle of it is', () => {
    const state: StudyCycleState = {
      activeId: null,
      cycles: [cycle('Redes', 'completed', 1), cycle('Banco de dados', 'diagnosis', 3), cycle('Redes', 'practice', 2)],
    }
    expect(studiedTopics(state)).toEqual([
      { topic: 'Banco de dados', completed: false },
      { topic: 'Redes', completed: true },
    ])
  })
})

describe('nome exibido dos tópicos (AO-35)', () => {
  it('tira o código da frente, mas mantém o tópico guardado com ele', () => {
    const [stored] = studiedTopics({ activeId: null, cycles: [cycle('[P2-ED-01] Árvores', 'diagnosis', 1)] })
    expect(stored.topic).toBe('[P2-ED-01] Árvores')
    expect(topicName(stored.topic)).toBe('Árvores')
  })

  it('o renderer mostra e anuncia o nome exibido, não o tópico cru', () => {
    const source = readFileSync('src/renderer/src/ui/study-ideas.ts', 'utf8')
    expect(source).toContain("h('b', {}, topicName(topic))")
    expect(source).toContain('announce(`Ideias de ${topicName(topic)} geradas.`)')
  })
})

describe('generateIdeas', () => {
  const TRAIL = parseStudyTrail('## 2º período\n### [P2-HW] Hardware I — 60 h\n- [ ] [P2-HW-01] Circuitos elétricos.')
  const TOPIC = TRAIL.topics[0]!.title
  const source = (state: 'pronto' | 'poucos-trechos'): ReadinessSource => ({
    trail: () => TRAIL,
    reports: (): Record<string, StudyReadiness> => ({
      'P2-HW': { discipline: 'P2-HW', builtAt: 1, topics: [{ id: 'P2-HW-01', topic: TOPIC, state, reason: 'Só 2 trecho(s).', folders: [] }] },
    }),
  })

  it('generates ideas for a ready topic', async () => {
    const ask = vi.fn(async () => ({ ideas: [{ title: 'Simulador', description: 'Monte um circuito.' }] }))
    const set = await generateIdeas(TOPIC, ask, source('pronto'), 5)
    expect(ask).toHaveBeenCalledOnce()
    expect(set).toEqual({ topic: TOPIC, generatedAt: 5, ideas: [{ title: 'Simulador', description: 'Monte um circuito.' }] })
  })

  it('does not ask the model for a locked topic and says why', async () => {
    const ask = vi.fn(async () => ({ ideas: [{ title: 'Simulador', description: 'Monte um circuito.' }] }))
    await expect(generateIdeas(TOPIC, ask, source('poucos-trechos'))).rejects.toThrow('"Circuitos elétricos" ainda não está pronto: Só 2 trecho(s).')
    expect(ask).not.toHaveBeenCalled()
  })
})

describe('parseIdeas', () => {
  it('keeps well-formed ideas and drops the rest', () => {
    expect(parseIdeas({ ideas: [{ title: ' A ', description: 'b' }, { title: 'x' }, null] })).toEqual([{ title: 'A', description: 'b' }])
  })
  it('returns null when nothing is usable', () => {
    expect(parseIdeas({ ideas: [] })).toBeNull()
    expect(parseIdeas('texto')).toBeNull()
  })
})

describe('especificação do projeto (AO-36)', () => {
  const sections = () => Object.fromEntries(SPEC_SECTIONS.map((s) => [s.key, `Texto de ${s.key}, com o porquê.`]))

  it('aceita as nove seções e monta o Markdown na ordem, com o porquê e sem código', () => {
    const parsed = parseSpec({ sections: sections() }, 'Simulador')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const headings = parsed.markdown.split('\n').filter((l) => l.startsWith('## '))
    expect(headings).toEqual(SPEC_SECTIONS.map((s, i) => `## ${i + 1}. ${s.title}`))
    expect(parsed.markdown).not.toContain('```')
  })

  it('rejeita resposta sem uma seção obrigatória, dizendo qual', () => {
    const { stack: _stack, ...rest } = sections()
    const parsed = parseSpec({ sections: rest }, 'Simulador')
    expect(parsed).toEqual({ ok: false, error: 'A especificação veio sem a seção "Stack e ferramentas". Tente gerar de novo.' })
    expect(parseSpec({ sections: { ...sections(), mvp: '   ' } }, 'x').ok).toBe(false)
    expect(parseSpec('texto', 'x').ok).toBe(false)
  })

  it('rejeita código pronto e texto longo demais', () => {
    expect(parseSpec({ sections: { ...sections(), etapas: '```js\nlet a\n```' } }, 'x')).toMatchObject({ ok: false })
    expect(parseSpec({ sections: { ...sections(), etapas: 'a'.repeat(SPEC_SECTION_MAX + 1) } }, 'x')).toMatchObject({ ok: false })
  })

  it('generateSpec lança a mensagem clara e não guarda nada quando a resposta é incompleta', async () => {
    const ask = vi.fn(async () => ({ sections: { objetivo: 'só isto' } }))
    await expect(generateSpec('T', 'Simulador', 'desc', ask)).rejects.toThrow('veio sem a seção "Tópicos estudados × funcionalidade"')
  })

  it('generateSpec devolve a spec quando completa (modelo simulado)', async () => {
    const ask = vi.fn(async () => ({ sections: sections() }))
    const spec = await generateSpec('T', 'Simulador', 'desc', ask, 9)
    expect(spec.generatedAt).toBe(9)
    expect(spec.markdown.startsWith('# Especificação: Simulador')).toBe(true)
  })

  it('nome do arquivo exportado é seguro', () => {
    expect(specFileName('Simulador de Circuitos / Ação!')).toBe('simulador-de-circuitos-acao-especificacao.md')
    expect(specFileName('???')).toBe('projeto-especificacao.md')
  })

  describe('armazenamento e migração', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ao36-'))
    afterAll(() => rmSync(dir, { recursive: true, force: true }))

    it('lê o study-ideas.json antigo (sem spec) sem perder nada e guarda a spec ao lado', () => {
      const old = { Redes: { topic: 'Redes', generatedAt: 3, ideas: [{ title: 'Ping', description: 'Mede latência.' }, { title: 'Sniffer', description: 'Lê pacotes.' }] } }
      writeFileSync(join(dir, STUDY_IDEAS_FILE), JSON.stringify(old))
      const store = new StudyIdeaStore(dir)
      expect(store.read()).toEqual(old)
      const set = store.saveSpec('Redes', 'Ping', { generatedAt: 4, markdown: '# x' })
      expect(set.ideas[0]).toEqual({ title: 'Ping', description: 'Mede latência.', spec: { generatedAt: 4, markdown: '# x' } })
      expect(set.ideas[1]).toEqual(old.Redes.ideas[1])
      expect(new StudyIdeaStore(dir).read().Redes?.ideas[0]?.spec?.markdown).toBe('# x')
    })

    it('gerar ideias de novo mantém os projetos que já têm especificação', () => {
      const store = new StudyIdeaStore(dir)
      store.save({ topic: 'Redes', generatedAt: 9, ideas: [{ title: 'Traceroute', description: 'Rotas.' }] })
      expect(store.read().Redes?.ideas.map((i) => i.title)).toEqual(['Ping', 'Traceroute'])
      expect(store.read().Redes?.ideas[0]?.spec).toBeDefined()
    })

    it('recusa guardar spec de projeto que não existe', () => {
      expect(() => new StudyIdeaStore(dir).saveSpec('Redes', 'Nada', { generatedAt: 1, markdown: 'x' })).toThrow('não está mais guardado')
    })
  })

  it('o renderer tem os botões e mostra a spec por textContent (sem innerHTML)', () => {
    const source = readFileSync('src/renderer/src/ui/study-ideas.ts', 'utf8')
    expect(source).toContain('Gerar especificação')
    expect(source).toContain('Exportar .md')
    expect(source).toContain('idea.spec.markdown')
    expect(source).not.toContain('innerHTML')
  })
})
