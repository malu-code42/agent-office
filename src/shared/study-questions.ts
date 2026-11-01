export type StudyOriginKind = 'enem' | 'concurso' | 'livro' | 'web' | 'ia'
export type AnswerStatus = 'verified' | 'unverified' | 'missing'
export type StudySourceVisibility = 'public' | 'private' | 'local' | 'unknown'

export interface StudyQuestion {
  id: string
  topic: string
  tags: string[]
  /** Text the question refers to ("segundo o texto…"); shown before the statement. Several questions may share it. */
  passage?: string
  question: string
  /** Multiple choice: the lettered alternatives, in order. `answer` is then the correct letter. */
  options?: string[]
  answer?: string
  rationale?: string
  answerStatus: AnswerStatus
  originKind: StudyOriginKind
  sourceTitle: string
  sourceVisibility: StudySourceVisibility
  sourceUrl?: string
  sourceReference?: string
  attribution: string
  license: string
  sourceOnly?: true
  verifiedByUser?: true
  verifiedAt?: string
}

export interface DecodedStudyBank {
  questions: StudyQuestion[]
  /** Non-record lines are kept verbatim (excluding blank separators) so readers can inspect them safely. */
  unknownLines: string[]
}

export const STUDY_QUESTION_LIMITS = { count: 100, text: 20_000, tags: 20, tag: 80, options: 6, option: 2000 } as const

export const studyOptionLetter = (index: number): string => String.fromCharCode(65 + index)

/** What the Tutor (and any reader) sees as the question: passage, statement and lettered alternatives. */
export function studyQuestionText(q: Pick<StudyQuestion, 'passage' | 'question' | 'options'>): string {
  const options = (q.options ?? []).map((option, index) => `${studyOptionLetter(index)}) ${option}`).join('\n')
  return [q.passage ? `Trecho:\n${q.passage}` : '', q.question, options].filter(Boolean).join('\n\n')
}
export const STUDY_BANK_LINE_LIMIT = 20_000
export const STUDY_BANK_LINE_BYTES = 30_000
const ORIGINS: readonly StudyOriginKind[] = ['enem', 'concurso', 'livro', 'web', 'ia']
const ANSWER_STATUSES: readonly AnswerStatus[] = ['verified', 'unverified', 'missing']
const VISIBILITY: readonly StudySourceVisibility[] = ['public', 'private', 'local', 'unknown']
const RANK: Record<StudyOriginKind, number> = { enem: 0, concurso: 1, livro: 2, web: 3, ia: 4 }
const RECORD_START = '### Questão: '

function cleanLine(value: string, label: string, max: number = STUDY_QUESTION_LIMITS.text): string {
  const text = value.trim()
  if (!text || text.length > max || /[\r\n]/.test(text) || text.includes('\0')) throw new Error(`${label} inválido.`)
  return text
}

export function isSafeStudyUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !!url.hostname && !url.username && !url.password
  } catch {
    return false
  }
}

/** Like cleanLine, but line breaks are allowed: a passage can be several lines when each one carries data the question needs. */
function cleanPassage(value: string): string {
  const text = value.replace(/\r\n?/g, '\n').trim()
  if (!text || text.length > STUDY_QUESTION_LIMITS.text || text.includes('\0')) throw new Error('Trecho inválido.')
  return text
}

