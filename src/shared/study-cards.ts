import { createHash } from 'node:crypto'

export const CARD_SECTIONS = ['information', 'examplePractice', 'connections', 'sources'] as const
export type CardSection = (typeof CARD_SECTIONS)[number]

export interface StudyNoteSnapshot {
  id: string
  title: string
  sourceRef: string
  hash: string
  text: string
}

export interface StudyCardSections {
  information: string
  examplePractice: string
  connections: string
  sources: string
  connectionsPending: boolean
  sourcesPending: boolean
}

export interface StudyCardDraft {
  title: string
  sourceSnapshots: StudyNoteSnapshot[]
  sections: StudyCardSections
}

export interface StudyCard {
  id: string
  title: string
  createdAt: string
  physicalWritten: boolean
  sourceSnapshots: StudyNoteSnapshot[]
  sections: StudyCardSections
}

export interface StudyCardSummary {
  id: string
  title: string
  createdAt: string
  physicalWritten: boolean
  sourceRefs: string[]
  connectionsPending: boolean
  sourcesPending: boolean
  originChanged: boolean
}

export interface StudyNotesRead {
  notes: StudyNoteSnapshot[]
  warning?: string
}

export interface StudyCardsRead {
  cards: StudyCardSummary[]
  warning?: string
}

interface CardMetadata {
  id: string
  createdAt: string
  physicalWritten: boolean
  sourceSnapshots: StudyNoteSnapshot[]
}

const CARD_MARKER = /^<!-- agent-office-card:([A-Za-z0-9+/=]+) -->$/m
const SECTION_MARKERS: Record<CardSection, [string, string]> = {
  information: ['<!-- AO-CARD:information -->', '<!-- AO-CARD-END:information -->'],
  examplePractice: ['<!-- AO-CARD:example-practice -->', '<!-- AO-CARD-END:example-practice -->'],
  connections: ['<!-- AO-CARD:connections -->', '<!-- AO-CARD-END:connections -->'],
  sources: ['<!-- AO-CARD:sources -->', '<!-- AO-CARD-END:sources -->'],
}
const SECTION_TITLES: Record<CardSection, string> = {
  information: 'Informação',
  examplePractice: 'Exemplo/Prática',
  connections: 'Conexões',
  sources: 'Fontes',
}

export function studyNoteHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function validateStudyCardDraft(raw: unknown): StudyCardDraft {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Rascunho de cartão inválido.')
  const row = raw as Record<string, unknown>
  if (
    typeof row.title !== 'string' ||
    !row.title.trim() ||
    row.title.length > 200 ||
    /[\r\n\0]/.test(row.title) ||
    unsafeMarkdown(row.title)
  )
    throw new Error('Informe um título de cartão com até 200 caracteres em uma linha.')
  if (!Array.isArray(row.sourceSnapshots) || row.sourceSnapshots.length < 1 || row.sourceSnapshots.length > 20)
    throw new Error('Selecione de uma a vinte notas de estudo.')
  const ids = new Set<string>()
  const sourceSnapshots = row.sourceSnapshots.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Snapshot de nota inválido.')
    const snapshot = item as Record<string, unknown>
    if (
      typeof snapshot.id !== 'string' ||
      !/^sn-[a-z0-9-]{8,150}$/i.test(snapshot.id) ||
      typeof snapshot.title !== 'string' ||
      !snapshot.title.trim() ||
      snapshot.title.length > 300 ||
      typeof snapshot.sourceRef !== 'string' ||
      !snapshot.sourceRef.trim() ||
      snapshot.sourceRef.length > 1000 ||
      typeof snapshot.text !== 'string' ||
      !snapshot.text.trim() ||
      snapshot.text.length > 20_000 ||
      typeof snapshot.hash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(snapshot.hash) ||
      studyNoteHash(snapshot.text) !== snapshot.hash
    )
      throw new Error('Snapshot de nota inválido ou alterado.')
    if (ids.has(snapshot.id)) throw new Error('Uma nota foi selecionada mais de uma vez.')
    ids.add(snapshot.id)
    return { id: snapshot.id, title: snapshot.title.trim(), sourceRef: snapshot.sourceRef.trim(), hash: snapshot.hash, text: snapshot.text }
  })
  if (!row.sections || typeof row.sections !== 'object' || Array.isArray(row.sections))
    throw new Error('As seções do cartão estão inválidas.')
  const rawSections = row.sections as Record<string, unknown>
  const sections = {} as StudyCardSections
  for (const section of CARD_SECTIONS) {
    const value = rawSections[section]
    if (
      typeof value !== 'string' ||
      value.length > 20_000 ||
      value.includes('\0') ||
      unsafeMarkdown(value) ||
      /<!--\s*(?:agent-office-card|AO-CARD)/i.test(value)
    )
      throw new Error(`A seção ${section} é inválida.`)
    sections[section] = value.trim()
  }
  if (typeof rawSections.connectionsPending !== 'boolean' || typeof rawSections.sourcesPending !== 'boolean')
    throw new Error('O estado das conexões e fontes está inválido.')
  sections.connectionsPending = rawSections.connectionsPending
  sections.sourcesPending = rawSections.sourcesPending
  if (!sections.information || !sections.examplePractice) throw new Error('Preencha Informação e Exemplo/Prática antes de salvar.')
  return { title: row.title.trim(), sourceSnapshots, sections }
}

