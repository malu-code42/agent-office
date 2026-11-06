import { join } from 'node:path'
import { disciplineIdOf, studyBankFolders, type StudyBankStop } from '@shared/study-bank'
import type { StudyBookSuggestion } from '@shared/study-bank'

import type { StudyLibraryHit, StudySourceInfo } from '@shared/study-library'
import type { StudySubtopics } from '@shared/study-outline'
import type { StudyProofFailure, StudyReadiness, StudyReadinessTopic } from '@shared/study-readiness'
import { readinessTopicOf } from '@shared/study-readiness'
import type { StudyTrail } from '@shared/study-trail'
import { buildStudyBank, studyBankTopics } from './study-bank-builder'
import { loadJson, reportLoad, writeJsonAtomic } from './fs-safe'

export const STUDY_READINESS_FILE = 'study-readiness.json'
/** Fewer passages than this and the bank would make only a handful of questions from the topic. */
const MIN_PASSAGES = 3
const NAME_ONLY = /O nome corresponde|Encontrado pelo nome/

interface Deps {
  /** The vault root: the folders in the report are full paths under it. */
  vault: string
  library: {
    search(query: string, scope?: readonly string[]): Promise<{ hits: StudyLibraryHit[] }>
    inventory(verify?: boolean): Promise<{ sources: StudySourceInfo[]; missingFolder?: true }>
  }
  subtopics: { get(topic: string): StudySubtopics | undefined }
}

/**
 * The state of each topic of a discipline, read from its own books only (the discipline's folders
 * under textbooks). A PDF with no selectable text is not indexed: it makes a topic "precisa-ocr" only
 * when its name matches the topic (the search finds it by name). Subtopics are read from the store,
 * never built here, and no web or model is called.
 * With `previous`, a topic that was "pronto" there is kept as it was and not checked again; the rest are checked.
 * At build time `revalidateSources` checks passages again without repeating the question proof.
 */
export async function checkDisciplineReadiness(
  trail: StudyTrail,
  discipline: string,
  deps: Deps,
  now = Date.now(),
  previous?: StudyReadiness,
  revalidateSources = false,
): Promise<StudyReadiness> {
  const topics = studyBankTopics(trail, { discipline })
  if (!topics.length) throw new Error('Nenhum tópico da trilha corresponde à disciplina.')
  // Verified, not background: a PDF still being read would look like one with no passages.
  const { sources, missingFolder } = await deps.library.inventory(true)
  const out: StudyReadinessTopic[] = []
  for (const topic of topics) {
    const before = readinessTopicOf(previous?.discipline === discipline ? previous : undefined, topic, topics)
    if (before?.state === 'pronto' && !revalidateSources) {
      out.push({ ...before, id: topic.id, topic: topic.title })
      continue
    }
    const { folders } = studyBankFolders(disciplineIdOf(topic.id), topic.discipline)
    const found = (await deps.library.search(topic.title, folders)).hits
    const hits = found.filter((hit) => !NAME_ONLY.test(hit.excerpt))
    const named = new Set(found.filter((hit) => NAME_ONLY.test(hit.excerpt)).map((hit) => hit.sourceRef))
    const scanned = sources.filter((s) => s.scanned && named.has(s.path)).map((s) => s.name)
    const paths = folders.map((f) => join(deps.vault, f))
    const base = { id: topic.id, topic: topic.title, folders: paths, ...(before?.books ? { books: before.books } : {}) }
    if (!hits.length && scanned.length) {
      out.push({
        ...base,
        state: 'precisa-ocr',
        reason: `Sem texto selecionável: ${scanned.join(', ')}. Precisa de um PDF com texto selecionável; coloque a versão digital do livro em uma destas pastas: ${paths.join(', ')}.`,
      })
    } else if (!hits.length) {
      const reason = missingFolder
        ? `A pasta "study sources" ainda não existe; crie-a e coloque o livro em uma destas pastas: ${paths.join(', ')}.`
        : `Nenhum trecho sobre "${topic.title}" nos livros da pasta.`
      out.push({ ...base, state: 'sem-fonte', reason })
    } else if (hits.length < MIN_PASSAGES) {
      out.push({
        ...base,
        state: 'poucos-trechos',
        reason: `Só ${hits.length} trecho(s) sobre "${topic.title}" nos livros da pasta; são necessários ${MIN_PASSAGES}.`,
      })
    } else if (before?.state === 'pronto') {
      out.push({ ...before, id: topic.id, topic: topic.title })
    } else {
      const entry = deps.subtopics.get(topic.title)
      // A topic with no subtopics would get a total of 0 (total = questions per subtopic × subtopics): not ready.
      if (entry?.status === 'ok' && entry.subtopics.length)
        out.push({ ...base, state: 'pronto', reason: `${hits.length} trechos e ${entry.subtopics.length} subtemas.` })
      else
        out.push({
          ...base,
          state: 'sem-subtemas',
          reason:
            entry?.status === 'ok' ? 'O sumário do livro não trouxe subtemas.' : (entry?.reason ?? 'Os subtemas ainda não foram montados.'),
        })
    }
  }
  return { discipline, builtAt: now, topics: out }
}

