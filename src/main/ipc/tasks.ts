import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dialog, ipcMain } from 'electron'
import { buildAgendaView } from '@shared/agenda'
import { focusItems, focusKey } from '@shared/planning'
import { parseTasksFile, type TaskList, type TaskRef } from '@shared/tasks'
import type { Proposal } from '@shared/proposals'
import { createAgendaWriter } from '../agenda-write'
import { dayKey } from '../backups'
import { applyProposal } from '../proposals'
import { registerIrisIpc } from './iris'
import { registerReviewIpc } from './review'
import { createTaskWriter, type TaskWriter } from '../tasks-write'
import { createCompletionUndo } from '../tasks-undo'
import {
  completeTaskSchema,
  discardTaskSchema,
  idSchema,
  moveTaskSchema,
  newTaskSchema,
  parse,
  parseStepText,
  reopenTaskSchema,
  rescheduleTaskSchema,
  taskIdSchema,
  taskLineSchema,
  vaultPathSchema,
} from '../validate'
import type { IpcContext } from './context'

export function registerTasksIpc(ctx: IpcContext): void {
  const writer = createTaskWriter()
  // Shared with the proposals below: one read of tarefas.md is what the next confirmation checks against.
  const agenda = createAgendaWriter()
  const undo = createCompletionUndo()
  const read = (vaultPath: unknown) => readTasksAt(writer, vaultPath)
  const requireVault = (): string => {
    const vaultPath = ctx.store.settings.vaultPath
    if (!vaultPath) throw new Error('Configure a pasta do vault em Ajustes → Tarefas do Obsidian.')
    return checkedVault(vaultPath)
  }
  // Reads the file without remembering it: the board's line numbers come from its own read.
  const focusView = (lists: TaskList[]) => focusItems(lists, ctx.planning.focus(), ctx.planning.todaySteps(dayKey()))
  // The popup can discard or complete without the board open, so what it reads is what the writer checks against.
  const focusOf = (path: string) => {
    const content = readTasksFile(path)
    writer.remember(path, content)
    return focusView(parseTasksFile(content).lists)
  }

  registerReviewIpc(ctx, { tasks: writer, agenda, vault: requireVault })
  registerIrisIpc(ctx, { tasks: writer, agenda, vault: requireVault })

  ipcMain.handle('office:readTasks', async () => {
    const vaultPath = ctx.store.settings.vaultPath
    if (!vaultPath) throw new Error('Configure a pasta do vault em Ajustes → Tarefas do Obsidian.')
    return read(vaultPath)
  })

  ipcMain.handle('office:selectTasksVault', async () => {
    const result = await dialog.showOpenDialog(ctx.win()!, {
      properties: ['openDirectory'],
      title: 'Escolha a pasta do vault do Obsidian',
      ...(ctx.store.settings.vaultPath ? { defaultPath: ctx.store.settings.vaultPath } : {}),
    })
    if (result.canceled || !result.filePaths[0]) return null

    const vaultPath = result.filePaths[0]
    const board = read(vaultPath)
    ctx.store.settings = { ...ctx.store.settings, vaultPath }
    ctx.broadcast({ type: 'settings', settings: ctx.store.settings })
    return { vaultPath, board }
  })

  ipcMain.handle('office:createTask', async (_e, draft: unknown) => {
    const vaultPath = ctx.store.settings.vaultPath
    if (!vaultPath) throw new Error('Configure a pasta do vault em Ajustes → Tarefas do Obsidian.')
    const input = parse(newTaskSchema, draft, 'Tarefa inválida.')
    const path = checkedVault(vaultPath)
    const id = writer.create(path, input)
    return { id, board: read(path) }
  })

  ipcMain.handle('office:moveTask', async (_e, move: unknown) => {
    const vaultPath = ctx.store.settings.vaultPath
    if (!vaultPath) throw new Error('Configure a pasta do vault em Ajustes → Tarefas do Obsidian.')
    const input = parse(moveTaskSchema, move, 'Movimento inválido.')
    const path = checkedVault(vaultPath)
    writer.move(path, input.line, input.list)
    return { board: read(path) }
  })

  ipcMain.handle('office:rescheduleTask', async (_e, change: unknown) => {
    const vaultPath = ctx.store.settings.vaultPath
    if (!vaultPath) throw new Error('Configure a pasta do vault em Ajustes → Tarefas do Obsidian.')
    const input = parse(rescheduleTaskSchema, change, 'Reagendamento inválido.')
    const path = checkedVault(vaultPath)
    writer.reschedule(path, input.line, input.date)
    return { board: read(path) }
  })

  // The task leaves the focus and goes to the Archive in tarefas.md; the undo window starts now (AO-05).
  ipcMain.handle('office:completeTask', async (_e, target: unknown) => {
    const input = parse(completeTaskSchema, target, 'Tarefa inválida.')
    const path = requireVault()
    const done = writer.complete(path, 'line' in input ? input.line : input.id)
    const wasFocused = ctx.planning.focus().includes(focusKey(done.id))
    ctx.planning.archive(done.id, { origin: done.origin, completedAt: done.completedAt, originalLine: done.originalLine })
    undo.remember({ ...done, vault: path, wasFocused })
    const board = read(path)
    return { id: done.id, board, focus: focusView(board.lists) }
  })

  ipcMain.handle('office:undoCompleteTask', async (_e, id: unknown) => {
    const taskId = parse(taskIdSchema, id, 'Identificador inválido.')
    const path = requireVault()
    const done = undo.peek(taskId, path)
    writer.undoComplete(path, done)
    undo.forget(taskId)
    ctx.planning.restore(done.id, done.wasFocused)
    const board = read(path)
    return { board, focus: focusView(board.lists) }
  })

  // The reason is required: an empty one is refused before anything is written. tarefas.md goes first,
  // then the origin is recorded; if that second step fails, the task is in the Archive with no origin,
  // and reopening it asks for a list.
  ipcMain.handle('office:discardTask', async (_e, raw: unknown) => {
    const input = parse(discardTaskSchema, raw, 'Descarte inválido.')
    const path = requireVault()
    const done = writer.discard(path, targetOf(input.target), input.reason)
    try {
      ctx.planning.archive(done.id, { origin: done.origin, completedAt: done.completedAt, originalLine: done.originalLine })
    } catch (err) {
      throw new Error('A tarefa foi descartada no tarefas.md, mas não consegui atualizar o planning.json. Abra o quadro Tarefas de novo.', {
        cause: err,
      })
    }
    const board = read(path)
    return { id: done.id, board, focus: focusView(board.lists) }
  })

  // tarefas.md is written first, then the record of the task is removed. If that second step fails, the
  // task is already back in its list and the record stays; it is replaced by the next completion or discard.
  ipcMain.handle('office:reopenTask', async (_e, raw: unknown) => {
    const input = parse(reopenTaskSchema, raw, 'Reabertura inválida.')
    const path = requireVault()
    const plan = writer.reopen(path, targetOf(input.target), { list: input.list, archived: (id) => ctx.planning.archivedOf(id) })
    if (plan.status === 'choose') return plan
    if (plan.id) {
      undo.forget(plan.id)
      if (ctx.planning.archivedOf(plan.id)) {
        try {
          ctx.planning.unarchive(plan.id)
        } catch (err) {
          throw new Error(
            'A tarefa voltou para a lista no tarefas.md, mas não consegui apagar o registro dela no planning.json. O registro fica lá e não atrapalha.',
            { cause: err },
          )
        }
      }
    }
    const board = read(path)
    return { status: 'done' as const, list: plan.list, board, focus: focusView(board.lists) }
  })

  ipcMain.handle('office:readFocus', async () => focusOf(requireVault()))

  // Read on every call, so an edit made in Obsidian shows on the next read. Nothing here writes agenda.md or tarefas.md (AO-11).
  ipcMain.handle('office:readAgenda', async () => {
    const path = requireVault()
    return buildAgendaView(
      readOptionalFile(path, 'agenda.md'),
      readOptionalFile(path, 'tarefas.md') ?? '',
      new Date(),
      readOptionalFile(path, 'aulas.md'),
    )
  })

  ipcMain.handle('office:focusTask', async (_e, line: unknown) => {
    const input = parse(taskLineSchema, line, 'Tarefa inválida.')
    const path = requireVault()
    // The id is written into tarefas.md first: a refused write leaves the focus set as it was.
    ctx.planning.add(writer.assignId(path, input))
    const board = read(path)
    return { board, focus: focusView(board.lists) }
  })

  ipcMain.handle('office:unfocusTask', async (_e, id: unknown) => {
    const input = parse(taskIdSchema, id, 'Identificador inválido.')
    const path = requireVault()
    ctx.planning.remove(input)
    return focusOf(path)
  })

  // The step goes to planning.json only: tarefas.md is read for the focus list, never written here.
  ipcMain.handle('office:saveStep', async (_e, id: unknown, text: unknown) => {
    const taskId = parse(taskIdSchema, id, 'Identificador inválido.')
    const step = parseStepText(text)
    const path = requireVault()
    ctx.planning.saveStep(taskId, step, dayKey())
    return focusOf(path)
  })

  ipcMain.handle('office:clearStep', async (_e, id: unknown) => {
    const taskId = parse(taskIdSchema, id, 'Identificador inválido.')
    const path = requireVault()
    ctx.planning.clearStep(taskId, dayKey())
    return focusOf(path)
  })

  // A proposal changes nothing until it is confirmed (AO-10). The page sends only the id: the operations
  // come from planning.json, so a page can never add one. The review reads both files, which the
  // confirmation then checks against.
  ipcMain.handle('office:openProposal', async (_e, id: unknown) => {
    const proposal = findProposal(ctx, id)
    const path = requireVault()
    const titles: Record<string, string> = {}
    for (const list of read(path).lists) for (const task of list.tasks) if (task.id) titles[task.id.toLowerCase()] = task.text
    return { proposal, titles, agendaFound: agenda.read(path) !== null }
  })

  ipcMain.handle('office:applyProposal', async (_e, id: unknown) => {
    const proposal = findProposal(ctx, id)
    const path = requireVault()
    try {
      applyProposal(path, proposal, { tasks: writer, agenda, planning: ctx.planning })
    } finally {
      ctx.broadcast({ type: 'proposals', proposals: ctx.planning.pendingProposals() })
    }
  })

  // Refusing writes nothing in the files; it only takes the proposal off the pending list.
  ipcMain.handle('office:rejectProposal', async (_e, id: unknown) => {
    const proposalId = parse(idSchema, id, 'Proposta inválida.')
    ctx.planning.removeProposal(proposalId)
    ctx.broadcast({ type: 'proposals', proposals: ctx.planning.pendingProposals() })
  })
}

