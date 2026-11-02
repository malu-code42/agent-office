import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseTasksFile } from '../src/shared/tasks'
import { createAgendaWriter } from '../src/main/agenda-write'
import { createTaskWriter } from '../src/main/tasks-write'
import { createGoalsWriter } from '../src/main/goals-write'
import { createMediaWriter } from '../src/main/media-write'
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
    focusTask: vi.fn(() => 'tpag001'),
    agenda: createAgendaWriter({ now: () => new Date(2026, 9, 30, 10) }),
    review: {
      focus: vi.fn(() => [
        { id: 'tabc123', title: 'Lavar louça', list: 'Casa', missing: false, stale: true },
        { id: 'tsumiu1', title: '', list: '', missing: true, stale: false },
      ]),
      done: vi.fn(),
      postpone: vi.fn(() => '2026-11-02'),
    },
    callAgent: vi.fn(async () => ({ name: 'Grace' })),
    goals: createGoalsWriter({ now: () => new Date(2026, 9, 30, 10), newId: () => 'gnovo0001' }),
    media: createMediaWriter({ now: () => new Date(2026, 9, 30, 10), newId: () => 'mnovo0001' }),
    routines: {
      overview: () => ({
        today: '2026-10-30',
        weekStart: '2026-10-25',
        weekEnd: '2026-10-31',
        rows: [
          {
            routineId: 'rcorre',
            line: 3,
            title: 'Correr',
            target: 2,
            cadence: 'semanal',
            confirmed: false,
            occurrenceIds: [],
            completed: 0,
          },
        ],
        candidates: [],
        pending: [],
      }),
      distribute: vi.fn(),
    },
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

  it('põe em foco sem mexer na data da tarefa', async () => {
    await call('tasks_list')
    expect((await call('focus_add', { target: 3 })).text).toBe('Tarefa tpag001 em foco.')
    expect(deps.focusTask).toHaveBeenCalledWith(3)
    expect(readFileSync(join(vault, 'tarefas.md'), 'utf8')).toBe(TASKS)
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

  it('revisão do dia: lê o foco com as paradas, conclui e adia sem cartão', async () => {
    const focus = await call('focus_list')
    expect(focus.text).toContain('- tabc123 · Casa · Lavar louça · parada')
    expect(focus.text).toContain('- tsumiu1 · não está mais em tarefas.md')
    expect((await call('review_done')).text).toBe('Revisão do dia registrada.')
    expect(deps.review.done).toHaveBeenCalledOnce()
    expect((await call('review_postpone', { days: 3 })).text).toBe('Revisão adiada; volta em 2026-11-02.')
    expect(deps.review.postpone).toHaveBeenCalledWith(3)
    expect(LUNA_CONFIRM_TOOLS.has('mcp__casa__review_done')).toBe(false)
    expect(LUNA_CONFIRM_TOOLS.has('mcp__casa__review_postpone')).toBe(false)
  })

  it('objetivos: cria, lista e marca um marco pelo writer da janela Objetivos (#112)', async () => {
    expect(
      (await call('goal_create', { title: 'Correr 5 km', target: '5 km', deadline: '2026-12-31', milestones: ['2 km', '3 km'] })).text,
    ).toBe('Objetivo “Correr 5 km” criado (gnovo0001).')
    expect((await call('goals_list')).text).toContain('- marco 2 [ ] 3 km')
    expect((await call('goal_milestone', { goal: 'gnovo0001', milestone: 2, done: true })).isError).toBe(false)
    expect(readFileSync(join(vault, 'objetivos.md'), 'utf8')).toContain('- Marco: [x] 3 km')
  })

  it('mídias e rotinas: adiciona um livro, lê a semana e distribui (#112)', async () => {
    expect((await call('media_add', { kind: 'livro', title: 'Duna' })).text).toBe('Livro “Duna” adicionado (mnovo0001).')
    expect((await call('media_list', { kind: 'livro' })).text).toBe('- mnovo0001 · planejado · Duna')
    expect((await call('routines_week')).text).toContain('- rcorre · Correr · 2x/semana · sem dias · a distribuir · feitas 0')
    expect((await call('routine_distribute', { routine: 'rcorre', days: [1, 4] })).text).toBe('Rotina rcorre distribuída: seg, qui.')
    expect(deps.routines.distribute).toHaveBeenCalledWith('rcorre', [1, 4])
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
