export type EmphasisKind = 'plain' | 'bold' | 'italic'

export interface EmphasisSegment {
  kind: EmphasisKind
  text: string
}

/** `**negrito**` first, so a double star is never read as two italic markers. Only these two markers exist. */
const MARKER = /\*\*(?=\S)(.+?)\*\*|\*(?=\S)(.+?)\*/g

/** Splits task text into plain, bold and italic runs. Unpaired markers stay as plain text. */
export function parseEmphasis(source: string): EmphasisSegment[] {
  const segments: EmphasisSegment[] = []
  let last = 0
  for (const match of source.matchAll(MARKER)) {
    const start = match.index ?? 0
    if (start > last) segments.push({ kind: 'plain', text: source.slice(last, start) })
    const bold = match[1]
    segments.push(bold !== undefined ? { kind: 'bold', text: bold } : { kind: 'italic', text: match[2] ?? '' })
    last = start + match[0].length
  }
  if (last < source.length) segments.push({ kind: 'plain', text: source.slice(last) })
  return segments
}
