export type RewriteKind = 'task' | 'untouched' | 'ambiguous'

export type RewriteLine = {
  line: number
  section: string | null
  before: string
  after: string | null
  kind: RewriteKind
  /** Números das regras aprovadas que mudaram esta linha; a prévia os conta por regra. */
  rules: number[]
  /** Hora original removida por não haver data na linha; a prévia lista cada uma. */
  droppedTime?: string
  note?: string
}

export type RewriteAmbiguity = { line: number; before: string; question: string }

export type RewritePreview = { lines: RewriteLine[]; ambiguous: RewriteAmbiguity[] }

type TaskRewrite = { fields: string; closing: string; problems: string[]; rules: number[]; droppedTime?: string; note?: string }

const TASK_RE = /^(\s*)- \[( |x|-)\] (.*)$/
const HEADING_RE = /^##\s+(.+?)\s*$/
const DATE_RE = /^\d{2}\.\d{2}(?:\.\d{4})?$/
const DATE_IN_TEXT_RE = /(?<!\d)(?<!\d\.)\d{2}\.\d{2}(?:\.\d{4})?(?!\d)(?!\.\d)/g
const BOLD_DATE_RE = /^\*\*(\d{2}\.\d{2}(?:\.\d{4})?)\*\*$/
const BOLD_AREA_RE = /^\*\*(.+)\*\*$/
const TIME_RE = /^\d{1,2}:\d{2}$/
const BLOCK_ID_RE = /^t[a-z0-9]{6}$/
const CLOSING_MARK_RE = /[✅❌]\s*$/
const MOTIVE_RE = /^\s*—\s*(.+)$/
const ARCHIVE = 'Archive'
const YEAR = '2026'

/**
 * Prevê a reescrita de tarefas.md para `- [ ] data | hora | lista | tarefa ^tXXXXXX`.
 * Função pura: não grava nada. `ids` devolve identificadores `tXXXXXX` (sem `^`).
 */
export function previewRewrite(content: string, ids: () => string): RewritePreview {
  const used = new Set<string>()
  for (const match of content.matchAll(/\^(t[a-z0-9]{6})\b/g)) used.add(match[1] ?? '')

  const lines: RewriteLine[] = []
  const ambiguous: RewriteAmbiguity[] = []
  let section: string | null = null

  content.split(/\r?\n/).forEach((before, index) => {
    const line = index + 1
    const task = TASK_RE.exec(before)
    if (!task) {
      const heading = HEADING_RE.exec(before)
      if (heading) section = heading[1] ?? null
      lines.push({ line, section, before, after: before, kind: 'untouched', rules: [] })
      return
    }

    const [, indent = '', mark = ' ', body = ''] = task
    const rewrite = rewriteTask(mark, body, section, indent !== '')
    if (rewrite.problems.length > 0) {
      const question = rewrite.problems.join(' ')
      ambiguous.push({ line, before, question })
      lines.push({ line, section, before, after: null, kind: 'ambiguous', rules: rewrite.rules, note: question })
      return
    }

    const id = nextId(ids, used)
    const closing = rewrite.closing ? ` ${rewrite.closing}` : ''
    lines.push({
      line,
      section,
      before,
      after: `${indent}- [${mark}] ${rewrite.fields}${closing} ^${id}`,
      kind: 'task',
      rules: [...rewrite.rules, ...(rewrite.droppedTime ? [13] : []), 11],
      droppedTime: rewrite.droppedTime,
      note: rewrite.note,
    })
  })

  return { lines, ambiguous }
}

