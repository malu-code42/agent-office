import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { generateProjects, generateSpec, STUDY_IDEAS_BACKUP, STUDY_IDEAS_FILE, StudyIdeaStore } from '../src/main/study-ideas'
import type { ReadinessSource } from '../src/main/study-readiness'
import { coveredTopics, MAX_TOPICS_PER_REQUEST, parseProjects, parseSpec, SPEC_SECTION_MAX, SPEC_SECTIONS, specFileName, studiedTopics, uncoveredTopicsOf } from '../src/shared/study-ideas'
import { topicName } from '../src/shared/study-trail'
import type { StudyCycle, StudyCycleState } from '../src/shared/study-cycle'
import type { StudyReadiness } from '../src/shared/study-readiness'
import { parseStudyTrail } from '../src/shared/study-trail'
import { generateStudyProjectsArgsSchema, setStudyProjectStatusArgsSchema } from '../src/main/validate'

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
    expect(source).toContain('topics.map(topicName)')
    expect(source).toContain('Tópicos usados: ${names(project.topics)}')
  })
})

describe('generateProjects (AO-34)', () => {
  const TRAIL = parseStudyTrail(
    '## 2º período\n### [P2-HW] Hardware I — 60 h\n- [ ] [P2-HW-01] Circuitos elétricos.\n- [ ] [P2-HW-02] Ondas.\n- [ ] [P2-HW-03] Sensores.',
  )
  const [A, B, C] = TRAIL.topics.map((t) => t.title) as [string, string, string]
  const source = (states: Record<string, 'pronto' | 'poucos-trechos'>): ReadinessSource => ({
    trail: () => TRAIL,
    reports: (): Record<string, StudyReadiness> => ({
      'P2-HW': {
        discipline: 'P2-HW',
        builtAt: 1,
        topics: TRAIL.topics.map((t) => ({ id: t.id, topic: t.title, state: states[t.title] ?? 'pronto', reason: 'Só 2 trecho(s).', folders: [] })),
      },
    }),
  })
  const reply = {
    projects: [
      { title: 'Estação', description: 'Lê sensores e plota.', topics: [B, C] },
      { title: 'Bancada', description: 'Simula circuitos.', topics: [A] },
    ],
    best: { index: 0, reason: 'Cobre dois tópicos sem projeto.' },
  }

  it('manda todos os tópicos prontos de uma vez, sem seleção, e devolve o melhor com o motivo', async () => {
    const ask = vi.fn(async (_prompt: string, _input: unknown) => reply)
    const out = await generateProjects([A, B, C], new Set(), ask, source({}))
    expect(ask).toHaveBeenCalledOnce()
    expect(ask.mock.calls[0]![1]).toEqual({ topics: [A, B, C], coveredTopics: [] })
    expect(out.drafts.map((d) => d.topics)).toEqual([[B, C], [A]])
    expect(out.bestIndex).toBe(0)
    expect(out.reason).toBe('Cobre dois tópicos sem projeto.')
  })

  it('deixa de fora o tópico não pronto e o informa; sem nenhum pronto, nem chama o modelo', async () => {
    const ask = vi.fn(async (_prompt: string, _input: unknown) => reply)
    const out = await generateProjects([A, B, C], new Set(), ask, source({ [A]: 'poucos-trechos' }))
    expect(out.skipped.map((s) => s.topic)).toEqual([A])
    expect(ask.mock.calls[0]![1]).toMatchObject({ topics: [B, C] })
    ask.mockClear()
    await expect(generateProjects([A], new Set(), ask, source({ [A]: 'poucos-trechos' }))).rejects.toThrow(/ainda não está pronto/)
    expect(ask).not.toHaveBeenCalled()
  })

  it('rejeita pedido com tópicos demais, sem chamar o modelo, com mensagem clara', async () => {
    const ask = vi.fn(async (_prompt: string, _input: unknown) => reply)
    const many = Array.from({ length: MAX_TOPICS_PER_REQUEST + 1 }, (_, i) => `Tópico ${i}`)
    await expect(generateProjects(many, new Set(), ask, source({}))).rejects.toThrow(`o limite por pedido é ${MAX_TOPICS_PER_REQUEST}`)
    await expect(generateProjects([], new Set(), ask, source({}))).rejects.toThrow('Nenhum tópico estudado')
    expect(ask).not.toHaveBeenCalled()
  })

  it('resposta inválida do modelo vira erro claro', async () => {
    await expect(generateProjects([A], new Set(), async () => ({ ideas: [] }), source({}))).rejects.toThrow('formato esperado')
    await expect(generateProjects([A], new Set(), async () => ({ projects: [{ title: 'x', description: 'y', topics: ['Outro'] }] }), source({}))).rejects.toThrow('nenhum projeto válido')
  })

  it('a entrada do renderer é validada em validate.ts', () => {
    expect(generateStudyProjectsArgsSchema.safeParse([[A, B]]).success).toBe(true)
    expect(generateStudyProjectsArgsSchema.safeParse([[]]).success).toBe(false)
    expect(generateStudyProjectsArgsSchema.safeParse([[1]]).success).toBe(false)
    expect(generateStudyProjectsArgsSchema.safeParse([Array.from({ length: 501 }, () => 'a')]).success).toBe(false)
    expect(setStudyProjectStatusArgsSchema.safeParse(['sp-abc-1', 'feito']).success).toBe(true)
    expect(setStudyProjectStatusArgsSchema.safeParse(['sp-abc-1', 'pronto']).success).toBe(false)
    expect(setStudyProjectStatusArgsSchema.safeParse(['../x', 'feito']).success).toBe(false)
  })
})

