export type RewriteKind = 'task' | 'untouched' | 'ambiguous'

export type RewriteLine = {
  line: number
  section: string | null
  before: string
  after: string | null
  kind: RewriteKind
  note?: string
}

export type RewriteAmbiguity = { line: number; before: string; question: string }

export type RewritePreview = { lines: RewriteLine[]; ambiguous: RewriteAmbiguity[] }

type TaskRewrite = { fields: string; closing: string; problems: string[]; note?: string }

const TASK_RE = /^(\s*)- \[( |x|-)\] (.*)$/
const HEADING_RE = /^##\s+(.+?)\s*$/
const DATE_RE = /^\d{2}\.\d{2}(?:\.\d{4})?$/
const TIME_RE = /^\d{1,2}:\d{2}$/
const BLOCK_ID_RE = /^t[a-z0-9]{6}$/
const DONE_RE = /✅\s*(\d{2}\.\d{2}\.\d{4})/
const DISCARD_RE = /❌\s*(\d{2}\.\d{2}\.\d{4})\s*—\s*(.+)$/

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
      lines.push({ line, section, before, after: before, kind: 'untouched' })
      return
    }

    const [, indent = '', mark = ' ', body = ''] = task
    const rewrite = rewriteTask(mark, body, section)
    if (rewrite.problems.length > 0) {
      const question = rewrite.problems.join(' ')
      ambiguous.push({ line, before, question })
      lines.push({ line, section, before, after: null, kind: 'ambiguous', note: question })
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
      note: rewrite.note,
    })
  })

  return { lines, ambiguous }
}

function rewriteTask(mark: string, body: string, section: string | null): TaskRewrite {
  const problems: string[] = []
  const notes: string[] = []
  if (/\^t[a-z0-9]{6}\b/.test(body)) problems.push('A linha já tem identificador de bloco; não sobrescrevo.')

  let text = body
  let closing = ''
  const done = DONE_RE.exec(body)
  const discard = DISCARD_RE.exec(body)
  if (mark === 'x' && done) {
    closing = `✅ ${done[1]}`
    text = body.slice(0, done.index)
  }
  if (mark === '-') {
    if (discard) {
      closing = `❌ ${discard[1]} — ${discard[2]?.trim()}`
      text = body.slice(0, discard.index)
    } else {
      problems.push('Falta a data e o motivo do descarte (❌ DD.MM.AAAA — motivo).')
    }
  }

  const parts = text.split(' | ').map((part) => part.trim())
  const take = (pattern: RegExp): string | undefined => {
    const value = unbold(parts[0] ?? '')
    if (!pattern.test(value)) return undefined
    parts.shift()
    return value
  }
  const date = take(DATE_RE)
  const rawTime = take(TIME_RE)
  const time = rawTime ? normalizeTime(rawTime) : undefined
  if (rawTime && time !== rawTime) notes.push(`hora ${rawTime} escrita como ${time}`)

  let area: string | undefined
  let title = ''
  if (parts.length === 1) {
    title = parts[0] ?? ''
  } else if (parts.length === 2) {
    area = unbold(parts[0] ?? '')
    title = parts[1] ?? ''
  } else if (parts.length > 2) {
    problems.push(`"${text.trim()}" tem mais de um " | " depois da data e da hora; não dá para saber qual parte é a área.`)
  }

  if (area && area.split(/\s+/).length > 3) problems.push(`"${area}" pode ser parte do título, não uma área.`)
  const lista = area ?? section
  if (!lista) problems.push('A linha está antes da primeira seção.')
  if (!title && parts.length < 3) problems.push('A linha não tem texto de tarefa.')

  if (mark === 'x' && !done) {
    problems.push(
      date
        ? `A data ${date} é a conclusão ou o prazo? A linha não tem ✅ DD.MM.AAAA com a data de conclusão.`
        : 'Qual é a data de conclusão? A linha não tem data nem ✅ DD.MM.AAAA.',
    )
  }

  const fields = [date, time, lista, title].filter((field): field is string => Boolean(field))
  return { fields: fields.join(' | '), closing, problems, note: notes.length > 0 ? notes.join('; ') : undefined }
}

function unbold(value: string): string {
  return value.replace(/\*\*/g, '').trim()
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
