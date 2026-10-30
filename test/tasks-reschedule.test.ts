import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTaskWriter, planReschedule } from '../src/main/tasks-write'
import { parseTasksFile, rescheduleTargets, taskDue, taskWhen } from '../src/shared/tasks'

const SOURCE = [
  '## Estudo',
  '- [ ] 16.10.2026 | 09:00 | Estudo | Revisar plano ^t9z8y7x',
  '- [ ] Estudo | Ler capítulo 3 ^t1a2b3c',
  '- [ ] 09:00 | Estudo | Ler artigo ^t3c4d5e',
  '',
  '## Casa',
  '- [ ] Casa | Lavar roupa ^t4d5e6f',
  '- [x] 10.10.2026 | Casa | Passar pano ✅ 2026-10-12 ^t5e6f7a',
  '',
  '## Archive',
  '- [-] Casa | Ler revista ❌ 2026-10-10 — descartada: sem tempo ^t6f7a8b',
  '',
].join('\n')

const LEGACY_BOLD = '## Estudo\n- [ ] **06.10.2026** | Hera | criar relatório ^t2b3c4d\n'
const LEGACY_EMOJI = '## Casa\n- [ ] Lavar roupa 📅 2026-10-16 ^t4d5e6f\n'
const LEGACY_PLAIN = '## Casa\n- [ ] Lavar roupa ^t1a2b3c\n'

describe('taskWhen', () => {
  it('shows the date and time as written, and nothing when the line has neither', () => {
    const estudo = parseTasksFile(SOURCE).lists[0]!.tasks

    expect(taskWhen(estudo[0]!)).toBe('16.10.2026 09:00')
    expect(taskWhen(estudo[1]!)).toBeNull()
    expect(taskWhen(estudo[2]!)).toBe('09:00')
  })

  it('shows the due date of a legacy line as written', () => {
    const task = parseTasksFile(LEGACY_EMOJI).lists[0]!.tasks[0]!

    expect(taskWhen(task)).toBe('2026-10-16')
  })
})

describe('rescheduleTargets', () => {
  it('offers tomorrow, three days later and the Monday of next week, from the local day', () => {
    expect(rescheduleTargets(new Date(2026, 9, 16))).toEqual([
      { label: 'Amanhã', date: '17.10.2026' },
      { label: 'Em 3 dias', date: '19.10.2026' },
      { label: 'Próxima semana', date: '19.10.2026' },
    ])
  })

  it('takes the Monday after a Sunday as next week, which is tomorrow', () => {
    expect(rescheduleTargets(new Date(2026, 9, 18))).toEqual([
      { label: 'Amanhã', date: '19.10.2026' },
      { label: 'Em 3 dias', date: '21.10.2026' },
      { label: 'Próxima semana', date: '19.10.2026' },
    ])
  })

  it('takes the Monday after a Monday as the one in seven days, never today', () => {
    expect(rescheduleTargets(new Date(2026, 9, 19))).toEqual([
      { label: 'Amanhã', date: '20.10.2026' },
      { label: 'Em 3 dias', date: '22.10.2026' },
      { label: 'Próxima semana', date: '26.10.2026' },
    ])
  })

  it('crosses the year end', () => {
    expect(rescheduleTargets(new Date(2026, 11, 31))).toEqual([
      { label: 'Amanhã', date: '01.01.2027' },
      { label: 'Em 3 dias', date: '03.01.2027' },
      { label: 'Próxima semana', date: '04.01.2027' },
    ])
  })
})

