import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTaskWriter, planComplete, planDiscard, planReopen } from '../src/main/tasks-write'
import { isNewFormatLine, parseTasksFile } from '../src/shared/tasks'

/**
 * Descartar e reabrir tarefa (AO-06): a discard is not a completion, the reason is required, and a
 * reopen puts the line back in its origin list with the marks gone and the id kept. Other lines
 * stay byte for byte.
 */

const SOURCE = [
  '## Estudo',
  '- [ ] Ler capítulo 3 ^t1a2b3c',
  '## Casa',
  '- [ ] 16.10.2026 | 09:00 | Casa | Lavar roupa ^tabc123',
  '- [ ] Passar pano ^tdef456',
  '## Archive',
  '- [-] Ler artigo antigo ❌ 2026-10-10 — descartada: não é mais relevante ^t7e8f9a',
  '',
].join('\n')

const DAY = new Date(2026, 9, 17, 10, 30)
const ids = (...list: string[]) => {
  let i = 0
  return () => list[i++]!
}
const record = (origin: string, originalLine: string) => ({ origin, completedAt: '2026-10-17', originalLine })

describe('planDiscard', () => {
  it('moves a new-format line to the end of the Archive as discarded, with the day, the reason and the id, and no ✅', () => {
    const out = planDiscard(SOURCE, 4, 'Não faz mais sentido', DAY, ids('tnovo01'))

    expect(out).toMatchObject({ id: 'tabc123', origin: 'Casa', completedAt: '2026-10-17' })
    expect(out.text.split('\n')).toEqual([
      '## Estudo',
      '- [ ] Ler capítulo 3 ^t1a2b3c',
      '## Casa',
      '- [ ] Passar pano ^tdef456',
      '## Archive',
      '- [-] Ler artigo antigo ❌ 2026-10-10 — descartada: não é mais relevante ^t7e8f9a',
      '- [-] 16.10.2026 | 09:00 | Casa | Lavar roupa ❌ 17.10.2026 — Não faz mais sentido ^tabc123',
      '',
    ])
    expect(out.text).not.toContain('✅')
  })

  it('refuses an empty or spaces-only reason, with the words of the form', () => {
    expect(() => planDiscard(SOURCE, 4, '', DAY)).toThrow('Escreva o motivo para descartar a tarefa.')
    expect(() => planDiscard(SOURCE, 4, '   \t ', DAY)).toThrow('Escreva o motivo para descartar a tarefa.')
  })

  it('refuses a reason that would break the fields of the line, or is too long', () => {
    expect(() => planDiscard(SOURCE, 4, 'sem tempo | amanhã', DAY)).toThrow('O motivo não pode ter “|”')
    expect(() => planDiscard(SOURCE, 4, 'linha\nnova', DAY)).toThrow('O motivo não pode ter “|”')
    expect(() => planDiscard(SOURCE, 4, 'ver ^tabc123', DAY)).toThrow('O motivo não pode ter “|”')
    expect(() => planDiscard(SOURCE, 4, 'x'.repeat(201), DAY)).toThrow('O motivo pode ter até 200 caracteres.')
  })

  it('refuses the Archive, a task that is not open, and a line with no task', () => {
    expect(() => planDiscard(SOURCE, 7, 'Sem tempo', DAY)).toThrow('As tarefas do Archive não podem ser descartadas.')
    expect(() => planDiscard('## Casa\n- [x] Feito ✅ 2026-10-12 ^tabc123\n', 2, 'Sem tempo', DAY)).toThrow(
      'Só tarefas abertas podem ser descartadas.',
    )
    expect(() => planDiscard(SOURCE, 1, 'Sem tempo', DAY)).toThrow('Não encontrei essa tarefa no tarefas.md.')
  })

  it('gives a legacy line without an id one, and keeps its text', () => {
    const out = planDiscard('## Casa\n- [ ] Lavar roupa\n## Archive\n', 2, 'Sem tempo', DAY, ids('tnovo02'))

    expect(out.id).toBe('tnovo02')
    expect(out.text).toBe('## Casa\n## Archive\n- [-] Lavar roupa ❌ 17.10.2026 — Sem tempo ^tnovo02\n')
  })

  it('keeps CRLF line endings in the Archive', () => {
    const out = planDiscard('## Casa\r\n- [ ] Lavar roupa ^tabc123\r\n## Archive\r\n- [-] Velho ^t7e8f9a\r\n', 2, 'Sem tempo', DAY)

    expect(out.text).toBe('## Casa\r\n## Archive\r\n- [-] Velho ^t7e8f9a\r\n- [-] Lavar roupa ❌ 17.10.2026 — Sem tempo ^tabc123\r\n')
  })
})

