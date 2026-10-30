import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseTasksFile } from '../src/shared/tasks'
import { createAgendaWriter } from '../src/main/agenda-write'
import { createTaskWriter } from '../src/main/tasks-write'
import { LUNA_CONFIRM_TOOLS, lunaToolDefs, type LunaToolDeps } from '../src/main/luna-tools'

const TASKS = ['## Casa', '- [ ] Lavar louça ^tabc123', '- [ ] 05.11.2026 | Casa | Pagar conta ^tpag001', ''].join('\n')
const AGENDA = ['# Agenda', '', '## 2026-10-30', '- 09:00 Dentista', ''].join('\n')

let vault: string
let deps: LunaToolDeps

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), 'ao-luna-tools-'))
  writeFileSync(join(vault, 'tarefas.md'), TASKS)
  writeFileSync(join(vault, 'agenda.md'), AGENDA)
  const writer = createTaskWriter({ now: () => new Date(2026, 9, 30, 10) })
  deps = {
    vault: () => vault,
    readTasks: (path) => {
      const text = readFileSync(join(path, 'tarefas.md'), 'utf8')
      writer.remember(path, text)
      return parseTasksFile(text)
    },
    createTask: (path, draft) => writer.create(path, draft),
    moveTask: (path, line, list) => writer.move(path, line, list),
    rescheduleTask: (path, line, date) => writer.reschedule(path, line, date),
    completeTask: vi.fn(() => 'tabc123'),
    discardTask: vi.fn(() => 'tabc123'),
    agenda: createAgendaWriter({ now: () => new Date(2026, 9, 30, 10) }),
    callAgent: vi.fn(async () => ({ name: 'Grace' })),
  }
})

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const def = lunaToolDefs(deps).find((t) => t.name === name)!
  const out = (await def.handler(args as never, {} as never)) as { content: { text: string }[]; isError?: boolean }
  return { text: out.content[0]!.text, isError: out.isError === true }
}

describe('ferramentas da Luna (#101)', () => {
  it('lê as tarefas com linha e id, sem escrever nada', async () => {
    const { text, isError } = await call('tasks_list')
    expect(isError).toBe(false)
    expect(text).toContain('## Casa')
    expect(text).toContain('linha 2 · tabc123')
    expect(readFileSync(join(vault, 'tarefas.md'), 'utf8')).toBe(TASKS)
  })

  it('cria a tarefa direto num pedido claro', async () => {
    const { text, isError } = await call('task_create', { title: 'Comprar pão', list: 'Casa' })
    expect(isError).toBe(false)
    expect(text).toMatch(/Tarefa criada em Casa/)
    expect(readFileSync(join(vault, 'tarefas.md'), 'utf8')).toContain('Comprar pão')
  })

  it('reagenda pela linha da última leitura', async () => {
    await call('tasks_list')
    expect((await call('task_reschedule', { line: 3, date: '07.11.2026' })).isError).toBe(false)
    expect(readFileSync(join(vault, 'tarefas.md'), 'utf8')).toContain('07.11.2026')
  })

  it('concluir e descartar passam pelas mesmas rotinas do quadro', async () => {
    expect((await call('task_complete', { target: 'tabc123' })).text).toContain('concluída')
    expect(deps.completeTask).toHaveBeenCalledWith('tabc123')
    await call('task_discard', { target: 2, reason: 'Não faz mais sentido' })
    expect(deps.discardTask).toHaveBeenCalledWith(2, 'Não faz mais sentido')
  })

  it('agenda: lista, adiciona e remove compromissos', async () => {
    expect((await call('agenda_list', { from: '2026-10-30' })).text).toContain('2026-10-30 09:00 · Dentista')
    expect((await call('agenda_add', { day: '2026-10-30', time: '15:00', title: 'Academia' })).isError).toBe(false)
    expect(readFileSync(join(vault, 'agenda.md'), 'utf8')).toContain('- 15:00 Academia')
    expect((await call('agenda_remove', { day: '2026-10-30', time: '09:00', title: 'Dentista' })).isError).toBe(false)
    expect(readFileSync(join(vault, 'agenda.md'), 'utf8')).not.toContain('Dentista')
  })

  it('chama um agente para a Casa', async () => {
    expect((await call('agent_call', { task: 'Revisar o orçamento' })).text).toBe('Grace está a caminho com a tarefa.')
    expect(deps.callAgent).toHaveBeenCalledWith({ task: 'Revisar o orçamento' })
  })

  it('falha vira mensagem para a Luna, sem gravar', async () => {
    deps.vault = () => {
      throw new Error('Configure a pasta do vault em Ajustes → Tarefas do Obsidian.')
    }
    const out = await call('task_create', { title: 'X', list: 'Casa' })
    expect(out).toEqual({ isError: true, text: 'Configure a pasta do vault em Ajustes → Tarefas do Obsidian.' })
  })

  it('só descartar e remover compromisso pedem o cartão de confirmação', () => {
    const names = lunaToolDefs(deps).map((t) => `mcp__casa__${t.name}`)
    expect(names.filter((n) => LUNA_CONFIRM_TOOLS.has(n)).sort()).toEqual(['mcp__casa__agenda_remove', 'mcp__casa__task_discard'])
  })
})
