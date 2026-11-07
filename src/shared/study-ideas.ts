import type { StudyCycleState } from './study-cycle'

/** Estado do projeto, marcado pela usuária: só "feito" faz os tópicos dele contarem como cobertos. */
export const PROJECT_STATUSES = ['ideia', 'escolhido', 'feito'] as const
export type StudyProjectStatus = (typeof PROJECT_STATUSES)[number]
export const PROJECT_STATUS_LABEL: Record<StudyProjectStatus, string> = { ideia: 'Ideia', escolhido: 'Escolhido', feito: 'Feito' }

/** Máximos por pedido ao modelo e por texto; o main rejeita o que passar. */
export const MAX_TOPICS_PER_REQUEST = 30
export const MAX_PROJECTS_PER_REQUEST = 8
export const PROJECT_TITLE_MAX = 120
export const PROJECT_DESCRIPTION_MAX = 600
export const PROJECT_REASON_MAX = 400
export const PROJECT_ID_RE = /^sp-[a-z0-9-]{1,60}$/

export interface StudyProject {
  id: string
  title: string
  description: string
  /** Os tópicos estudados que o projeto usa (um subconjunto que combina), com o nome guardado no ciclo. */
  topics: string[]
  status: StudyProjectStatus
  createdAt: number
  /** Presente no projeto que o modelo indicou como o melhor do pedido, com o motivo. */
  best?: { reason: string }
  /** Especificação passo a passo do projeto, guardada junto dele (AO-36); ausente até ser gerada. */
  spec?: StudySpec
}

export interface StudySpec {
  generatedAt: number
  /** O texto final em Markdown, com as nove seções na ordem fixa. */
  markdown: string
}

/** As nove seções obrigatórias da especificação, na ordem em que aparecem no arquivo. */
export const SPEC_SECTIONS = [
  { key: 'objetivo', title: 'Objetivo e o que o projeto prova' },
  { key: 'topicos', title: 'Tópicos estudados × funcionalidade' },
  { key: 'mvp', title: 'Escopo mínimo (MVP) e o que fica de fora' },
  { key: 'stack', title: 'Stack e ferramentas' },
  { key: 'estrutura', title: 'Estrutura de pastas e modelo de dados' },
  { key: 'contratos', title: 'Interfaces entre partes (contratos)' },
  { key: 'etapas', title: 'Etapas ordenadas' },
  { key: 'roteiro', title: 'Roteiro de gravação' },
  { key: 'github', title: 'Checklist do GitHub' },
] as const

export const SPEC_SECTION_MAX = 6000
export const SPEC_MAX = 40000

export type SpecParse = { ok: true; markdown: string } | { ok: false; error: string }

/** Valida a resposta do modelo: as nove seções presentes, tamanho limitado e nenhum bloco de código pronto. */
export function parseSpec(reply: unknown, title: string): SpecParse {
  const raw = reply && typeof reply === 'object' ? (reply as { sections?: unknown }).sections : undefined
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'O modelo não devolveu a especificação no formato esperado. Tente novamente.' }
  const parts: string[] = [`# Especificação: ${title}`]
  let total = 0
  for (const [index, { key, title: heading }] of SPEC_SECTIONS.entries()) {
    const value = (raw as Record<string, unknown>)[key]
    const text = typeof value === 'string' ? value.trim() : ''
    if (!text) return { ok: false, error: `A especificação veio sem a seção "${heading}". Tente gerar de novo.` }
    if (text.length > SPEC_SECTION_MAX) return { ok: false, error: `A seção "${heading}" veio longa demais. Tente gerar de novo.` }
    if (text.includes('```')) return { ok: false, error: `A seção "${heading}" trouxe código pronto, o que a especificação não pode ter. Tente gerar de novo.` }
    total += text.length
    parts.push(`## ${index + 1}. ${heading}\n\n${text}`)
  }
  if (total > SPEC_MAX) return { ok: false, error: 'A especificação veio longa demais. Tente gerar de novo.' }
  return { ok: true, markdown: `${parts.join('\n\n')}\n` }
}