function findProposal(ctx: IpcContext, id: unknown): Proposal {
  const proposalId = parse(idSchema, id, 'Proposta inválida.')
  const proposal = ctx.planning.proposal(proposalId)
  if (!proposal) throw new Error('Essa proposta não existe mais.')
  return proposal
}

function targetOf(ref: TaskRef): number | string {
  return 'line' in ref ? ref.line : ref.id
}

function checkedVault(rawPath: unknown): string {
  const path = parse(vaultPathSchema, rawPath, 'O caminho do vault precisa ser uma pasta absoluta.')
  if (!path) throw new Error('Escolha a pasta que contém tarefas.md.')
  try {
    if (!statSync(path).isDirectory()) throw new Error('O caminho do vault precisa ser uma pasta.')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`A pasta do vault não existe: ${path}`, { cause: err })
    throw err
  }
  return path
}

function readTasksFile(path: string): string {
  try {
    return readFileSync(join(path, 'tarefas.md'), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`tarefas.md não encontrado em ${path}`, { cause: err })
    }
    throw err
  }
}

/** The text of a file in the vault, or null when the file is not there. */
function readOptionalFile(path: string, name: string): string | null {
  try {
    return readFileSync(join(path, name), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

function readTasksAt(writer: TaskWriter, rawPath: unknown) {
  const path = checkedVault(rawPath)
  const content = readTasksFile(path)
  writer.remember(path, content)
  const parsed = parseTasksFile(content)
  return { lists: parsed.lists, warnings: parsed.warnings }
}
