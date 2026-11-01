import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, opendirSync, readSync, realpathSync, unlinkSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import {
  decodeStudyBank,
  isChoiceQuestion,
  encodeStudyQuestion,
  findDuplicateStudyQuestion,
  rankStudyQuestions,
  STUDY_QUESTION_LIMITS,
  validateStudyQuestion,
  type StudyQuestion,
} from '@shared/study-questions'
import { writeFileAtomic, writeFileAtomicChecked } from './fs-safe'
import { PdfTextCache, type PdfExtractor, type PdfOcrJob } from './study-pdf'

export const STUDY_BANK_FILE = 'questoes-estudo.md'
export const STUDY_SOURCES_DIRECTORY = 'study sources'
export const STUDY_BANK_BYTE_LIMIT = 8 * 1024 * 1024
const MAX_CANDIDATES = 100

/** Errors the bank builder tells apart: the bank is full, or it changed in Obsidian during the write. */
const RECORD_START = '### Questão: '
const bankError = (code: 'full' | 'changed', message: string): Error => Object.assign(new Error(message), { code })
const SOURCE_FILE_LIMIT = 50
const SOURCE_PATH_COUNT_LIMIT = 500
const SOURCE_METADATA_SCAN_LIMIT = 250
const SOURCE_HEADER_BYTE_LIMIT = 16 * 1024
const SOURCE_FILE_BYTE_LIMIT = 512 * 1024
const SOURCE_TOTAL_BYTE_LIMIT = 4 * 1024 * 1024
const SOURCE_QUESTION_LIMIT_PER_FILE = 20
const SOURCE_EXTENSIONS = new Set(['.md', '.txt', '.pdf'])
/** A PDF weighs images and fonts on disk; its extracted text goes through the text limits. */
const SOURCE_PDF_BYTE_LIMIT = 64 * 1024 * 1024
/** How long one search waits for PDFs never parsed before; the rest are read in the background. */
const PDF_COLD_BUDGET_MS = 15_000
// This exact-label allowlist only controls whether a short excerpt candidate can be shown.
// It never marks a source or rights as verified; the user must still confirm before persistence.
const RECOGNIZED_LICENSE_LABELS = new Set([
  'cc by 4.0',
  'cc by 3.0',
  'cc by-sa 4.0',
  'cc by-sa 3.0',
  'cc by-nc 4.0',
  'cc by-nc-sa 4.0',
  'cc0 1.0 universal',
  'domínio público',
  'dominio publico',
])
const ORIGIN = /^(enem|concurso|livro)$/i

export type StudySearchStatus = 'found' | 'insufficient' | 'noResults' | 'error' | 'incomplete'

export interface StudySearchResult {
  token: string
  status: StudySearchStatus
  localScanComplete: boolean
  local: StudyQuestion[]
  sourceCandidates: StudyQuestion[]
  web: StudyQuestion[]
  generated: StudyQuestion[]
  canGenerate: boolean
  warning?: string
}

export interface StudySearchProviders {
  webSearch?(query: string, limit: number): Promise<StudyQuestion[]>
  generate?(query: string, limit: number): Promise<StudyQuestion[]>
}

export type CheckedAtomicWrite = (path: string, contents: string, beforeRename: () => void) => void

interface SearchSnapshot {
  query: string
  bankHash: string
  status: StudySearchStatus
  localScanComplete: boolean
  candidates: Map<string, StudyQuestion>
}

interface LocalSourceResult {
  questions: StudyQuestion[]
  warnings: string[]
  complete: boolean
}

interface SourceQuestionSnippet {
  question: string
  passage?: string
  options?: string[]
  topic: string
  tags: string[]
  answer?: string
  rationale?: string
  itemMetadataMatch: boolean
  questionTextMatch: boolean
}

interface SourceQuestionSnippetResult {
  snippets: SourceQuestionSnippet[]
  overflow: boolean
}

/** Main-process access to the canonical bank and bounded, read-only study-source snippets. */
export class StudyQuestionService {
  private readonly vault: string
  private readonly snapshots = new Map<string, SearchSnapshot>()
  private readonly atomicWrite: CheckedAtomicWrite
  private readonly pdf: PdfTextCache

  constructor(
    vault: string,
    private readonly providers: StudySearchProviders = {},
    options: { atomicWrite?: CheckedAtomicWrite; pdfCacheDir?: string; extractPdf?: PdfExtractor; ocrPdf?: (job: PdfOcrJob) => void } = {},
  ) {
    this.vault = resolve(vault)
    this.pdf = new PdfTextCache(options.pdfCacheDir, options.extractPdf, options.ocrPdf)
    this.atomicWrite =
      options.atomicWrite ??
      ((path, contents, beforeRename) => writeFileAtomicChecked(path, contents, beforeRename, `.tmp-${randomUUID()}`))
  }

