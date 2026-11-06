/**
 * AO-101: splits the long text of an agent's question into short context blocks and the
 * final question, so the card can show them with hierarchy. Pure: no DOM.
 *
 * Heuristic, simple on purpose: the question is the last sentence with "?" of the last
 * paragraph (plus whatever follows it); without "?" it is the whole last paragraph.
 * Nothing is dropped: everything else is context, in the original order.
 */
export interface ContextBlock {
  kind: 'p' | 'item'
  text: string
}

export interface SplitQuestion {
  context: ContextBlock[]
  question: string
}

/** A paragraph longer than this is cut at sentence ends into several. */
const MAX_BLOCK = 320

const ITEM = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?…])\s+(?=\S)/).filter(Boolean)
}

/** Greedy grouping of sentences into paragraphs of at most MAX_BLOCK characters. */
function chunk(text: string): string[] {
  const out: string[] = []
  let cur = ''
  for (const s of sentences(text)) {
    if (cur && cur.length + 1 + s.length > MAX_BLOCK) {
      out.push(cur)
      cur = s
    } else cur = cur ? `${cur} ${s}` : s
  }
  if (cur) out.push(cur)
  return out
}

/** Paragraphs (blank-line separated) and list lines, in order. Consecutive prose lines of a paragraph are joined. */
function parse(text: string): ContextBlock[] {
  const blocks: ContextBlock[] = []
  for (const para of text.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)) {
    let run: string[] = []
    const flush = () => {
      if (run.length) blocks.push({ kind: 'p', text: run.join(' ') })
      run = []
    }
    for (const raw of para.split('\n')) {
      const line = raw.trim()
      if (!line) continue
      const m = ITEM.exec(line)
      if (m) {
        flush()
        blocks.push({ kind: 'item', text: m[1].trim() })
      } else run.push(line)
    }
    flush()
  }
  return blocks
}

function toContext(blocks: ContextBlock[]): ContextBlock[] {
  return blocks.flatMap((b) => (b.kind === 'p' ? chunk(b.text).map((text) => ({ kind: 'p' as const, text })) : [b]))
}

export function splitQuestion(text: string): SplitQuestion {
  const blocks = parse(text ?? '')
  if (!blocks.length) return { context: [], question: '' }

  // The last block when the text ends in prose; when it ends in a list, the last prose block with "?".
  let qi = blocks.length - 1
  while (qi >= 0 && !(blocks[qi].kind === 'p' && (qi === blocks.length - 1 || blocks[qi].text.includes('?')))) qi--
  if (qi < 0) return { context: toContext(blocks), question: '' }

  const sents = sentences(blocks[qi].text)
  let from = 0
  for (let i = sents.length - 1; i >= 0; i--)
    if (sents[i].includes('?')) {
      from = i
      break
    }
  const before = sents.slice(0, from).join(' ')
  const context = [...blocks.slice(0, qi), ...(before ? [{ kind: 'p' as const, text: before }] : []), ...blocks.slice(qi + 1)]
  return { context: toContext(context), question: sents.slice(from).join(' ') }
}
