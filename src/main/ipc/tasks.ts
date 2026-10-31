import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dialog, ipcMain } from 'electron'
import { z } from 'zod'
import { buildAgendaView } from '@shared/agenda'
import { buildClassSchedule } from '@shared/class-schedule'
import { parseStudyTrail, STUDY_TRAIL_FILE } from '@shared/study-trail'
import { focusItems, focusKey } from '@shared/planning'
import { ARCHIVE_LIST, parseTasksFile, type TaskList, type TaskRef } from '@shared/tasks'
import type { Proposal } from '@shared/proposals'
import { createAgendaWriter, planAddCommitment, planRemoveCommitment } from '../agenda-write'
import { createGoalsWriter } from '../goals-write'
import { dayKey } from '../backups'
import { applyProposal } from '../proposals'
import { registerIrisIpc } from './iris'
import { registerReviewIpc } from './review'
import { createTaskWriter, type TaskWriter } from '../tasks-write'
import { createCompletionUndo } from '../tasks-undo'
import { PersonalRoutineStore } from '../personal-routines-store'
import { personalRoutineTaskFingerprintFromLine, personalRoutineTaskFingerprintFromTask } from '../personal-routine-fingerprint'
import { StudyQuestionService } from '../study-questions'
import { claudeStudyQuestionProviders } from '../study-questions-claude'
import { StudyCycleService } from '../study-cycle'
import { StudyCycleStore } from '../study-cycle-store'
import { claudeStudyTutor } from '../study-cycle-claude'
import { StudyLibrary, StudyNotesWriter } from '../study-library'
import { StudyCardsService } from '../study-cards'
import { claudeStudyCardInterpreter } from '../study-cards-claude'
import { MAIN_ACCOUNT } from '@shared/accounts'
import { activeStudyCycle, retestScore } from '@shared/study-cycle'
import {
  completeTaskSchema,
  discardTaskSchema,
  idSchema,
  moveTaskSchema,
  newTaskSchema,
  cleanHire,
  parse,
  parseStepText,
  reopenTaskSchema,
  rescheduleTaskSchema,
  taskIdSchema,
  taskLineSchema,
  vaultPathSchema,
  studyQuestionSearchArgsSchema,
  studyQuestionSaveArgsSchema,
  studyQuestionGenerateArgsSchema,
  startStudyCycleArgsSchema,
  answerStudyCycleArgsSchema,
  evaluateStudyAnswerArgsSchema,
  advanceStudyCycleArgsSchema,
  resetStudyCycleArgsSchema,
  resumeStudyCycleArgsSchema,
  searchStudyLibraryArgsSchema,
  studyLibrarySourceArgsSchema,
  studyCycleNoteArgsSchema,
  startStudyPracticeArgsSchema,
  answerStudyPracticeArgsSchema,
  reviewStudyGapArgsSchema,
  startStudyRetestArgsSchema,
  answerStudyRetestArgsSchema,
  verifyStudyRetestArgsSchema,
  completeStudyRetestArgsSchema,
  generateStudyCardDraftArgsSchema,
  saveStudyCardDraftArgsSchema,
  listStudyCardsArgsSchema,
  setStudyCardPhysicalArgsSchema,
} from '../validate'
import { lunaTools } from '../luna-tools'
import type { IpcContext } from './context'