export function validateStudyQuestion(raw: unknown): StudyQuestion {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Questão inválida.')
  const row = raw as Record<string, unknown>
  const id = typeof row.id === 'string' ? cleanLine(row.id, 'Identificador', 80) : ''
  if (!/^q-[a-z0-9-]{8,72}$/i.test(id)) throw new Error('Identificador de questão inválido.')
  if (!ORIGINS.includes(row.originKind as StudyOriginKind)) throw new Error('Origem da questão inválida.')
  if (!ANSWER_STATUSES.includes(row.answerStatus as AnswerStatus)) throw new Error('Estado do gabarito inválido.')
  if (!VISIBILITY.includes(row.sourceVisibility as StudySourceVisibility)) throw new Error('Visibilidade da fonte inválida.')
  if (!Array.isArray(row.tags) || row.tags.length > STUDY_QUESTION_LIMITS.tags || !row.tags.every((tag) => typeof tag === 'string'))
    throw new Error('Etiquetas inválidas.')
  const tags = row.tags.map((tag) => cleanLine(tag, 'Etiqueta', STUDY_QUESTION_LIMITS.tag))
  const sourceUrl = row.sourceUrl === undefined ? undefined : typeof row.sourceUrl === 'string' ? cleanLine(row.sourceUrl, 'URL', 8192) : ''
  if (sourceUrl && !isSafeStudyUrl(sourceUrl)) throw new Error('URL da fonte inválida; use apenas HTTP ou HTTPS sem credenciais.')
  const answer = row.answer === undefined ? undefined : typeof row.answer === 'string' ? cleanLine(row.answer, 'Gabarito') : ''
  const rationale =
    row.rationale === undefined ? undefined : typeof row.rationale === 'string' ? cleanLine(row.rationale, 'Justificativa') : ''
  const passage = row.passage === undefined ? undefined : typeof row.passage === 'string' ? cleanPassage(row.passage) : ''
  let options: string[] | undefined
  if (row.options !== undefined) {
    if (
      !Array.isArray(row.options) ||
      row.options.length < 2 ||
      row.options.length > STUDY_QUESTION_LIMITS.options ||
      !row.options.every((option) => typeof option === 'string')
    )
      throw new Error('Alternativas inválidas.')
    options = row.options.map((option) => cleanLine(option, 'Alternativa', STUDY_QUESTION_LIMITS.option))
    if (answer && (!/^[A-Z]$/.test(answer) || answer.charCodeAt(0) - 65 >= options.length))
      throw new Error('O gabarito de múltipla escolha deve ser a letra de uma alternativa.')
  }
  const sourceOnly = row.sourceOnly === true
  let question: string
  if (sourceOnly) {
    if (row.question !== undefined && row.question !== '') throw new Error('Um registro somente de metadados não pode conter enunciado.')
    question = ''
  } else if (typeof row.question === 'string') question = cleanLine(row.question, 'Enunciado')
  else throw new Error('Enunciado inválido.')
  if (sourceOnly && (passage || options || answer || rationale || row.answerStatus !== 'missing'))
    throw new Error('Um registro somente de metadados não pode guardar enunciado, resposta, justificativa ou gabarito.')
  const verifiedByUser = row.verifiedByUser === true
  const verifiedAt = typeof row.verifiedAt === 'string' ? cleanLine(row.verifiedAt, 'Data de revisão', 40) : undefined
  if (
    verifiedByUser !== !!verifiedAt ||
    (verifiedAt && (!Number.isFinite(Date.parse(verifiedAt)) || new Date(verifiedAt).toISOString() !== verifiedAt))
  )
    throw new Error('Confirmação de procedência inválida.')
  return {
    id,
    topic: typeof row.topic === 'string' ? cleanLine(row.topic, 'Tópico', 200) : '',
    tags,
    ...(passage ? { passage } : {}),
    question,
    ...(options ? { options } : {}),
    ...(answer ? { answer } : {}),
    ...(rationale ? { rationale } : {}),
    answerStatus: row.answerStatus as AnswerStatus,
    originKind: row.originKind as StudyOriginKind,
    sourceTitle: typeof row.sourceTitle === 'string' ? cleanLine(row.sourceTitle, 'Título da fonte', 300) : '',
    sourceVisibility: row.sourceVisibility as StudySourceVisibility,
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(typeof row.sourceReference === 'string' && row.sourceReference.trim()
      ? { sourceReference: cleanLine(row.sourceReference, 'Referência', 1000) }
      : {}),
    attribution: typeof row.attribution === 'string' ? cleanLine(row.attribution, 'Atribuição', 1000) : '',
    license: typeof row.license === 'string' ? cleanLine(row.license, 'Licença', 300) : '',
    ...(sourceOnly ? { sourceOnly: true as const } : {}),
    ...(verifiedByUser && verifiedAt ? { verifiedByUser: true as const, verifiedAt } : {}),
  }
}

export function encodeStudyQuestion(raw: StudyQuestion): string {
  const q = validateStudyQuestion(raw)
  return [
    `${RECORD_START}${q.id}`,
    `- Tópico: ${q.topic}`,
    `- Etiquetas: ${q.tags.join(', ') || '—'}`,
    `- Origem: ${q.originKind}`,
    `- Fonte: ${q.sourceTitle}`,
    `- Acesso à fonte: ${q.sourceVisibility}`,
    `- URL: ${q.sourceUrl ?? '—'}`,
    `- Referência: ${q.sourceReference ?? '—'}`,
    `- Atribuição: ${q.attribution}`,
    `- Licença: ${q.license}`,
    `- Somente metadados: ${q.sourceOnly ? 'sim' : 'não'}`,
    `- Procedência revisada pela usuária: ${q.verifiedByUser ? `sim — ${q.verifiedAt}` : 'não'}`,
    `- Estado do gabarito: ${q.answerStatus}`,
    `- Trecho: ${q.passage ? passageToLine(q.passage) : '—'}`,
    `- Enunciado: ${q.question}`,
    `- Alternativas: ${q.options ? JSON.stringify(q.options) : '—'}`,
    `- Resposta: ${q.answer ?? '—'}`,
    `- Justificativa: ${q.rationale ?? '—'}`,
    '',
  ].join('\n')
}

/** The bank keeps one field per line, so a passage's line breaks travel as a backslash and n (and a backslash as two). */
function passageToLine(passage: string): string {
  return passage.replaceAll('\\', '\\\\').replaceAll('\n', '\\n')
}

