import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dialog, ipcMain } from 'electron'
import { parseTasksFile } from '@shared/tasks'
import { createGoalsWriter } from '../goals-write'
import { createGoalSchema, goalIdArgsSchema, linkGoalTaskSchema, parse, setGoalMilestoneSchema, vaultPathSchema } from '../validate'
import type { IpcContext } from './context'

/** Goals live in objetivos.md; linked tasks are read from their canonical tarefas.md entries. */
export function registerGoalsIpc(ctx: IpcContext): void {
  const writer = createGoalsWriter({
    confirmAchieved: async (title) => {
      const win = ctx.win()
      if (!win) return false
      const result = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Marcar como alcançado', 'Agora não'],
        defaultId: 1,
        cancelId: 1,
        message: `O objetivo “${title}” chegou a 100%. Posso marcá-lo como alcançado?`,
        detail: 'Nada muda até você confirmar.',
      })
      return result.response === 0
    },
  })
  const vault = (): string => {
    const path = parse(vaultPathSchema, ctx.store.settings.vaultPath, 'Configure a pasta do vault em Ajustes → Tarefas do Obsidian.')
    try {
      if (!statSync(path).isDirectory()) throw new Error('O caminho do vault precisa ser uma pasta.')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`A pasta do vault não existe: ${path}`, { cause: err })
      throw err
    }
    return path
  }
  const tasksAt = (path: string) => {
    try {
      return parseTasksFile(readFileSync(join(path, 'tarefas.md'), 'utf8')).lists.flatMap((list) => list.tasks)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`tarefas.md não encontrado em ${path}`, { cause: err })
      throw err
    }
  }

  ipcMain.handle('office:readGoals', async () => {
    const path = vault()
    return { goals: writer.read(path).goals, tasks: tasksAt(path) }
  })

  ipcMain.handle('office:createGoal', async (_event, raw: unknown) => {
    const draft = parse(createGoalSchema, raw, 'Os dados do objetivo são inválidos.')
    const path = vault()
    const tasks = tasksAt(path)
    if (draft.taskIds.some((id) => !tasks.some((task) => task.id?.toLowerCase() === id.toLowerCase()))) {
      throw new Error('Uma das tarefas vinculadas não existe em tarefas.md.')
    }
    return writer.create(path, draft)
  })

  ipcMain.handle('office:setGoalMilestone', async (_event, ...raw: unknown[]) => {
    const [id, index, done] = parse(setGoalMilestoneSchema, raw, 'O marco do objetivo é inválido.')
    const path = vault()
    writer.setMilestone(path, id, index, done)
  })

  ipcMain.handle('office:linkGoalTask', async (_event, ...raw: unknown[]) => {
    const [id, taskId] = parse(linkGoalTaskSchema, raw, 'O vínculo do objetivo é inválido.')
    const path = vault()
    writer.linkTask(path, id, taskId, tasksAt(path))
  })

  ipcMain.handle('office:achieveGoal', async (_event, ...raw: unknown[]) => {
    const [id] = parse(goalIdArgsSchema, raw, 'O identificador do objetivo é inválido.')
    const path = vault()
    return writer.achieve(path, id, tasksAt(path))
  })
}
