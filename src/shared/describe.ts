import { SQUAD_ROLE_LABELS, type Look, type SquadRole, type SubagentInfo } from './types'

const basename = (p: unknown): string => {
  if (typeof p !== 'string' || !p) return ''
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || p
}

const clip = (s: unknown, n = 60): string => {
  const str = typeof s === 'string' ? s : JSON.stringify(s ?? '')
  const one = str.replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n - 1) + '…' : one
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])

/** Present-tense activity line for a tool call, shown on the agent's name tag. */
export function describeTool(tool: string, input: Record<string, unknown> = {}): string {
  switch (tool) {
    case 'Bash':
      return `Rodando ${clip(input.command, 40)}`
    case 'Edit':
    case 'MultiEdit':
      return `Editando ${basename(input.file_path)}`
    case 'Write':
      return `Escrevendo ${basename(input.file_path)}`
    case 'Read':
      return `Lendo ${basename(input.file_path)}`
    case 'NotebookEdit':
      return `Editando ${basename(input.notebook_path)}`
    case 'Grep':
      return `Buscando "${clip(input.pattern, 28)}"`
    case 'Glob':
      return `Procurando ${clip(input.pattern, 28)}`
    case 'WebFetch':
      return `Lendo ${clip(input.url, 36)}`
    case 'WebSearch':
      return `Pesquisando "${clip(input.query, 28)}"`
    case 'Task':
    case 'Agent':
      return `Delegando: ${clip(input.description, 32)}`
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
      return 'Organizando tarefas'
    case 'AskUserQuestion':
      return 'Com uma pergunta'
    case 'ExitPlanMode':
      return 'Apresentando o plano'
    case 'Skill':
      return `Usando skill ${clip(input.skill ?? input.name, 24)}`
    default:
      if (tool.startsWith('mcp__')) {
        const [, server, name] = tool.split('__')
        return `${server}: ${name ?? ''}`.trim()
      }
      return `Usando ${tool}`
  }
}

/** Title + detail for a permission card. */
/** What a subagent is doing, in one line, for its balloon and its row in the panel. */
export function helperActivity(s: SubagentInfo): string {
  return s.summary || s.activity || (s.lastTool ? `Usando ${s.lastTool}` : 'Começando')
}

/** The log line of a tool call: the command, path or pattern it ran with. */
export function toolDetail(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case 'Bash':
      return `$ ${input.command ?? ''}`
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'Read':
      return `${tool} ${input.file_path ?? ''}`
    case 'Grep':
      return `Grep "${input.pattern ?? ''}" ${input.path ?? ''}`
    case 'Glob':
      return `Glob ${input.pattern ?? ''}`
    case 'WebFetch':
      return `WebFetch ${input.url ?? ''}`
    case 'WebSearch':
      return `WebSearch "${input.query ?? ''}"`
    default:
      return describeTool(tool, input)
  }
}

export function describePermission(tool: string, input: Record<string, unknown> = {}): { title: string; detail: string } {
  switch (tool) {
    case 'Bash':
      return { title: 'Posso rodar este comando?', detail: String(input.command ?? '') }
    case 'Edit':
    case 'MultiEdit':
      return { title: `Posso editar ${basename(input.file_path)}?`, detail: String(input.file_path ?? '') }
    case 'Write':
      return { title: `Posso escrever ${basename(input.file_path)}?`, detail: String(input.file_path ?? '') }
    case 'Read':
      return { title: `Posso ler ${basename(input.file_path)}?`, detail: String(input.file_path ?? '') }
    case 'WebFetch':
      return { title: 'Posso acessar este site?', detail: String(input.url ?? '') }
    case 'WebSearch':
      return { title: 'Posso pesquisar na web?', detail: String(input.query ?? '') }
    // Emi's cards show the whole plan / squad, never a clipped JSON: it is what the user approves.
    case 'mcp__emi__plan_approve':
      return {
        title: 'Posso aprovar este plano do andar?',
        detail: [
          `Objetivo: ${String(input.goal ?? '')}`,
          `Tickets: ${list(input.tickets).join(', ')}`,
          'Critérios de aceite:',
          ...list(input.criteria).map((c) => `- ${c}`),
          '',
          'Grill:',
          String(input.grill ?? ''),
          '',
          'Especificação:',
          String(input.spec ?? ''),
        ].join('\n'),
      }
    case 'mcp__emi__squad_create': {
      const members = Array.isArray(input.members) ? (input.members as Record<string, unknown>[]) : []
      return {
        title: `Posso criar o squad ${String(input.name ?? '')}?`,
        detail: [
          `Squad: ${String(input.name ?? '')}${input.room ? ` · Sala ${String(input.room)}` : ''}`,
          `Para: ${String(input.brief ?? '')}`,
          `Tickets: ${list(input.tickets).join(', ')}`,
          'Membros:',
          ...members.map(
            (m) =>
              `- ${String(m.name ?? '')} · ${SQUAD_ROLE_LABELS[m.role as SquadRole] ?? String(m.role ?? '')} · ` +
              `modelo ${m.model ? String(m.model) : 'padrão do Claude Code'}${m.account ? ` · conta ${String(m.account)}` : ''}\n  ${String(m.focus ?? '')}`,
          ),
        ].join('\n'),
      }
    }
    default:
      return { title: `Posso usar ${tool}?`, detail: clip(input, 400) }
  }
}

