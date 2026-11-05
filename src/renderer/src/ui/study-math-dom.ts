import DOMPurify from 'dompurify'
import { studyMathParts } from './study-math'

/** Plain text is appended as text nodes; generated markup is sanitized before insertion. */
export function studyMath(text: string): DocumentFragment {
  const result = document.createDocumentFragment()
  for (const part of studyMathParts(text)) {
    if ('text' in part) result.append(document.createTextNode(part.text))
    else result.append(DOMPurify.sanitize(part.html, { RETURN_DOM_FRAGMENT: true }))
  }
  return result
}
