import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dialog, ipcMain } from 'electron'
import { focusItems } from '@shared/planning'
import { parseTasksFile } from '@shared/tasks'
import { createTaskWriter, type TaskWriter } from '../tasks-write'
import { moveTaskSchema, newTaskSchema, parse, taskIdSchema, taskLineSchema, vaultPathSchema } from '../validate'
import type { IpcContext } from './context'

export function registerTasksIpc(ctx: IpcContext): void {
  const writer = createTaskWriter()
  const read = (vaultPath: unknown) => readTasksAt(writer, vaultPath)
  const requireVault = (): string => {
    const vaultPath = ctx.store.settings.vaultPath
    if (!vaultPath) throw new Error('Configure a pasta do vault em Ajustes → Tarefas do Obsidian.')
    return checkedVault(vaultPath)
  }
  // Reads the file without remembering it: the board's line numbers come from its own read.
  const focusOf = (path: string) => focusItems(parseTasksFile(readTasksFile(path)).lists, ctx.planning.focus())

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

  ipcMain.handle('office:readFocus', async () => focusOf(requireVault()))

  ipcMain.handle('office:focusTask', async (_e, line: unknown) => {
    const input = parse(taskLineSchema, line, 'Tarefa inválida.')
    const path = requireVault()
    // The id is written into tarefas.md first: a refused write leaves the focus set as it was.
    ctx.planning.add(writer.assignId(path, input))
    const board = read(path)
    return { board, focus: focusItems(board.lists, ctx.planning.focus()) }
  })

  ipcMain.handle('office:unfocusTask', async (_e, id: unknown) => {
    const input = parse(taskIdSchema, id, 'Identificador inválido.')
    const path = requireVault()
    ctx.planning.remove(input)
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
