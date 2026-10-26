import { z } from 'zod'
import type { AudioPlan, AudioPlanGroup } from '@shared/audio'

const taskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  date: z
    .string()
    .regex(/^\d{2}\.\d{2}\.\d{4}$/)
    .refine(isCalendarDate)
    .optional(),
  time: z
    .string()
    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
})
const groupSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('tasks'),
    list: z.string().trim().min(1).max(120),
    tasks: z.array(taskSchema).min(1).max(20),
    sourceText: z.string().max(1000).optional(),
  }),
  z.object({
    kind: z.literal('route'),
    domain: z.enum(['agenda', 'media', 'goals', 'writing', 'unknown']),
    text: z.string().trim().min(1).max(2000),
  }),
])
const planSchema = z.object({ groups: z.array(groupSchema).max(40), question: z.string().trim().min(1).max(1000).optional() })

export function audioPlanContext(transcript: string, localDate: string, lists: readonly string[]): string {
  const relativeDates = relativeDateReference(localDate)
  return [
    '[CAPTURA DE ÁUDIO — CONTEXTO LOCAL]',
    `Data local de referência: ${localDate}`,
    'Datas relativas já resolvidas pelo calendário local:',
    `- hoje: ${relativeDates.today}`,
    `- amanhã: ${relativeDates.tomorrow}`,
    `- depois de amanhã: ${relativeDates.dayAfterTomorrow}`,
    'Listas canônicas já existentes em tarefas.md (use somente nomes exatos):',
    lists.map((list) => `- ${list}`).join('\n') || '(nenhuma lista disponível)',
    'Transcrição corrigida, revisada localmente pela usuária:',
    transcript,
  ].join('\n\n')
}

export function relativeDateReference(localDate: string): { today: string; tomorrow: string; dayAfterTomorrow: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate)
  if (!match) throw new Error('A data local de referência precisa estar no formato AAAA-MM-DD.')
  const [, yearText, monthText, dayText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    throw new Error('A data local de referência não existe no calendário.')
  const format = (offset: number) => {
    const next = new Date(date.getTime() + offset * 86_400_000)
    return `${String(next.getUTCDate()).padStart(2, '0')}.${String(next.getUTCMonth() + 1).padStart(2, '0')}.${next.getUTCFullYear()}`
  }
  return { today: format(0), tomorrow: format(1), dayAfterTomorrow: format(2) }
}

/** Parse model output and refuse invented task categories or malformed dates/times. */
export function parseAudioPlan(raw: unknown, canonicalLists: readonly string[]): AudioPlan {
  const parsed = planSchema.safeParse(jsonObject(raw))
  if (!parsed.success) throw new Error('A Luna não conseguiu organizar a transcrição com segurança. Revise os trechos e tente novamente.')
  const plan = parsed.data
  if (plan.question) return { groups: [], question: plan.question }
  if (!plan.groups.length) throw new Error('Não encontrei ações claras nesta transcrição. Nenhum dado foi gravado.')

  const unknownList = plan.groups.find((group) => group.kind === 'tasks' && !canonicalLists.includes(group.list))
  if (unknownList?.kind === 'tasks')
    return {
      groups: [],
      question: `Não encontrei a lista “${unknownList.list}” em tarefas.md. Escolha uma lista existente: ${canonicalLists.join(', ')}.`,
    }

  return { groups: plan.groups as AudioPlanGroup[] }
}

function jsonObject(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end < start) return undefined
  try {
    return JSON.parse(raw.slice(start, end + 1)) as unknown
  } catch {
    return undefined
  }
}

function isCalendarDate(value: string): boolean {
  const [day, month, year] = value.split('.').map(Number) as [number, number, number]
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}