/** Nome de arquivo seguro (sem acentos nem separadores) para exportar a especificação. */
export function specFileName(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${slug || 'projeto'}-especificacao.md`
}

function cleanSpec(value: unknown): StudySpec | undefined {
  const s = (value ?? {}) as Partial<StudySpec>
  return typeof s.markdown === 'string' && s.markdown && typeof s.generatedAt === 'number' ? { generatedAt: s.generatedAt, markdown: s.markdown } : undefined
}

/** Formato antigo de study-ideas.json (AO-17): um conjunto de ideias por tópico, sem campo `version`. */
export function isLegacyIdeaFile(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw) && !('version' in raw)
}

/** Converte o formato antigo em projetos: cada ideia vira um projeto "ideia" de um tópico só, mantendo a spec. */
export function migrateLegacyIdeas(raw: unknown): StudyProject[] {
  const out: StudyProject[] = []
  if (!isLegacyIdeaFile(raw)) return out
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const set = value as { topic?: unknown; generatedAt?: unknown; ideas?: unknown } | null
    if (!set || typeof set !== 'object' || !Array.isArray(set.ideas)) continue
    const topic = typeof set.topic === 'string' && set.topic ? set.topic : key
    const createdAt = typeof set.generatedAt === 'number' ? set.generatedAt : 0
    for (const item of set.ideas) {
      const { title, description, spec } = (item ?? {}) as Record<string, unknown>
      if (typeof title !== 'string' || typeof description !== 'string') continue
      const kept = cleanSpec(spec)
      out.push({ id: `sp-legacy-${out.length + 1}`, title, description, topics: [topic], status: 'ideia', createdAt, ...(kept ? { spec: kept } : {}) })
    }
  }
  return out
}

/** Lê o que veio do disco: aceita o formato novo e o antigo, guardando só o que é bem formado. */
export function normalizeProjects(raw: unknown): StudyProject[] {
  if (isLegacyIdeaFile(raw)) return migrateLegacyIdeas(raw)
  const list = raw && typeof raw === 'object' ? (raw as { projects?: unknown }).projects : undefined
  if (!Array.isArray(list)) return []
  const out: StudyProject[] = []
  const ids = new Set<string>()
  for (const item of list) {
    const p = (item ?? {}) as Record<string, unknown>
    if (typeof p.id !== 'string' || !PROJECT_ID_RE.test(p.id) || ids.has(p.id)) continue
    if (typeof p.title !== 'string' || typeof p.description !== 'string' || !Array.isArray(p.topics)) continue
    const topics = [...new Set(p.topics.filter((t): t is string => typeof t === 'string' && !!t))]
    if (!topics.length) continue
    const status = PROJECT_STATUSES.find((x) => x === p.status) ?? 'ideia'
    const reason = (p.best as { reason?: unknown } | undefined)?.reason
    const spec = cleanSpec(p.spec)
    ids.add(p.id)
    out.push({
      id: p.id,
      title: p.title,
      description: p.description,
      topics,
      status,
      createdAt: typeof p.createdAt === 'number' ? p.createdAt : 0,
      ...(typeof reason === 'string' && reason ? { best: { reason } } : {}),
      ...(spec ? { spec } : {}),
    })
  }
  return out
}

/** Tópicos cobertos: os usados em algum projeto marcado como feito. */
export function coveredTopics(projects: readonly StudyProject[]): Set<string> {
  return new Set(projects.filter((p) => p.status === 'feito').flatMap((p) => p.topics))
}

/** Os tópicos do projeto que ainda não têm nenhum projeto feito. */
export function uncoveredTopicsOf(project: Pick<StudyProject, 'topics'>, covered: ReadonlySet<string>): string[] {
  return project.topics.filter((t) => !covered.has(t))
}

export interface StudiedTopic {
  topic: string
  /** True once a cycle of the topic was completed (its retest passed and the student confirmed). */
  completed: boolean
}

/** Every topic of the study cycles, newest first; a topic counts as completed if any of its cycles is. */
export function studiedTopics(state: StudyCycleState): StudiedTopic[] {
  const topics = new Map<string, StudiedTopic>()
  for (const cycle of [...state.cycles].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const seen = topics.get(cycle.topic)
    topics.set(cycle.topic, { topic: cycle.topic, completed: !!seen?.completed || cycle.stage === 'completed' })
  }
  return [...topics.values()]
}

export interface ProjectDraft {
  title: string
  description: string
  topics: string[]
}

export type ProjectsParse = { ok: true; drafts: ProjectDraft[]; bestIndex: number; reason: string } | { ok: false; error: string }

/**
 * Valida a resposta do modelo: de 1 a 8 projetos com título, descrição e tópicos que existem no pedido
 * (nomes desconhecidos são descartados; projeto sem nenhum tópico válido some). O melhor é o que cobre
 * mais tópicos ainda sem projeto feito: se o modelo apontou outro, vale o que cobre mais, e o motivo é
 * montado aqui, já que o do modelo falaria de outro projeto.
 */
export function parseProjects(reply: unknown, allowed: readonly string[], covered: ReadonlySet<string> = new Set()): ProjectsParse {
  const raw = reply && typeof reply === 'object' ? (reply as { projects?: unknown; best?: unknown }) : undefined
  if (!raw || !Array.isArray(raw.projects)) return { ok: false, error: 'O modelo não devolveu os projetos no formato esperado. Tente novamente.' }
  const known = new Set(allowed)
  const drafts: ProjectDraft[] = []
  const modelIndex: number[] = []
  raw.projects.forEach((item, index) => {
    const { title, description, topics } = (item ?? {}) as Record<string, unknown>
    if (typeof title !== 'string' || typeof description !== 'string' || !Array.isArray(topics)) return
    const t = title.trim()
    const d = description.trim()
    if (!t || !d || t.length > PROJECT_TITLE_MAX || d.length > PROJECT_DESCRIPTION_MAX) return
    const used = [...new Set(topics.filter((x): x is string => typeof x === 'string').map((x) => x.trim()))].filter((x) => known.has(x))
    if (!used.length || drafts.length >= MAX_PROJECTS_PER_REQUEST) return
    drafts.push({ title: t, description: d, topics: used })
    modelIndex.push(index)
  })
  if (!drafts.length) return { ok: false, error: 'O modelo não devolveu nenhum projeto válido (com título, descrição e tópicos estudados). Tente novamente.' }
  const count = (d: ProjectDraft) => d.topics.filter((x) => !covered.has(x)).length
  const top = Math.max(...drafts.map(count))
  const best = (raw.best ?? {}) as { index?: unknown; reason?: unknown }
  const chosen = typeof best.index === 'number' ? modelIndex.indexOf(best.index) : -1
  const modelReason = typeof best.reason === 'string' ? best.reason.trim() : ''
  if (chosen >= 0 && count(drafts[chosen]!) === top && modelReason && modelReason.length <= PROJECT_REASON_MAX) {
    return { ok: true, drafts, bestIndex: chosen, reason: modelReason }
  }
  const bestIndex = drafts.findIndex((d) => count(d) === top)
  const reason = top
    ? `Cobre ${top} ${top === 1 ? 'tópico' : 'tópicos'} ainda sem projeto feito, mais do que os outros.`
    : 'Todos os tópicos dele já têm projeto feito; é o que cobre mais tópicos no geral.'
  return { ok: true, drafts, bestIndex, reason }
}