describe('planReopen', () => {
  it('puts a concluded task back at the end of its origin list, with the id, and drops its record', () => {
    const done = planComplete(SOURCE, 4, DAY, ids('tnovo01'))
    const plan = planReopen(done.text, 'tabc123', { archived: () => record(done.origin, done.originalLine) })

    expect(plan).toMatchObject({ status: 'done', id: 'tabc123', list: 'Casa' })
    expect(plan.status === 'done' && plan.text.split('\n')).toEqual([
      '## Estudo',
      '- [ ] Ler capítulo 3 ^t1a2b3c',
      '## Casa',
      '- [ ] Passar pano ^tdef456',
      '- [ ] 16.10.2026 | 09:00 | Casa | Lavar roupa ^tabc123',
      '## Archive',
      '- [-] Ler artigo antigo ❌ 2026-10-10 — descartada: não é mais relevante ^t7e8f9a',
      '',
    ])
  })

  it('puts a discarded task back without its ❌, its date and its reason', () => {
    const discarded = planDiscard(SOURCE, 4, 'Não faz mais sentido', DAY, ids('tnovo01'))
    const plan = planReopen(discarded.text, 'tabc123', { archived: () => record(discarded.origin, discarded.originalLine) })

    expect(plan.status === 'done' && plan.text.split('\n')).toContain('- [ ] 16.10.2026 | 09:00 | Casa | Lavar roupa ^tabc123')
    expect(plan.status === 'done' && plan.text).not.toContain('Não faz mais sentido')
  })

  it('restores a legacy line to the text it had before, and keeps the id it has now', () => {
    const legacy = '## Estudo\n- [ ] **06.10.2026** | Hera | criar relatório\n## Archive\n'
    const done = planComplete(legacy, 2, DAY, ids('tfoco01'))
    const plan = planReopen(done.text, 'tfoco01', { archived: () => record(done.origin, done.originalLine) })

    expect(plan.status === 'done' && plan.text).toBe('## Estudo\n- [ ] **06.10.2026** | Hera | criar relatório ^tfoco01\n## Archive\n')
  })

  it('takes the marks off a legacy line in place when its record is gone', () => {
    const text = '## Estudo\n## Archive\n- [x] **06.10.2026** | Hera | criar relatório ✅ 17.10.2026 ^tfoco01\n'
    const plan = planReopen(text, 'tfoco01', { archived: () => undefined, list: 'Estudo' })

    expect(plan.status === 'done' && plan.text).toBe('## Estudo\n- [ ] **06.10.2026** | Hera | criar relatório ^tfoco01\n## Archive\n')
  })

  it('asks for a list, and writes nothing, when the origin list is gone; a list chosen is used', () => {
    const done = planComplete(SOURCE, 4, DAY, ids('tnovo01'))

    expect(planReopen(done.text, 'tabc123', { archived: () => record('Leitura', done.originalLine) })).toEqual({
      status: 'choose',
      lists: ['Estudo', 'Casa'],
    })
    expect(planReopen(done.text, 'tabc123', { archived: () => undefined })).toMatchObject({ status: 'choose' })

    const chosen = planReopen(done.text, 'tabc123', { list: 'Estudo', archived: () => record('Leitura', done.originalLine) })
    expect(chosen).toMatchObject({ status: 'done', list: 'Estudo' })
    expect(chosen.status === 'done' && parseTasksFile(chosen.text).lists[0]!.tasks.map((t) => t.id)).toEqual(['t1a2b3c', 'tabc123'])
  })

  it('refuses a list that does not exist', () => {
    const done = planComplete(SOURCE, 4, DAY, ids('tnovo01'))

    expect(() => planReopen(done.text, 'tabc123', { list: 'Leitura', archived: () => undefined })).toThrow(
      'Não encontrei a lista “Leitura” no tarefas.md.',
    )
  })

  it('refuses an open task with no record, and lets go of the record of an open task', () => {
    expect(() => planReopen(SOURCE, 'tdef456', { archived: () => undefined })).toThrow('Essa tarefa não está concluída nem descartada')

    const plan = planReopen(SOURCE, 'tdef456', { archived: () => record('Casa', '- [ ] Passar pano ^tdef456') })
    expect(plan).toEqual({ status: 'done', text: SOURCE, id: 'tdef456', list: 'Casa' })
  })

  it('refuses a task that is not in the file', () => {
    expect(() => planReopen(SOURCE, 'tzzzzzz', { archived: () => undefined })).toThrow('Não encontrei essa tarefa no tarefas.md.')
  })
})

describe('isNewFormatLine', () => {
  it('tells the new format from a legacy line, marks and id aside', () => {
    expect(isNewFormatLine('- [ ] 16.10.2026 | 09:00 | Casa | Lavar roupa ^tabc123')).toBe(true)
    expect(isNewFormatLine('- [-] Casa | Ler revista ❌ 17.10.2026 — sem tempo ^t6f7a8b')).toBe(true)
    expect(isNewFormatLine('- [ ] **06.10.2026** | Hera | criar relatório ^tfoco01')).toBe(false)
    expect(isNewFormatLine('- [ ] Lavar roupa')).toBe(false)
  })
})

