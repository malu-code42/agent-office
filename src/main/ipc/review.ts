import { ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AgendaWriter } from '../agenda-write'
import { dayKey } from '../backups'
import { focusItems } from '@shared/planning'
import { finishReview, hasDraftToday, markOffered, offerDue, openReview, postponeReview, type ReviewDeps } from '../review'
import type { TaskWriter } from '../tasks-write'
import { taskIdsIn } from '../tasks-write'
import type { ReviewPostpone } from '@shared/review'
import { personalRoutinesFile, personalRoutineCandidates, personalRoutineDefinition, personalRoutineOverview } from '../routines-personal'
import { localWeek, routineOccurrenceId, weeklyOccurrenceDates } from '@shared/routine-personal'
import type { PersonalRoutineStore } from '../personal-routines-store'
import { personalRoutineTaskFingerprint, personalRoutineTaskFingerprintFromTask } from '../personal-routine-fingerprint'
import { ARCHIVE_LIST, dayLabel, parseTasksFile, taskDraftProblem } from '@shared/tasks'
import {
  confirmPersonalRoutineDistributionSchema,
  createPersonalRoutineTaskSchema,
  parse,
  personalRoutineOccurrenceSchema,
} from '../validate'
import type { IpcContext } from './context'

/**
 * The daily review (AO-12). It happens in Luna's chat: the page only asks whether it is due, and Luna reads the
 * focus, finishes or postpones it through her tools, which call what this returns. Nothing here calls an AI.
 * `files` are the writers of tasks.ts, so the reads here are the ones the board checks against.
 */
