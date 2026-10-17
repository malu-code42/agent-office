import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dialog, ipcMain } from 'electron'
import { parseTasksFile } from '@shared/tasks'
import { createTaskWriter, type TaskWriter } from '../tasks-write'
import { newTaskSchema, parse, vaultPathSchema } from '../validate'
import type { IpcContext } from './context'

export function registerTasksIpc(ctx: IpcContext): void {
  const writer = createTaskWriter()
  const read = (vaultPath: unknown) => readTasksAt(writer, vaultPath)

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

function readTasksAt(writer: TaskWriter, rawPath: unknown) {
  const path = checkedVault(rawPath)
  const tasksFile = join(path, 'tarefas.md')
  try {
    const content = readFileSync(tasksFile, 'utf8')
    writer.remember(path, content)
    const parsed = parseTasksFile(content)
    return { lists: parsed.lists, warnings: parsed.warnings }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`tarefas.md não encontrado em ${path}`, { cause: err })
    }
    throw err
  }
}