describe('discard and reopen in createTaskWriter', () => {
  let vault: string
  let file: string

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), 'ao-tasks-reopen-'))
    file = join(vault, 'tarefas.md')
    writeFileSync(file, SOURCE, 'utf8')
  })

  afterEach(() => rmSync(vault, { recursive: true, force: true }))

  it('discards by line and writes the discarded line, leaving the rest of the file as it was', () => {
    const writer = createTaskWriter({ now: () => DAY, newId: ids('tnovo01') })
    writer.remember(vault, SOURCE)

    const out = writer.discard(vault, 4, 'Não faz mais sentido')

    expect(out).toEqual({
      id: 'tabc123',
      origin: 'Casa',
      completedAt: '2026-10-17',
      originalLine: '- [ ] 16.10.2026 | 09:00 | Casa | Lavar roupa ^tabc123',
    })
    expect(readFileSync(file, 'utf8')).toBe(planDiscard(SOURCE, 4, 'Não faz mais sentido', DAY).text)
  })

  it('refuses an empty reason, and writes nothing', () => {
    const writer = createTaskWriter({ now: () => DAY })
    writer.remember(vault, SOURCE)

    expect(() => writer.discard(vault, 4, '  ')).toThrow('Escreva o motivo para descartar a tarefa.')
    expect(readFileSync(file, 'utf8')).toBe(SOURCE)
  })

  it('round-trips a discard and its reopen back to the same bytes', () => {
    const source = '## Casa\n- [ ] Lavar roupa ^tabc123\n## Archive\n- [-] Velho ❌ 2026-10-10 — descartada: x ^t7e8f9a\n'
    writeFileSync(file, source, 'utf8')
    const writer = createTaskWriter({ now: () => DAY })
    writer.remember(vault, source)

    const out = writer.discard(vault, 'tabc123', 'Sem tempo')
    const plan = writer.reopen(vault, 'tabc123', { archived: () => record(out.origin, out.originalLine) })

    expect(plan.status).toBe('done')
    expect(readFileSync(file, 'utf8')).toBe(source)
  })

  it('reopens a discarded task from the file, by id, after the board read it', () => {
    const writer = createTaskWriter({ now: () => DAY, newId: ids('tnovo01') })
    writer.remember(vault, SOURCE)
    const out = writer.discard(vault, 4, 'Não faz mais sentido')

    writer.reopen(vault, out.id, { archived: () => record(out.origin, out.originalLine) })

    expect(readFileSync(file, 'utf8')).toContain('- [ ] 16.10.2026 | 09:00 | Casa | Lavar roupa ^tabc123\n')
    expect(readFileSync(file, 'utf8')).not.toContain('❌ 17.10.2026')
  })

  it('writes nothing when the origin list is gone, and the chosen list gets the task', () => {
    const writer = createTaskWriter({ now: () => DAY, newId: ids('tnovo01') })
    writer.remember(vault, SOURCE)
    writer.discard(vault, 4, 'Não faz mais sentido')
    const discarded = readFileSync(file, 'utf8')

    expect(writer.reopen(vault, 'tabc123', { archived: () => record('Leitura', '') })).toEqual({
      status: 'choose',
      lists: ['Estudo', 'Casa'],
    })
    expect(readFileSync(file, 'utf8')).toBe(discarded)

    expect(writer.reopen(vault, 'tabc123', { list: 'Estudo', archived: () => record('Leitura', '') })).toMatchObject({
      status: 'done',
      list: 'Estudo',
    })
    expect(readFileSync(file, 'utf8').split('\n')[1]).toBe('- [ ] Ler capítulo 3 ^t1a2b3c')
    expect(readFileSync(file, 'utf8').split('\n')[2]).toBe('- [ ] 16.10.2026 | 09:00 | Casa | Lavar roupa ^tabc123')
  })

  it('refuses a reopen when the file changed since the board read it, and writes nothing', () => {
    const writer = createTaskWriter({ now: () => DAY, newId: ids('tnovo01') })
    writer.remember(vault, SOURCE)
    writer.discard(vault, 4, 'Não faz mais sentido')
    const changed = readFileSync(file, 'utf8') + '- [ ] Outra coisa\n'
    writeFileSync(file, changed, 'utf8')

    expect(() => writer.reopen(vault, 'tabc123', { archived: () => record('Casa', '') })).toThrow('mudou desde que você abriu o quadro')
    expect(readFileSync(file, 'utf8')).toBe(changed)
  })
})

describe('the parser reads the discarded line of the new format', () => {
  it('takes the DD.MM.AAAA date and the reason, and the id', () => {
    const board = parseTasksFile(
      '## Archive\n- [-] 16.10.2026 | 09:00 | Casa | Lavar roupa ❌ 17.10.2026 — Não faz mais sentido ^tabc123\n',
    )
    const task = board.lists[0]!.tasks[0]!

    expect(task).toMatchObject({
      id: 'tabc123',
      text: 'Lavar roupa',
      status: 'discarded',
      completedDate: '17.10.2026',
      reason: 'Não faz mais sentido',
      date: '16.10.2026',
      time: '09:00',
    })
  })
})