export function registerReviewIpc(
  ctx: IpcContext,
  files: { tasks: TaskWriter; agenda: AgendaWriter; vault(): string },
  personalRoutines: PersonalRoutineStore,
) {
  const deps = (): ReviewDeps => ({ planning: ctx.planning, tasks: files.tasks, agenda: files.agenda, now: () => new Date() })
  const draftChanged = () => ctx.broadcast({ type: 'review:draft', draft: hasDraftToday(ctx.planning, new Date()) })
  // The offer is shown once per local day. Without a vault there is nothing to review, so no offer and no mark.
  ipcMain.handle('office:reviewGate', async () => {
    if (!ctx.store.settings.vaultPath) return false
    const today = dayKey()
    if (!offerDue(ctx.planning, today)) return false
    markOffered(ctx.planning, today)
    ctx.broadcast({ type: 'review:due', due: true })
    ctx.broadcast({ type: 'review:nextDay', nextDay: ctx.planning.reviewNextDay() })
    return true
  })

  // AO-47: definitions remain read-only in the vault; distribution/occurrence state stays in userData.
  ipcMain.handle('office:routineCandidates', async () => personalRoutineCandidates(files.vault(), dayKey()))
  ipcMain.handle('office:personalRoutineOverview', async () => {
    const path = files.vault()
    return personalRoutineOverview(path, dayKey(), personalRoutines)
  })
  // Shared by the routines panel and Luna's routine_distribute.
  const distribute = (rawId: unknown, rawDays: unknown) => {
    const [id, days] = parse(confirmPersonalRoutineDistributionSchema, [rawId, rawDays], 'Distribuição semanal inválida.')
    const path = files.vault()
    const routine = personalRoutineOverview(path, dayKey(), personalRoutines).rows.find((row) => row.routineId === id)
    if (!routine?.target || days.length !== routine.target)
      throw new Error(`Escolha exatamente ${routine?.target ?? 'a meta'} dias para esta semana.`)
    const today = dayKey()
    personalRoutines.confirmDistribution(`${localWeek(today).start}:${id}`, days)
    for (const date of weeklyOccurrenceDates(today, days)) personalRoutines.ensureOccurrence(routineOccurrenceId(id, date), id, date)
    return personalRoutineOverview(path, dayKey(), personalRoutines)
  }
  ipcMain.handle('office:confirmPersonalRoutineDistribution', async (_e, rawId: unknown, rawDays: unknown) => distribute(rawId, rawDays))
  const resumeOccurrence = (occurrenceId: string) => {
    const occurrence = personalRoutines.occurrence(occurrenceId)
    if (!occurrence?.taskId) throw new Error('Esta ocorrência ainda não tem tarefa para retomar.')
    const path = files.vault()
    const parsed = parseTasksFile(files.tasks.current(path))
    const task = parsed.lists
      .flatMap((list) => list.tasks.map((item) => ({ list: list.name, item })))
      .find(({ item }) => item.id === occurrence.taskId)
    if (!task) {
      personalRoutines.recoverMissingTask(occurrence.taskId)
      throw new Error('A tarefa vinculada não existe mais; a ocorrência foi liberada para uma nova tarefa.')
    }
    const archived = task.list === ARCHIVE_LIST ? ctx.planning.archivedOf(occurrence.taskId) : undefined
    const fingerprintList = archived?.origin ?? (task.list === ARCHIVE_LIST ? undefined : task.list)
    const actualFingerprint = fingerprintList ? personalRoutineTaskFingerprintFromTask(task.item, fingerprintList) : undefined
    const reservedMatch = occurrence.taskLinkState === 'reserved' && occurrence.taskFingerprint === actualFingerprint
    if (!actualFingerprint || (!reservedMatch && !personalRoutines.matchesTaskFingerprint(occurrence.taskId, actualFingerprint))) {
      personalRoutines.recoverMissingTask(occurrence.taskId)
      throw new Error('O conteúdo da tarefa vinculada mudou; a associação foi liberada e a ocorrência continua pendente.')
    }
    if (reservedMatch) personalRoutines.setTask(occurrence.id, occurrence.taskId, actualFingerprint)
    if (task.list === ARCHIVE_LIST || task.item.status !== 'open') {
      if (task.item.status === 'completed') personalRoutines.completeTask(occurrence.taskId, dayKey())
      else if (task.item.status === 'discarded') personalRoutines.discardTask(occurrence.taskId)
      throw new Error('A tarefa vinculada não está aberta no tarefas.md; a ocorrência continua pendente.')
    }
    ctx.planning.add(task.item.id!)
    const board = parseTasksFile(files.tasks.current(path))
    return { id: task.item.id!, board, focus: focusItems(board.lists, ctx.planning.focus(), ctx.planning.todaySteps(dayKey())) }
  }
  ipcMain.handle('office:resumePersonalRoutineOccurrence', async (_e, raw: unknown) => {
    const id = parse(personalRoutineOccurrenceSchema, raw, 'Ocorrência inválida.')
    return resumeOccurrence(id)
  })
  ipcMain.handle('office:createPersonalRoutineTask', async (_e, raw: unknown) => {
    const input = parse(createPersonalRoutineTaskSchema, raw, 'Tarefa de rotina inválida.')
    const path = files.vault()
    const [routineId, occurrenceDay] = input.occurrenceId.split(':')
    if (!routineId || !occurrenceDay) throw new Error('Ocorrência inválida.')
    const definition = personalRoutineDefinition(path, routineId)
    if (!definition) throw new Error('A definição desta rotina não existe mais na nota.')
    if (input.time !== definition.time) throw new Error('O horário informado não corresponde à definição atual da rotina.')
    const taskFields = {
      title: input.objective,
      list: input.list,
      date: dayLabel(new Date()),
      ...(definition.time ? { time: definition.time } : {}),
    }
    const taskFingerprint = personalRoutineTaskFingerprint(taskFields)
    const previousOccurrence = personalRoutines.occurrence(input.occurrenceId)
    const previousText = files.tasks.current(path)
    const previousTask = previousOccurrence?.taskId
      ? parseTasksFile(previousText)
          .lists.flatMap((list) => list.tasks.map((task) => ({ list: list.name, task })))
          .find(({ task }) => task.id === previousOccurrence.taskId)
      : undefined
    const previousArchive = previousOccurrence?.taskId ? ctx.planning.archivedOf(previousOccurrence.taskId) : undefined
    const previousFingerprintList = previousArchive?.origin ?? (previousTask?.list === ARCHIVE_LIST ? undefined : previousTask?.list)
    const previousFingerprint =
      previousTask && previousFingerprintList
        ? personalRoutineTaskFingerprintFromTask(previousTask.task, previousFingerprintList)
        : undefined
    const linkedTaskMismatch =
      !!previousOccurrence?.taskId &&
      !!previousTask &&
      (!previousFingerprint || !personalRoutines.matchesTaskFingerprint(previousOccurrence.taskId, previousFingerprint))
    const overview = personalRoutineOverview(path, dayKey(), personalRoutines)
    if (linkedTaskMismatch && previousOccurrence?.taskId) {
      personalRoutines.recoverMissingTask(previousOccurrence.taskId)
      throw new Error(
        'A tarefa com o ID reservado foi alterada e não corresponde mais à rotina. A associação foi liberada; confira e tente criar uma nova tarefa.',
      )
    }
    const allowed =
      overview.rows.some(
        (row) => row.confirmed && row.occurrenceIds.includes(input.occurrenceId) && input.occurrenceId.endsWith(`:${overview.today}`),
      ) || overview.pending.some((row) => row.occurrenceId === input.occurrenceId)
    if (!allowed) throw new Error('Esta ocorrência não está confirmada para inclusão no foco.')
    const currentText = files.tasks.current(path)
    const reservation = personalRoutines.reserve(input.occurrenceId, routineId, occurrenceDay, taskIdsIn(currentText), taskFingerprint)
    const draft = { ...taskFields, id: reservation.taskId }
    const current = parseTasksFile(currentText)
    const existing = current.lists
      .flatMap((list) => list.tasks.map((task) => ({ list: list.name, task })))
      .find(({ task }) => task.id === reservation.taskId)
    if (existing) {
      if (existing.list === ARCHIVE_LIST || existing.task.status !== 'open')
        throw new Error('A tarefa reservada já está concluída ou descartada; ela não será duplicada.')
      const existingFingerprint = personalRoutineTaskFingerprint({
        title: existing.task.text,
        list: existing.list,
        date: existing.task.date,
        time: existing.task.time,
      })
      if (reservation.taskFingerprint !== undefined && reservation.taskFingerprint !== existingFingerprint) {
        personalRoutines.recoverMissingTask(reservation.taskId!)
        throw new Error(
          'O conteúdo da tarefa aberta com esse ID não corresponde ao fingerprint reservado. A associação foi liberada; a tarefa não foi alterada.',
        )
      }
      if (existingFingerprint !== taskFingerprint)
        throw new Error('A tarefa já existe com outro rascunho. Ela foi preservada; reabra a ocorrência para iniciar uma tarefa nova.')
      personalRoutines.setTask(input.occurrenceId, reservation.taskId!, taskFingerprint)
      return resumeOccurrence(input.occurrenceId)
    }
    const problem = taskDraftProblem(
      draft,
      current.lists.map((list) => list.name),
    )
    if (problem) throw new Error(problem)
    const id = files.tasks.create(files.vault(), draft)
    personalRoutines.setTask(input.occurrenceId, id, taskFingerprint)
    return resumeOccurrence(input.occurrenceId)
  })
  ipcMain.handle('office:openPersonalRoutines', async () => {
    const name = personalRoutinesFile(files.vault())
    const path = join(files.vault(), name)
    if (!existsSync(path))
      throw new Error('Não encontrei rotinas-pessoais.md nem rotina_pessoal.txt no vault. Crie a nota e tente de novo.')
    const error = await shell.openPath(path)
    if (error) throw new Error(`Não consegui abrir ${name}: ${error}`)
  })

  return {
    routines: {
      overview: () => personalRoutineOverview(files.vault(), dayKey(), personalRoutines),
      distribute: (id: string, days: number[]) => void distribute(id, days),
    },
    focus: () => openReview(files.vault(), deps()).focus,
    done: () => {
      finishReview(ctx.planning, dayKey())
      ctx.broadcast({ type: 'review:due', due: false })
      draftChanged()
    },
    postpone: (option: ReviewPostpone) => {
      try {
        return postponeReview(ctx.planning, dayKey(), option)
      } finally {
        ctx.broadcast({ type: 'review:due', due: false })
        ctx.broadcast({ type: 'review:nextDay', nextDay: ctx.planning.reviewNextDay() })
      }
    },
  }
}
