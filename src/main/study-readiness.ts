import { join } from 'node:path'
import { disciplineIdOf, studyBankFolders, type StudyBookSuggestion } from '@shared/study-bank'
import type { StudyLibraryHit, StudySourceInfo } from '@shared/study-library'
import type { StudySubtopics } from '@shared/study-outline'
import type { StudyReadiness, StudyReadinessTopic } from '@shared/study-readiness'
import type { StudyTrail } from '@shared/study-trail'
import { studyBankTopics } from './study-bank-builder'
import { loadJson, reportLoad, writeJsonAtomic } from './fs-safe'

export const STUDY_READINESS_FILE = 'study-readiness.json'
/** Fewer passages than this and the bank would make only a handful of questions from the topic. */
const MIN_PASSAGES = 3
const NAME_ONLY = /O nome corresponde|Encontrado pelo nome/

interface Deps {
  library: {
    search(query: string, scope?: readonly string[]): Promise<{ hits: StudyLibraryHit[] }>
    inventory(verify?: boolean): Promise<{ sources: StudySourceInfo[] }>
  }
  subtopics: { get(topic: string): StudySubtopics | undefined }
  /** Textbooks on the web for a topic with no passage; a failure just means no suggestion. */
  suggestBooks?: (topic: string, discipline: string) => Promise<StudyBookSuggestion[]>
}

/**
 * The state of each topic of a discipline, read from its own books only (the discipline's folders
 * under textbooks). A PDF with no selectable text is not indexed: a topic it would have covered is
 * "precisa-ocr". Subtopics are read from the store, never built here.
 */
export async function checkDisciplineReadiness(trail: StudyTrail, discipline: string, deps: Deps, now = Date.now()): Promise<StudyReadiness> {
  const topics = studyBankTopics(trail, { discipline })
  if (!topics.length) throw new Error('Nenhum tópico da trilha corresponde à disciplina.')
  // Verified, not background: a PDF still being read would look like one with no passages.
  const { sources } = await deps.library.inventory(true)
  const out: StudyReadinessTopic[] = []
  for (const topic of topics) {
    const { folders } = studyBankFolders(disciplineIdOf(topic.id), topic.discipline)
    const hits = (await deps.library.search(topic.title, folders)).hits.filter((hit) => !NAME_ONLY.test(hit.excerpt))
    const scanned = sources.filter((s) => s.scanned && folders.some((f) => s.path.startsWith(f))).map((s) => s.name)
    const base = { id: topic.id, topic: topic.title, folders: [...folders] }
    if (!hits.length && scanned.length) {
      out.push({ ...base, state: 'precisa-ocr', reason: `Sem texto selecionável: ${scanned.join(', ')}. Precisa de OCR, que o app não faz; coloque um PDF com texto.` })
    } else if (!hits.length) {
      const books = deps.suggestBooks ? await suggest(deps.suggestBooks, topic.title, topic.discipline) : []
      out.push({ ...base, state: 'sem-fonte', reason: `Nenhum trecho sobre "${topic.title}" nos livros da pasta.`, ...(books.length ? { books } : {}) })
    } else if (hits.length < MIN_PASSAGES) {
      out.push({ ...base, state: 'poucos-trechos', reason: `Só ${hits.length} trecho(s) sobre "${topic.title}" nos livros da pasta; são necessários ${MIN_PASSAGES}.` })
    } else {
      const entry = deps.subtopics.get(topic.title)
      if (entry?.status === 'ok') out.push({ ...base, state: 'pronto', reason: `${hits.length} trechos e ${entry.subtopics.length} subtemas.` })
      else out.push({ ...base, state: 'sem-subtemas', reason: entry?.reason ?? 'Os subtemas ainda não foram montados.' })
    }
  }
  return { discipline, builtAt: now, topics: out }
}

async function suggest(fn: NonNullable<Deps['suggestBooks']>, topic: string, discipline: string): Promise<StudyBookSuggestion[]> {
  try {
    return await fn(topic, discipline)
  } catch {
    return []
  }
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