export const SKIN_TONES = ['#f6d3b3', '#eebd94', '#d9a066', '#b97a4f', '#8d5636', '#5e3a24']
export const HAIR_COLORS = ['#2b1d16', '#4a3022', '#7a4b2a', '#c98d4b', '#e8c26e', '#d8d2c8', '#b33a3a', '#3b4a8f', '#e070a8', '#1f1f24']
export const SHIRT_COLORS = [
  '#e2574c',
  '#f0a23b',
  '#f2d34f',
  '#57b65f',
  '#3fa7a0',
  '#4a8fe0',
  '#6c5ce7',
  '#c56cd6',
  '#f27ea9',
  '#f4f4f4',
  '#2f3542',
  '#ff7f50',
]
export const PANTS_COLORS = ['#2f3b5c', '#3d3d46', '#5a4636', '#24496b', '#6b6f7a', '#1e1e24', '#7a5c3e']
export const SHOE_COLORS = ['#1e1e24', '#f4f4f4', '#7a4b2a', '#c0392b']
export const HAIR_STYLES = 6

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Deterministic look from a seed, so the same agent name always gets the same avatar. */
export function lookFromSeed(seed: string): Look {
  let h = hash(seed)
  const pick = <T>(arr: T[]): T => {
    const v = arr[h % arr.length]
    h = Math.imul(h ^ (h >>> 13), 2654435761) >>> 0
    return v
  }
  return {
    skin: pick(SKIN_TONES),
    hair: pick(HAIR_COLORS),
    hairStyle: pick([0, 1, 2, 3, 4, 5]),
    shirt: pick(SHIRT_COLORS),
    pants: pick(PANTS_COLORS),
    shoes: pick(SHOE_COLORS),
  }
}

// Personalities of computing (#105: more of them, picked at random).
export const AGENT_NAMES = [
  'Ada',
  'Turing',
  'Grace',
  'Linus',
  'Margaret',
  'Dennis',
  'Barbara',
  'Ken',
  'Hedy',
  'Alan',
  'Radia',
  'Guido',
  'Frances',
  'Bjarne',
  'Katherine',
  'Yukihiro',
  'Joan',
  'Anders',
  'Sophie',
  'Rich',
  'Edsger',
  'Donald',
  'Tim',
  'Vint',
  'Shafi',
  'Leslie',
  'Niklaus',
  'Fran',
  'Jean',
  'Adele',
  'Evelyn',
  'Annie',
  'Mary',
  'Lynn',
  'Elizabeth',
  'Hal',
  'Claude',
  'John',
  'Charles',
  'Konrad',
  'Seymour',
  'Ivan',
  'Douglas',
  'Butler',
  'Whitfield',
  'Martin',
  'Ward',
  'Kent',
  'Brian',
  'Bob',
  'Larry',
  'Rasmus',
  'Brendan',
  'James',
  'Matz',
  'Rob',
  'Russ',
  'Yann',
  'Fei-Fei',
  'Geoffrey',
  'Carol',
  'Sandi',
  'Kathleen',
  'Gladys',
  'Mark',
  'Lovelace',
  'Hopper',
  'Babbage',
  'Dijkstra',
  'Knuth',
]

/**
 * A name from AGENT_NAMES at random, so calls do not keep bringing the same names back:
 * first one no agent ever had (`past`), then one no current agent has (`active`). Undefined when all are taken.
 */
export function pickAgentName(active: Iterable<string>, past: Iterable<string> = [], random = Math.random): string | undefined {
  const taken = new Set(active)
  const old = new Set(past)
  const fresh = AGENT_NAMES.filter((n) => !taken.has(n) && !old.has(n))
  const pool = fresh.length ? fresh : AGENT_NAMES.filter((n) => !taken.has(n))
  return pool.length ? pool[Math.floor(random() * pool.length)] : undefined
}