  read(): { questions: StudyQuestion[]; unknownLines: string[] } {
    return decodeStudyBank(this.readText())
  }

  async search(topic: string, limit = 20): Promise<StudySearchResult> {
    const query = topic.trim()
    if (!query || query.length > 200 || /[\r\n]/.test(query) || query.includes('\0'))
      throw new Error('Informe um tópico de até 200 caracteres.')
    const cap = Math.max(1, Math.min(50, Math.floor(limit)))
    const text = this.readText()
    const bank = decodeStudyBank(text).questions
    const local = rankStudyQuestions(bank.filter((item) => matchesTopic(item, query))).slice(0, cap)
    const sourceResult =
      local.length < cap ? this.readLocalSources(query, await this.readPdfSources()) : { questions: [], warnings: [], complete: true }
    const sourceCandidates = sourceResult.complete ? rankStudyQuestions(sourceResult.questions).slice(0, cap - local.length) : []
    let web: StudyQuestion[] = []
    let status: StudySearchStatus
    let warning = sourceResult.warnings.join(' ')
    let webCompleted = false
    const foundCount = local.length + sourceCandidates.length
    if (!sourceResult.complete) {
      status = 'incomplete'
      warning = [warning, 'Busca local incompleta; refine o tópico ou escolha uma fonte antes de continuar.'].filter(Boolean).join(' ')
    } else if (foundCount >= cap) {
      status = 'found'
    } else if (!this.providers.webSearch) {
      status = foundCount ? 'insufficient' : 'error'
      warning = [warning, 'A busca na web não está disponível nesta instalação.'].filter(Boolean).join(' ')
    } else {
      try {
        const results = await this.providers.webSearch(query, cap - foundCount)
        webCompleted = true
        const webQuestions = results
          .slice(0, cap - foundCount)
          .map(normalizeWebCandidate)
          .filter((row) => !!row.sourceUrl)
        web = webQuestions.flatMap((row) => [row, metadataOnlyVariant(row)])
        status = foundCount + webQuestions.length >= cap ? 'found' : foundCount + webQuestions.length ? 'insufficient' : 'noResults'
      } catch {
        status = 'error'
        warning = [warning, 'A busca na web falhou. Tente novamente; nenhuma questão foi gerada.'].filter(Boolean).join(' ')
      }
    }
    const token = randomUUID()
    const candidates = new Map([...(sourceResult.complete ? sourceCandidates : []), ...web].map((row) => [row.id, row]))
    this.remember(token, { query, bankHash: hash(text), status, localScanComplete: sourceResult.complete, candidates })
    return {
      token,
      status,
      localScanComplete: sourceResult.complete,
      local,
      sourceCandidates,
      web,
      generated: [],
      canGenerate:
        sourceResult.complete && webCompleted && (status === 'insufficient' || status === 'noResults') && !!this.providers.generate,
      ...(warning ? { warning } : {}),
    }
  }

  async generate(token: string): Promise<Pick<StudySearchResult, 'token' | 'status' | 'generated' | 'canGenerate' | 'warning'>> {
    const snapshot = this.snapshots.get(token)
    if (!snapshot || !snapshot.localScanComplete)
      throw new Error('A busca local ficou incompleta. Refine o tópico ou escolha uma fonte antes de gerar questões.')
    if ((snapshot.status !== 'insufficient' && snapshot.status !== 'noResults') || !this.providers.generate)
      throw new Error('A geração só fica disponível depois de uma busca concluída com resultados insuficientes.')
    const remaining = Math.max(1, Math.min(50, MAX_CANDIDATES - snapshot.candidates.size))
    try {
      const generated = (await this.providers.generate(snapshot.query, remaining)).slice(0, remaining).map((row) =>
        validateStudyQuestion({
          ...row,
          originKind: 'ia',
          answerStatus: 'unverified',
          sourceTitle: 'Questão gerada por IA',
          sourceVisibility: 'unknown',
          sourceUrl: undefined,
          sourceReference: undefined,
          sourceOnly: undefined,
          verifiedByUser: undefined,
          verifiedAt: undefined,
          license: 'Gerada por IA — revisar antes de usar',
          attribution: 'Gerada por IA',
        }),
      )
      for (const row of generated) snapshot.candidates.set(row.id, row)
      if (generated.length) snapshot.status = 'found'
      return {
        token,
        status: generated.length ? 'found' : 'noResults',
        generated,
        canGenerate: false,
        ...(!generated.length ? { warning: 'A geração não retornou questões.' } : {}),
      }
    } catch {
      return {
        token,
        status: 'error',
        generated: [],
        canGenerate: true,
        warning: 'Não foi possível gerar questões. Você pode tentar novamente.',
      }
    }
  }

