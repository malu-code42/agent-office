const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/** True when another field is being edited, so opening a conversation must not take the focus from it. */
export function otherFieldEditing(active: { tagName: string; isContentEditable?: boolean } | null, input: unknown): boolean {
  if (!active || active === input || active.tagName === 'BODY') return false
  return EDITABLE_TAGS.has(active.tagName) || active.isContentEditable === true
}
