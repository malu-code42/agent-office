import type { StudyCycleState } from './study-cycle'

export interface StudyIdea {
  title: string
  description: string
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

/** Lê o que veio do disco: guarda só o que é bem formado, mantendo dados antigos (sem spec) intactos. */
export function normalizeIdeaSets(raw: unknown): Record<string, StudyIdeaSet> {
  const out: Record<string, StudyIdeaSet> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [topic, value] of Object.entries(raw)) {
    const set = value as Partial<StudyIdeaSet> | null
    if (!set || typeof set !== 'object' || !Array.isArray(set.ideas)) continue
    const ideas: StudyIdea[] = []
    for (const item of set.ideas) {
      const { title, description, spec } = (item ?? {}) as unknown as Record<string, unknown>
      if (typeof title !== 'string' || typeof description !== 'string') continue
      const s = spec as Partial<StudySpec> | undefined
      const keep = s && typeof s.markdown === 'string' && s.markdown && typeof s.generatedAt === 'number'
      ideas.push(keep ? { title, description, spec: { generatedAt: s.generatedAt as number, markdown: s.markdown as string } } : { title, description })
    }
    out[topic] = { topic: typeof set.topic === 'string' ? set.topic : topic, generatedAt: typeof set.generatedAt === 'number' ? set.generatedAt : 0, ideas }
  }
  return out
}

export interface StudyIdeaSet {
  topic: string
  generatedAt: number
  ideas: StudyIdea[]
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

/** Keeps only well-formed ideas from a model reply (3 to 6, bounded text); null when none survive. */
export function parseIdeas(reply: unknown): StudyIdea[] | null {
  const list = reply && typeof reply === 'object' ? (reply as { ideas?: unknown }).ideas : undefined
  if (!Array.isArray(list)) return null
  const ideas: StudyIdea[] = []
  for (const item of list) {
    const { title, description } = (item ?? {}) as Record<string, unknown>
    if (typeof title !== 'string' || typeof description !== 'string') continue
    const t = title.trim()
    const d = description.trim()
    if (t && d && t.length <= 120 && d.length <= 600) ideas.push({ title: t, description: d })
  }
  return ideas.length ? ideas.slice(0, 6) : null
}