function passageFromLine(line: string): string {
  return line.replace(/\\([\\n])/g, (_, c: string) => (c === 'n' ? '\n' : '\\'))
}

function parseOptions(raw: string, line: number): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error(`Alternativas ilegíveis na questão da linha ${line}.`)
  }
}

export function decodeStudyBank(source: string): DecodedStudyBank {
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/, STUDY_BANK_LINE_LIMIT + 1)
  if (lines.length > STUDY_BANK_LINE_LIMIT) throw new Error('O banco contém linhas demais para ser lido com segurança.')
  const utf8 = new TextEncoder()
  if (lines.some((line) => utf8.encode(line).byteLength > STUDY_BANK_LINE_BYTES))
    throw new Error('Uma linha do banco excede o limite seguro de leitura.')
  const questions: StudyQuestion[] = []
  const unknownLines: string[] = []
  const ids = new Set<string>()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!line.startsWith(RECORD_START)) {
      if (line.trim() && !/^#{1,6}\s/.test(line.trim())) unknownLines.push(line)
      continue
    }
    const id = line.slice(RECORD_START.length).trim()
    if (!/^q-[a-z0-9-]{8,72}$/i.test(id)) throw new Error(`Identificador de questão inválido na linha ${i + 1}.`)
    const fields = new Map<string, string>()
    let end = i + 1
    while (end < lines.length && !lines[end]!.startsWith(RECORD_START) && lines[end]!.trim()) {
      const field = /^- ([^:]+):\s?(.*)$/.exec(lines[end]!)
      if (field) {
        if (fields.has(field[1]!)) throw new Error(`Campo duplicado na linha ${end + 1}.`)
        fields.set(field[1]!, field[2]!)
      } else unknownLines.push(lines[end]!)
      end++
    }
    const get = (name: string) => fields.get(name)
    const tags = (get('Etiquetas') ?? '')
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag && tag !== '—')
    const answer = get('Resposta')
    const rationale = get('Justificativa')
    const sourceUrl = get('URL')
    const sourceReference = get('Referência')
    const sourceOnly = get('Somente metadados') === 'sim'
    const passage = get('Trecho')
    const optionsRaw = get('Alternativas')
    const verification = get('Procedência revisada pela usuária')
    const verificationDate = verification?.startsWith('sim — ') ? verification.slice('sim — '.length) : undefined
    const question = validateStudyQuestion({
      id,
      topic: get('Tópico'),
      tags,
      ...(passage && passage !== '—' ? { passage: passageFromLine(passage) } : {}),
      question: get('Enunciado'),
      ...(optionsRaw && optionsRaw !== '—' ? { options: parseOptions(optionsRaw, i + 1) } : {}),
      ...(answer && answer !== '—' ? { answer } : {}),
      ...(rationale && rationale !== '—' ? { rationale } : {}),
      answerStatus: get('Estado do gabarito'),
      originKind: get('Origem'),
      sourceTitle: get('Fonte'),
      sourceVisibility: get('Acesso à fonte'),
      ...(sourceUrl && sourceUrl !== '—' ? { sourceUrl } : {}),
      ...(sourceReference && sourceReference !== '—' ? { sourceReference } : {}),
      attribution: get('Atribuição'),
      license: get('Licença'),
      ...(sourceOnly ? { sourceOnly: true } : {}),
      ...(verificationDate ? { verifiedByUser: true, verifiedAt: verificationDate } : {}),
    })
    if (ids.has(question.id)) throw new Error(`Identificador duplicado: ${question.id}.`)
    ids.add(question.id)
    questions.push(question)
    i = end - 1
    if (questions.length > STUDY_QUESTION_LIMITS.count) throw new Error('O banco excede o limite de questões legíveis.')
  }
  return { questions, unknownLines }
}

export function rankStudyQuestions<T extends StudyQuestion>(questions: readonly T[]): T[] {
  return questions
    .map((question, index) => ({ question, index }))
    .sort((a, b) => RANK[a.question.originKind] - RANK[b.question.originKind] || a.index - b.index)
    .map(({ question }) => question)
}

export function findDuplicateStudyQuestion(candidate: StudyQuestion, existing: readonly StudyQuestion[]): StudyQuestion | undefined {
  const normalize = (text: string) => text.toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim()
  if (candidate.sourceOnly) {
    return existing.find(
      (row) =>
        row.id === candidate.id ||
        (row.sourceOnly &&
          row.sourceTitle === candidate.sourceTitle &&
          (row.sourceUrl ?? row.sourceReference) === (candidate.sourceUrl ?? candidate.sourceReference)),
    )
  }
  const key = normalize(candidate.question)
  return existing.find((row) => row.id === candidate.id || (!row.sourceOnly && normalize(row.question) === key))
}
