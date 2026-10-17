import { describe, expect, it } from 'vitest'
import { parseTasksFile } from '../src/shared/tasks'

describe('parseTasksFile', () => {
  it('preserves the source and reads task lists in order, ignoring frontmatter and Kanban settings', () => {
    const source = [
      '---',
      'kanban-plugin: board',
      '---',
      '',
      '## Objetivos',
      '- [ ] Terminar o curso 📅 2026-10-20 ^t1a2b3c',
      '- [x] Comprar o livro ✅ 2026-10-12 ^t4c5d6e',
      '',
      '## Rotina',
      '',
      '## Archive',
      '- [-] Ler artigo antigo ❌ 2026-10-10 — descartada: não é mais relevante ^t7e8f9a',
      '%% kanban:settings',
      '```',
      '{"kanban-plugin":"board"}',
      '```',
      '%%',
      '',
    ].join('\n')

    const parsed = parseTasksFile(source)

    expect(parsed.original).toBe(source)
    expect(parsed.lists.map((list) => list.name)).toEqual(['Objetivos', 'Rotina', 'Archive'])
    expect(parsed.lists[0]?.tasks).toEqual([
      { text: 'Terminar o curso', line: 6, status: 'open', id: 't1a2b3c', dueDate: '2026-10-20' },
      { text: 'Comprar o livro', line: 7, status: 'completed', completedDate: '2026-10-12', id: 't4c5d6e' },
    ])
    expect(parsed.lists[1]?.tasks).toEqual([])
    expect(parsed.lists[2]?.tasks).toEqual([
      {
        text: 'Ler artigo antigo',
        line: 12,
        status: 'discarded',
        completedDate: '2026-10-10',
        reason: 'não é mais relevante',
        id: 't7e8f9a',
      },
    ])
    expect(parsed.warnings).toEqual([])
  })

  it('warns about non-task lines without rendering them as task cards', () => {
    const parsed = parseTasksFile(['## Casa', 'uma anotação livre', '- [ ] Lavar roupa ^t1a2b3c', 'texto após a tarefa'].join('\n'))

    expect(parsed.lists[0]?.tasks).toEqual([{ text: 'Lavar roupa', line: 3, status: 'open', id: 't1a2b3c' }])
    expect(parsed.warnings).toEqual([
      'Linha 2: "uma anotação livre" não é uma tarefa reconhecida.',
      'Linha 4: "texto após a tarefa" não é uma tarefa reconhecida.',
    ])
  })

  it('supports CRLF and a UTF-8 BOM without changing the original text', () => {
    const source = '\uFEFF---\r\nkanban-plugin: board\r\n---\r\n## Estudar\r\n- [ ] Rever o tópico ^t123abc\r\n'
    const parsed = parseTasksFile(source)

    expect(parsed.original).toBe(source)
    expect(parsed.lists).toEqual([{ name: 'Estudar', tasks: [{ text: 'Rever o tópico', line: 5, status: 'open', id: 't123abc' }] }])
    expect(parsed.warnings).toEqual([])
  })

  it('accepts only unique six-character block ids and warns about malformed or duplicate ids', () => {
    const parsed = parseTasksFile(
      ['## Casa', '- [ ] ID válido ^tab12cd', '- [ ] ID malformado ^tshort', '- [ ] ID repetido ^tab12cd'].join('\n'),
    )

    expect(parsed.lists[0]?.tasks.map((task) => ({ text: task.text, id: task.id }))).toEqual([
      { text: 'ID válido', id: 'tab12cd' },
      { text: 'ID malformado', id: undefined },
      { text: 'ID repetido', id: undefined },
    ])
    expect(parsed.warnings).toEqual([
      'Linha 3: identificador de tarefa inválido; esperado ^t seguido por seis caracteres alfanuméricos.',
      'Linha 4: identificador de tarefa duplicado (tab12cd).',
    ])
  })

  it('reports unknown content outside task lists instead of silently dropping it', () => {
    const parsed = parseTasksFile(
      ['texto introdutório', '', '## Casa', '- [ ] Limpar mesa ^t123abc', '## Configurações', 'texto livre'].join('\n'),
    )

    expect(parsed.lists.map((list) => list.name)).toEqual(['Casa', 'Configurações'])
    expect(parsed.lists[0]?.tasks).toHaveLength(1)
    expect(parsed.lists[1]?.tasks).toEqual([])
    expect(parsed.warnings).toEqual([
      'Linha 1: "texto introdutório" não é uma tarefa reconhecida.',
      'Linha 6: "texto livre" não é uma tarefa reconhecida.',
    ])
  })

  it('reads **DD.MM.AAAA** and **DD.MM** at the start of the title as written, without the asterisks', () => {
    const parsed = parseTasksFile(['## Rotina', '- [ ] **06.10.2026** | criar o hábito', '- [ ] **09.10** | apresentação'].join('\n'))

    expect(parsed.lists[0]?.tasks).toEqual([
      { text: 'criar o hábito', line: 2, status: 'open', dueDate: '06.10.2026' },
      { text: 'apresentação', line: 3, status: 'open', dueDate: '09.10' },
    ])
    expect(parsed.warnings).toEqual([])
  })

  it('keeps the 📅 AAAA-MM-DD form and reads titles without any date', () => {
    const parsed = parseTasksFile(['## Casa', '- [ ] Lavar roupa 📅 2026-10-20', '- [ ] Sem data nenhuma'].join('\n'))

    expect(parsed.lists[0]?.tasks).toEqual([
      { text: 'Lavar roupa', line: 2, status: 'open', dueDate: '2026-10-20' },
      { text: 'Sem data nenhuma', line: 3, status: 'open' },
    ])
    expect(parsed.lists[0]?.tasks[1]?.dueDate).toBeUndefined()
  })
})