export function encodeStudyCard(raw: StudyCard): string {
  const draft = validateStudyCardDraft({ title: raw.title, sourceSnapshots: raw.sourceSnapshots, sections: raw.sections })
  if (!/^c-[a-z0-9-]{8,80}$/i.test(raw.id) || !Number.isFinite(Date.parse(raw.createdAt)) || typeof raw.physicalWritten !== 'boolean')
    throw new Error('Metadados do cartão inválidos.')
  const metadata: CardMetadata = {
    id: raw.id,
    createdAt: new Date(raw.createdAt).toISOString(),
    physicalWritten: raw.physicalWritten,
    sourceSnapshots: draft.sourceSnapshots,
  }
  const marker = Buffer.from(JSON.stringify(metadata), 'utf8').toString('base64')
  const body = CARD_SECTIONS.map((section) => {
    const [start, end] = SECTION_MARKERS[section]
    const contents = [
      draft.sections[section],
      ...(section === 'sources'
        ? draft.sourceSnapshots
            .filter((snapshot) => !draft.sections.sources.includes(snapshot.sourceRef))
            .map((snapshot) => `- ${codeSpan(snapshot.title)} — ${codeSpan(snapshot.sourceRef)}`)
        : []),
      ...(section === 'connections' && draft.sections.connectionsPending ? ['> Revisão pendente: confirmar conexões.'] : []),
      ...(section === 'sources' && draft.sections.sourcesPending ? ['> Revisão pendente: confirmar fontes.'] : []),
    ]
      .filter(Boolean)
      .join('\n')
    return `## ${SECTION_TITLES[section]}\n${start}\n${contents}\n${end}`
  }).join('\n\n')
  const snapshots = draft.sourceSnapshots
    .map((snapshot) => {
      const fence = snapshotFence(snapshot.text)
      return `### ${escapeHeading(snapshot.title)}\n${fence}\n${snapshot.text}\n${fence}`
    })
    .join('\n\n')
  return [
    `<!-- agent-office-card:${marker} -->`,
    `<!-- agent-office-card-pending:connections=${draft.sections.connectionsPending},sources=${draft.sections.sourcesPending} -->`,
    `# ${escapeHeading(draft.title)}`,
    '',
    body,
    '',
    '## Snapshots originais das notas',
    '',
    snapshots,
    '',
  ].join('\n')
}