function rewriteTask(mark: string, body: string, section: string | null, indented: boolean): TaskRewrite {
  const problems: string[] = []
  const notes: string[] = []
  const rules: number[] = []
  if (/\^t[a-z0-9]{6}\b/.test(body)) problems.push('A linha já tem identificador de bloco; não sobrescrevo.')
  if ([...body.matchAll(DATE_IN_TEXT_RE)].some((date) => date[0].length === 5)) rules.push(1)

  const closes = mark === 'x' || mark === '-'
  const parts = body.split('|').map((part) => part.trim())
  if (parts.some((part) => BOLD_DATE_RE.test(part))) rules.push(12)
  let text = parts.map((part) => BOLD_DATE_RE.exec(part)?.[1] ?? part).join(' | ')

  let closing = ''
  const dates = [...text.matchAll(DATE_IN_TEXT_RE)]
  if (closes && dates.length > 1) {
    const list = dates.map((date) => date[0]).join(', ')
    const kind = mark === 'x' ? 'concluída' : 'descartada'
    const meaning = mark === 'x' ? 'conclusão' : 'descarte'
    problems.push(`Há ${dates.length} datas (${list}) numa tarefa ${kind}; qual é a data de ${meaning}?`)
    rules.push(4)
  } else if (closes && dates.length === 1) {
    const [only] = dates
    const start = only?.index ?? 0
    const end = start + (only?.[0].length ?? 0)
    const marker = CLOSING_MARK_RE.exec(text.slice(0, start))
    const cut = marker?.index ?? start
    const reason = mark === '-' && marker ? MOTIVE_RE.exec(text.slice(end)) : null
    const date = normalizeDate(only?.[0] ?? '')
    closing = mark === 'x' ? `✅ ${date}` : `❌ ${date}${reason ? ` — ${reason[1]?.trim().replaceAll('|', '-') ?? ''}` : ''}`
    text = reason ? text.slice(0, cut) : text.slice(0, cut) + text.slice(end)
    rules.push(mark === 'x' ? 2 : 9)
    if (mark === '-' && !reason) notes.push('descarte sem motivo')
  } else if (closes && dates.length === 0) {
    rules.push(mark === 'x' ? 3 : 9)
  }

  const fieldParts = text
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part !== '')
  let date: string | undefined
  let time: string | undefined
  const [first] = fieldParts
  if (first !== undefined && DATE_RE.test(first)) {
    date = normalizeDate(first)
    fieldParts.shift()
  }
  const [rawTime] = fieldParts
  let droppedTime: string | undefined
  if (rawTime !== undefined && TIME_RE.test(rawTime)) {
    fieldParts.shift()
    if (date) {
      time = normalizeTime(rawTime)
      if (time !== rawTime) notes.push(`hora ${rawTime} escrita como ${time}`)
    } else {
      droppedTime = rawTime
      notes.push(`hora ${rawTime} removida (sem data)`)
    }
  }

  const defaultList = closes && !indented ? ARCHIVE : section
  let lista: string | null = defaultList
  let title = fieldParts.join(' - ')
  const area = fieldParts.length === 2 ? unboldArea(fieldParts[0] ?? '') : null
  if (area && wordCount(area) <= 3) {
    lista = area
    title = fieldParts[1] ?? ''
    if (area !== fieldParts[0]) rules.push(12)
  } else {
    if (fieldParts.length === 2) rules.push(7)
    if (fieldParts.length >= 3) rules.push(6)
    if (indented) rules.push(8)
    if (closes && !indented) rules.push(5)
  }

  if (!title) problems.push('A linha não tem texto de tarefa.')
  if (!lista) problems.push('A linha está antes da primeira seção.')

  const fields = [date, time, lista, title.replace(DATE_IN_TEXT_RE, normalizeDate)].filter((field): field is string => Boolean(field))
  return {
    fields: fields.join(' | '),
    closing,
    problems,
    rules: [...new Set(rules)],
    droppedTime,
    note: notes.length > 0 ? notes.join('; ') : undefined,
  }
}

function normalizeDate(value: string): string {
  return value.length === 5 ? `${value}.${YEAR}` : value
}

function unboldArea(value: string): string {
  return value.replace(BOLD_AREA_RE, '$1').trim()
}

function wordCount(value: string): number {
  return value.split(/\s+/).filter(Boolean).length
}

function normalizeTime(value: string): string {
  const [hour = '', minute = ''] = value.split(':')
  return `${hour.padStart(2, '0')}:${minute}`
}

function nextId(ids: () => string, used: Set<string>): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const id = ids()
    if (BLOCK_ID_RE.test(id) && !used.has(id)) {
      used.add(id)
      return id
    }
  }
  throw new Error('Não foi possível gerar um identificador de bloco único.')
}
