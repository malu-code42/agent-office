import { createHash } from 'node:crypto'
import { readTasks, planNewTask, type TaskWriter } from './tasks-write'
import { parseTasksFile } from '@shared/tasks'
import type { AskQuestion, AttachmentInput, LogEntry } from '@shared/types'
import type { AudioPlan, AudioPlanGroup, AudioTaskDraft, LocalAudioTranscript } from '@shared/audio'
import { dayKey } from './backups'
import { AudioDictionaryStore } from './audio-dictionary'
import { LocalAudioProcessingFailure, LocalAudioTranscriber } from './audio-transcriber'
import { normalizeAudioPhrase } from './audio-dictionary'
import { parseAudioPlan, audioPlanContext } from './audio-plan'
import { cleanupTemporaryAudio, materializeAudioAttachment } from './audio-temporary'
import { AudioPlanUnavailable, type AudioPlanInterpreter } from './audio-claude'

/** Whether an audio finished, needs the user again, or failed locally and may be retried. */
export type AudioDisposition = 'complete' | 'pending' | 'retry'

type AskOption = AskQuestion['options'][number]
type Ask = (header: string, question: string, options: AskOption[]) => Promise<string | null>

export interface AudioCaptureHost {
  dataDirectory(): string
  vault(): string
  log(kind: LogEntry['kind'], text: string): void
  transcript(text: string): void
  status(activity: string): void
  confirmContext(context: string): Promise<boolean>
  ask: Ask
  routeGroup(domain: Extract<AudioPlanGroup, { kind: 'route' }>['domain'], text: string, groupId: string): Promise<boolean>
  saveWriting(text: string, stableId: string): Promise<boolean>
}

interface PlannedTasks {
  before: string
  after: string
  ids: string[]
}

const APPROVE_TASKS = 'Aprovar e gravar grupo'
const REJECT_GROUP = 'Rejeitar grupo'
const EDIT_GROUP = 'Editar grupo'
const KEEP_TRANSCRIPT = 'Manter como foi transcrito'
const MAX_EDIT_ROUNDS = 3

/** Local ASR, contextual dictionary and one-by-one group review for local audio (AO-54). */
export class AudioCaptureWorkflow {
  private queue: Promise<void> = Promise.resolve()
  private readonly appliedGroups = new Set<string>()

  constructor(
    private readonly transcriber: Pick<LocalAudioTranscriber, 'transcribe'>,
    private readonly dictionary: AudioDictionaryStore,
    private readonly planner: AudioPlanInterpreter,
    private readonly tasks: TaskWriter,
    private readonly host: AudioCaptureHost,
    private readonly now: () => Date = () => new Date(),
  ) {
    try {
      cleanupTemporaryAudio(host.dataDirectory())
    } catch (error) {
      host.log('error', error instanceof Error ? error.message : 'Não consegui limpar os áudios temporários antigos.')
    }
  }

  processAttachment(input: AttachmentInput, caption: string): Promise<void> {
    return this.serial(async () => {
      const audio = materializeAudioAttachment(this.host.dataDirectory(), input)
      try {
        await this.process(audio.path, caption, audio.fingerprint)
      } finally {
        audio.dispose()
      }
    })
  }