export function decodeStudyCard(markdown: string): StudyCard {
  const marker = CARD_MARKER.exec(markdown)
  if (!marker) throw new Error('O arquivo não contém metadados de cartão do Agent Office.')
  let metadata: unknown
  try {
    metadata = JSON.parse(Buffer.from(marker[1]!, 'base64').toString('utf8'))
  } catch {
    throw new Error('Os metadados do cartão estão inválidos.')
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Os metadados do cartão estão inválidos.')
  const meta = metadata as Record<string, unknown>
  const rawTitle = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim()
  const title = rawTitle ? unescapeHeading(rawTitle) : undefined
  if (
    typeof meta.id !== 'string' ||
    !/^c-[a-z0-9-]{8,80}$/i.test(meta.id) ||
    typeof meta.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(meta.createdAt)) ||
    new Date(meta.createdAt).toISOString() !== meta.createdAt ||
    typeof meta.physicalWritten !== 'boolean' ||
    !title
  )
    throw new Error('Os metadados do cartão estão incompletos.')
  const sections = {} as StudyCardSections
  const metadataSources = meta.sourceSnapshots
  if (!Array.isArray(metadataSources)) throw new Error('As fontes do cartão estão inválidas.')
  const pending = /^<!-- agent-office-card-pending:connections=(true|false),sources=(true|false) -->$/m.exec(markdown)
  const connectionsPending = pending?.[1] === 'true'
  const sourcesPending = pending?.[2] === 'true'
  for (const section of CARD_SECTIONS) {
    const [start, end] = SECTION_MARKERS[section]
    const escapedStart = escapeRegex(start)
    const escapedEnd = escapeRegex(end)
    const match = new RegExp(`${escapedStart}\\r?\\n([\\s\\S]*?)\\r?\\n${escapedEnd}`).exec(markdown)
    if (!match) throw new Error(`Falta a seção ${section} no cartão.`)
    const generatedMarkers = new Set([
      ...(section === 'connections' && connectionsPending ? ['> Revisão pendente: confirmar conexões.'] : []),
      ...(section === 'sources' && sourcesPending ? ['> Revisão pendente: confirmar fontes.'] : []),
    ])
    sections[section] = match[1]!
      .split('\n')
      .filter((line) => !generatedMarkers.has(line.trim()))
      .join('\n')
      .trim()
  }
  const snapshots = metadataSources as StudyNoteSnapshot[]
  const automaticReferences = new Set(snapshots.map((snapshot) => `- ${codeSpan(snapshot.title)} — ${codeSpan(snapshot.sourceRef)}`))
  sections.sources = sections.sources
    .split('\n')
    .filter((line) => !automaticReferences.has(line.trim()))
    .join('\n')
    .trim()
  sections.connectionsPending = connectionsPending
  sections.sourcesPending = sourcesPending
  const validated = validateStudyCardDraft({ title, sourceSnapshots: metadataSources, sections })
  return {
    id: meta.id,
    title: validated.title,
    createdAt: meta.createdAt,
    physicalWritten: meta.physicalWritten,
    sourceSnapshots: validated.sourceSnapshots,
    sections: validated.sections,
  }
}

export function setCardPhysicalWritten(markdown: string, written: boolean): string {
  const marker = CARD_MARKER.exec(markdown)
  if (!marker) throw new Error('O arquivo não contém metadados de cartão do Agent Office.')
  let meta: Record<string, unknown>
  try {
    meta = JSON.parse(Buffer.from(marker[1]!, 'base64').toString('utf8')) as Record<string, unknown>
  } catch {
    throw new Error('Os metadados do cartão estão inválidos.')
  }
  if (!meta || typeof meta !== 'object' || typeof meta.id !== 'string' || typeof meta.physicalWritten !== 'boolean')
    throw new Error('Os metadados do cartão estão incompletos.')
  meta.physicalWritten = written
  const next = Buffer.from(JSON.stringify(meta), 'utf8').toString('base64')
  return markdown.replace(marker[0], `<!-- agent-office-card:${next} -->`)
}

export function studyCardSummary(card: StudyCard, currentNotes: ReadonlyMap<string, string>): StudyCardSummary {
  return {
    id: card.id,
    title: card.title,
    createdAt: card.createdAt,
    physicalWritten: card.physicalWritten,
    sourceRefs: card.sourceSnapshots.map((snapshot) => snapshot.sourceRef),
    connectionsPending: card.sections.connectionsPending,
    sourcesPending: card.sections.sourcesPending,
    originChanged: card.sourceSnapshots.some((snapshot) => currentNotes.get(snapshot.id) !== snapshot.hash),
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function snapshotFence(text: string): string {
  let length = 3
  while (text.includes('`'.repeat(length))) length++
  return '`'.repeat(length)
}

function unsafeMarkdown(text: string): boolean {
  return /<\s*\/?[a-z][^>]*>/i.test(text) || /\bon[a-z]{3,}\s*=/i.test(text) || /\]\s*\(\s*(?:javascript|data|vbscript):/i.test(text)
}

function codeSpan(text: string): string {
  let fence = '`'
  while (text.includes(fence)) fence += '`'
  return `${fence}${text}${fence}`
}

function escapeHeading(text: string): string {
  return text.replace(/[\\`*_{}\x5B\x5D()#+.!<>|]/g, '\\$&')
}

function unescapeHeading(text: string): string {
  return text.replace(/\\([\\`*_{}\x5B\x5D()#+.!<>|])/g, '$1')
}