  /**
   * Office saves coordinate through a lock; Obsidian does not honor it. The hash re-read immediately before
   * atomic replace detects edits completed before that check, but ordinary filesystem APIs cannot close the
   * final check-to-rename race against a non-cooperating editor. The exact pre-write snapshot is backed up;
   * neither the lock nor atomic rename guarantees a compare-and-swap with Obsidian.
   */
  save(token: string, selection: unknown[], reviewConfirmed: boolean): void {
    const expected = this.snapshots.get(token)
    this.snapshots.delete(token)
    if (!expected) throw new Error('A busca expirou. Faça a busca novamente antes de salvar.')
    if (!expected.localScanComplete)
      throw new Error('A busca local ficou incompleta. Refine o tópico ou escolha uma fonte antes de salvar candidatas.')
    if (reviewConfirmed !== true) throw new Error('Confirme que revisou a procedência e a licença antes de salvar.')
    if (!Array.isArray(selection) || selection.length < 1 || selection.length > MAX_CANDIDATES)
      throw new Error('Selecione de 1 a 100 questões para salvar.')
    const rows = selection.map(validateStudyQuestion)
    for (const row of rows) {
      const candidate = expected.candidates.get(row.id)
      if (!candidate || JSON.stringify(candidate) !== JSON.stringify(row))
        throw new Error('A seleção contém uma questão que não veio desta busca.')
    }

    const verifiedAt = new Date().toISOString()
    this.commit(
      rows.map((row) => ({ ...row, verifiedByUser: true as const, verifiedAt })),
      expected.bankHash,
    )
  }

  /**
   * Appends questions already checked by the agent chain (study-questions-grounded.ts), without the
   * user's review step; they carry no verifiedByUser. Duplicates of questions in the bank are skipped.
   */
  appendChecked(rows: StudyQuestion[], backup = true): { added: number; skipped: number } {
    return this.commit(rows.map(validateStudyQuestion), undefined, true, backup)
  }

  /**
   * Takes the open questions (not multiple choice) out of the bank file, after a backup of the exact
   * version; every other line stays as it was. Since 2026-11-01 the bank is multiple choice only.
   */
  removeOpenQuestions(): number {
    const path = this.bankPath()
    if (!existsSync(path)) return 0
    const lockPath = `${path}.lock`
    let lock: number
    try {
      lock = openSync(lockPath, 'wx', 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new Error('O banco está sendo salvo em outra operação. Tente novamente.', { cause: error })
      throw error
    }
    try {
      const current = this.readText()
      const baseHash = hash(current)
      const open = new Set(
        decodeStudyBank(current)
          .questions.filter((q) => !isChoiceQuestion(q))
          .map((q) => q.id),
      )
      if (!open.size) return 0
      this.backupExactVersion(current)
      const lines = current.split(/\r?\n/)
      const kept: string[] = []
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!
        const id = line.startsWith(RECORD_START) ? line.slice(RECORD_START.length).trim() : ''
        if (!open.has(id)) {
          kept.push(line)
          continue
        }
        // skip the record up to the blank line that ends it, and that blank line
        while (i + 1 < lines.length && lines[i + 1]!.trim() && !lines[i + 1]!.startsWith(RECORD_START)) i++
        if (i + 1 < lines.length && !lines[i + 1]!.trim()) i++
      }
      this.atomicWrite(path, kept.join('\n'), () => {
        if (hash(this.readText()) !== baseHash)
          throw bankError('changed', 'O banco mudou no Obsidian. A edição externa foi preservada; tente novamente.')
      })
      return open.size
    } finally {
      closeSync(lock)
      unlinkSync(lockPath)
    }
  }

