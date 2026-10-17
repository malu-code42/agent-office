import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dialog, ipcMain } from 'electron'
import { focusItems, focusKey } from '@shared/planning'
import { parseTasksFile, type TaskList } from '@shared/tasks'
import { dayKey } from '../backups'
import { createTaskWriter, type TaskWriter } from '../tasks-write'
import { createCompletionUndo } from '../tasks-undo'
import {
  completeTaskSchema,
  moveTaskSchema,
  newTaskSchema,
  parse,
  parseStepText,
  parseTimerMinutes,
  rescheduleTaskSchema,
  taskIdSchema,
  taskLineSchema,
  vaultPathSchema,
} from '../validate'
import type { IpcContext } from './context'

export function registerTasksIpc(ctx: IpcContext): void {
  const writer = createTaskWriter()
  const undo = createCompletionUndo()
  const read = (vaultPath: unknown) => readTasksAt(writer, vaultPath)
  const requireVault = (): string => {
    const vaultPath = ctx.store.settings.vaultPath
    if (!vaultPath) throw new Error('Configure a pasta do vault em Ajustes → Tarefas do Obsidian.')
    return checkedVault(vaultPath)
  }
  // Reads the file without remembering it: the board's line numbers come from its own read.
  const focusView = (lists: TaskList[]) => focusItems(lists, ctx.planning.focus(), ctx.planning.todaySteps(dayKey()), ctx.planning.timers())
  const focusOf = (path: string) => focusView(parseTasksFile(readTasksFile(path)).lists)

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

  ipcMain.handle('office:readFocus', async () => focusOf(requireVault()))

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

  // The focus timer lives in planning.json too: tarefas.md is only read, as for the steps (AO-08).
  ipcMain.handle('office:startTimer', async (_e, id: unknown) => {
    const taskId = parse(taskIdSchema, id, 'Identificador inválido.')
    const path = requireVault()
    ctx.planning.startTimer(taskId)
    return focusOf(path)
  })

  ipcMain.handle('office:pauseTimer', async (_e, id: unknown) => {
    const taskId = parse(taskIdSchema, id, 'Identificador inválido.')
    const path = requireVault()
    ctx.planning.pauseTimer(taskId)
    return focusOf(path)
  })

  ipcMain.handle('office:resumeTimer', async (_e, id: unknown) => {
    const taskId = parse(taskIdSchema, id, 'Identificador inválido.')
    const path = requireVault()
    ctx.planning.resumeTimer(taskId)
    return focusOf(path)
  })

  ipcMain.handle('office:stopTimer', async (_e, id: unknown) => {
    const taskId = parse(taskIdSchema, id, 'Identificador inválido.')
    const path = requireVault()
    ctx.planning.stopTimer(taskId)
    return focusOf(path)
  })

  ipcMain.handle('office:confirmTimer', async (_e, id: unknown, minutes: unknown) => {
    const taskId = parse(taskIdSchema, id, 'Identificador inválido.')
    const count = parseTimerMinutes(minutes)
    const path = requireVault()
    ctx.planning.confirmTimer(taskId, count)
    return focusOf(path)
  })
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

function readTasksAt(writer: TaskWriter, rawPath: unknown) {
  const path = checkedVault(rawPath)
  const content = readTasksFile(path)
  writer.remember(path, content)
  const parsed = parseTasksFile(content)
  return { lists: parsed.lists, warnings: parsed.warnings }
}
