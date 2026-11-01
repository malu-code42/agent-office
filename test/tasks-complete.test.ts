import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTaskWriter, lineOfId, planComplete, planUndoComplete } from '../src/main/tasks-write'
import { parseTasksFile } from '../src/shared/tasks'

/**
 * Concluir tarefa (AO-05): the line goes to the Archive with its day and the same id, the other
 * lines stay as they are, and undo gives the file back byte for byte.
 */

const SOURCE = [
  '\uFEFF---',
  'kanban-plugin: board',
  '---',
  '',
  '## Estudo',
  '- [ ] Ler capítulo 3 ^t1a2b3c',
  '- [x] Terminar exercício ✅ 2026-10-12 ^t4c5d6e',
  '',
  '## Casa',
  '- [ ] 16.10.2026 | 09:00 | Casa | Lavar roupa ^tabc123',
  '',
  '## Archive',
  '- [-] Ler artigo antigo ❌ 2026-10-10 — descartada: não é mais relevante ^t7e8f9a',
  '',
].join('\n')

const DAY = new Date(2026, 9, 17, 10, 30)
const ids = (...list: string[]) => {
  let i = 0
  return () => list[i++]!
}

describe('planComplete', () => {
  it('moves a new-format line to the end of the Archive with its day and id, and nothing else changes', () => {
    const out = planComplete(SOURCE, 10, DAY, ids('tnovo01'))

    expect(out.id).toBe('tabc123')
    expect(out.origin).toBe('Casa')
    expect(out.completedAt).toBe('2026-10-17')
    expect(out.originalLine).toBe('- [ ] 16.10.2026 | 09:00 | Casa | Lavar roupa ^tabc123')
    expect(out.text.split('\n')).toEqual([
      '\uFEFF---',
      'kanban-plugin: board',
      '---',
      '',
      '## Estudo',
      '- [ ] Ler capítulo 3 ^t1a2b3c',
      '- [x] Terminar exercício ✅ 2026-10-12 ^t4c5d6e',
      '',
      '## Casa',
      '',
      '## Archive',
      '- [-] Ler artigo antigo ❌ 2026-10-10 — descartada: não é mais relevante ^t7e8f9a',
      '- [x] 16.10.2026 | 09:00 | Casa | Lavar roupa ✅ 17.10.2026 10:30 ^tabc123',
      '',
    ])
  })

  it('reads back as a completed task with its date, its fields and its id', () => {
    const board = parseTasksFile(planComplete(SOURCE, 10, DAY, ids('tnovo01')).text)
    const archive = board.lists.find((l) => l.name === 'Archive')!

    expect(archive.tasks.find((t) => t.id === 'tabc123')).toMatchObject({
      text: 'Lavar roupa',
      status: 'completed',
      completedDate: '17.10.2026',
      date: '16.10.2026',
      time: '09:00',
    })
  })

  it('moves a legacy line verbatim, with the day inserted before its id and [x] for [ ]', () => {
    const legacy = '## Estudo\n- [ ] **06.10.2026** | Hera | criar relatório\n## Archive\n'
    const out = planComplete(legacy, 2, DAY, ids('tfoco01'))

    expect(out.id).toBe('tfoco01')
    expect(out.text).toBe('## Estudo\n## Archive\n- [x] **06.10.2026** | Hera | criar relatório ✅ 17.10.2026 10:30 ^tfoco01\n')
  })

  it('gives a task without an id one that no other task has', () => {
    const noId = '## Casa\n- [ ] Lavar roupa\n## Archive\n- [-] Velho ^t7e8f9a\n'
    const out = planComplete(noId, 2, DAY, ids('t7e8f9a', 'tnovo02'))

    expect(out.id).toBe('tnovo02')
    expect(out.text).toBe('## Casa\n## Archive\n- [-] Velho ^t7e8f9a\n- [x] Lavar roupa ✅ 17.10.2026 10:30 ^tnovo02\n')
  })

  it('creates the Archive at the end of the file, after one blank line, when there is none', () => {
    const out = planComplete('## Casa\n- [ ] Lavar roupa ^tabc123\n', 2, DAY)

    expect(out.text).toBe('## Casa\n\n## Archive\n- [x] Lavar roupa ✅ 17.10.2026 10:30 ^tabc123\n')
  })

  it('keeps CRLF line endings in the new section', () => {
    const out = planComplete('## Casa\r\n- [ ] Lavar roupa ^tabc123\r\n', 2, DAY)

    expect(out.text).toBe('## Casa\r\n\r\n## Archive\r\n- [x] Lavar roupa ✅ 17.10.2026 10:30 ^tabc123\r\n')
  })

  it('refuses the Archive, a task that is not open, and a line with no task', () => {
    expect(() => planComplete(SOURCE, 13, DAY)).toThrow('As tarefas do Archive já estão concluídas.')
    expect(() => planComplete(SOURCE, 7, DAY)).toThrow('Só tarefas abertas podem ser concluídas.')
    expect(() => planComplete(SOURCE, 4, DAY)).toThrow('Não encontrei essa tarefa no tarefas.md.')
  })

  it('refuses a line with a broken id, instead of giving it a second one', () => {
    expect(() => planComplete('## Casa\n- [ ] Lavar roupa ^tXY\n', 2, DAY)).toThrow('identificador repetido ou inválido')
  })

  it('finds a task by its id, whatever its case', () => {
    expect(lineOfId(SOURCE, 'TABC123')).toBe(10)
    expect(() => lineOfId(SOURCE, 'tzzzzzz')).toThrow('Não encontrei essa tarefa')
  })

  it('undoes to the text it was given, and refuses any other text', () => {
    const out = planComplete(SOURCE, 10, DAY)

    expect(planUndoComplete(out.text, { before: SOURCE, after: out.text })).toBe(SOURCE)
    expect(() => planUndoComplete(out.text + '\n', { before: SOURCE, after: out.text })).toThrow('nada foi desfeito')
  })
})

