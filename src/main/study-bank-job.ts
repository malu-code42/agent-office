import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { STUDY_BANK_DEFAULT_PER_TOPIC, STUDY_BANK_MAX_PER_TOPIC, type StudyBankJob, type StudyBankRequest } from '@shared/study-bank'
import type { StudyTrail } from '@shared/study-trail'
import { buildStudyBank, studyBankTopics, type StudyBankBuildResult } from './study-bank-builder'
import { writeJsonAtomic } from './fs-safe'

export const STUDY_BANK_JOB_FILE = 'study-bank-job.json'

type Build = (trail: StudyTrail, options: Parameters<typeof buildStudyBank>[2]) => Promise<StudyBankBuildResult>

/**
 * The one bank build that may run at a time, in the main process: it goes on while its window is
 * closed, reports every step, can be stopped, and is found "interrupted" after the app quits mid-run
 * (running it again resumes it: finished topics are skipped).
 */
export class StudyBankJobs {
  private job: StudyBankJob | null
  private abort: AbortController | null = null
  private readonly file: string

  constructor(
    dataDir: string,
    private readonly emit: (job: StudyBankJob | null) => void,
    private readonly now: () => number = Date.now,
  ) {
    this.file = join(dataDir, STUDY_BANK_JOB_FILE)
    this.job = this.load()
    if (this.job?.status === 'running') this.save({ ...this.job, status: 'stopped', stop: 'interrupted', current: undefined })
  }

  status(): StudyBankJob | null {
    return this.job
  }

  /** Starts a run; throws if one is going on. Resolves when it is set up, not when it ends. */
  start(trail: StudyTrail, request: StudyBankRequest, build: Build): StudyBankJob {
    if (this.job?.status === 'running') throw new Error('Já há uma montagem do banco em andamento.')
    const perTopic = Math.max(1, Math.min(STUDY_BANK_MAX_PER_TOPIC, Math.floor(request.perTopic ?? STUDY_BANK_DEFAULT_PER_TOPIC)))
    const topics = studyBankTopics(trail, request)
    if (!topics.length) throw new Error('Nenhum tópico da trilha corresponde à escolha.')
    const at = this.now()
    const job: StudyBankJob = {
      status: 'running',
      ...(request.discipline ? { discipline: request.discipline } : {}),
      ...(request.topic ? { topic: request.topic } : {}),
      perTopic,
      total: topics.length,
      done: 0,
      added: 0,
      results: [],
      startedAt: at,
      updatedAt: at,
    }
    this.save(job)
    const abort = new AbortController()
    this.abort = abort
    void build(trail, {
      discipline: request.discipline,
      topic: request.topic,
      perTopic,
      signal: abort.signal,
      onProgress: (event) => {
        const current = this.job
        if (!current || current.status !== 'running') return
        if (event.kind === 'topic')
          this.save({
            ...current,
            current: { topic: event.topic.title, discipline: event.topic.discipline, made: 0, goal: event.goal - event.had },
          })
        else if (event.kind === 'step' && current.current)
          this.save({ ...current, current: { ...current.current, made: event.made, step: event.step, source: event.source } }, false)
        else if (event.kind === 'done')
          this.save({
            ...current,
            done: current.done + 1,
            added: current.added + event.result.added,
            results: [...current.results, event.result],
            current: undefined,
          })
      },
    })
      .then((result) => this.finish(result))
      .catch((error: unknown) => this.finish({ results: [], stop: 'error', message: (error as Error).message }))
    return this.job!
  }

  /** Asks the run to stop after the call in progress; what is finished stays in the bank. */
  cancel(): void {
    this.abort?.abort()
  }

  /** Forgets the last run (the report or the "interrupted" notice). */
  dismiss(): void {
    if (this.job?.status === 'running') return
    this.job = null
    writeJsonAtomic(this.file, null, { mode: 0o600 })
    this.emit(null)
  }

  private finish(result: StudyBankBuildResult): void {
    const current = this.job
    this.abort = null
    if (!current) return
    this.save({
      ...current,
      status: result.stop ? 'stopped' : 'done',
      current: undefined,
      ...(result.stop ? { stop: result.stop } : {}),
      ...(result.message ? { message: result.message.slice(0, 500) } : {}),
    })
  }

  /** Steps are frequent: they go to the window but not to disk. */
  private save(job: StudyBankJob, persist = true): void {
    this.job = { ...job, updatedAt: this.now() }
    if (persist) writeJsonAtomic(this.file, this.job, { mode: 0o600 })
    this.emit(this.job)
  }

  private load(): StudyBankJob | null {
    try {
      if (!existsSync(this.file)) return null
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as StudyBankJob | null
      return data && typeof data === 'object' && Array.isArray(data.results) ? data : null
    } catch {
      return null
    }
  }
}