  private serial<T>(run: () => Promise<T>): Promise<T> {
    const result = this.queue.then(run)
    this.queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async process(path: string, caption: string, audioFingerprint: string): Promise<AudioDisposition> {
    this.host.status('Transcrevendo áudio localmente')
    let transcript: LocalAudioTranscript
    try {
      transcript = await this.transcriber.transcribe(path)
    } catch (error) {
      this.host.log('error', error instanceof Error ? error.message : 'Não consegui transcrever esse áudio localmente.')
      this.host.status('Pronta para ajudar')
      return error instanceof LocalAudioProcessingFailure ? 'retry' : 'pending'
    }

    const corrected = await this.correctUncertain(transcript)
    if (!corrected) {
      this.host.log('assistant', 'A revisão parou sem alterar nenhum dado. Envie o áudio novamente quando quiser continuar.')
      this.host.status('Pronta para ajudar')
      return 'pending'
    }
    const transcriptText = [
      ...transcript.segments.map((segment) => segment.text.trim()).filter(Boolean),
      ...(caption.trim() ? [`Instrução junto ao áudio: ${caption.trim()}`] : []),
    ].join(' ')
    if (!transcriptText.trim()) {
      this.host.log('error', 'Não reconheci fala neste áudio. Nenhum dado foi gravado.')
      this.host.status('Pronta para ajudar')
      return 'complete'
    }

    this.host.transcript(
      transcript.segments
        .map((segment) => `${stamp(segment.start)} ${segment.text.trim()}`)
        .filter(Boolean)
        .join('\n'),
    )
    try {
      const vault = this.host.vault()
      const currentTasks = readTasks(vault)
      this.tasks.remember(vault, currentTasks)
      const lists = parseTasksFile(currentTasks).lists.map((list) => list.name)
      let context = audioPlanContext(transcriptText, dayKey(this.now()), lists)
      if (!(await this.host.confirmContext(context))) {
        this.host.log('assistant', 'Envio cancelado. A transcrição ficou somente neste computador e nenhum grupo foi gravado.')
        this.host.status('Pronta para ajudar')
        return 'pending'
      }

      let plan: AudioPlan | undefined
      for (let turn = 0; turn < MAX_EDIT_ROUNDS; turn++) {
        plan = parseAudioPlan(await this.planner.interpret(context, AbortSignal.timeout(60_000)), lists)
        if (!plan.question) break
        const answer = await this.host.ask('Trecho ambíguo', plan.question, [])
        if (!answer) {
          this.host.log('assistant', 'A revisão parou; nada foi gravado. Você pode reenviar o áudio mais tarde.')
          this.host.status('Pronta para ajudar')
          return 'pending'
        }
        context = audioPlanContext(`${transcriptText}\n\nEsclarecimento da usuária: ${answer}`, dayKey(this.now()), lists)
        if (!(await this.host.confirmContext(context))) {
          this.host.log('assistant', 'Envio cancelado. Nenhum grupo foi gravado.')
          this.host.status('Pronta para ajudar')
          return 'pending'
        }
      }
      if (!plan || plan.question) {
        this.host.log('assistant', 'Ainda há uma ambiguidade. Nada foi gravado; diga à Luna o que quis dizer e tente novamente.')
        this.host.status('Pronta para ajudar')
        return 'pending'
      }

      const groups = mergeTaskGroups(plan.groups)
      let allResolved = true
      for (const [index, group] of groups.entries()) {
        const groupId = groupFingerprint(audioFingerprint, group)
        const resolved = group.kind === 'tasks' ? await this.reviewTaskGroup(groupId, group) : await this.reviewRouteGroup(groupId, group)
        allResolved &&= resolved
        if (!resolved) break
        this.host.log('system', `Grupo ${index + 1}/${groups.length} processado.`)
      }
      if (allResolved)
        this.host.log('assistant', 'A captura terminou. Grupos aprovados foram processados; grupos rejeitados não foram alterados.')
      return allResolved ? 'complete' : 'pending'
    } catch (error) {
      this.host.log('error', error instanceof Error ? error.message : 'Não consegui preparar os grupos do áudio.')
      return (error instanceof AudioPlanUnavailable && error.retryable) || error instanceof LocalAudioProcessingFailure
        ? 'retry'
        : 'pending'
    } finally {
      this.host.status('Pronta para ajudar')
    }
  }

  private async correctUncertain(transcript: LocalAudioTranscript): Promise<boolean> {
    for (const [index, segment] of transcript.segments.entries()) {
      if (!segment.uncertain) continue
      const context = [transcript.segments[index - 1]?.text, segment.text, transcript.segments[index + 1]?.text]
        .filter((text): text is string => !!text)
        .join(' ')
        .slice(0, 300)
      const entries = this.dictionary.find(segment.text)
      const matchingContext = entries.filter((entry) => normalizeAudioPhrase(entry.context) === normalizeAudioPhrase(context))
      const candidates = matchingContext.length ? matchingContext : entries
      const known = [...new Set(candidates.map((entry) => entry.correction))]
      if (matchingContext.length && known.length === 1) {
        segment.text = known[0]!
        segment.uncertain = false
        continue
      }
      const options: AskOption[] = [
        ...known.map((correction) => ({ label: correction, description: 'Correção já confirmada neste contexto.' })),
        { label: KEEP_TRANSCRIPT, description: 'Manter exatamente o que a transcrição reconheceu.' },
      ]
      const answer = await this.host.ask(
        'Trecho incerto',
        `Não tive certeza deste trecho (${stamp(segment.start)}): “${segment.text}”. ${known.length ? 'Escolha uma correção ou escreva outra.' : 'Escreva a correção em “Outra resposta” ou mantenha o trecho.'}`,
        options,
      )
      if (!answer) return false
      if (answer !== KEEP_TRANSCRIPT) {
        const correction = answer.trim()
        if (!correction || correction.length > 200) {
          this.host.log('error', 'A correção precisa ter até 200 caracteres. Reenvie o áudio para tentar novamente.')
          return false
        }
        this.dictionary.remember(segment.text, correction, context)
        segment.text = correction
      }
      segment.uncertain = false
    }
    return true
  }

  private async reviewTaskGroup(groupId: string, original: Extract<AudioPlanGroup, { kind: 'tasks' }>): Promise<boolean> {
    if (this.dictionary.hasAcceptedGroup(groupId)) {
      this.host.log('assistant', `Este grupo de áudio já foi gravado em “${original.list}”; não criei cópias.`)
      return true
    }
    let group = original
    for (let edit = 0; edit <= MAX_EDIT_ROUNDS; edit++) {
      const plan = this.planTasks(group, groupId)
      const answer = await this.host.ask(
        `Tarefas · ${group.list}`,
        `Confira o grupo que será acrescentado à lista existente “${group.list}”. Só este grupo será gravado após sua aprovação.\n\n${describeTasks(group.tasks)}`,
        [
          { label: APPROVE_TASKS, description: 'Gravar estas tarefas na lista existente.' },
          { label: EDIT_GROUP, description: 'Revisar os títulos/datas e reapresentar o grupo.' },
          { label: REJECT_GROUP, description: 'Descartar este grupo sem alterar tarefas.md.' },
        ],
      )
      if (!answer) return false
      if (answer === REJECT_GROUP) return true
      if (answer === APPROVE_TASKS) {
        if (this.appliedGroups.has(groupId)) return true
        this.tasks.write(this.host.vault(), plan.before, plan.after)
        this.appliedGroups.add(groupId)
        this.dictionary.markAcceptedGroup(groupId)
        this.host.log('assistant', `Gravei ${group.tasks.length} tarefa(s) na lista “${group.list}”.`)
        return true
      }

      const editedText =
        answer === EDIT_GROUP
          ? await this.host.ask('Editar grupo', 'Escreva uma tarefa por linha. Formato opcional: título | DD.MM.AAAA | HH:MM.', [])
          : answer
      if (!editedText) return false
      group = { ...group, tasks: parseEditedTasks(editedText) }
    }
    this.host.log('assistant', `Não consegui fechar o grupo “${original.list}” após as edições. Nada foi gravado.`)
    return false
  }

  private async reviewRouteGroup(groupId: string, group: Extract<AudioPlanGroup, { kind: 'route' }>): Promise<boolean> {
    if (this.dictionary.hasAcceptedGroup(groupId)) {
      this.host.log('assistant', `Este trecho de ${routeName(group.domain)} já foi encaminhado; não o dupliquei.`)
      return true
    }
    let text = group.text
    for (let edit = 0; edit <= MAX_EDIT_ROUNDS; edit++) {
      const answer = await this.host.ask(
        `Encaminhar · ${routeName(group.domain)}`,
        `Este trecho será encaminhado ao fluxo de ${routeName(group.domain)}. Nenhum dado desse grupo será gravado silenciosamente.\n\n${text}`,
        [
          { label: 'Encaminhar trecho', description: 'Continuar no fluxo normal de Luna para este domínio.' },
          { label: EDIT_GROUP, description: 'Editar o trecho e reapresentar o grupo.' },
          { label: REJECT_GROUP, description: 'Descartar este grupo sem alterar dados.' },
        ],
      )
      if (!answer) return false
      if (answer === REJECT_GROUP) return true
      if (answer === 'Encaminhar trecho') {
        if (this.appliedGroups.has(groupId)) return true
        if (group.domain === 'writing') {
          if (!(await this.host.saveWriting(text, stableWritingId(groupId)))) return false
          this.appliedGroups.add(groupId)
          this.dictionary.markAcceptedGroup(groupId)
          this.host.log('assistant', 'O trecho foi salvo como Original na biblioteca de Escrita, após sua confirmação.')
        } else {
          if (!(await this.host.routeGroup(group.domain, text, groupId))) return false
          this.appliedGroups.add(groupId)
          this.dictionary.markAcceptedGroup(groupId)
          this.host.log('assistant', `O trecho foi encaminhado ao fluxo de ${routeName(group.domain)}.`)
        }
        return true
      }
      const editedText = answer === EDIT_GROUP ? await this.host.ask('Editar trecho', 'Escreva a versão corrigida do trecho.', []) : answer
      if (!editedText) return false
      text = editedText.trim()
      if (!text) return false
    }
    this.host.log('assistant', `Não consegui fechar o grupo de ${routeName(group.domain)} após as edições. Nada foi gravado.`)
    return false
  }

  private planTasks(group: Extract<AudioPlanGroup, { kind: 'tasks' }>, groupId: string): PlannedTasks {
    const vault = this.host.vault()
    const before = readTasks(vault)
    this.tasks.remember(vault, before)
    let after = before
    const ids: string[] = []
    for (const [index, task] of group.tasks.entries()) {
      const planned = planNewTask(after, { ...task, list: group.list, id: stableTaskId(groupId, index) })
      after = planned.text
      ids.push(planned.id)
    }
    return { before, after, ids }
  }
}

function mergeTaskGroups(groups: AudioPlanGroup[]): AudioPlanGroup[] {
  const out: AudioPlanGroup[] = []
  const tasksByList = new Map<string, Extract<AudioPlanGroup, { kind: 'tasks' }>>()
  const routesByDomain = new Map<string, Extract<AudioPlanGroup, { kind: 'route' }>>()
  for (const group of groups) {
    if (group.kind === 'route') {
      const existing = routesByDomain.get(group.domain)
      if (existing) existing.text = `${existing.text}\n${group.text}`
      else {
        const copy: Extract<AudioPlanGroup, { kind: 'route' }> = { ...group }
        routesByDomain.set(group.domain, copy)
        out.push(copy)
      }
      continue
    }
    if (group.kind !== 'tasks') {
      out.push(group)
      continue
    }
    const existing = tasksByList.get(group.list)
    if (existing) existing.tasks.push(...group.tasks)
    else {
      const copy: Extract<AudioPlanGroup, { kind: 'tasks' }> = { ...group, tasks: [...group.tasks] }
      tasksByList.set(group.list, copy)
      out.push(copy)
    }
  }
  return out
}

function groupFingerprint(audio: string, group: AudioPlanGroup): string {
  const descriptor = group.kind === 'tasks' ? `tasks\0${group.list}` : `route\0${group.domain}`
  return createHash('sha256').update(`${audio}\0${descriptor}`).digest('hex')
}

function stableTaskId(groupId: string, index: number): string {
  const value = BigInt(`0x${createHash('sha256').update(`${groupId}\0${index}`).digest('hex').slice(0, 16)}`)
    .toString(36)
    .padStart(6, '0')
  return `t${value.slice(-6)}`
}

function stableWritingId(groupId: string): string {
  return `w${groupId.slice(0, 32)}`
}

function parseEditedTasks(text: string): AudioTaskDraft[] {
  const tasks = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [title, date, time, ...extra] = line.split('|').map((part) => part.trim())
      if (extra.length) throw new Error('Cada tarefa pode ter título, data e hora: título | DD.MM.AAAA | HH:MM.')
      return { title, ...(date ? { date } : {}), ...(time ? { time } : {}) }
    })
  if (!tasks.length || tasks.length > 20) throw new Error('Escreva de 1 a 20 tarefas para reapresentar o grupo.')
  return tasks
}

function describeTasks(tasks: AudioTaskDraft[]): string {
  return tasks.map((task) => `- ${task.title}${task.date ? ` · ${task.date}` : ''}${task.time ? ` às ${task.time}` : ''}`).join('\n')
}

function routeName(domain: Extract<AudioPlanGroup, { kind: 'route' }>['domain']): string {
  switch (domain) {
    case 'agenda':
      return 'agenda'
    case 'media':
      return 'mídias'
    case 'goals':
      return 'objetivos'
    case 'writing':
      return 'escrita'
    case 'unknown':
      return 'destino a esclarecer'
  }
}

function stamp(seconds: number): string {
  const total = Math.floor(seconds)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