describe('complete and undo in createTaskWriter', () => {
  let vault: string
  let file: string

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), 'ao-tasks-complete-'))
    file = join(vault, 'tarefas.md')
    writeFileSync(file, SOURCE, 'utf8')
  })

  afterEach(() => rmSync(vault, { recursive: true, force: true }))

  it('completes by line and returns what undo needs; one backup per session', () => {
    const folder = join(vault, 'backups', 'tarefas')
    const writer = createTaskWriter({ now: () => new Date(2026, 9, 16, 9, 5, 7), newId: ids('tnovo01') })
    writer.remember(vault, SOURCE)

    const done = writer.complete(vault, 10)
    expect(done).toMatchObject({
      id: 'tabc123',
      origin: 'Casa',
      completedAt: '2026-10-16',
      before: SOURCE,
      after: readFileSync(file, 'utf8'),
    })
    expect(readdirSync(folder)).toEqual(['tarefas-2026-10-16-090507.md'])
    expect(readFileSync(join(folder, 'tarefas-2026-10-16-090507.md'), 'utf8')).toBe(SOURCE)
    expect(existsSync(join(vault, 'tarefas.md.tmp'))).toBe(false)
  })

  it('completes by id, the way the focus popup does', () => {
    const writer = createTaskWriter({ newId: ids('tnovo01'), now: () => DAY })
    writer.remember(vault, SOURCE)

    expect(writer.complete(vault, 'tabc123').id).toBe('tabc123')
    expect(readFileSync(file, 'utf8')).toContain('- [x] 16.10.2026 | 09:00 | Casa | Lavar roupa ✅ 17.10.2026 10:30 ^tabc123')
  })

  it('refuses to complete when the file changed after the board read it, and writes nothing', () => {
    const writer = createTaskWriter({ newId: ids('tnovo01') })
    writer.remember(vault, SOURCE)
    const changed = SOURCE.replace('Lavar roupa', 'Lavar louça')
    writeFileSync(file, changed, 'utf8')

    expect(() => writer.complete(vault, 10)).toThrow('mudou desde que você abriu o quadro')
    expect(readFileSync(file, 'utf8')).toBe(changed)
  })

  it('undo gives the file back exactly as it was', () => {
    const writer = createTaskWriter({ newId: ids('tnovo01') })
    writer.remember(vault, SOURCE)
    const done = writer.complete(vault, 10)

    writer.undoComplete(vault, done)
    expect(readFileSync(file, 'utf8')).toBe(SOURCE)
  })

  it('undo removes the Archive section that the completion created', () => {
    const plain = '## Casa\n- [ ] Lavar roupa ^tabc123\n'
    writeFileSync(file, plain, 'utf8')
    const writer = createTaskWriter({ newId: ids('tnovo01') })
    writer.remember(vault, plain)
    const done = writer.complete(vault, 2)

    writer.undoComplete(vault, done)
    expect(readFileSync(file, 'utf8')).toBe(plain)
  })

  it('undo is refused, and writes nothing, when the file changed since the completion', () => {
    const writer = createTaskWriter({ newId: ids('tnovo01') })
    writer.remember(vault, SOURCE)
    const done = writer.complete(vault, 10)
    const edited = readFileSync(file, 'utf8') + '- [ ] Outra\n'
    writeFileSync(file, edited, 'utf8')

    expect(() => writer.undoComplete(vault, done)).toThrow('nada foi desfeito')
    expect(readFileSync(file, 'utf8')).toBe(edited)
  })
})
