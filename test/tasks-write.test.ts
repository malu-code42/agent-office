import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTaskWriter, planMoveTask, planNewTask, randomTaskId, taskIdsIn } from '../src/main/tasks-write'
import { parseTasksFile } from '../src/shared/tasks'

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
  '- [ ] Lavar roupa',
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

/** Ids handed out in order, the way a test needs them. */
const ids = (...list: string[]) => {
  let i = 0
  return () => list[i++]
}

const NOVA = {
  title: 'Revisar plano',
  list: 'Estudo',
  date: '16.10.2026',
  time: '09:00',
}

describe('planNewTask', () => {
  it('writes the line with date and time, after the last task of the list, and nothing else changes', () => {
    const out = planNewTask(SOURCE, NOVA, ids('tnovo01'))
    const before = SOURCE.split('\n')

    expect(out.id).toBe('tnovo01')
    expect(out.text.split('\n')).toEqual([
      ...before.slice(0, 7),
      '- [ ] 16.10.2026 | 09:00 | Estudo | Revisar plano ^tnovo01',
      ...before.slice(7),
    ])
  })

  it('writes the line without date or time: an absent field is not written', () => {
    const out = planNewTask(SOURCE, { title: 'Revisar plano', list: 'Estudo' }, ids('tnovo01'))
    expect(out.text.split('\n')[7]).toBe('- [ ] Estudo | Revisar plano ^tnovo01')

    const dateOnly = planNewTask(SOURCE, { title: 'Revisar plano', list: 'Estudo', date: '16.10.2026', time: '' }, ids('tnovo01'))
    expect(dateOnly.text.split('\n')[7]).toBe('- [ ] 16.10.2026 | Estudo | Revisar plano ^tnovo01')

    const timeOnly = planNewTask(SOURCE, { title: 'Revisar plano', list: 'Estudo', time: '09:00' }, ids('tnovo01'))
    expect(timeOnly.text.split('\n')[7]).toBe('- [ ] 09:00 | Estudo | Revisar plano ^tnovo01')
  })

  it('puts the task right under the heading when the list has no task yet', () => {
    const text = '## Rotina\n\n## Casa\n- [ ] Lavar roupa ^t1a2b3c\n'
    const out = planNewTask(text, { title: 'Caminhar', list: 'Rotina' }, ids('tnovo01'))

    expect(out.text).toBe('## Rotina\n- [ ] Rotina | Caminhar ^tnovo01\n\n## Casa\n- [ ] Lavar roupa ^t1a2b3c\n')
  })

  it('keeps CRLF line endings', () => {
    const text = '## Casa\r\n- [ ] Lavar roupa ^t1a2b3c\r\n'
    const out = planNewTask(text, { title: 'Passar pano', list: 'Casa' }, ids('tnovo01'))

    expect(out.text).toBe('## Casa\r\n- [ ] Lavar roupa ^t1a2b3c\r\n- [ ] Casa | Passar pano ^tnovo01\r\n')
  })

  it('refuses an empty title, a title with |, a title in several lines and a missing list', () => {
    expect(() => planNewTask(SOURCE, { ...NOVA, title: '   ' })).toThrow('Escreva o título da tarefa.')
    expect(() => planNewTask(SOURCE, { ...NOVA, title: 'Revisar | plano' })).toThrow('“|”')
    expect(() => planNewTask(SOURCE, { ...NOVA, title: 'Revisar\nplano' })).toThrow('caber em uma linha')
    expect(() => planNewTask(SOURCE, { ...NOVA, list: 'Trabalho' })).toThrow('Não encontrei a lista “Trabalho” no tarefas.md.')
  })

  it('refuses a date or time that is not written as DD.MM.AAAA and HH:MM', () => {
    expect(() => planNewTask(SOURCE, { ...NOVA, date: '31.02.2026' })).toThrow('DD.MM.AAAA')
    expect(() => planNewTask(SOURCE, { ...NOVA, date: '2026-10-16' })).toThrow('DD.MM.AAAA')
    expect(() => planNewTask(SOURCE, { ...NOVA, time: '9h' })).toThrow('HH:MM')
  })

  it('skips ids already in the file, the Archive included', () => {
    const out = planNewTask(SOURCE, NOVA, ids('t1a2b3c', 't7e8f9a', 'tnovo01'))
    expect(out.id).toBe('tnovo01')
  })

  it('gives every new task its own id, unique in the whole file', () => {
    let text = SOURCE
    const created: string[] = []
    for (let i = 0; i < 300; i++) {
      const out = planNewTask(text, { title: `Tarefa ${i}`, list: 'Estudo' })
      created.push(out.id)
      text = out.text
    }

    expect(new Set(created).size).toBe(300)
    for (const id of created) {
      expect(id).toMatch(/^t[a-z0-9]{6}$/)
      expect(text.split(`^${id}`).length - 1).toBe(1)
    }
    expect(taskIdsIn(text).size).toBe(303)
  })

  it('makes ids from six lowercase letters or digits', () => {
    for (let i = 0; i < 50; i++) expect(randomTaskId()).toMatch(/^t[a-z0-9]{6}$/)
  })
})

