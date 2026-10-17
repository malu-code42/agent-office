import { describe, expect, it } from 'vitest'
import { previewRewrite } from '../src/shared/tasks-rewrite'

const sequence = (...values: string[]) => {
  let index = 0
  return () => values[index++] ?? 'tzzzzzz'
}

const counter = () => {
  let n = 0
  return () => `t${(++n).toString(36).padStart(6, '0')}`
}

const afterOf = (source: string, line: number) => previewRewrite(source, counter()).lines.find((item) => item.line === line)?.after

describe('previewRewrite', () => {
  it('omits the date and time fields when the original has neither', () => {
    expect(afterOf(['## Casa', '- [ ] Lavar roupa'].join('\n'), 2)).toBe('- [ ] Casa | Lavar roupa ^t000001')
  })

  it('writes only the date when the original has a date and no time', () => {
    expect(afterOf(['## prazos', '- [ ] **09.10** | apresentação do trabalho'].join('\n'), 2)).toBe(
      '- [ ] 09.10 | prazos | apresentação do trabalho ^t000001',
    )
  })

  it('writes date and time, and normalizes a one-digit hour', () => {
    const preview = previewRewrite(['## Rotina', '- [ ] **16.10.2026** | 9:00 | Tomar café'].join('\n'), counter())

    expect(preview.lines[1]?.after).toBe('- [ ] 16.10.2026 | 09:00 | Rotina | Tomar café ^t000001')
    expect(preview.lines[1]?.note).toBe('hora 9:00 escrita como 09:00')
  })

  it('turns an "Área | tarefa" prefix into the lista and keeps the section', () => {
    const preview = previewRewrite(['## tarefas', '- [ ] **06.10.2026** | Hera | criar revisão diária'].join('\n'), counter())

    expect(preview.lines[1]).toMatchObject({ section: 'tarefas', kind: 'task' })
    expect(preview.lines[1]?.after).toBe('- [ ] 06.10.2026 | Hera | criar revisão diária ^t000001')
  })

  it('keeps the area prefix without a date', () => {
    expect(afterOf(['## rotina', '- [ ] Curso | EBAC'].join('\n'), 2)).toBe('- [ ] Curso | EBAC ^t000001')
  })

  it('removes bold markers from a full date with and without area', () => {
    expect(afterOf(['## prazos', '- [ ] **06.10.2026** | criar o hábito de carregar caderno'].join('\n'), 2)).toBe(
      '- [ ] 06.10.2026 | prazos | criar o hábito de carregar caderno ^t000001',
    )
  })

  it('keeps a date without year exactly as written', () => {
    expect(afterOf(['## prazos', '- [ ] **09.10** | Apresentação do projeto'].join('\n'), 2)).toBe(
      '- [ ] 09.10 | prazos | Apresentação do projeto ^t000001',
    )
  })

  it('converts a completed task that already carries its completion date', () => {
    expect(afterOf(['## Archive', '- [x] Casa | Comprar livro ✅ 13.10.2026'].join('\n'), 2)).toBe(
      '- [x] Casa | Comprar livro ✅ 13.10.2026 ^t000001',
    )
  })

  it('marks a completed task without completion date as ambiguous and does not invent one', () => {
    const preview = previewRewrite(['## tarefas', '- [x] Hermes | configurar o perfil'].join('\n'), counter())

    expect(preview.lines[1]).toMatchObject({ kind: 'ambiguous', after: null })
    expect(preview.ambiguous).toEqual([
      expect.objectContaining({ line: 2, question: expect.stringContaining('Qual é a data de conclusão?') }),
    ])
  })

  it('asks whether the only date of a completed task is the completion or the due date', () => {
    const preview = previewRewrite(['## Archive', '- [x] **06.10.2026** | Hera | tornar o sistema utilizável'].join('\n'), counter())

    expect(preview.ambiguous[0]?.question).toContain('A data 06.10.2026 é a conclusão ou o prazo?')
  })

  it('converts a discarded task with its reason', () => {
    expect(afterOf(['## Archive', '- [-] Ler artigo antigo ❌ 10.10.2026 — não é mais relevante'].join('\n'), 2)).toBe(
      '- [-] Archive | Ler artigo antigo ❌ 10.10.2026 — não é mais relevante ^t000001',
    )
  })

  it('marks a discarded task without date or reason as ambiguous', () => {
    const preview = previewRewrite(['## Archive', '- [-] Ler artigo antigo'].join('\n'), counter())

    expect(preview.lines[1]?.kind).toBe('ambiguous')
    expect(preview.ambiguous[0]?.question).toContain('motivo do descarte')
  })

  it('keeps the indentation of sub-tasks and gives them the section as lista', () => {
    expect(afterOf(['## estudar', '- [ ] hardware I | realizar Prova 01', '\t- [ ] usar questões do ENEM'].join('\n'), 3)).toBe(
      '\t- [ ] estudar | usar questões do ENEM ^t000002',
    )
  })

  it('leaves frontmatter, settings, comments, rules, headings and plain text untouched', () => {
    const source = [
      '---',
      'kanban-plugin: board',
      '---',
      '## Casa',
      '<!-- origem: nota -->',
      '***',
      'texto livre',
      '%% kanban:settings',
      '',
    ].join('\n')
    const preview = previewRewrite(source, counter())

    expect(preview.lines.filter((item) => item.kind !== 'untouched')).toEqual([])
    for (const item of preview.lines) expect(item.after).toBe(item.before)
    expect(preview.ambiguous).toEqual([])
  })

  it('gives every converted line a unique id, skipping ids already in the file and repeated ids', () => {
    const source = ['## Casa', '- [ ] Um ^t000002', '- [ ] Dois', '- [ ] Três'].join('\n')
    const preview = previewRewrite(source, sequence('t000002', 't000001', 't000001', 't000003', 't000004'))
    const ids = preview.lines.flatMap((item) => (item.after?.match(/\^(t[a-z0-9]{6})$/) ? [item.after.slice(-7)] : []))

    expect(ids).toEqual(['t000001', 't000003'])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('does not convert a title with two " | " separators and reports it as ambiguous', () => {
    const preview = previewRewrite(['## ler', '- [ ] Ai | Matt Podock | email'].join('\n'), counter())

    expect(preview.lines[1]).toMatchObject({ kind: 'ambiguous', after: null })
    expect(preview.ambiguous).toEqual([expect.objectContaining({ line: 2, question: expect.stringContaining('mais de um " | "') })])
  })

  it('reports an area with more than three words as ambiguous', () => {
    const preview = previewRewrite(['## pratica', '- [ ] Códigos do projeto estrutura de dados | leitura'].join('\n'), counter())

    expect(preview.ambiguous[0]?.question).toContain('pode ser parte do título')
  })
})
