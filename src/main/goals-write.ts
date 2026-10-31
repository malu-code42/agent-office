import { randomInt } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseTasksFile } from '@shared/tasks'
import {
  GOALS_FILE,
  GOALS_FILES,
  appendGoal,
  goalProgress,
  linkGoalTask,
  markGoalAchieved,
  parseGoals,
  setGoalMilestone,
  type GoalDraft,
} from '@shared/goals'
import type { Task } from '@shared/tasks'
import { writeFileAtomic } from './fs-safe'
import { readTasks } from './tasks-write'

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const CHANGED =
  'O objetivos.md mudou desde que você abriu os objetivos, então nada foi escrito. Abra os objetivos de novo e tente outra vez.'
const NO_LONGER_COMPLETE =
  'O progresso do objetivo mudou durante a confirmação e não está mais em 100%. Nada foi escrito; confira objetivos.md e tarefas.md e tente novamente.'

export interface GoalWriterOptions {
  now?: () => Date
  newId?: () => string
  confirmAchieved?: (goalTitle: string) => Promise<boolean>
}

/** One writer per app session; this owns goals.md only and never writes tarefas.md. */
export function createGoalsWriter(opts: GoalWriterOptions = {}) {
  const lastRead = new Map<string, string | null>()
  const backedUp = new Set<string>()
  const now = opts.now ?? (() => new Date())
  const newId = opts.newId ?? (() => `g${Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')}`)
  /** The vault's own goals file: objetivos.md, else objetivos.txt; objetivos.md when neither exists. */
  const nameOf = (vault: string): string => GOALS_FILES.find((name) => existsSync(join(vault, name))) ?? GOALS_FILE
  const fileOf = (vault: string) => join(vault, nameOf(vault))
  const readFile = (vault: string): string | null => {
    try {
      return readFileSync(fileOf(vault), 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }
  const changed = (vault: string): string | null => {
    const before = lastRead.get(vault)
    if (before === undefined) throw new Error('Abra os objetivos de novo antes de alterar o objetivos.md.')
    if (readFile(vault) !== before) throw new Error(CHANGED)
    return before
  }
  const backup = (vault: string, text: string): void => {
    const dir = join(vault, 'backups', 'objetivos')
    mkdirSync(dir, { recursive: true })
    const d = now()
    const p = (n: number) => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
    let dest = join(dir, `objetivos-${stamp}.md`)
    for (let n = 2; existsSync(dest); n++) dest = join(dir, `objetivos-${stamp}-${n}.md`)
    writeFileAtomic(dest, text)
  }
  const save = (vault: string, before: string | null, after: string): void => {
    if (readFile(vault) !== before) throw new Error(CHANGED)
    if (!backedUp.has(vault)) {
      backup(vault, before ?? '')
      backedUp.add(vault)
    }
    writeFileAtomic(fileOf(vault), after)
    lastRead.set(vault, after)
  }

  return {
    read(vault: string) {
      const text = readFile(vault)
      lastRead.set(vault, text)
      const document = parseGoals(text ?? '')
      return { text, goals: document.goals }
    },
    create(vault: string, draft: Omit<GoalDraft, 'id'>): string {
      const before = changed(vault)
      const id = newId()
      const after = appendGoal(before ?? '', { ...draft, id }, nameOf(vault).endsWith('.txt') || undefined)
      save(vault, before, after)
      return id
    },
    setMilestone(vault: string, id: string, index: number, done: boolean): void {
      const before = changed(vault)
      if (before === null) throw new Error('Crie um objetivo antes de atualizar marcos.')
      const after = setGoalMilestone(before, id, index, done)
      if (after !== before) save(vault, before, after)
    },
    linkTask(vault: string, id: string, taskId: string, tasks: readonly Task[]): void {
      const before = changed(vault)
      if (before === null) throw new Error('Crie um objetivo antes de vincular tarefas.')
      if (!tasks.some((task) => task.id?.toLowerCase() === taskId.toLowerCase()))
        throw new Error('Não encontrei essa tarefa canônica no tarefas.md.')
      const after = linkGoalTask(before, id, taskId)
      if (after !== before) save(vault, before, after)
    },
    async achieve(vault: string, id: string, tasks: readonly Task[]): Promise<boolean> {
      const before = changed(vault)
      if (before === null) throw new Error('Crie um objetivo antes de marcá-lo como alcançado.')
      const goal = parseGoals(before).goals.find((item) => item.id === id)
      if (!goal) throw new Error('Não encontrei esse objetivo no arquivo objetivos.md.')
      if (goal.achieved) return true
      const completed = new Set(tasks.filter((task) => task.status === 'completed' && task.id).map((task) => task.id!.toLowerCase()))
      if (!goal.simple && goalProgress(goal, completed).percent !== 100)
        throw new Error('O objetivo só pode ser marcado como alcançado quando o progresso chegar a 100%.')
      if (!(await opts.confirmAchieved?.(goal.title))) return false
      const currentGoals = readFile(vault)
      if (currentGoals !== before) throw new Error(CHANGED)
      const currentTasks = parseTasksFile(readTasks(vault)).lists.flatMap((list) => list.tasks)
      const currentlyCompleted = new Set(
        currentTasks.filter((task) => task.status === 'completed' && task.id).map((task) => task.id!.toLowerCase()),
      )
      const currentGoal = parseGoals(currentGoals ?? '').goals.find((item) => item.id === id)
      if (!currentGoal || (!currentGoal.simple && goalProgress(currentGoal, currentlyCompleted).percent !== 100))
        throw new Error(NO_LONGER_COMPLETE)
      const after = markGoalAchieved(before, id)
      save(vault, before, after)
      return true
    },
  }
}

export type GoalsWriter = ReturnType<typeof createGoalsWriter>