  private commit(rows: StudyQuestion[], expectedHash?: string, skipDuplicates = false, backup = true): { added: number; skipped: number } {
    const path = this.bankPath()
    const lockPath = `${path}.lock`
    let lock: number
    try {
      lock = openSync(lockPath, 'wx', 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new Error('O banco está sendo salvo em outra operação. Tente novamente.', { cause: error })
      throw error
    }
    try {
      const current = this.readText()
      const baseHash = expectedHash ?? hash(current)
      if (hash(current) !== baseHash) throw bankError('changed', 'O banco mudou no Obsidian. Releia as questões antes de salvar.')
      const existing = decodeStudyBank(current).questions
      const accepted: StudyQuestion[] = []
      for (const row of rows) {
        if (findDuplicateStudyQuestion(row, [...existing, ...accepted])) {
          if (skipDuplicates) continue
          throw new Error(`Questão duplicada: ${row.id}.`)
        }
        accepted.push(row)
      }
      if (existing.length + accepted.length > STUDY_QUESTION_LIMITS.count)
        throw bankError('full', `O banco pode conter no máximo ${STUDY_QUESTION_LIMITS.count} questões.`)
      if (!accepted.length) return { added: 0, skipped: rows.length }
      if (backup) this.backupExactVersion(current)
      const prefix = current && !current.endsWith('\n') ? '\n' : ''
      const appended = `${current}${prefix}${accepted.map(encodeStudyQuestion).join('\n')}`
      this.atomicWrite(path, appended, () => {
        if (hash(this.readText()) !== baseHash)
          throw bankError('changed', 'O banco mudou no Obsidian. A edição externa foi preservada; tente novamente.')
      })
      return { added: accepted.length, skipped: rows.length - accepted.length }
    } finally {
      closeSync(lock)
      unlinkSync(lockPath)
    }
  }

  private remember(token: string, snapshot: SearchSnapshot): void {
    this.snapshots.set(token, snapshot)
    if (this.snapshots.size > 20) this.snapshots.delete(this.snapshots.keys().next().value!)
  }

  /**
   * The text of the PDFs at the top of the study sources folder, extracted locally (and cached)
   * before the synchronous scan below reads them like text files. A PDF that fails to parse is
   * left out here and reported by the scan.
   */
  private async readPdfSources(): Promise<Map<string, string | 'pending'>> {
    const texts = new Map<string, string | 'pending'>()
    const deadline = Date.now() + PDF_COLD_BUDGET_MS
    const dir = join(this.vault, STUDY_SOURCES_DIRECTORY)
    let names: string[]
    try {
      const info = lstatSync(dir)
      if (info.isSymbolicLink() || !info.isDirectory()) return texts
      names = []
      const handle = opendirSync(dir)
      try {
        for (let entry = handle.readSync(); entry && names.length <= SOURCE_PATH_COUNT_LIMIT; entry = handle.readSync())
          if (entry.name.toLowerCase().endsWith('.pdf')) names.push(entry.name)
      } finally {
        handle.closeSync()
      }
    } catch {
      return texts
    }
    for (const name of names.sort(compareSourcePath).slice(0, SOURCE_METADATA_SCAN_LIMIT)) {
      const path = join(dir, name)
      try {
        const info = lstatSync(path)
        if (info.isSymbolicLink() || !info.isFile() || info.size > SOURCE_PDF_BYTE_LIMIT) continue
        const pages = await this.pdf.pagesBy(path, info, () => readBytesBounded(path, SOURCE_PDF_BYTE_LIMIT), deadline)
        texts.set(name, pages === 'pending' ? pages : pages.join('\n\n'))
      } catch {
        // Unreadable or protected PDF: the scan reports it as a source it could not read.
      }
    }
    return texts
  }

  private readLocalSources(topic: string, pdfTexts: Map<string, string | 'pending'> = new Map()): LocalSourceResult {
    const dir = join(this.vault, STUDY_SOURCES_DIRECTORY)
    const warnings: string[] = []
    let complete = true
    let entries: string[]
    try {
      const info = lstatSync(dir)
      if (info.isSymbolicLink() || !info.isDirectory())
        return { questions: [], warnings: ['A pasta study sources não é um diretório local seguro.'], complete: false }
      const rootReal = realpathSync(this.vault)
      const sourceReal = realpathSync(dir)
      const rel = relative(rootReal, sourceReal)
      if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`))
        return { questions: [], warnings: ['A pasta study sources aponta para fora do vault e foi ignorada.'], complete: false }
      const handle = opendirSync(dir)
      entries = []
      try {
        for (let entry = handle.readSync(); entry && entries.length <= SOURCE_PATH_COUNT_LIMIT; entry = handle.readSync())
          entries.push(entry.name)
      } finally {
        handle.closeSync()
      }
      entries.sort(compareSourcePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { questions: [], warnings: [], complete: true }
      throw error
    }
    if (entries.length > SOURCE_PATH_COUNT_LIMIT) {
      return {
        questions: [],
        warnings: [
          `A pasta study sources excede o limite seguro de ${SOURCE_PATH_COUNT_LIMIT} caminhos; restrinja ou organize a pasta e tente novamente.`,
          'Busca local incompleta; refine o tópico ou escolha uma fonte antes de continuar.',
        ],
        complete: false,
      }
    }

    const query = topic.toLocaleLowerCase('pt-BR')
    let metadataBytes = 0
    const eligible: {
      name: string
      size: number
      pdfText?: string
      metadata: NonNullable<ReturnType<typeof sourceMetadata>>
      itemMetadataMatch: boolean
      questionTextMatch: boolean
      originRank: number
    }[] = []
    const originRank = { enem: 0, concurso: 1, livro: 2 } as const
    for (const name of entries.slice(0, SOURCE_METADATA_SCAN_LIMIT)) {
      const path = join(dir, name)
      const extension = name.slice(name.lastIndexOf('.')).toLowerCase()
      let info
      try {
        info = lstatSync(path)
      } catch {
        complete = false
        warnings.push(`Fonte alterada durante a busca local: ${basename(name)}.`)
        continue
      }
      if (info.isSymbolicLink() || !info.isFile()) continue
      if (!SOURCE_EXTENSIONS.has(extension)) {
        complete = false
        warnings.push(`Fonte não suportada ignorada: ${basename(name)}.`)
        continue
      }
      const pdfRead = extension === '.pdf' ? pdfTexts.get(name) : undefined
      if (pdfRead === 'pending') {
        complete = false
        warnings.push(`PDF ainda sendo lido pela primeira vez: ${basename(name)}; tente de novo em alguns minutos.`)
        continue
      }
      const pdfText = pdfRead
      if (extension === '.pdf' && pdfText === undefined) {
        complete = false
        warnings.push(`PDF sem texto legível ignorado: ${basename(name)}.`)
        continue
      }
      const size = pdfText !== undefined ? Buffer.byteLength(pdfText, 'utf8') : info.size
      if (size > SOURCE_FILE_BYTE_LIMIT) {
        complete = false
        warnings.push(`Fonte grande demais para busca local: ${basename(name)}.`)
        continue
      }
      if (metadataBytes + Math.min(size, SOURCE_HEADER_BYTE_LIMIT) > SOURCE_TOTAL_BYTE_LIMIT) {
        complete = false
        warnings.push(`Limite de leitura de cabeçalhos atingido; fonte ignorada: ${basename(name)}.`)
        continue
      }
      metadataBytes += Math.min(size, SOURCE_HEADER_BYTE_LIMIT)
      let header: string
      try {
        header = pdfText !== undefined ? pdfText.slice(0, SOURCE_HEADER_BYTE_LIMIT) : readUtf8Prefix(path, SOURCE_HEADER_BYTE_LIMIT)
      } catch {
        complete = false
        warnings.push(`Cabeçalho de fonte inválido ou alterado: ${basename(name)}.`)
        continue
      }
      const metadata = sourceMetadata(header)
      if (!metadata?.origin || !metadata.title) {
        complete = false
        warnings.push(`Fonte sem metadados visíveis confiáveis ignorada: ${basename(name)}.`)
        continue
      }
      const preview = extractRelevantQuestionSnippets(header, query)
      const hasQuestion = header.split(/\r?\n/).some((line) => /^Questão:\s*\S/i.test(line))
      if (!hasQuestion) {
        if (size > SOURCE_HEADER_BYTE_LIMIT) {
          complete = false
          warnings.push(`Busca local parcial: enunciados após o cabeçalho de ${basename(name)} não foram inspecionados.`)
        } else if (metadata.topic?.toLocaleLowerCase('pt-BR').includes(query))
          warnings.push(`Fonte relevante ignorada, sem enunciado extraível: ${basename(name)}.`)
        continue
      }
      if (!preview.snippets.length) {
        if (size > SOURCE_HEADER_BYTE_LIMIT) {
          complete = false
          warnings.push(`Busca local parcial: questões após o cabeçalho de ${basename(name)} não foram inspecionadas.`)
        }
        warnings.push(`Nenhuma questão individual da fonte corresponde ao tópico: ${basename(name)}.`)
        continue
      }
      eligible.push({
        name,
        size,
        pdfText,
        metadata,
        itemMetadataMatch: preview.snippets.some((record) => record.itemMetadataMatch),
        questionTextMatch: preview.snippets.some((record) => record.questionTextMatch),
        originRank: originRank[metadata.origin],
      })
    }
    if (entries.length > SOURCE_METADATA_SCAN_LIMIT) {
      complete = false
      warnings.push(
        `Limite de cabeçalhos locais atingido (${SOURCE_METADATA_SCAN_LIMIT}); refine o tópico ou escolha uma fonte específica.`,
      )
    }

    eligible.sort(
      (a, b) =>
        a.originRank - b.originRank ||
        Number(b.itemMetadataMatch) - Number(a.itemMetadataMatch) ||
        Number(b.questionTextMatch) - Number(a.questionTextMatch) ||
        compareSourcePath(a.name, b.name),
    )
    const rankedFiles = eligible.slice(0, SOURCE_FILE_LIMIT)
    if (eligible.length > SOURCE_FILE_LIMIT) {
      complete = false
      warnings.push(`Limite de conteúdo local atingido (${SOURCE_FILE_LIMIT} arquivos); candidatos priorizados por origem/tópico.`)
    }

    const questions: StudyQuestion[] = []
    let bytesRead = 0
    for (const source of rankedFiles) {
      if (bytesRead + source.size > SOURCE_TOTAL_BYTE_LIMIT) {
        complete = false
        warnings.push(`Limite total de conteúdo local atingido antes de ler ${basename(source.name)}.`)
        continue
      }
      bytesRead += source.size
      const path = join(dir, source.name)
      let text: string
      try {
        text = source.pdfText ?? readUtf8Bounded(path, SOURCE_FILE_BYTE_LIMIT)
      } catch {
        complete = false
        warnings.push(`Fonte alterada ou grande demais para busca local: ${basename(source.name)}.`)
        continue
      }
      const metadata = source.metadata
      const license = metadata.license || 'Não informada'
      const excerptLicenseLabelRecognized = RECOGNIZED_LICENSE_LABELS.has(license.toLocaleLowerCase('pt-BR').trim())
      const snippetResult = extractRelevantQuestionSnippets(text, topic)
      const snippets = snippetResult.snippets
      if (snippets.length === 0) {
        complete = false
        warnings.push(`Nenhuma questão individual da fonte corresponde ao tópico: ${basename(source.name)}.`)
        continue
      }
      if (snippetResult.overflow) {
        complete = false
        warnings.push(
          `Mais de ${SOURCE_QUESTION_LIMIT_PER_FILE} questões correspondem em ${basename(source.name)}; busca local incompleta.`,
        )
      }
      if (metadata.origin === 'livro') {
        questions.push(
          validateStudyQuestion({
            id: `q-${createId(source.name, -1)}`,
            topic: metadata.topic || snippets[0]!.topic || topic,
            tags: [],
            question: '',
            answerStatus: 'missing',
            originKind: 'livro',
            sourceTitle: metadata.title!,
            sourceVisibility: 'local',
            ...(metadata.url && isSafeHttpUrl(metadata.url) ? { sourceUrl: metadata.url } : {}),
            sourceReference: source.name,
            attribution: metadata.attribution || metadata.title!,
            license,
            sourceOnly: true,
          }),
        )
        if (!excerptLicenseLabelRecognized) {
          const url = metadata.url && isSafeHttpUrl(metadata.url) ? metadata.url : 'sem URL pública'
          warnings.push(`Licença de ${metadata.title!.slice(0, 120)} não está clara: somente metadados/URL ${url} disponíveis.`)
        }
      }
      for (const [index, snippet] of snippets.entries()) {
        if (!excerptLicenseLabelRecognized && metadata.origin === 'livro') break
        if (!snippet.question || snippet.question.length > STUDY_QUESTION_LIMITS.text) continue
        try {
          questions.push(
            validateStudyQuestion({
              id: `q-${createId(source.name, index)}`,
              topic: snippet.topic,
              tags: snippet.tags,
              ...(snippet.passage ? { passage: snippet.passage } : {}),
              question: snippet.question,
              ...(snippet.options ? { options: snippet.options } : {}),
              ...(snippet.answer ? { answer: snippet.answer } : {}),
              ...(snippet.rationale ? { rationale: snippet.rationale } : {}),
              answerStatus: 'unverified',
              originKind: metadata.origin,
              sourceTitle: metadata.title!,
              sourceVisibility: 'local',
              ...(metadata.url && isSafeHttpUrl(metadata.url) ? { sourceUrl: metadata.url } : {}),
              sourceReference: source.name,
              attribution: metadata.attribution || metadata.title!,
              license,
            }),
          )
        } catch {
          warnings.push(`Questão inválida ignorada na fonte ${basename(source.name)}.`)
        }
      }
    }
    if (!complete)
      warnings.push('Busca local incompleta por limites de leitura; refine o tópico ou escolha uma fonte antes de gerar questões.')
    return { questions, warnings, complete }
  }

  private backupExactVersion(current: string): void {
    if (!existsSync(this.bankPath())) return
    const backupDir = join(this.vault, '.agent-office-backups')
    if (!existsSync(backupDir)) mkdirSync(backupDir)
    const info = lstatSync(backupDir)
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('A pasta de backup do banco não é segura.')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const path = join(backupDir, `questoes-estudo-${stamp}-${randomUUID().slice(0, 8)}.md`)
    writeFileAtomic(path, current, 0o600, `.tmp-${randomUUID()}`)
  }

  private bankPath(): string {
    return join(this.vault, STUDY_BANK_FILE)
  }

  private readText(): string {
    const path = this.bankPath()
    try {
      const info = lstatSync(path)
      if (info.isSymbolicLink() || !info.isFile())
        throw new Error('O banco de questões precisa ser um arquivo regular, sem link simbólico.')
      if (info.size > STUDY_BANK_BYTE_LIMIT) throw new Error('O banco de questões é grande demais para leitura segura.')
      return readUtf8Bounded(path, STUDY_BANK_BYTE_LIMIT)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
      throw error
    }
  }
}

function readUtf8Bounded(path: string, maxBytes: number): string {
  const fd = openSync(path, 'r')
  try {
    const info = fstatSync(fd)
    if (!info.isFile() || info.size > maxBytes) throw new Error('Arquivo excede o limite de leitura.')
    const buffer = Buffer.allocUnsafe(maxBytes + 1)
    let bytes = 0
    while (bytes <= maxBytes) {
      const count = readSync(fd, buffer, bytes, maxBytes + 1 - bytes, bytes)
      if (count === 0) break
      bytes += count
    }
    if (bytes > maxBytes) throw new Error('Arquivo excede o limite de leitura.')
    const text = buffer.toString('utf8', 0, bytes)
    if (!Buffer.from(text, 'utf8').equals(buffer.subarray(0, bytes))) throw new Error('O arquivo não está codificado em UTF-8 válido.')
    return text
  } finally {
    closeSync(fd)
  }
}

/** The bytes of a file, refusing one larger than `maxBytes`. */
function readBytesBounded(path: string, maxBytes: number): Buffer {
  const fd = openSync(path, 'r')
  try {
    const info = fstatSync(fd)
    if (!info.isFile() || info.size > maxBytes) throw new Error('Arquivo excede o limite de leitura.')
    const buffer = Buffer.allocUnsafe(info.size)
    let bytes = 0
    while (bytes < buffer.length) {
      const count = readSync(fd, buffer, bytes, buffer.length - bytes, bytes)
      if (count === 0) break
      bytes += count
    }
    return buffer.subarray(0, bytes)
  } finally {
    closeSync(fd)
  }
}

function readUtf8Prefix(path: string, maxBytes: number): string {
  const fd = openSync(path, 'r')
  try {
    const info = fstatSync(fd)
    if (!info.isFile()) throw new Error('Arquivo de fonte inválido.')
    const wanted = Math.min(info.size, maxBytes)
    const buffer = Buffer.allocUnsafe(wanted)
    let bytes = 0
    while (bytes < wanted) {
      const count = readSync(fd, buffer, bytes, wanted - bytes, bytes)
      if (count === 0) break
      bytes += count
    }
    return buffer.toString('utf8', 0, bytes)
  } finally {
    closeSync(fd)
  }
}

function sourceMetadata(
  text: string,
): { title?: string; origin?: 'enem' | 'concurso' | 'livro'; license?: string; attribution?: string; url?: string; topic?: string } | null {
  const header = text.split(/\r?\n/).slice(0, 20)
  const fields = new Map<string, string>()
  const maxima: Record<string, number> = { título: 300, origem: 32, licença: 300, atribuição: 1000, url: 8192, tópico: 200 }
  for (const line of header) {
    const match = /^(Título|Origem|Licença|Atribuição|URL|Tópico):\s*(.+)$/i.exec(line.trim())
    const key = match?.[1]?.toLocaleLowerCase('pt-BR')
    if (match && key && match[2]!.length <= maxima[key]!) fields.set(key, match[2]!.trim())
  }
  const origin = fields.get('origem')?.toLocaleLowerCase('pt-BR')
  return {
    title: fields.get('título'),
    ...(origin && ORIGIN.test(origin) ? { origin: origin as 'enem' | 'concurso' | 'livro' } : {}),
    license: fields.get('licença'),
    attribution: fields.get('atribuição'),
    url: fields.get('url'),
    topic: fields.get('tópico'),
  }
}

function matchesTopic(question: StudyQuestion, query: string): boolean {
  return `${question.topic} ${question.tags.join(' ')} ${question.question}`
    .toLocaleLowerCase('pt-BR')
    .includes(query.toLocaleLowerCase('pt-BR'))
}

function extractRelevantQuestionSnippets(text: string, query: string): SourceQuestionSnippetResult {
  const lines = text.split(/\r?\n/)
  const normalizedQuery = query.toLocaleLowerCase('pt-BR').trim()
  const snippets: SourceQuestionSnippet[] = []
  let overflow = false
  for (let index = 0; index < lines.length;) {
    const questionMatch = /^Questão:\s*(.*)$/i.exec(lines[index]!)
    if (!questionMatch) {
      index++
      continue
    }
    const question = questionMatch[1]!.trim()
    index++
    let itemTopic: string | undefined
    let tags: string[] = []
    let answer: string | undefined
    let rationale: string | undefined
    let passage: string | undefined
    const options: string[] = []
    let inPassage = false
    while (index < lines.length && !/^Questão:\s*/i.test(lines[index]!)) {
      const passageMatch = /^Trecho:\s*(.+)$/i.exec(lines[index]!)
      const optionMatch = /^([A-F])[).]\s+(.+)$/.exec(lines[index]!.trim())
      // Letters must come in order (A, B, C…) so stray lines like "B. Brookshear" are not taken as alternatives.
      const isOption = !!optionMatch && optionMatch[1] === String.fromCharCode(65 + options.length)
      const topicMatch = /^(?:Tópico|Tema) da questão:\s*(.+)$/i.exec(lines[index]!)
      const tagsMatch = /^(?:Tags|Etiquetas)(?: da questão)?:\s*(.+)$/i.exec(lines[index]!)
      const answerMatch = /^Gabarito:\s*(.+)$/i.exec(lines[index]!)
      const rationaleMatch = /^(?:Justificativa|Explicação):\s*(.+)$/i.exec(lines[index]!)
      // A passage goes on until a blank line or the next field; its lines are kept because each may carry data the question needs.
      if (inPassage && lines[index]!.trim() && !passageMatch && !isOption && !topicMatch && !tagsMatch && !answerMatch && !rationaleMatch)
        passage += `\n${lines[index]!.trim()}`
      else inPassage = false
      if (!passage && passageMatch) {
        passage = passageMatch[1]!.trim()
        inPassage = true
      }
      if (isOption) options.push(optionMatch![2]!.trim())
      if (!itemTopic && topicMatch) itemTopic = topicMatch[1]!.trim()
      if (tagsMatch)
        tags = tagsMatch[1]!
          .split(/[,;]/)
          .map((tag) => tag.trim())
          .filter(Boolean)
      if (!answer && answerMatch) answer = answerMatch[1]!.trim()
      if (!rationale && rationaleMatch) rationale = rationaleMatch[1]!.trim()
      index++
    }
    if (!question) continue
    const itemMetadataMatch = [itemTopic, ...tags].some((value) => value && hasTopicTerms(value, normalizedQuery))
    const questionTextMatch = hasTopicTerms(question, normalizedQuery)
    if (!itemMetadataMatch && !questionTextMatch) continue
    const matchingTag = tags.find((tag) => hasTopicTerms(tag, normalizedQuery))
    const isChoice = options.length >= 2
    // "Gabarito: B) texto" → "B", so the key matches the lettered alternatives.
    const choiceLetter = isChoice && answer ? /^[A-F](?=[).\s]|$)/.exec(answer)?.[0] : undefined
    snippets.push({
      question,
      ...(passage ? { passage } : {}),
      ...(isChoice ? { options } : {}),
      topic: itemTopic || matchingTag || query,
      tags,
      ...(answer ? { answer: choiceLetter ?? answer } : {}),
      ...(rationale ? { rationale } : {}),
      itemMetadataMatch,
      questionTextMatch,
    })
    if (snippets.length > SOURCE_QUESTION_LIMIT_PER_FILE) {
      overflow = true
      break
    }
  }
  return { snippets: snippets.slice(0, SOURCE_QUESTION_LIMIT_PER_FILE), overflow }
}

function hasTopicTerms(value: string, query: string): boolean {
  const normalize = (text: string) =>
    text
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('pt-BR')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .replace(/\s+/g, ' ')
  const normalizedValue = normalize(value)
  const normalizedQuery = normalize(query)
  return !!normalizedQuery && ` ${normalizedValue} `.includes(` ${normalizedQuery} `)
}

function compareSourcePath(a: string, b: string): number {
  const left = a.replace(/\\/g, '/')
  const right = b.replace(/\\/g, '/')
  return left < right ? -1 : left > right ? 1 : 0
}

function normalizeWebCandidate(raw: StudyQuestion): StudyQuestion {
  return validateStudyQuestion({
    ...raw,
    originKind: 'web',
    answerStatus: 'unverified',
    sourceVisibility: 'unknown',
    attribution: 'Atribuição reportada — conferir na fonte',
    license: 'Não verificada — confirmar na fonte',
    sourceOnly: undefined,
    verifiedByUser: undefined,
    verifiedAt: undefined,
  })
}

function metadataOnlyVariant(source: StudyQuestion): StudyQuestion {
  return validateStudyQuestion({
    ...source,
    id: `q-${createId(source.id, -2)}`,
    question: '',
    answer: undefined,
    rationale: undefined,
    answerStatus: 'missing',
    sourceOnly: true,
    verifiedByUser: undefined,
    verifiedAt: undefined,
  })
}

function hash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function createId(source: string, index: number): string {
  return createHash('sha256').update(`${source}:${index}`).digest('hex').slice(0, 16)
}

function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !!url.hostname && !url.username && !url.password
  } catch {
    return false
  }
}