describe('planReschedule', () => {
  it('changes only the date field of a new-format line, and the rest of the file stays the same', () => {
    const out = planReschedule(SOURCE, 2, '20.10.2026')
    const before = SOURCE.split('\n')

    expect(out.split('\n')).toEqual([
      ...before.slice(0, 1),
      '- [ ] 20.10.2026 | 09:00 | Estudo | Revisar plano ^t9z8y7x',
      ...before.slice(2),
    ])
  })

  it('adds the date to a line without one, in front of the time, list and task', () => {
    expect(planReschedule(SOURCE, 3, '20.10.2026').split('\n')[2]).toBe('- [ ] 20.10.2026 | Estudo | Ler capítulo 3 ^t1a2b3c')
    expect(planReschedule(SOURCE, 4, '20.10.2026').split('\n')[3]).toBe('- [ ] 20.10.2026 | 09:00 | Estudo | Ler artigo ^t3c4d5e')
  })

  it('keeps CRLF line endings', () => {
    const crlf = SOURCE.replace(/\n/g, '\r\n')
    const out = planReschedule(crlf, 3, '20.10.2026')

    expect(out).toBe(crlf.replace('- [ ] Estudo | Ler capítulo 3', '- [ ] 20.10.2026 | Estudo | Ler capítulo 3'))
  })

  it('refuses a legacy line, with the message that asks for the rewrite', () => {
    for (const text of [LEGACY_BOLD, LEGACY_EMOJI, LEGACY_PLAIN]) {
      expect(() => planReschedule(text, 2, '20.10.2026')).toThrow('Reescreva esta tarefa no novo formato antes de reagendar')
    }
  })

  it('refuses the Archive, a task that is not open, a date that does not exist and a line with no task', () => {
    expect(() => planReschedule(SOURCE, 11, '20.10.2026')).toThrow('As tarefas do Archive não podem ser reagendadas pelo quadro.')
    expect(() => planReschedule(SOURCE, 8, '20.10.2026')).toThrow('Só tarefas abertas podem ser reagendadas.')
    expect(() => planReschedule(SOURCE, 2, '31.02.2026')).toThrow('Data inválida')
    expect(() => planReschedule(SOURCE, 5, '20.10.2026')).toThrow('Não encontrei essa tarefa')
  })
})

describe('reschedule in createTaskWriter', () => {
  let vault: string
  let file: string

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), 'ao-tasks-reschedule-'))
    file = join(vault, 'tarefas.md')
    writeFileSync(file, SOURCE, 'utf8')
  })

  afterEach(() => rmSync(vault, { recursive: true, force: true }))

  it('writes the new date atomically, backs up the file once and reads the new date back', () => {
    const writer = createTaskWriter({ now: () => new Date(2026, 9, 16, 9, 5, 7) })
    writer.remember(vault, readFileSync(file, 'utf8'))

    writer.reschedule(vault, 3, '20.10.2026')

    expect(existsSync(join(vault, 'tarefas.md.tmp'))).toBe(false)
    expect(readFileSync(file, 'utf8')).toBe(planReschedule(SOURCE, 3, '20.10.2026'))
    expect(parseTasksFile(readFileSync(file, 'utf8')).lists[0]!.tasks[1]).toMatchObject({ id: 't1a2b3c', date: '20.10.2026' })

    const folder = join(vault, 'backups', 'tarefas')
    expect(readdirSync(folder)).toEqual(['tarefas-2026-10-16-090507.md'])
    expect(readFileSync(join(folder, 'tarefas-2026-10-16-090507.md'), 'utf8')).toBe(SOURCE)

    writer.remember(vault, readFileSync(file, 'utf8'))
    writer.reschedule(vault, 2, '21.10.2026')
    expect(readdirSync(folder)).toHaveLength(1)
  })

  it('cancels when the file changed after the board read it, and writes nothing', () => {
    const writer = createTaskWriter()
    writer.remember(vault, readFileSync(file, 'utf8'))
    const changed = SOURCE.replace('Lavar roupa', 'Lavar louça')
    writeFileSync(file, changed, 'utf8')

    expect(() => writer.reschedule(vault, 2, '20.10.2026')).toThrow('mudou desde que você abriu o quadro')
    expect(readFileSync(file, 'utf8')).toBe(changed)
    expect(existsSync(join(vault, 'backups'))).toBe(false)
  })

  it('refuses a legacy line and writes nothing', () => {
    writeFileSync(file, LEGACY_BOLD, 'utf8')
    const writer = createTaskWriter()
    writer.remember(vault, LEGACY_BOLD)

    expect(() => writer.reschedule(vault, 2, '20.10.2026')).toThrow('Reescreva esta tarefa no novo formato antes de reagendar')
    expect(readFileSync(file, 'utf8')).toBe(LEGACY_BOLD)
    expect(existsSync(join(vault, 'backups'))).toBe(false)
  })
})

describe('taskDue', () => {
  const now = new Date(2026, 9, 30, 15, 0)
  it('says how near the deadline is, with the day as DD/MM', () => {
    expect(taskDue({ date: '22.10.2026' }, now)).toEqual({ kind: 'late', day: '22/10' })
    expect(taskDue({ date: '30.10.2026' }, now)).toEqual({ kind: 'today', day: '30/10' })
    expect(taskDue({ date: '31.10.2026' }, now)).toEqual({ kind: 'soon', day: '31/10' })
    expect(taskDue({ dueDate: '2026-11-02' }, now)).toEqual({ kind: 'later', day: '02/11' })
    expect(taskDue({}, now)).toEqual({ kind: 'none', day: '' })
    expect(taskDue({ date: '31.02.2026' }, now)).toEqual({ kind: 'none', day: '' })
  })
})