describe('createTaskWriter', () => {
  let vault: string
  let file: string

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), 'ao-tasks-write-'))
    file = join(vault, 'tarefas.md')
    writeFileSync(file, SOURCE, 'utf8')
  })

  afterEach(() => rmSync(vault, { recursive: true, force: true }))

  it('writes the task atomically, byte-identical except for the new line, and the reader reads it back', () => {
    const writer = createTaskWriter({ newId: ids('tnovo01') })
    writer.remember(vault, readFileSync(file, 'utf8'))

    expect(writer.create(vault, NOVA)).toBe('tnovo01')

    const after = readFileSync(file, 'utf8')
    const before = SOURCE.split('\n')
    expect(after.startsWith('\uFEFF---')).toBe(true)
    expect(after.split('\n')).toEqual([
      ...before.slice(0, 7),
      '- [ ] 16.10.2026 | 09:00 | Estudo | Revisar plano ^tnovo01',
      ...before.slice(7),
    ])
    expect(existsSync(join(vault, 'tarefas.md.tmp'))).toBe(false)

    const estudo = parseTasksFile(after).lists[0]!.tasks
    expect(estudo.at(-1)).toEqual({
      text: 'Revisar plano',
      line: 8,
      status: 'open',
      id: 'tnovo01',
      date: '16.10.2026',
      time: '09:00',
    })
  })

  it('retries a create with the same idempotency key without adding a duplicate line', () => {
    const writer = createTaskWriter({ newId: ids('tnew001') })
    writer.remember(vault, readFileSync(file, 'utf8'))
    const request = { ...NOVA, id: 'tretry1' }

    expect(writer.create(vault, request)).toBe('tretry1')
    const afterFirst = readFileSync(file, 'utf8')
    expect(writer.create(vault, request)).toBe('tretry1')
    expect(readFileSync(file, 'utf8')).toBe(afterFirst)
    expect(afterFirst.match(/\^tretry1/g) ?? []).toHaveLength(1)
    expect(readdirSync(join(vault, 'backups', 'tarefas'))).toHaveLength(1)
    expect(() => writer.create(vault, { ...request, title: 'Different objective' })).toThrow(/já pertence a outra tarefa/)
    expect(readFileSync(file, 'utf8')).toBe(afterFirst)
  })

  it('cancels the write when the file changed after the board read it', () => {
    const writer = createTaskWriter({ newId: ids('tnovo01') })
    writer.remember(vault, readFileSync(file, 'utf8'))
    const changed = SOURCE.replace('Lavar roupa', 'Lavar louça')
    writeFileSync(file, changed, 'utf8')

    expect(() => writer.create(vault, NOVA)).toThrow('mudou desde que você abriu o quadro')
    expect(readFileSync(file, 'utf8')).toBe(changed)
    expect(existsSync(join(vault, 'backups'))).toBe(false)
  })

  it('refuses to write before the board has read the file', () => {
    const writer = createTaskWriter({ newId: ids('tnovo01') })

    expect(() => writer.create(vault, NOVA)).toThrow('Abra o quadro Tarefas de novo')
    expect(readFileSync(file, 'utf8')).toBe(SOURCE)
  })

  it('backs up the file once per session, before the first write, and never deletes a backup', () => {
    const at = () => new Date(2026, 9, 16, 9, 5, 7)
    const folder = join(vault, 'backups', 'tarefas')
    const writer = createTaskWriter({ now: at, newId: ids('tnovo01', 'tnovo02') })
    writer.remember(vault, readFileSync(file, 'utf8'))
    writer.create(vault, NOVA)

    expect(readdirSync(folder)).toEqual(['tarefas-2026-10-16-090507.md'])
    expect(readFileSync(join(folder, 'tarefas-2026-10-16-090507.md'), 'utf8')).toBe(SOURCE)

    writer.remember(vault, readFileSync(file, 'utf8'))
    writer.create(vault, { title: 'Passar pano', list: 'Casa' })
    expect(readdirSync(folder)).toHaveLength(1)

    const nextSession = createTaskWriter({ now: at, newId: ids('tnovo03') })
    nextSession.remember(vault, readFileSync(file, 'utf8'))
    nextSession.create(vault, { title: 'Ler', list: 'Estudo' })

    expect(readdirSync(folder).sort()).toEqual(['tarefas-2026-10-16-090507-2.md', 'tarefas-2026-10-16-090507.md'])
    expect(readFileSync(join(folder, 'tarefas-2026-10-16-090507.md'), 'utf8')).toBe(SOURCE)
  })

  it('writes nothing and makes no backup when the draft is refused', () => {
    const writer = createTaskWriter({ newId: ids('tnovo01') })
    writer.remember(vault, readFileSync(file, 'utf8'))

    expect(() => writer.create(vault, { ...NOVA, title: '' })).toThrow('Escreva o título da tarefa.')
    expect(readFileSync(file, 'utf8')).toBe(SOURCE)
    expect(existsSync(join(vault, 'backups'))).toBe(false)
  })
})

