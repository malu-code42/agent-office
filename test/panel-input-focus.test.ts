import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentPanel } from '../src/renderer/src/ui/panel'
import { otherFieldEditing } from '../src/renderer/src/ui/panel/focus-input'

// Fake elements: the renderer has no DOM in the test environment.
const el = (tagName: string, isContentEditable = false) => ({ tagName, isContentEditable }) as unknown as Element

const fakeNode = () => ({ setAttribute() {}, addEventListener() {}, append() {}, className: '' })

// open() only needs the fields it touches; h() needs a document and a Node constructor.
function panelWith(input: { focus: () => void }, active: Element | null) {
  vi.stubGlobal('document', { createElement: fakeNode, activeElement: active })
  vi.stubGlobal('Node', class {})
  return {
    agentId: null,
    helper: null,
    el: { classList: { remove() {} } },
    feed: { replaceChildren() {}, scrollTop: 0, scrollHeight: 0 },
    state: { log: async () => [] },
    floor: 0,
    from: 0,
    log: [],
    lastTool: null,
    lastEntry: undefined,
    stickToBottom: false,
    searching: false,
    input,
    render() {},
    clearMatches() {},
    append() {},
    runSearch() {},
  } as unknown as AgentPanel
}

describe('AgentPanel.open focuses the chat box', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllGlobals())

  it('focuses the box when a conversation opens and no other field is being edited', async () => {
    const focus = vi.fn()
    await AgentPanel.prototype.open.call(panelWith({ focus }, el('BODY')), 'luna')
    expect(focus).toHaveBeenCalledTimes(1)
  })

  // AO-98 critério 2: trocar de conversa também foca; abrir a mesma de novo não mexe no foco.
  it('focuses the box again each time the panel switches to another conversation', async () => {
    const focus = vi.fn()
    const panel = panelWith({ focus }, el('BODY'))
    await AgentPanel.prototype.open.call(panel, 'luna')
    expect(focus).toHaveBeenCalledTimes(1)
    await AgentPanel.prototype.open.call(panel, 'emi')
    expect(focus).toHaveBeenCalledTimes(2)
    await AgentPanel.prototype.open.call(panel, 'luna')
    expect(focus).toHaveBeenCalledTimes(3)
  })

  it('does not refocus when the same conversation is opened again', async () => {
    const focus = vi.fn()
    const panel = panelWith({ focus }, el('BODY'))
    await AgentPanel.prototype.open.call(panel, 'luna')
    await AgentPanel.prototype.open.call(panel, 'luna')
    expect(focus).toHaveBeenCalledTimes(1)
  })

  it('switching conversations still leaves a field being edited alone', async () => {
    const focus = vi.fn()
    const panel = panelWith({ focus }, el('BODY'))
    await AgentPanel.prototype.open.call(panel, 'luna')
    vi.stubGlobal('document', { createElement: fakeNode, activeElement: el('INPUT') })
    await AgentPanel.prototype.open.call(panel, 'emi')
    expect(focus).toHaveBeenCalledTimes(1)
  })

  it('does not take the focus from a field being edited', async () => {
    const focus = vi.fn()
    await AgentPanel.prototype.open.call(panelWith({ focus }, el('INPUT')), 'luna')
    expect(focus).not.toHaveBeenCalled()
  })
})

describe('otherFieldEditing', () => {
  const input = el('TEXTAREA')

  it('lets the chat box take the focus when nothing else is being edited', () => {
    expect(otherFieldEditing(null, input)).toBe(false)
    expect(otherFieldEditing(el('BODY'), input)).toBe(false)
    expect(otherFieldEditing(el('BUTTON'), input)).toBe(false)
    expect(otherFieldEditing(input, input)).toBe(false)
  })

  it('does not take the focus from another field being edited', () => {
    expect(otherFieldEditing(el('INPUT'), input)).toBe(true)
    expect(otherFieldEditing(el('TEXTAREA'), input)).toBe(true)
    expect(otherFieldEditing(el('SELECT'), input)).toBe(true)
    expect(otherFieldEditing(el('DIV', true), input)).toBe(true)
  })
})
