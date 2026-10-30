import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dialog, ipcMain } from 'electron'
import { z } from 'zod'
import { buildAgendaView } from '@shared/agenda'
import { focusItems, focusKey } from '@shared/planning'
import { ARCHIVE_LIST, parseTasksFile, type TaskList, type TaskRef } from '@shared/tasks'
import type { Proposal } from '@shared/proposals'
import { createAgendaWriter } from '../agenda-write'
import { dayKey } from '../backups'
import { applyProposal } from '../proposals'
import { registerIrisIpc } from './iris'
import { registerReviewIpc } from './review'
import { createTaskWriter, type TaskWriter } from '../tasks-write'
import { createCompletionUndo } from '../tasks-undo'
import { PersonalRoutineStore } from '../personal-routines-store'
import { DailyWorkflow } from '../daily-workflow'
import { readPersonalRoutines } from '../routines-personal'
import { LUNA_AGENT_ID } from '@shared/luna'
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

const dailyWorkflowTimesSchema = z
  .object({
    morning: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    evening: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  })
  .strict()

export function registerTasksIpc(ctx: IpcContext): void {
  const writer = createTaskWriter()
  // Shared with the proposals below: one read of tarefas.md is what the next confirmation checks against.
  const agenda = createAgendaWriter()
  const undo = createCompletionUndo()
  const personalRoutines = new PersonalRoutineStore(ctx.store.dataDirectory)
  const dailyWorkflow = new DailyWorkflow({
    store: personalRoutines,
    now: () => new Date(),
    routineText: () => {
      const vaultPath = ctx.store.settings.vaultPath
      return vaultPath ? (readPersonalRoutines(checkedVault(vaultPath)) ?? '') : ''
    },
    morning: (day) => {
      const [year, month, date] = day.split('-').map(Number)
      const now = new Date(year!, month! - 1, date!, 12)
      const vaultPath = ctx.store.settings.vaultPath
      if (!vaultPath) return 'Planejamento matinal: configure o vault para incluir agenda, aulas e tarefas com data.'
      const path = checkedVault(vaultPath)
      const boardText = readOptionalFile(path, 'tarefas.md') ?? ''
      const agenda = buildAgendaView(readOptionalFile(path, 'agenda.md'), boardText, now, readOptionalFile(path, 'aulas.md'))
      const entries = agenda.today.entries.map((entry) =>
        'time' in entry ? `${entry.time} · ${'title' in entry ? entry.title : (entry.text ?? 'Tarefa vinculada')}` : entry.text,
      )
      const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      const dateLabels = new Set([
        dateKey,
        `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}`,
        `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}`,
      ])
      const datedTasks = parseTasksFile(boardText).lists.flatMap((list) =>
        list.tasks
          .filter((task) => task.status === 'open' && dateLabels.has(task.date ?? task.dueDate ?? ''))
          .map((task) => `• ${task.text}`),
      )
      return [
        'Planejamento de hoje',
        entries.length ? `Agenda e aulas:\n${entries.map((entry) => `• ${entry}`).join('\n')}` : 'Agenda e aulas: nada marcado para hoje.',
        datedTasks.length ? `Tarefas com data:\n${datedTasks.join('\n')}` : 'Tarefas com data: nenhuma para hoje.',
      ].join('\n\n')
    },
    evening: (day) => {
      const vaultPath = ctx.store.settings.vaultPath
      if (!vaultPath) return 'Revisão do dia: configure o vault para consultar tarefas e agenda.'
      const boardText = readOptionalFile(checkedVault(vaultPath), 'tarefas.md') ?? ''
      const parsed = parseTasksFile(boardText)
      const dateLabels = new Set([
        day,
        `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`,
        `${day.slice(8, 10)}.${day.slice(5, 7)}`,
      ])
      const todaysTasks = parsed.lists.flatMap((list) => list.tasks.filter((task) => dateLabels.has(task.date ?? task.dueDate ?? '')))
      const completed = todaysTasks.filter((task) => task.status === 'completed').map((task) => `• ${task.text}`)
      const open = todaysTasks.filter((task) => task.status === 'open').map((task) => `• ${task.text}`)
      return [
        'Revisão do dia',
        completed.length ? `Concluídas:\n${completed.join('\n')}` : 'Concluídas: nenhuma registrada.',
        open.length ? `Ainda abertas:\n${open.slice(0, 8).join('\n')}` : 'Ainda abertas: nenhuma.',
      ].join('\n\n')
    },
    chat: (text) => {
      const question = 'Li seu planejamento/revisão local. Você pode continuar no chat normal da Luna quando quiser.'
      ctx.manager.requestDecision(
        LUNA_AGENT_ID,
        {
          kind: 'question',
          toolName: 'Luna',
          title: 'Seu resumo diário',
          detail: text,
          input: {},
          canAlwaysAllow: false,
          questions: [
            {
              header: 'Resumo',
              question,
              multiSelect: false,
              options: [
                { label: 'Abrir o chat da Luna', description: 'Continuar o planejamento no chat normal.' },
                { label: 'Agora não', description: 'Fechar sem outra ação.' },
              ],
            },
          ],
        },
        (decision) => {
          if (decision.behavior === 'allow' && Object.values(decision.answers ?? {}).includes('Abrir o chat da Luna')) {
            ctx.manager.appendBuiltInLog(LUNA_AGENT_ID, 'assistant', text)
            ctx.broadcast({ type: 'luna:open-chat' })
          }
        },
      )
    },
    ask: (items, answer) => {
      const questions = items.map((item) => ({
        header: item.id.startsWith('priorities:') ? 'Prioridades' : 'Rotina pessoal',
        question: item.question,
        multiSelect: item.multiSelect ?? false,
        options: item.options,
      }))
      return ctx.manager.requestDecision(
        LUNA_AGENT_ID,
        {
          kind: 'question',
          toolName: 'Luna',
          title: 'Planejamento e rotinas de hoje',
          detail: '',
          input: {},
          canAlwaysAllow: false,
          questions,
        },
        (decision) => {
          if (decision.behavior === 'allow') answer(decision.answers ?? {})
        },
      )
    },
    cancelRequest: (requestId) => ctx.manager.cancelRequest(requestId, 'O lembrete foi atualizado; responda à pergunta mais recente.'),
  })
  if (ctx.manager) {
    const dailyTimer = setInterval(() => {
      try {
        dailyWorkflow.check()
      } catch (err) {
        console.error('Workflow diário da Luna:', err)
      }
    }, 60_000)
    dailyTimer.unref()
    try {
      dailyWorkflow.check()
    } catch (err) {
      console.error('Catch-up diário da Luna:', err)
    }
  }
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

  registerReviewIpc(ctx, { tasks: writer, agenda, vault: requireVault }, personalRoutines)
  ipcMain.handle('office:dailyWorkflowTimes', () => personalRoutines.dailyTimes())
  ipcMain.handle('office:setDailyWorkflowTimes', (_event, raw: unknown) => {
    const value = dailyWorkflowTimesSchema.safeParse(raw)
    if (!value.success) throw new Error('Horários inválidos.')
    personalRoutines.setDailyTimes(value.data)
    dailyWorkflow.check()
  })
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
        callAgent: async ({ task, cwd, name }) => {
          const req = cleanHire({ task, cwd: cwd ?? requireVault(), ...(name ? { name } : {}) }, ctx.store.settings)
          const agent = await ctx.manager.hire({ ...req, homeResident: true })
          return { name: agent.name }
        },
      })

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