/** Two lists: a new-format line (with date and time) and a task with an id, no date. */
const MIXED = [
  '## Estudo',
  '- [ ] 16.10.2026 | 09:00 | Estudo | Revisar plano ^t9z8y7x',
  '- [ ] Estudo | Ler capítulo 3 ^t1a2b3c',
  '',
  '## Casa',
  '- [ ] Casa | Lavar roupa ^t4d5e6f',
  '',
].join('\n')

const LEGACY = [
  '## Estudo',
  '- [ ] **06.10.2026** | Hera | criar relatório ^t2b3c4d',
  '- [ ] Estudo | IRA 9.0',
  '',
  '## Casa',
  '- [ ] Lavar roupa',
  '',
].join('\n')

describe('planMoveTask', () => {
  it('moves a new-format line: only that line changes, its lista field is updated and the id is kept', () => {
    const out = planMoveTask(MIXED, 2, 'Casa', () => {
      throw new Error('no id is needed: the task already has one')
    })

    expect(out.id).toBe('t9z8y7x')
    expect(out.text.split('\n')).toEqual([
      '## Estudo',
      '- [ ] Estudo | Ler capítulo 3 ^t1a2b3c',
      '',
      '## Casa',
      '- [ ] Casa | Lavar roupa ^t4d5e6f',
      '- [ ] 16.10.2026 | 09:00 | Casa | Revisar plano ^t9z8y7x',
      '',
    ])
  })

  it('moves a legacy line verbatim, without changing any of its fields', () => {
    const out = planMoveTask(LEGACY, 2, 'Casa', ids('tnovo01'))

    expect(out.id).toBe('t2b3c4d')
    expect(out.text.split('\n')).toEqual([
      '## Estudo',
      '- [ ] Estudo | IRA 9.0',
      '',
      '## Casa',
      '- [ ] Lavar roupa',
      '- [ ] **06.10.2026** | Hera | criar relatório ^t2b3c4d',
      '',
    ])
  })

  it('gives a task with no id one, unique in the file, and leaves its line otherwise as it was', () => {
    const out = planMoveTask(LEGACY, 3, 'Casa', ids('t2b3c4d', 'tnovo01'))

    expect(out.id).toBe('tnovo01')
    expect(out.text.split('\n')).toEqual([
      '## Estudo',
      '- [ ] **06.10.2026** | Hera | criar relatório ^t2b3c4d',
      '',
      '## Casa',
      '- [ ] Lavar roupa',
      '- [ ] Estudo | IRA 9.0 ^tnovo01',
      '',
    ])
  })

  it('does nothing when the task is already in that list', () => {
    expect(planMoveTask(MIXED, 2, 'Estudo').text).toBe(MIXED)
  })

  it('refuses to move from the Archive or to it, and a line that is not a task', () => {
    expect(() => planMoveTask(SOURCE, 13, 'Casa')).toThrow('As tarefas do Archive não podem ser movidas pelo quadro.')
    expect(() => planMoveTask(SOURCE, 6, 'Archive')).toThrow('Não é possível mover tarefas para o Archive pelo quadro.')
    expect(() => planMoveTask(SOURCE, 4, 'Casa')).toThrow('Não encontrei essa tarefa')
    expect(() => planMoveTask(SOURCE, 6, 'Trabalho')).toThrow('Não encontrei a lista “Trabalho” no tarefas.md.')
  })

  it('puts the task under the heading when the target list has no task yet', () => {
    const text = '## Rotina\n- [ ] Rotina | Caminhar ^t1a2b3c\n\n## Casa\n'
    const out = planMoveTask(text, 2, 'Casa')

    expect(out.text).toBe('## Rotina\n\n## Casa\n- [ ] Casa | Caminhar ^t1a2b3c\n')
  })
})

