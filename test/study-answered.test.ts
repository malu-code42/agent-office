import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  answeredStudyQuestions,
  answerStudyQuestion,
  createStudyCycleState,
  resetActiveStudyCycle,
  unansweredStudyQuestions,
  type StudyCycleQuestion,
} from '../src/shared/study-cycle'
import type { StudyQuestion } from '../src/shared/study-questions'
import { parseStudyTrail } from '../src/shared/study-trail'
import type { StudyBankJob } from '../src/shared/study-bank'
import { StudyCycleStore } from '../src/main/study-cycle-store'
import { hashStudyQuestion } from '../src/main/study-cycle-schema'
import { STUDY_BANK_JOB_FILE, StudyBankJobs } from '../src/main/study-bank-job'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))

const q = (id: string, question: string): StudyQuestion => ({
  id,
  topic: 'Filas',
  tags: [],
  question,
  answer: 'FIFO',
  answerStatus: 'verified',
  originKind: 'livro',
  sourceTitle: 'Livro',
  sourceVisibility: 'local',
  attribution: 'Autor',
  license: 'Livre',
})
const cq = (source: StudyQuestion): StudyCycleQuestion => ({
  id: source.id,
  sourceHash: hashStudyQuestion(source),
  source,
  response: '',
  providedExcerpt: '',
  uncertain: null,
  assessment: null,
})

describe('questões respondidas', () => {
  const a = q('q-aaaaaaaa', 'O que é uma fila?')
  const copy = q('q-bbbbbbbb', '  o que é   uma FILA? ')
  const b = q('q-cccccccc', 'O que é uma pilha?')

  it('registra a questão ao responder e a guarda mesmo depois de trocar de ciclo', () => {
    let state = createStudyCycleState('Filas', [cq(a), cq(b)], 1)
    state = answerStudyQuestion(state, a.id, 'Primeiro a entrar, primeiro a sair', false, 2)
    expect(state.answered).toEqual([{ id: a.id, key: 'o que é uma fila?', at: 2 }])
    state = resetActiveStudyCycle(state)
    state = createStudyCycleState('Pilhas', [cq(b)], 3, state)
    expect(state.answered?.map((item) => item.id)).toEqual([a.id])
  })

  it('não oferece de novo a mesma questão nem uma cópia com outro id', () => {
    const state = answerStudyQuestion(createStudyCycleState('Filas', [cq(a)], 1), a.id, 'FIFO', false, 2)
    expect(unansweredStudyQuestions([a, copy, b], state).map((item) => item.id)).toEqual([b.id])
  })

  it('conta as respostas de ciclos gravados antes do registro existir', () => {
    const old = answerStudyQuestion(createStudyCycleState('Filas', [cq(a)], 1), a.id, 'FIFO', false, 2)
    delete old.answered
    expect(answeredStudyQuestions(old).ids.has(a.id)).toBe(true)
  })

  it('persiste o registro no study-cycle.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'study-answered-'))
    try {
      const store = new StudyCycleStore(dir)
      store.write(answerStudyQuestion(createStudyCycleState('Filas', [cq(a)], 1), a.id, 'FIFO', false, 2))
      expect(new StudyCycleStore(dir).read().answered).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('StudyBankJobs', () => {
  const trail = parseStudyTrail(['## 1º período', '### [P2-ED] Estrutura de Dados — 60 h', '- [ ] [P2-ED-05] Filas.'].join('\n'))

  it('marca como interrompida a montagem que estava rodando quando o app fechou', () => {
    const dir = mkdtempSync(join(tmpdir(), 'study-bank-job-'))
    try {
      const running: StudyBankJob = {
        status: 'running',
        perTopic: 20,
        total: 3,
        done: 1,
        added: 20,
        results: [],
        startedAt: 1,
        updatedAt: 2,
      }
      writeFileSync(join(dir, STUDY_BANK_JOB_FILE), JSON.stringify(running))
      expect(new StudyBankJobs(dir, () => {}).status()).toMatchObject({ status: 'stopped', stop: 'interrupted', done: 1 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('roda uma montagem por vez, informa o andamento e termina com o relatório', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'study-bank-job-'))
    try {
      const events: (StudyBankJob | null)[] = []
      const jobs = new StudyBankJobs(dir, (job) => events.push(job))
      let release!: () => void
      const build = vi.fn(async (_trail, options) => {
        await new Promise<void>((resolve) => (release = resolve))
        const result = {
          id: 'P2-ED-05',
          topic: 'Filas',
          discipline: 'Estrutura de Dados',
          disciplineId: 'P2-ED',
          goal: 20,
          had: 0,
          added: 20,
        }
        options.onProgress({ kind: 'done', result })
        return { results: [result] }
      })
      expect(jobs.start(trail, { discipline: 'P2-ED' }, build)).toMatchObject({ status: 'running', total: 1, perTopic: 20 })
      expect(() => jobs.start(trail, {}, build)).toThrow(/em andamento/)
      release()
      await vi.waitFor(() => expect(jobs.status()?.status).toBe('done'))
      expect(jobs.status()).toMatchObject({ done: 1, added: 20 })
      expect(events.length).toBeGreaterThan(1)
      jobs.dismiss()
      expect(jobs.status()).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