/** What the generators read: the trail and the last readiness report of each discipline. */
export interface ReadinessSource {
  trail(): StudyTrail
  reports(): Record<string, StudyReadiness>
}

/** Cards, projects and zettels of a topic are generated only when its readiness is "pronto"; otherwise this throws the reason. */
export function assertTopicReady(source: ReadinessSource, topic: string): void {
  const trail = source.trail()
  const matches = readyTrailTopics(trail, topic)
  // A title can repeat across disciplines: guessing the first one could release a locked topic.
  if (matches.length > 1)
    throw new Error(
      `"${topic}" existe em mais de uma disciplina da trilha, então não dá para saber qual está pronto. Dê nomes diferentes aos tópicos na trilha.`,
    )
  const [trailTopic] = matches
  if (!trailTopic) throw new Error(`"${topic}" não está na trilha de estudos.`)
  const discipline = disciplineIdOf(trailTopic.id)
  const report = source.reports()[discipline]
  if (!report) throw new Error(`Ainda não há relatório de prontidão da disciplina ${discipline}. Prepare a disciplina antes de gerar.`)
  const entry = readinessTopicOf(report, trailTopic, studyBankTopics(trail, { discipline }))
  if (!entry) throw new Error(`"${topic}" não está no relatório de prontidão. Prepare a disciplina de novo.`)
  if (entry.state !== 'pronto') throw new Error(`"${topic}" ainda não está pronto: ${entry.reason}`)
}

const PROOF_REASON: Record<StudyProofFailure, string> = {
  unsupported: 'O livro não sustenta uma questão sobre o tópico.',
  similar: 'As questões feitas saíram parecidas demais com outras do tópico.',
  refused: 'A prova foi recusada: a resposta não estava clara no livro.',
}

/** A label carries an explicit ID even if its title is old; never retry a missing ID as a title. */
function readyTrailTopics(trail: StudyTrail, topic: string) {
  const id = /^\[([^\]]+)\]/.exec(topic)?.[1]
  const exact = trail.topics.filter((t) => t.id === (id ?? topic))
  return id || exact.length ? exact : studyBankTopics(trail, { topic })
}

/**
 * Makes one exam question for each ready topic of the report, through the bank builder (perTopic 1, and
 * subtopics off so the builder does not split it). A question that passes joins the bank; one that fails
 * locks the topic ('travado') with its reason, saved on top of the stored report at once. A model or bank
 * stop leaves the topic ready to retry.
 */
export async function proveReadyTopics(
  trail: StudyTrail,
  report: StudyReadiness,
  deps: { build: Parameters<typeof buildStudyBank>[1]; store: StudyReadinessStore },
  signal?: AbortSignal,
): Promise<{ report: StudyReadiness; stop?: StudyBankStop; message?: string }> {
  let current = report
  const scope = studyBankTopics(trail, { discipline: report.discipline })
  for (const item of report.topics) {
    if (item.state !== 'pronto') continue
    if (signal?.aborted) return { report: current, stop: 'cancelled' }
    // The stored report may be newer than the one given: a topic that a newer check no longer marks ready is not proved.
    const live = deps.store.read()[report.discipline] ?? current
    const candidates = item.id ? scope.filter((t) => t.id === item.id) : scope.filter((t) => t.title === item.topic)
    const [topic] = candidates
    if (candidates.length !== 1 || !topic)
      throw new Error(`O tópico "${item.topic}" não está na trilha, ou está repetido nela. Prepare a disciplina de novo.`)
    const entry = readinessTopicOf(live, topic, scope)
    if (entry?.state !== 'pronto') continue
    // The id picks exactly one topic of the trail (a title can repeat). Subtopics are off: one question per topic.
    const built = await buildStudyBank(
      trail,
      { ...deps.build, subtopics: undefined },
      {
        discipline: report.discipline,
        topic: topic.id ?? topic.label,
        perTopic: 1,
        signal,
      },
    )
    if (built.stop) return { report: current, stop: built.stop, message: built.message }
    const result = built.results[0]
    if (!result || built.results.length !== 1) throw new Error(`O tópico "${item.topic}" não está na trilha, ou está repetido nela.`)
    if (result.added || result.reason === 'complete') continue
    // The bank reports 'little' when the chain could not support a question, which is the 'unsupported' failure.
    const failure: StudyProofFailure = result.reason === 'similar' || result.reason === 'refused' ? result.reason : 'unsupported'
    const topics = live.topics.map((t) => (t === entry ? { ...t, state: 'travado' as const, failure, reason: PROOF_REASON[failure] } : t))
    current = { ...live, topics }
    deps.store.save(current)
  }
  return { report: current }
}

