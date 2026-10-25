import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { StudyCycleState } from '@shared/study-cycle'
import { validateStudyQuestion } from '@shared/study-questions'

const questionSchema = z
  .object({
    id: z.string().regex(/^q-[a-z0-9-]{8,72}$/i),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    source: z
      .object({
        id: z.string().max(80),
        topic: z.string().max(200),
        tags: z.array(z.string().max(80)).max(20),
        question: z.string().max(20_000),
        answer: z.string().max(20_000).optional(),
        rationale: z.string().max(20_000).optional(),
        answerStatus: z.enum(['verified', 'unverified', 'missing']),
        originKind: z.enum(['enem', 'concurso', 'livro', 'web', 'ia']),
        sourceTitle: z.string().max(300),
        sourceVisibility: z.enum(['public', 'private', 'local', 'unknown']),
        sourceUrl: z.string().max(8192).optional(),
        sourceReference: z.string().max(1000).optional(),
        attribution: z.string().max(1000),
        license: z.string().max(300),
        sourceOnly: z.literal(true).optional(),
        verifiedByUser: z.literal(true).optional(),
        verifiedAt: z.string().max(40).optional(),
      })
      .strict(),
    response: z.string().max(20_000),
    providedExcerpt: z.string().max(20_000),
    uncertain: z.boolean().nullable(),
    assessment: z
      .object({
        kind: z.enum(['correct', 'incorrect', 'uncertain', 'pending']),
        rationale: z.string().max(2000),
        checkedAt: z.number().finite(),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .refine((question) => question.id === question.source.id && question.sourceHash === hashStudyQuestion(question.source))
  .superRefine((question, context) => {
    try {
      validateStudyQuestion(question.source)
    } catch {
      context.addIssue({ code: 'custom', message: 'Questão snapshot inválida.' })
    }
  })

const cycleSchema = z
  .object({
    id: z.string().min(1).max(100),
    topic: z.string().min(1).max(200),
    stage: z.enum(['diagnosis', 'review-required', 'retest-ready']),
    startedAt: z.number().finite(),
    updatedAt: z.number().finite(),
    questions: z.array(questionSchema).min(1).max(100),
  })
  .strict()
  .refine((cycle) => new Set(cycle.questions.map((question) => question.id)).size === cycle.questions.length)

export const studyCycleStateSchema: z.ZodType<StudyCycleState> = z
  .object({ activeId: z.string().min(1).max(100).nullable(), cycles: z.array(cycleSchema).max(1000) })
  .strict()
  .refine((state) => new Set(state.cycles.map((cycle) => cycle.id)).size === state.cycles.length)
  .refine((state) => state.activeId === null || state.cycles.some((cycle) => cycle.id === state.activeId))

export function isStudyCycleState(value: unknown): value is StudyCycleState {
  return studyCycleStateSchema.safeParse(value).success
}

export function hashStudyQuestion(question: unknown): string {
  return createHash('sha256').update(JSON.stringify(question), 'utf8').digest('hex')
}