describe('parseProjects (AO-34)', () => {
  const allowed = ['A', 'B', 'C']
  const p = (title: string, topics: unknown) => ({ title, description: 'd', topics })

  it('mantém projetos bem formados, descarta tópicos desconhecidos e projetos sem tópico válido', () => {
    const out = parseProjects({ projects: [p(' X ', ['A', 'A', 'Z']), p('Y', ['Z']), { title: 'sem' }, null], best: { index: 0, reason: 'porque' } }, allowed)
    expect(out).toEqual({ ok: true, drafts: [{ title: 'X', description: 'd', topics: ['A'] }], bestIndex: 0, reason: 'porque' })
  })

  it('o melhor é o que cobre mais tópicos sem projeto feito, mesmo se o modelo apontar outro', () => {
    const reply = { projects: [p('um', ['A']), p('dois', ['B', 'C']), p('três', ['A', 'B'])], best: { index: 0, reason: 'o primeiro' } }
    // A já tem projeto feito: "dois" cobre 2 sem projeto, "três" só 1.
    const out = parseProjects(reply, allowed, new Set(['A']))
    expect(out).toMatchObject({ ok: true, bestIndex: 1 })
    expect(out.ok && out.reason).toBe('Cobre 2 tópicos ainda sem projeto feito, mais do que os outros.')
    // Sem nada feito, "dois" e "três" empatam em 2; o modelo apontou "três" (empate): vale o dele.
    expect(parseProjects({ ...reply, best: { index: 2, reason: 'combina' } }, allowed)).toMatchObject({ bestIndex: 2, reason: 'combina' })
  })

  it('rejeita o que não é lista de projetos ou veio sem nenhum válido', () => {
    expect(parseProjects('texto', allowed)).toMatchObject({ ok: false })
    expect(parseProjects({ projects: [] }, allowed)).toMatchObject({ ok: false })
    expect(parseProjects({ projects: [p('t'.repeat(121), ['A'])] }, allowed)).toMatchObject({ ok: false })
  })

  it('tópicos cobertos são só os de projetos marcados como feito', () => {
    const base = { description: '', createdAt: 0 }
    const projects = [
      { ...base, id: 'sp-1', title: 'a', topics: ['A', 'B'], status: 'feito' as const },
      { ...base, id: 'sp-2', title: 'b', topics: ['C'], status: 'escolhido' as const },
      { ...base, id: 'sp-3', title: 'c', topics: ['C'], status: 'ideia' as const },
    ]
    expect([...coveredTopics(projects)]).toEqual(['A', 'B'])
    expect(uncoveredTopicsOf({ topics: ['B', 'C'] }, coveredTopics(projects))).toEqual(['C'])
    expect([...coveredTopics(projects.map((x) => (x.id === 'sp-2' ? { ...x, status: 'feito' as const } : x)))]).toEqual(['A', 'B', 'C'])
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
    await expect(generateSpec(['T'], 'Simulador', 'desc', ask)).rejects.toThrow('veio sem a seção "Tópicos estudados × funcionalidade"')
  })

  it('generateSpec devolve a spec quando completa (modelo simulado)', async () => {
    const ask = vi.fn(async () => ({ sections: sections() }))
    const spec = await generateSpec(['T'], 'Simulador', 'desc', ask, 9)
    expect(spec.generatedAt).toBe(9)
    expect(spec.markdown.startsWith('# Especificação: Simulador')).toBe(true)
  })

  it('nome do arquivo exportado é seguro', () => {
    expect(specFileName('Simulador de Circuitos / Ação!')).toBe('simulador-de-circuitos-acao-especificacao.md')
    expect(specFileName('???')).toBe('projeto-especificacao.md')
  })

  describe('armazenamento e migração (AO-34)', () => {
    const fresh = () => {
      const dir = mkdtempSync(join(tmpdir(), 'ao34-'))
      dirs.push(dir)
      return dir
    }
    const dirs: string[] = []
    afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))
    const OLD = {
      Redes: { topic: 'Redes', generatedAt: 3, ideas: [{ title: 'Ping', description: 'Mede latência.', spec: { generatedAt: 4, markdown: '# x' } }, { title: 'Sniffer', description: 'Lê pacotes.' }] },
      Banco: { topic: 'Banco', generatedAt: 5, ideas: [{ title: 'Mini SQL', description: 'Consultas.' }, { title: 'quebrada' }] },
    }

    it('lê o study-ideas.json antigo (um conjunto por tópico) sem perder nada: viram projetos "ideia", com spec', () => {
      const dir = fresh()
      writeFileSync(join(dir, STUDY_IDEAS_FILE), JSON.stringify(OLD))
      const projects = new StudyIdeaStore(dir).read()
      expect(projects.map((p) => [p.title, p.description, p.topics, p.status, p.createdAt])).toEqual([
        ['Ping', 'Mede latência.', ['Redes'], 'ideia', 3],
        ['Sniffer', 'Lê pacotes.', ['Redes'], 'ideia', 3],
        ['Mini SQL', 'Consultas.', ['Banco'], 'ideia', 5],
      ])
      expect(projects[0]!.spec).toEqual({ generatedAt: 4, markdown: '# x' })
      expect(projects[1]!.spec).toBeUndefined()
      expect(new Set(projects.map((p) => p.id)).size).toBe(3)
      // Ler não mexe no arquivo.
      expect(JSON.parse(readFileSync(join(dir, STUDY_IDEAS_FILE), 'utf8'))).toEqual(OLD)
    })

    it('na primeira gravação copia o arquivo antigo e grava o formato novo, mantendo os projetos antigos', () => {
      const dir = fresh()
      writeFileSync(join(dir, STUDY_IDEAS_FILE), JSON.stringify(OLD))
      const store = new StudyIdeaStore(dir)
      const list = store.add([{ title: 'Novo', description: 'n', topics: ['Redes', 'Banco'] }], 0, 'cobre dois', 10)
      expect(list.map((p) => p.title)).toEqual(['Ping', 'Sniffer', 'Mini SQL', 'Novo'])
      expect(existsSync(join(dir, STUDY_IDEAS_BACKUP))).toBe(true)
      expect(JSON.parse(readFileSync(join(dir, STUDY_IDEAS_BACKUP), 'utf8'))).toEqual(OLD)
      expect(JSON.parse(readFileSync(join(dir, STUDY_IDEAS_FILE), 'utf8')).version).toBe(2)
      const again = new StudyIdeaStore(dir).read()
      expect(again).toEqual(list)
      expect(again.find((p) => p.title === 'Ping')?.spec?.markdown).toBe('# x')
      expect(again[3]).toMatchObject({ topics: ['Redes', 'Banco'], status: 'ideia', best: { reason: 'cobre dois' } })
    })

    it('gerar de novo não apaga os projetos anteriores', () => {
      const store = new StudyIdeaStore(fresh())
      store.add([{ title: 'A', description: 'a', topics: ['T'] }], 0, 'r', 1)
      const list = store.add([{ title: 'A', description: 'a', topics: ['T'] }, { title: 'B', description: 'b', topics: ['T'] }], 1, 'r2', 1)
      expect(list.map((p) => p.title)).toEqual(['A', 'A', 'B'])
      expect(new Set(list.map((p) => p.id)).size).toBe(3)
    })

    it('estado e exclusão: marcar feito muda os tópicos cobertos; excluir tira o projeto', () => {
      const dir = fresh()
      const store = new StudyIdeaStore(dir)
      const [first] = store.add([{ title: 'A', description: 'a', topics: ['T', 'U'] }, { title: 'B', description: 'b', topics: ['U'] }], 0, 'r', 1)
      expect([...coveredTopics(store.read())]).toEqual([])
      expect([...coveredTopics(store.setStatus(first!.id, 'escolhido'))]).toEqual([])
      expect([...coveredTopics(store.setStatus(first!.id, 'feito'))]).toEqual(['T', 'U'])
      expect(new StudyIdeaStore(dir).read()[0]!.status).toBe('feito')
      expect(store.remove(first!.id).map((p) => p.title)).toEqual(['B'])
      expect(() => store.setStatus(first!.id, 'ideia')).toThrow('não está mais guardado')
    })

    it('guarda a especificação junto do projeto e recusa a de projeto que não existe', () => {
      const store = new StudyIdeaStore(fresh())
      const [p] = store.add([{ title: 'A', description: 'a', topics: ['T'] }], 0, 'r', 1)
      expect(store.saveSpec(p!.id, { generatedAt: 4, markdown: '# s' })[0]!.spec?.markdown).toBe('# s')
      expect(() => store.saveSpec('sp-nada', { generatedAt: 1, markdown: 'x' })).toThrow('não está mais guardado')
    })

    it('arquivo do formato novo com itens quebrados guarda só o que é válido', () => {
      const dir = fresh()
      writeFileSync(join(dir, STUDY_IDEAS_FILE), JSON.stringify({ version: 2, projects: [{ id: 'sp-a-1', title: 't', description: 'd', topics: ['X'], status: 'estranho', createdAt: 1 }, { id: 'ruim', title: 't' }, null] }))
      expect(new StudyIdeaStore(dir).read()).toEqual([{ id: 'sp-a-1', title: 't', description: 'd', topics: ['X'], status: 'ideia', createdAt: 1 }])
    })
  })

  it('o renderer tem os botões e mostra a spec por textContent (sem innerHTML)', () => {
    const source = readFileSync('src/renderer/src/ui/study-ideas.ts', 'utf8')
    expect(source).toContain('Gerar especificação')
    expect(source).toContain('Exportar .md')
    expect(source).toContain('project.spec.markdown')
    expect(source).not.toContain('innerHTML')
  })
})
