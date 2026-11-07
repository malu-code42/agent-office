import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentPanel } from '../src/renderer/src/ui/panel'
import type { AgentSummary } from '../src/shared/types'

// AO-107: o subtítulo do crachá do orquestrador. O nome é de uma figura; o grupo (squad) a que a sala pertence vai no subtítulo.
// O renderer não tem DOM no teste: `document` é um gravador de nós e `renderHead` roda o código de verdade.

class FakeNode {
  tagName = ''
  className = ''
  attrs: Record<string, string> = {}
  children: unknown[] = []
  innerHTML = ''
  classList = { add: (c: string) => void (this.className = `${this.className} ${c}`.trim()) }
  setAttribute(k: string, v: string) {
    this.attrs[k] = v
  }
  addEventListener() {}
  append(...c: unknown[]) {
    this.children.push(...c)
  }
  replaceChildren(...c: unknown[]) {
    this.children = c
  }
}

const textOf = (n: unknown): string => (n instanceof FakeNode ? n.children.map(textOf).join('') : typeof n === 'string' ? n : '')
const find = (n: unknown, cls: string): FakeNode | undefined => {
  if (!(n instanceof FakeNode)) return undefined
  if (n.className.split(' ').includes(cls)) return n
  for (const c of n.children) {
    const hit = find(c, cls)
    if (hit) return hit
  }
  return undefined
}

const agent = (over: Partial<AgentSummary> = {}): AgentSummary =>
  ({
    id: 'a1',
    name: 'Ada',
    role: 'orchestrator',
    squad: 'sala-1',
    cwd: 'C:/proj',
    source: 'office',
    engine: 'claude',
    status: 'idle',
    activity: 'Parado',
    ...over,
  }) as AgentSummary

function badge(a: AgentSummary, squads: Array<{ code: string; cwd: string; name: string }>, badgeOpen = true) {
  const head = new FakeNode()
  const self = {
    badgeOpen,
    memMenuOpen: false,
    head,
    state: { squads, settings: { accounts: [] }, itemsFor: () => ({ permissions: [] }) },
    actions: {},
    photo: () => 'foto',
    brainPicker: () => null,
    badgeDetails: () => null,
    memMenu: () => null,
  }
  ;(AgentPanel.prototype as unknown as { renderHead(a: AgentSummary): void }).renderHead.call(self, a)
  return head
}

describe('subtítulo do crachá do orquestrador (AO-107)', () => {
  beforeEach(() => {
    vi.stubGlobal('document', {
      createElement: (tag: string) => Object.assign(new FakeNode(), { tagName: tag }),
      createElementNS: (_ns: string, tag: string) => Object.assign(new FakeNode(), { tagName: tag }),
    })
    vi.stubGlobal('Node', FakeNode)
  })
  afterEach(() => vi.unstubAllGlobals())

  const squads = [
    { code: 'sala-1', cwd: 'C:/proj', name: 'Squad da Sala 1' },
    { code: 'sala-1', cwd: 'C:/outro', name: 'Outro projeto' },
  ]

  it('mostra "Orquestrador · nome do squad" e deixa o nome da figura na linha do nome', () => {
    const head = badge(agent(), squads)
    expect(textOf(find(head, 'ab-role'))).toBe('Orquestrador · Squad da Sala 1')
    expect(textOf(find(head, 'ab-name'))).toBe('Ada')
  })

  it('usa o squad do mesmo projeto quando o código se repete em outro', () => {
    expect(textOf(find(badge(agent({ cwd: 'C:/outro' }), squads), 'ab-role'))).toBe('Orquestrador · Outro projeto')
  })

  it('sem o squad na lista cai no código; sem código, em "squad"', () => {
    expect(textOf(find(badge(agent({ squad: 'sala-9' }), squads), 'ab-role'))).toBe('Orquestrador · sala-9')
    expect(textOf(find(badge(agent({ squad: undefined }), squads), 'ab-role'))).toBe('Orquestrador · squad')
  })

  it('agente comum continua com "Agente"; com o crachá fechado não há subtítulo', () => {
    expect(textOf(find(badge(agent({ role: 'worker' as never, squad: undefined }), squads), 'ab-role'))).toBe('Agente')
    expect(find(badge(agent(), squads, false), 'ab-role')).toBeUndefined()
  })
})