export function registerTasksIpc(ctx: IpcContext): void {
  const writer = createTaskWriter()
  // Shared with the proposals below: one read of tarefas.md is what the next confirmation checks against.
  const agenda = createAgendaWriter()
  const undo = createCompletionUndo()
  const personalRoutines = new PersonalRoutineStore(ctx.store.dataDirectory)
  const studyServices = new Map<string, StudyQuestionService>()
  const studyLibraries = new Map<string, StudyLibrary>()
  const studyCards = new Map<string, StudyCardsService>()
  const studyCycleStore = new StudyCycleStore(ctx.store.dataDirectory)
  const read = (vaultPath: unknown) => readTasksAt(writer, vaultPath)
  const requireVault = (): string => {
    const vaultPath = ctx.store.settings.vaultPath
    if (!vaultPath) throw new Error('Configure a pasta do vault em Ajustes → Tarefas do Obsidian.')
    return checkedVault(vaultPath)
  }
  const studyService = (): StudyQuestionService => {
    const vault = requireVault()
    let service = studyServices.get(vault)
    if (!service) {
      service = new StudyQuestionService(vault, claudeStudyQuestionProviders())
      studyServices.set(vault, service)
    }
    return service
  }
  const studyCycleService = (): StudyCycleService => {
    const vault = requireVault()
    const evaluateTutor = (input: Parameters<ReturnType<typeof claudeStudyTutor>>[0]) => {
      const settings = ctx.store.settings
      const accountId = settings.defaultAccounts[0] ?? MAIN_ACCOUNT
      const account = settings.accounts.find((candidate) => candidate.id === accountId)
      if (!account) throw new Error('A conta definida para o Tutor não existe mais. Confira as contas nas configurações.')
      // Resolve route only at the explicit Tutor action; local read/start/answer remain usable offline.
      return claudeStudyTutor(settings, account)(input)
    }
    return new StudyCycleService(studyCycleStore, studyService(), evaluateTutor, Date.now, new StudyNotesWriter(vault))
  }
  const studyLibrary = (): StudyLibrary => {
    const vault = requireVault()
    let library = studyLibraries.get(vault)
    if (!library) {
      library = new StudyLibrary(vault)
      studyLibraries.set(vault, library)
    }
    return library
  }
  const studyCardsService = (): StudyCardsService => {
    const vault = requireVault()
    let service = studyCards.get(vault)
    if (!service) {
      service = new StudyCardsService(vault, {
        generate(notes) {
          const settings = ctx.store.settings
          const accountId = settings.defaultAccounts[0] ?? MAIN_ACCOUNT
          const account = settings.accounts.find((candidate) => candidate.id === accountId)
          if (!account) throw new Error('A conta Claude definida não existe mais. Confira as contas nas configurações.')
          return claudeStudyCardInterpreter(settings, account).generate(notes)
        },
      })
      studyCards.set(vault, service)
    }
    return service
  }
  // Reads the file without remembering it: the board's line numbers come from its own read.
  const focusView = (lists: TaskList[]) => focusItems(lists, ctx.planning.focus(), ctx.planning.todaySteps(dayKey()))
  // The popup can discard or complete without the board open, so what it reads is what the writer checks against.
  const focusOf = (path: string) => {
    const content = readTasksFile(path)
    writer.remember(path, content)
    return focusView(parseTasksFile(content).lists)
  }
  const taskAt = (path: string, target: number | string) => {
    const board = parseTasksFile(writer.current(path))
    for (const list of board.lists) {
      const task = list.tasks.find((item) => (typeof target === 'number' ? item.line === target : item.id === target))
      if (task) return { list: list.name, task }
    }
    return undefined
  }
  const routineTaskMatches = (id: string, task: { text: string; date?: string; time?: string }, list: string): boolean => {
    if (!personalRoutines.hasTaskLink(id)) return false
    const origin = list === ARCHIVE_LIST ? ctx.planning.archivedOf(id)?.origin : list
    return !!origin && personalRoutines.matchesTaskFingerprint(id, personalRoutineTaskFingerprintFromTask(task, origin))
  }

  // Luna's goal tools keep their own reads; the Objetivos window has its writer in goals.ts.
  const lunaGoals = createGoalsWriter()
  const review = registerReviewIpc(ctx, { tasks: writer, agenda, vault: requireVault }, personalRoutines)
  registerIrisIpc(ctx, { tasks: writer, agenda, vault: requireVault })

  ipcMain.handle('office:readStudyQuestions', async () => studyService().read())
  ipcMain.handle('office:searchStudyQuestions', async (_e, ...args: unknown[]) => {
    const [topic, limit] = parse(studyQuestionSearchArgsSchema, args, 'Busca de questões inválida.')
    return studyService().search(topic, limit)
  })
  ipcMain.handle('office:generateStudyQuestions', async (_e, ...args: unknown[]) => {
    const [token] = parse(studyQuestionGenerateArgsSchema, args, 'Geração de questões inválida.')
    return studyService().generate(token)
  })
  ipcMain.handle('office:saveStudyQuestions', async (_e, ...args: unknown[]) => {
    const [token, selection, reviewConfirmed] = parse(studyQuestionSaveArgsSchema, args, 'Seleção de questões inválida.')
    studyService().save(token, selection, reviewConfirmed)
  })
  ipcMain.handle('office:readStudyCycle', () => studyCycleStore.read())
  ipcMain.handle('office:startStudyCycle', (_e, ...args: unknown[]) => {
    const [topic, questionIds] = parse(startStudyCycleArgsSchema, args, 'Início do ciclo inválido.')
    return studyCycleService().start(topic, questionIds)
  })
  ipcMain.handle('office:answerStudyCycle', (_e, ...args: unknown[]) => {
    const [questionId, response, uncertain, providedExcerpt] = parse(answerStudyCycleArgsSchema, args, 'Resposta do diagnóstico inválida.')
    return studyCycleService().answer(questionId, response, uncertain, providedExcerpt)
  })
  ipcMain.handle('office:evaluateStudyAnswer', async (_e, ...args: unknown[]) => {
    const [questionId] = parse(evaluateStudyAnswerArgsSchema, args, 'Verificação do Tutor inválida.')
    return studyCycleService().evaluateAnswer(questionId)
  })
  ipcMain.handle('office:advanceStudyCycle', (_e, ...args: unknown[]) => {
    parse(advanceStudyCycleArgsSchema, args, 'Avanço do ciclo inválido.')
    return studyCycleService().advance()
  })
  ipcMain.handle('office:resetStudyCycle', (_e, ...args: unknown[]) => {
    parse(resetStudyCycleArgsSchema, args, 'Encerramento do ciclo inválido.')
    return studyCycleService().reset()
  })
  // Switching topics keeps every cycle; this pins a kept one again.
  ipcMain.handle('office:resumeStudyCycle', (_e, ...args: unknown[]) => {
    const [cycleId] = parse(resumeStudyCycleArgsSchema, args, 'Ciclo de estudo inválido.')
    return studyCycleService().resume(cycleId)
  })
  // Read on every call, like the agenda: the trail and the class grid are the user's files, never written here.
  ipcMain.handle('office:readStudyTrail', async () => parseStudyTrail(readOptionalFile(requireVault(), STUDY_TRAIL_FILE)))
  ipcMain.handle('office:readClassSchedule', async () => buildClassSchedule(readOptionalFile(requireVault(), 'aulas.md'), new Date()))
  ipcMain.handle('office:reviewStudyGap', (_e, ...args: unknown[]) => {
    const [questionId, cause, nextStep] = parse(reviewStudyGapArgsSchema, args, 'Revisão da lacuna inválida.')
    return studyCycleService().reviewGap(questionId, cause, nextStep)
  })
  ipcMain.handle('office:searchStudyLibrary', (_e, ...args: unknown[]) => {
    const [query] = parse(searchStudyLibraryArgsSchema, args, 'Busca local da Cora inválida.')
    return studyLibrary().search(query)
  })
  ipcMain.handle('office:attachStudySource', (_e, ...args: unknown[]) => {
    const [questionId, token, hitId] = parse(studyLibrarySourceArgsSchema, args, 'Vínculo de fonte inválido.')
    const hit = studyLibrary().source(token, hitId)
    return studyCycleService().attachSource(questionId, hit.sourceRef)
  })
  ipcMain.handle('office:saveStudyCycleNote', (_e, ...args: unknown[]) => {
    const [questionId, token, hitId, text] = parse(studyCycleNoteArgsSchema, args, 'Nota de estudo inválida.')
    const hit = studyLibrary().source(token, hitId)
    const current = studyCycleService()
    current.attachSource(questionId, hit.sourceRef)
    return current.saveNote(questionId, hit.sourceRef, text)
  })
  ipcMain.handle('office:startStudyPractice', (_e, ...args: unknown[]) => {
    const [questions] = parse(startStudyPracticeArgsSchema, args, 'Plano de prática inválido.')
    return studyCycleService().startPractice(questions)
  })
  ipcMain.handle('office:answerStudyPractice', (_e, ...args: unknown[]) => {
    const [questionId, response] = parse(answerStudyPracticeArgsSchema, args, 'Resposta de prática inválida.')
    return studyCycleService().answerPractice(questionId, response)
  })
  ipcMain.handle('office:evaluateStudyPractice', async (_e, ...args: unknown[]) => {
    const [questionId] = parse(evaluateStudyAnswerArgsSchema, args, 'Verificação da prática inválida.')
    return studyCycleService().evaluatePracticeAnswer(questionId)
  })
  ipcMain.handle('office:startStudyRetest', (_e, ...args: unknown[]) => {
    const [questionIds] = parse(startStudyRetestArgsSchema, args, 'Plano de reteste inválido.')
    return studyCycleService().startRetest(questionIds)
  })
  ipcMain.handle('office:answerStudyRetest', (_e, ...args: unknown[]) => {
    const [questionId, response] = parse(answerStudyRetestArgsSchema, args, 'Resposta de reteste inválida.')
    return studyCycleService().answerRetest(questionId, response)
  })
  ipcMain.handle('office:verifyStudyRetest', async (_e, ...args: unknown[]) => {
    parse(verifyStudyRetestArgsSchema, args, 'Conferência de reteste inválida.')
    return studyCycleService().verifyRetest()
  })
  ipcMain.handle('office:completeStudyRetest', async (_e, ...args: unknown[]) => {
    parse(completeStudyRetestArgsSchema, args, 'Confirmação do reteste inválida.')
    const cycle = activeStudyCycle(studyCycleStore.read())
    const score = cycle?.retests.at(-1) ? retestScore(cycle.retests.at(-1)!) : null
    if (cycle?.stage !== 'retest' || score === null || score < 80)
      throw new Error('O ciclo só pode ser concluído após um reteste verificado com pelo menos 80%.')
    const options = {
      type: 'question' as const,
      buttons: ['Concluir ciclo', 'Continuar estudando'],
      defaultId: 1,
      cancelId: 1,
      message: 'Concluir ciclo de estudo?',
      detail: `Você atingiu ${score}% no reteste. Confirma que quer concluir este ciclo?`,
    }
    const win = ctx.win()
    const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    if (response !== 0) return studyCycleStore.read()
    const latest = activeStudyCycle(studyCycleStore.read())
    const latestScore = latest?.retests.at(-1) ? retestScore(latest.retests.at(-1)!) : null
    if (latest?.id !== cycle.id || latestScore === null || latestScore < 80)
      throw new Error('O ciclo mudou durante a confirmação. Confira o reteste novamente.')
    return studyCycleService().completeRetest()
  })
  ipcMain.handle('office:readStudyNotes', () => studyCardsService().readNotes())
  ipcMain.handle('office:generateStudyCardDraft', async (_e, ...args: unknown[]) => {
    const [noteIds] = parse(generateStudyCardDraftArgsSchema, args, 'Seleção de notas para cartão inválida.')
    const cards = studyCardsService()
    const available = cards.readNotes().notes
    const selected = noteIds.map((id) => {
      const note = available.find((candidate) => candidate.id === id)
      if (!note) throw new Error('Uma nota selecionada mudou ou não existe mais. Recarregue a biblioteca.')
      return note
    })
    const settings = ctx.store.settings
    const accountId = settings.defaultAccounts[0] ?? MAIN_ACCOUNT
    const account = settings.accounts.find((candidate) => candidate.id === accountId)
    if (!account) throw new Error('A conta Claude definida não existe mais. Confira as contas nas configurações.')
    const options = {
      type: 'question' as const,
      buttons: ['Enviar notas selecionadas', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      message: 'Enviar estas notas selecionadas ao Claude para preparar um rascunho?',
      detail: `Serão enviados ${selected.length} snapshot(s): ${selected.map((note) => `${note.title} (${note.sourceRef})`).join('; ')}. Conta: ${account.name}. Modelo: ${settings.defaultModel || 'claude-haiku-5-5'}, esforço ${settings.defaultEffort || 'medium'}. Confirme que o ambiente dessa conta pode receber esse conteúdo. Nenhum cartão será salvo sem sua revisão posterior.`,
    }
    const win = ctx.win()
    const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    if (response !== 0) return null
    return cards.generateDraft(noteIds)
  })
  ipcMain.handle('office:saveStudyCardDraft', async (_e, ...args: unknown[]) => {
    const [token, draft] = parse(saveStudyCardDraftArgsSchema, args, 'Rascunho de cartão inválido.')
    const service = studyCardsService()
    const sources = service.draftSources(token)
    const options = {
      type: 'question' as const,
      buttons: ['Salvar cartão digital', 'Continuar revisando'],
      defaultId: 1,
      cancelId: 1,
      message: `Salvar o cartão “${draft.title}” no Obsidian?`,
      detail: `O cartão preservará ${sources.length} snapshot(s) de nota: ${sources.map((source) => source.title).join('; ')}. Essa aprovação não marca a cópia física como escrita e não altera o ciclo de estudo.`,
    }
    const win = ctx.win()
    const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    return response === 0 ? service.saveDraft(token, draft) : null
  })
  ipcMain.handle('office:listStudyCards', (_e, ...args: unknown[]) => {
    parse(listStudyCardsArgsSchema, args, 'Lista de cartões inválida.')
    return studyCardsService().listCards()
  })
  ipcMain.handle('office:setStudyCardPhysicalWritten', (_e, ...args: unknown[]) => {
    const [id, written] = parse(setStudyCardPhysicalArgsSchema, args, 'Estado da cópia física inválido.')
    return studyCardsService().setPhysicalWritten(id, written)
  })

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
  // Shared by the board and Luna's task_complete (#101): the same archive, focus and routine bookkeeping.
  const completeTask = (path: string, targetId: number | string) => {
    const before = taskAt(path, targetId)
    const linkedRoutineId = before?.task.id && personalRoutines.hasTaskLink(before.task.id) ? before.task.id : undefined
    const linkedRoutineMatches = !!linkedRoutineId && routineTaskMatches(linkedRoutineId, before!.task, before!.list)
    const done = writer.complete(path, targetId)
    const wasFocused = ctx.planning.focus().includes(focusKey(done.id))
    ctx.planning.archive(done.id, { origin: done.origin, completedAt: done.completedAt, originalLine: done.originalLine })
    if (linkedRoutineId === done.id) {
      if (linkedRoutineMatches) personalRoutines.completeTask(done.id, dayKey())
      else personalRoutines.recoverMissingTask(done.id)
    }
    undo.remember({ ...done, vault: path, wasFocused })
    return done.id
  }
  ipcMain.handle('office:completeTask', async (_e, target: unknown) => {
    const input = parse(completeTaskSchema, target, 'Tarefa inválida.')
    const path = requireVault()
    const id = completeTask(path, targetOf(input))
    const board = read(path)
    return { id, board, focus: focusView(board.lists) }
  })

  ipcMain.handle('office:undoCompleteTask', async (_e, id: unknown) => {
    const taskId = parse(taskIdSchema, id, 'Identificador inválido.')
    const path = requireVault()
    const done = undo.peek(taskId, path)
    const linkedRoutine = personalRoutines.hasTaskLink(taskId)
    const fingerprint = personalRoutineTaskFingerprintFromLine(done.originalLine, done.origin)
    const linkedRoutineMatches = linkedRoutine && !!fingerprint && personalRoutines.matchesTaskFingerprint(taskId, fingerprint)
    writer.undoComplete(path, done)
    undo.forget(taskId)
    if (linkedRoutine) {
      if (linkedRoutineMatches) personalRoutines.reopenTask(taskId)
      else personalRoutines.recoverMissingTask(taskId)
    }
    ctx.planning.restore(done.id, done.wasFocused)
    const board = read(path)
    return { board, focus: focusView(board.lists) }
  })

  // The reason is required: an empty one is refused before anything is written. tarefas.md goes first,
  // then the origin is recorded; if that second step fails, the task is in the Archive with no origin,
  // and reopening it asks for a list.
  const discardTask = (path: string, targetId: number | string, reason: string) => {
    const before = taskAt(path, targetId)
    const linkedRoutineId = before?.task.id && personalRoutines.hasTaskLink(before.task.id) ? before.task.id : undefined
    const linkedRoutineMatches = !!linkedRoutineId && routineTaskMatches(linkedRoutineId, before!.task, before!.list)
    const done = writer.discard(path, targetId, reason)
    try {
      ctx.planning.archive(done.id, { origin: done.origin, completedAt: done.completedAt, originalLine: done.originalLine })
      if (linkedRoutineId === done.id) {
        if (linkedRoutineMatches) personalRoutines.discardTask(done.id)
        else personalRoutines.recoverMissingTask(done.id)
      }
    } catch (err) {
      throw new Error('A tarefa foi descartada no tarefas.md, mas não consegui atualizar o planning.json. Abra o quadro Tarefas de novo.', {
        cause: err,
      })
    }
    return done.id
  }
  ipcMain.handle('office:discardTask', async (_e, raw: unknown) => {
    const input = parse(discardTaskSchema, raw, 'Descarte inválido.')
    const path = requireVault()
    const id = discardTask(path, targetOf(input.target), input.reason)
    const board = read(path)
    return { id, board, focus: focusView(board.lists) }
  })

  // #101: Luna's tools share these writers, so the board and her changes check against the same reads.
  // Tests may register this area without a manager.
  if (ctx.manager)
    ctx.manager.lunaTools = () =>
      lunaTools({
        vault: requireVault,
        readTasks: (path) => read(path),
        createTask: (path, draft) => writer.create(path, parse(newTaskSchema, draft, 'Tarefa inválida.')),
        moveTask: (path, line, list) => writer.move(path, line, list),
        rescheduleTask: (path, line, date) => writer.reschedule(path, line, date),
        completeTask: (target) => completeTask(requireVault(), target),
        discardTask: (target, reason) => discardTask(requireVault(), target, reason),
        agenda,
        review,
        callAgent: async ({ task, cwd, name }) => {
          const req = cleanHire({ task, cwd: cwd ?? requireVault(), ...(name ? { name } : {}) }, ctx.store.settings)
          const agent = await ctx.manager.hire({ ...req, homeResident: true })
          return { name: agent.name }
        },
        goals: lunaGoals,
        media: {
          read: (path, kind) => ctx.mediaWriter.read(path, kind),
          create: (path, kind, draft) => ctx.mediaWriter.create(path, kind, draft),
        },
        routines: review.routines,
      })

  // Luna's /compromisso command: the same writer and plan as her agenda_add tool, and its undo.
  const commitmentSchema = z.object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    title: z.string().min(1).max(300),
  })
  const agendaChange = (raw: unknown, plan: typeof planAddCommitment) => {
    const input = parse(commitmentSchema, raw, 'Compromisso inválido.')
    const path = requireVault()
    agenda.read(path)
    const before = agenda.current(path)
    agenda.write(path, before, plan(before, input))
  }
  ipcMain.handle('office:addCommitment', async (_e, raw: unknown) => agendaChange(raw, planAddCommitment))
  ipcMain.handle('office:removeCommitment', async (_e, raw: unknown) => agendaChange(raw, planRemoveCommitment))

  // tarefas.md is written first, then the record of the task is removed. If that second step fails, the
  // task is already back in its list and the record stays; it is replaced by the next completion or discard.
  ipcMain.handle('office:reopenTask', async (_e, raw: unknown) => {
    const input = parse(reopenTaskSchema, raw, 'Reabertura inválida.')
    const path = requireVault()
    const before = taskAt(path, targetOf(input.target))
    const taskId = before?.task.id
    const linkedRoutine = !!taskId && personalRoutines.hasTaskLink(taskId)
    const linkedRoutineMatches = !!taskId && !!before && routineTaskMatches(taskId, before.task, before.list)
    const plan = writer.reopen(path, targetOf(input.target), { list: input.list, archived: (id) => ctx.planning.archivedOf(id) })
    if (plan.status === 'choose') return plan
    if (plan.id) {
      undo.forget(plan.id)
      if (linkedRoutine && taskId === plan.id) {
        if (linkedRoutineMatches) personalRoutines.reopenTask(plan.id)
        else personalRoutines.recoverMissingTask(plan.id)
      }
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

  // Lê a agenda da semana que contém `date` (AAAA-MM-DD), para navegação entre semanas.
  ipcMain.handle('office:readAgendaForDate', async (_e, raw: unknown) => {
    const date = parse(
      z.string().refine((d) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false
        const parsed = new Date(`${d}T00:00:00Z`)
        return !isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === d
      }, 'Dia inválido.'),
      raw,
      'Dia inválido.',
    )
    const path = requireVault()
    return buildAgendaView(
      readOptionalFile(path, 'agenda.md'),
      readOptionalFile(path, 'tarefas.md') ?? '',
      new Date(`${date}T12:00:00`),
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
