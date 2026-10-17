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
    expect(afterOf(['## prazos', '- [ ] **09.10** | apresentação trabalho de automação'].join('\n'), 2)).toBe(
      '- [ ] 09.10.2026 | prazos | apresentação trabalho de automação ^t000001',
    )
  })

  it('writes date and time, and normalizes a one-digit hour', () => {
    const preview = previewRewrite(['## Rotina', '- [ ] **16.10.2026** | 9:00 | Tomar café'].join('\n'), counter())

    expect(preview.lines[1]?.after).toBe('- [ ] 16.10.2026 | 09:00 | Rotina | Tomar café ^t000001')
    expect(preview.lines[1]?.note).toBe('hora 9:00 escrita como 09:00')
  })

  it('keeps both the date and the time when the line has both', () => {
    const preview = previewRewrite(['## Rotina', '- [ ] **16.10.2026** | 14:30 | Consulta'].join('\n'), counter())

    expect(preview.lines[1]?.after).toBe('- [ ] 16.10.2026 | 14:30 | Rotina | Consulta ^t000001')
    expect(preview.lines[1]?.droppedTime).toBeUndefined()
    expect(preview.lines[1]?.rules).not.toContain(13)
  })

  // Regra 13: hora só existe junto com data; sem data, a hora sai da linha
  it('drops a time that has no date and keeps the rest of the line', () => {
    const preview = previewRewrite(['## Rotina', '- [ ] 9:00 | Tomar café'].join('\n'), counter())

    expect(preview.lines[1]?.after).toBe('- [ ] Rotina | Tomar café ^t000001')
    expect(preview.lines[1]?.droppedTime).toBe('9:00')
    expect(preview.lines[1]?.rules).toContain(13)
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

  // Regra 1: data sem ano ganha 2026
  it('adds the year 2026 to a date written without year', () => {
    const preview = previewRewrite(['## prazos', '- [ ] **09.10** | Apresentação do projeto'].join('\n'), counter())

    expect(preview.lines[1]?.after).toBe('- [ ] 09.10.2026 | prazos | Apresentação do projeto ^t000001')
    expect(preview.lines[1]?.rules).toContain(1)
  })

  // Regra 2: única data de tarefa concluída vira ✅
  it('turns the only date of a completed task into the completion field', () => {
    expect(afterOf(['## Archive', '- [x] **06.10.2026** | Hera | tornar o sistema utilizável'].join('\n'), 2)).toBe(
      '- [x] Hera | tornar o sistema utilizável ✅ 06.10.2026 ^t000001',
    )
  })

  it('converts a completed task that already carries its completion date', () => {
    expect(afterOf(['## Archive', '- [x] Casa | Comprar livro ✅ 13.10.2026'].join('\n'), 2)).toBe(
      '- [x] Casa | Comprar livro ✅ 13.10.2026 ^t000001',
    )
  })

  it('completes a completed task with a date without year', () => {
    expect(afterOf(['## Archive', '- [x] **03.10** | avisar a dona cleide para colocar o lixo em um local fechado'].join('\n'), 2)).toBe(
      '- [x] Archive | avisar a dona cleide para colocar o lixo em um local fechado ✅ 03.10.2026 ^t000001',
    )
  })

  // Regra 3: concluída sem data converte sem campo ✅
  it('converts a completed task without date and without ✅ field', () => {
    const preview = previewRewrite(['## tarefas', '- [x] Hermes | configurar o perfil'].join('\n'), counter())

    expect(preview.lines[1]).toMatchObject({ kind: 'task', after: '- [x] Hermes | configurar o perfil ^t000001' })
    expect(preview.ambiguous).toEqual([])
  })

  // Regra 4: duas ou mais datas em tarefa concluída é ambígua
  it('marks a completed task with two dates as ambiguous and asks which one is the completion', () => {
    const preview = previewRewrite(
      ['## Archive', '- [x] **14.09.2026** | **15.09** | artigo | entregar a metodologia do artigo'].join('\n'),
      counter(),
    )

    expect(preview.lines[1]).toMatchObject({ kind: 'ambiguous', after: null })
    expect(preview.ambiguous[0]?.question).toContain('Há 2 datas')
    expect(preview.ambiguous[0]?.question).toContain('qual é a data de conclusão?')
  })

  // Regra 5: concluída ou descartada sem área vai para Archive
  it('uses Archive as lista for a completed line without area prefix, whatever the section', () => {
    expect(afterOf(['## tarefas', '- [x] Fazer algo'].join('\n'), 2)).toBe('- [x] Archive | Fazer algo ^t000001')
  })

  // Regra 6: duas barras depois da data e da hora
  it('uses the section as lista and turns every | into - when two separators remain', () => {
    const preview = previewRewrite(['## estudar', '- [ ] Ai | Matt Podock | email'].join('\n'), counter())

    expect(preview.lines[1]).toMatchObject({ kind: 'task', after: '- [ ] estudar | Ai - Matt Podock - email ^t000001' })
    expect(preview.lines[1]?.rules).toContain(6)
    expect(preview.ambiguous).toEqual([])
  })

  // Regra 7: prefixo com mais de três palavras não é área
  it('turns an area with more than three words into part of the title', () => {
    const preview = previewRewrite(['## pratica', '- [ ] Códigos do projeto estrutura de dados | leitura'].join('\n'), counter())

    expect(preview.lines[1]?.after).toBe('- [ ] pratica | Códigos do projeto estrutura de dados - leitura ^t000001')
    expect(preview.lines[1]?.rules).toContain(7)
    expect(preview.ambiguous).toEqual([])
  })

  // Regra 8: sub-tarefa usa o nome da seção
  it('keeps the indentation of sub-tasks and gives them the section as lista', () => {
    const preview = previewRewrite(
      ['## estudar', '- [ ] hardware I | realizar Prova 01 do período', '\t- [ ] usar questões do ENEM'].join('\n'),
      counter(),
    )

    expect(preview.lines[2]?.after).toBe('\t- [ ] estudar | usar questões do ENEM ^t000002')
    expect(preview.lines[2]?.rules).toContain(8)
  })

  // Regra 9: descartada
  it('converts a discarded task with its reason', () => {
    expect(afterOf(['## Archive', '- [-] Ler artigo antigo ❌ 10.10.2026 — não é mais relevante'].join('\n'), 2)).toBe(
      '- [-] Archive | Ler artigo antigo ❌ 10.10.2026 — não é mais relevante ^t000001',
    )
  })

  it('turns a | in the discard reason into - so the title part never has |', () => {
    expect(afterOf(['## Archive', '- [-] Ler artigo ❌ 10.10.2026 — não é | mais relevante'].join('\n'), 2)).toBe(
      '- [-] Archive | Ler artigo ❌ 10.10.2026 — não é - mais relevante ^t000001',
    )
  })

  it('converts a discarded task without date and without ❌ field', () => {
    const preview = previewRewrite(['## Archive', '- [-] Ler artigo antigo'].join('\n'), counter())

    expect(preview.lines[1]).toMatchObject({ kind: 'task', after: '- [-] Archive | Ler artigo antigo ^t000001' })
    expect(preview.ambiguous).toEqual([])
  })

  // Regra 10: o que não é tarefa fica intacto
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

  // Regra 11: ID novo e único em cada tarefa convertida
  it('gives every converted line a unique id, skipping ids already in the file and repeated ids', () => {
    const source = ['## Casa', '- [ ] Um ^t000002', '- [ ] Dois', '- [ ] Três'].join('\n')
    const preview = previewRewrite(source, sequence('t000002', 't000001', 't000001', 't000003', 't000004'))
    const ids = preview.lines.flatMap((item) => (item.after?.match(/\^(t[a-z0-9]{6})$/) ? [item.after.slice(-7)] : []))

    expect(ids).toEqual(['t000001', 't000003'])
    expect(new Set(ids).size).toBe(ids.length)
  })

  // Regra 12: ** sai de datas e áreas, não do título
  it('removes ** from the date and the area, but not from the title', () => {
    const preview = previewRewrite(['## tarefas', '- [ ] **06.10.2026** | **Hera** | criar **revisão** diária'].join('\n'), counter())

    expect(preview.lines[1]?.after).toBe('- [ ] 06.10.2026 | Hera | criar **revisão** diária ^t000001')
    expect(preview.lines[1]?.rules).toContain(12)
  })
})
