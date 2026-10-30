// Luna's own tools (#101): the personal records of the house, through the same writers the
// Tarefas board uses. Clear requests run straight away; discarding a task and removing a
// commitment go through the office's permission card, which shows the exact input.

import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { ParsedBoard } from '@shared/tasks'
import { allCommitments, planAddCommitment, planRemoveCommitment } from './agenda-write'

export const LUNA_SERVER = 'casa'
/** Tools the user confirms on the permission card before they run: they take something away. */
export const LUNA_CONFIRM_TOOLS = new Set([`mcp__${LUNA_SERVER}__task_discard`, `mcp__${LUNA_SERVER}__agenda_remove`])

export interface LunaToolDeps {
  /** The configured vault; throws a pt-BR message when there is none. */
  vault(): string
  /** Reads tarefas.md and remembers it, so the next write checks against this read. */
  readTasks(vault: string): Pick<ParsedBoard, 'lists'>
  createTask(vault: string, draft: { title: string; list: string; date?: string; time?: string }): string
  moveTask(vault: string, line: number, list: string): void
  rescheduleTask(vault: string, line: number, date: string): void
  /** Completes like the board does (archive, focus, linked routine). Returns the task id. */
  completeTask(target: number | string): string
  discardTask(target: number | string, reason: string): string
  agenda: {
    read(vault: string): string | null
    current(vault: string): string
    write(vault: string, before: string, after: string): void
  }
  /** Calls an agent to the house for a task; it stays around after it until the user sends it away. */
  callAgent(req: { task: string; cwd?: string; name?: string }): Promise<{ name: string }>
}

const target = z.union([z.number().int().min(1), z.string().regex(/^t[a-z0-9]{6}$/i)])
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)

function boardText(board: Pick<ParsedBoard, 'lists'>): string {
  const lines = board.lists.flatMap((list) => [
    `## ${list.name}`,
    ...list.tasks.map((t) => {
      const when = [t.date ?? t.dueDate, t.time].filter(Boolean).join(' ')
      return `- linha ${t.line}${t.id ? ` · ${t.id}` : ''} · ${t.status}${when ? ` · ${when}` : ''} · ${t.text}`
    }),
  ])
  return lines.length ? lines.join('\n') : 'tarefas.md não tem listas.'
}

export function lunaTools(deps: LunaToolDeps): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: LUNA_SERVER,
    version: '1.0.0',
    instructions:
      'Registros pessoais da casa, no vault da usuária: tarefas (tarefas.md) e agenda (agenda.md). ' +
      'Leia com tasks_list antes de mudar uma tarefa: as linhas valem para essa leitura. ' +
      'Objetivos (objetivos.md), rotinas e mídias ficam no mesmo vault: leia os arquivos com Read.',
    tools: lunaToolDefs(deps),
  })
}

/** The tool definitions, apart from the server so tests can call each handler. */
export function lunaToolDefs(deps: LunaToolDeps) {
  const run = (fn: () => string | Promise<string>) => async () => {
    try {
      return { content: [{ type: 'text' as const, text: await fn() }] }
    } catch (err) {
      return { content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }], isError: true }
    }
  }
  const agendaChange = (plan: (text: string) => string): string => {
    const vault = deps.vault()
    deps.agenda.read(vault)
    const before = deps.agenda.current(vault)
    deps.agenda.write(vault, before, plan(before))
    return vault
  }

  return [
    tool(
      'tasks_list',
      'Lista as tarefas de tarefas.md por lista, com linha, id, estado e data.',
      {},
      () => run(() => boardText(deps.readTasks(deps.vault())))(),
      { annotations: { readOnlyHint: true } },
    ),
    tool(
      'task_create',
      'Cria uma tarefa numa lista existente de tarefas.md.',
      {
        title: z.string().min(1).max(300),
        list: z.string().min(1).max(200).describe('Nome de uma lista que já existe (veja tasks_list)'),
        date: z.string().max(10).optional().describe('DD.MM.AAAA'),
        time: time.optional(),
      },
      (args) =>
        run(() => {
          const vault = deps.vault()
          deps.readTasks(vault)
          const id = deps.createTask(vault, args)
          return `Tarefa criada em ${args.list} (${id}).`
        })(),
    ),
    tool(
      'task_move',
      'Move a tarefa da linha indicada (da última tasks_list) para outra lista.',
      { line: z.number().int().min(1), list: z.string().min(1).max(200) },
      (args) =>
        run(() => {
          deps.moveTask(deps.vault(), args.line, args.list)
          return `Tarefa da linha ${args.line} movida para ${args.list}.`
        })(),
    ),
    tool(
      'task_reschedule',
      'Muda a data da tarefa da linha indicada (da última tasks_list).',
      { line: z.number().int().min(1), date: z.string().min(5).max(10).describe('DD.MM.AAAA') },
      (args) =>
        run(() => {
          deps.rescheduleTask(deps.vault(), args.line, args.date)
          return `Tarefa da linha ${args.line} agora é para ${args.date}.`
        })(),
    ),
    tool('task_complete', 'Conclui uma tarefa (linha da última tasks_list ou id). Só quando a usuária pedir.', { target }, (args) =>
      run(() => `Tarefa ${deps.completeTask(args.target)} concluída e arquivada.`)(),
    ),
    tool(
      'task_discard',
      'Descarta uma tarefa com o motivo. A usuária confirma no cartão antes de valer.',
      { target, reason: z.string().min(1).max(1000) },
      (args) => run(() => `Tarefa ${deps.discardTask(args.target, args.reason)} descartada.`)(),
      { annotations: { destructiveHint: true } },
    ),
    tool(
      'agenda_list',
      'Lista os compromissos de agenda.md, opcionalmente de um intervalo de dias.',
      { from: day.optional(), to: day.optional() },
      (args) =>
        run(() => {
          const text = deps.agenda.read(deps.vault())
          if (text === null) return 'O vault não tem agenda.md.'
          const items = allCommitments(text).filter((c) => (!args.from || c.day >= args.from) && (!args.to || c.day <= args.to))
          return items.length ? items.map((c) => `- ${c.day} ${c.time} · ${c.title}`).join('\n') : 'Nenhum compromisso nesse período.'
        })(),
      { annotations: { readOnlyHint: true } },
    ),
    tool(
      'agenda_add',
      'Adiciona um compromisso num dia que já existe em agenda.md.',
      { day, time, title: z.string().min(1).max(300) },
      (args) =>
        run(() => {
          agendaChange((text) => planAddCommitment(text, args))
          return `Compromisso “${args.title}” marcado em ${args.day} às ${args.time}.`
        })(),
    ),
    tool(
      'agenda_remove',
      'Tira um compromisso de agenda.md. A usuária confirma no cartão antes de valer.',
      { day, time, title: z.string().min(1).max(300) },
      (args) =>
        run(() => {
          agendaChange((text) => planRemoveCommitment(text, args))
          return `Compromisso “${args.title}” de ${args.day} às ${args.time} removido.`
        })(),
      { annotations: { destructiveHint: true } },
    ),
    tool(
      'agent_call',
      'Chama um agente para uma tarefa. Ele vem à Casa, trabalha e fica por perto depois, até a usuária dispensar.',
      {
        task: z.string().min(1).max(20_000).describe('O pedido completo, com o contexto que o agente precisa'),
        cwd: z.string().max(1000).optional().describe('Pasta de um projeto do escritório; padrão: o vault'),
        name: z.string().max(40).optional(),
      },
      (args) => run(async () => `${(await deps.callAgent(args)).name} está a caminho com a tarefa.`)(),
    ),
  ]
}