const isReport = (value: unknown): value is StudyReadiness => {
  const r = value as StudyReadiness | null
  return !!r && typeof r.discipline === 'string' && typeof r.builtAt === 'number' && Array.isArray(r.topics)
}

/** The last readiness report of each discipline, in a userData file. Replaced only by a new check of that discipline. */
export class StudyReadinessStore {
  private readonly file: string

  constructor(dataDir: string) {
    this.file = join(dataDir, STUDY_READINESS_FILE)
  }

  read(): Record<string, StudyReadiness> {
    const result = loadJson<Record<string, unknown>>(this.file, {
      valid: (value): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value),
    })
    reportLoad(this.file, result)
    const all = result.status === 'ok' || result.status === 'restored' ? result.data : {}
    return Object.fromEntries(Object.entries(all).filter((pair): pair is [string, StudyReadiness] => isReport(pair[1])))
  }

  save(report: StudyReadiness): void {
    writeJsonAtomic(this.file, { ...this.read(), [report.discipline]: report }, { mode: 0o600 })
  }
}

/** Runs jobs one after another: a check and a book search each read the saved report and write it back. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve()

  run<T>(job: () => Promise<T>): Promise<T> {
    const next = this.tail.then(job)
    this.tail = next.catch(() => undefined)
    return next
  }
}

/** The folder is opened only if the saved report names it: the window asks only for those. */
export function openableFolder(store: StudyReadinessStore, folder: string): string {
  const folders = Object.values(store.read()).flatMap((r) => r.topics.flatMap((t) => t.folders))
  if (!folders.includes(folder)) throw new Error('Essa pasta não está no relatório de prontidão.')
  return folder
}

/**
 * Puts the books on a topic that is not ready, in the report as it is saved now (not as it was before
 * the search, so a check that ran meanwhile is kept). The search runs outside `queue`; only the read and
 * the write of the report run in it, so checks are not held up by the web and model search.
 */
export async function suggestTopicBooks(
  store: StudyReadinessStore,
  discipline: string,
  topic: string,
  search: (topic: StudyReadinessTopic) => Promise<StudyBookSuggestion[]>,
  queue: SerialQueue,
): Promise<StudyReadiness> {
  const before = store.read()[discipline]
  const byId = before?.topics.filter((t) => t.id === topic) ?? []
  const matches = byId.length ? byId : (before?.topics.filter((t) => t.topic === topic) ?? [])
  const [selected] = matches
  if (matches.length !== 1 || !selected)
    throw new Error('Confira a prontidão da disciplina antes de sugerir livros. O tópico não existe ou está repetido.')
  const books = await search(selected)
  return queue.run(async () => {
    const current = store.read()[discipline]
    if (!current) throw new Error('Confira a prontidão da disciplina antes de sugerir livros.')
    const scope = current.topics.map((t) => ({ id: t.id, title: t.topic }))
    const entry = readinessTopicOf(current, { id: selected.id, title: selected.topic }, scope)
    if (!entry) throw new Error('O tópico mudou no relatório de prontidão. Prepare a disciplina de novo antes de sugerir livros.')
    const next = { ...current, topics: current.topics.map((t) => (t === entry && t.state !== 'pronto' ? { ...t, books } : t)) }
    store.save(next)
    return next
  })
}