describe('move in createTaskWriter', () => {
  let vault: string
  let file: string

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), 'ao-tasks-move-'))
    file = join(vault, 'tarefas.md')
    writeFileSync(file, MIXED, 'utf8')
  })

  afterEach(() => rmSync(vault, { recursive: true, force: true }))

  it('writes the move atomically and the reader reads the task back in the new list', () => {
    const writer = createTaskWriter({ newId: ids('tnovo01') })
    writer.remember(vault, readFileSync(file, 'utf8'))

    writer.move(vault, 2, 'Casa')

    expect(existsSync(join(vault, 'tarefas.md.tmp'))).toBe(false)
    const after = readFileSync(file, 'utf8')
    expect(after).toBe(planMoveTask(MIXED, 2, 'Casa').text)
    const casa = parseTasksFile(after).lists[1]!.tasks
    expect(casa.at(-1)).toEqual({
      text: 'Revisar plano',
      line: 6,
      status: 'open',
      id: 't9z8y7x',
      date: '16.10.2026',
      time: '09:00',
    })
  })

  it('cancels the move when the file changed after the board read it', () => {
    const writer = createTaskWriter({ newId: ids('tnovo01') })
    writer.remember(vault, readFileSync(file, 'utf8'))
    const changed = MIXED.replace('Lavar roupa', 'Lavar louça')
    writeFileSync(file, changed, 'utf8')

    expect(() => writer.move(vault, 2, 'Casa')).toThrow('mudou desde que você abriu o quadro')
    expect(readFileSync(file, 'utf8')).toBe(changed)
    expect(existsSync(join(vault, 'backups'))).toBe(false)
  })

  it('makes no write and no backup for a move to the same list', () => {
    const writer = createTaskWriter({ newId: ids('tnovo01') })
    writer.remember(vault, readFileSync(file, 'utf8'))

    writer.move(vault, 2, 'Estudo')

    expect(readFileSync(file, 'utf8')).toBe(MIXED)
    expect(existsSync(join(vault, 'backups'))).toBe(false)
  })

  it('backs up the file once per session, before the first move, and never deletes a backup', () => {
    const at = () => new Date(2026, 9, 16, 9, 5, 7)
    const folder = join(vault, 'backups', 'tarefas')
    const writer = createTaskWriter({ now: at, newId: ids('tnovo01') })
    writer.remember(vault, readFileSync(file, 'utf8'))
    writer.move(vault, 2, 'Casa')

    expect(readdirSync(folder)).toEqual(['tarefas-2026-10-16-090507.md'])
    expect(readFileSync(join(folder, 'tarefas-2026-10-16-090507.md'), 'utf8')).toBe(MIXED)

    writer.remember(vault, readFileSync(file, 'utf8'))
    writer.move(vault, 2, 'Casa')
    expect(readdirSync(folder)).toHaveLength(1)

    const nextSession = createTaskWriter({ now: at, newId: ids('tnovo02') })
    nextSession.remember(vault, readFileSync(file, 'utf8'))
    nextSession.move(vault, 6, 'Estudo')

    expect(readdirSync(folder).sort()).toEqual(['tarefas-2026-10-16-090507-2.md', 'tarefas-2026-10-16-090507.md'])
    expect(readFileSync(join(folder, 'tarefas-2026-10-16-090507.md'), 'utf8')).toBe(MIXED)
  })
})
