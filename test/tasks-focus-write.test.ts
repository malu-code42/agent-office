import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTaskWriter, planTaskId } from '../src/main/tasks-write'

/**
 * Giving an open task its id when it is put in focus: only its own line changes, a task that has an
 * id keeps it, and the write goes through the same check and backup as the other writes to tarefas.md.
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
  '- [ ] Lavar roupa',
  '',
  '## Archive',
  '- [-] Ler artigo antigo ❌ 2026-10-10 — descartada: não é mais relevante ^t7e8f9a',
  '',
].join('\n')

const ids = (...list: string[]) => {
  let i = 0
  return () => list[i++]!
}

describe('planTaskId', () => {
  it('gives an open task without an id one at the end of its line and changes nothing else', () => {
    const out = planTaskId(SOURCE, 10, ids('tfoco01'))

    expect(out.id).toBe('tfoco01')
    expect(out.text.split('\n')).toEqual(SOURCE.split('\n').map((line, i) => (i === 9 ? '- [ ] Lavar roupa ^tfoco01' : line)))
  })

  it('keeps the id a task already has, and the text comes back as it was', () => {
    const out = planTaskId(SOURCE, 6, () => {
      throw new Error('no id is needed: the task already has one')
    })

    expect(out).toEqual({ text: SOURCE, id: 't1a2b3c' })
  })

  it('keeps the line ending of a CRLF file', () => {
    const crlf = '## Casa\r\n- [ ] Lavar roupa\r\n'

    expect(planTaskId(crlf, 2, ids('tfoco01')).text).toBe('## Casa\r\n- [ ] Lavar roupa ^tfoco01\r\n')
  })

  it('appends the id to a legacy line without reformatting its text', () => {
    const legacy = '## Estudo\n- [ ] **06.10.2026** | Hera | criar relatório\n'

    expect(planTaskId(legacy, 2, ids('tfoco01')).text).toBe('## Estudo\n- [ ] **06.10.2026** | Hera | criar relatório ^tfoco01\n')
  })

  it('refuses the Archive and tasks that are not open', () => {
    expect(() => planTaskId(SOURCE, 13, ids('tfoco01'))).toThrow('As tarefas do Archive não podem ir para o foco.')
    expect(() => planTaskId(SOURCE, 7, ids('tfoco01'))).toThrow('Só tarefas abertas podem ir para o foco.')
  })

  it('refuses a line whose id is broken, instead of giving it a second id', () => {
    expect(() => planTaskId('## Casa\n- [ ] Lavar roupa ^tXY\n', 2, ids('tfoco01'))).toThrow('identificador repetido ou inválido')
  })

  it('refuses a line that is not a task', () => {
    expect(() => planTaskId(SOURCE, 5, ids('tfoco01'))).toThrow('Não encontrei essa tarefa no tarefas.md')
  })
})

describe('assignId in createTaskWriter', () => {
  let vault: string
  let file: string

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), 'ao-tasks-focus-'))
    file = join(vault, 'tarefas.md')
    writeFileSync(file, SOURCE, 'utf8')
  })

  afterEach(() => rmSync(vault, { recursive: true, force: true }))

  it('writes the id once, backs up once per session, and a task that has an id is not written again', () => {
    const at = () => new Date(2026, 9, 16, 9, 5, 7)
    const folder = join(vault, 'backups', 'tarefas')
    const writer = createTaskWriter({ now: at, newId: ids('tfoco01', 'tfoco02') })
    writer.remember(vault, readFileSync(file, 'utf8'))

    expect(writer.assignId(vault, 10)).toBe('tfoco01')
    const after = readFileSync(file, 'utf8')
    expect(after.split('\n')[9]).toBe('- [ ] Lavar roupa ^tfoco01')
    expect(readdirSync(folder)).toEqual(['tarefas-2026-10-16-090507.md'])
    expect(readFileSync(join(folder, 'tarefas-2026-10-16-090507.md'), 'utf8')).toBe(SOURCE)
    expect(existsSync(join(vault, 'tarefas.md.tmp'))).toBe(false)

    writer.remember(vault, after)
    expect(writer.assignId(vault, 10)).toBe('tfoco01')
    expect(readFileSync(file, 'utf8')).toBe(after)
    expect(readdirSync(folder)).toHaveLength(1)
  })

  it('cancels when the file changed after the board read it, and writes nothing', () => {
    const writer = createTaskWriter({ newId: ids('tfoco01') })
    writer.remember(vault, readFileSync(file, 'utf8'))
    const changed = SOURCE.replace('Lavar roupa', 'Lavar louça')
    writeFileSync(file, changed, 'utf8')

    expect(() => writer.assignId(vault, 10)).toThrow('mudou desde que você abriu o quadro')
    expect(readFileSync(file, 'utf8')).toBe(changed)
    expect(existsSync(join(vault, 'backups'))).toBe(false)
  })
})
