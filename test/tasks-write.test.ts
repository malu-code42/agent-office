import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTaskWriter, planNewTask, randomTaskId, taskIdsIn } from '../src/main/tasks-write'
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
