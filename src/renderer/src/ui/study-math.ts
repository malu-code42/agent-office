import katex from 'katex'

type MathPart = { text: string } | { html: string; display: boolean }

/** Split plain question text without interpreting its HTML; only KaTeX output is sanitized. */
export function studyMathParts(text: string): MathPart[] {
  const parts: MathPart[] = []
  // Treat a number followed by prose or punctuation as currency; dollar-delimited syntax is inherently ambiguous.
  const pattern =
    /(?<!\\)(?:\$\$([\s\S]+?)(?<!\\)\$\$|(?<!\$)\$(?!\$|\s)(?!\d+(?:[.,]\d+)*(?!\d|[.,]\d)(?=\s*(?:[\p{L}.,;:!?]|$)))([^\n$]*?\S)(?<!\\)\$(?!\$))/gu
  let start = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index
    if (index > start) parts.push({ text: text.slice(start, index) })
    try {
      const display = match[1] !== undefined
      const html = katex.renderToString((match[1] ?? match[2])!, {
        displayMode: display,
        throwOnError: true,
        trust: false,
        strict: 'error',
        maxExpand: 1000,
      })
      parts.push({ html, display })
    } catch {
      // Preserve the original expression when KaTeX cannot parse it.
      parts.push({ text: match[0] })
    }
    start = index + match[0].length
  }
  if (start < text.length) parts.push({ text: text.slice(start) })
  return parts
}
