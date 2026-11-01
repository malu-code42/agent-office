import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { StudyCycleState } from '@shared/study-cycle'
import { validateStudyQuestion } from '@shared/study-questions'
import { retestScore } from '@shared/study-cycle'

const questionSchema = z
  .object({
    id: z.string().regex(/^q-[a-z0-9-]{8,72}$/i),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    source: z
      .object({
        id: z.string().max(80),
        topic: z.string().max(200),
        tags: z.array(z.string().max(80)).max(20),
        passage: z.string().max(20_000).optional(),
        question: z.string().max(20_000),
        options: z.array(z.string().max(2000)).min(2).max(6).optional(),
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
    review: z
      .object({
        cause: z.string().min(1).max(2000),
        nextStep: z.string().min(1).max(2000),
        sourceRefs: z.array(z.string().min(1).max(1000)).max(100),
      })
      .strict()
      .optional(),
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

const practiceQuestionSchema = z.intersection(
  questionSchema,
  z
    .object({
      gapQuestionIds: z
        .array(z.string().regex(/^q-[a-z0-9-]{8,72}$/i))
        .min(1)
        .max(100),
    })
    .strict(),
)

const cycleSchema = z
  .object({
    id: z.string().min(1).max(100),
    topic: z.string().min(1).max(200),
    stage: z.enum(['diagnosis', 'review-required', 'practice', 'retest-ready', 'retest', 'completed']),
    startedAt: z.number().finite(),
    updatedAt: z.number().finite(),
    questions: z.array(questionSchema).min(1).max(100),
    practiceRounds: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            startedAt: z.number().finite(),
            questions: z.array(practiceQuestionSchema).min(1).max(100),
          })
          .strict(),
      )
      .max(100)
      .default([]),
    notes: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            gapQuestionId: z.string().regex(/^q-[a-z0-9-]{8,72}$/i),
            sourceRef: z.string().min(1).max(1000),
            text: z.string().min(1).max(10_000),
            savedAt: z.number().finite(),
          })
          .strict(),
      )
      .max(1000)
      .default([]),
    retests: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            startedAt: z.number().finite(),
            questions: z.array(questionSchema).min(10).max(100),
          })
          .strict(),
      )
      .max(100)
      .default([]),
  })
  .strict()
  .refine((cycle) => new Set(cycle.questions.map((question) => question.id)).size === cycle.questions.length)
  .superRefine((cycle, context) => {
    const latestRetest = cycle.retests.at(-1)
    if (cycle.stage === 'retest' && !latestRetest)
      context.addIssue({ code: 'custom', message: 'Ciclo em reteste sem conjunto persistido.' })
    if (cycle.stage === 'completed' && (!latestRetest || retestScore(latestRetest) === null || retestScore(latestRetest)! < 80))
      context.addIssue({ code: 'custom', message: 'Ciclo concluído sem reteste válido de pelo menos 80%.' })
    const gaps = new Set(
      cycle.questions
        .filter((question) => question.uncertain || question.assessment?.kind === 'incorrect' || question.assessment?.kind === 'uncertain')
        .map((question) => question.id),
    )
    for (const round of cycle.practiceRounds) {
      for (const question of round.questions) {
        if (question.gapQuestionIds.some((id) => !gaps.has(id)))
          context.addIssue({ code: 'custom', message: 'Questão de prática sem lacuna vinculada.' })
      }
    }
    for (const note of cycle.notes)
      if (!gaps.has(note.gapQuestionId)) context.addIssue({ code: 'custom', message: 'Nota sem lacuna válida.' })
    const retestIds = new Set<string>()
    const retestPrompts = new Set<string>()
    for (const attempt of cycle.retests) {
      const ids = new Set<string>()
      const prompts = new Set<string>()
      for (const question of attempt.questions) {
        const normalized = question.source.question.toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim()
        if (
          question.source.answerStatus !== 'verified' ||
          !question.source.answer ||
          ids.has(question.id) ||
          prompts.has(normalized) ||
          retestIds.has(question.id) ||
          retestPrompts.has(normalized) ||
          cycle.questions.some(
            (original) =>
              original.id === question.id || original.source.question.toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim() === normalized,
          ) ||
          cycle.practiceRounds.some((round) =>
            round.questions.some(
              (practice) =>
                practice.id === question.id ||
                practice.source.question.toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim() === normalized,
            ),
          )
        )
          context.addIssue({ code: 'custom', message: 'Questão de reteste repetida, inválida ou sem gabarito conferido.' })
        ids.add(question.id)
        prompts.add(normalized)
        retestIds.add(question.id)
        retestPrompts.add(normalized)
      }
    }
  })

export const studyCycleStateSchema: z.ZodType<StudyCycleState> = z
  .object({
    activeId: z.string().min(1).max(100).nullable(),
    cycles: z.array(cycleSchema).max(1000),
    answered: z
      .array(z.object({ id: z.string().min(1).max(100), key: z.string().max(20_000), at: z.number().int().nonnegative() }).strict())
      .max(20_000)
      .optional(),
  })
  .strict()
  .refine((state) => new Set(state.cycles.map((cycle) => cycle.id)).size === state.cycles.length)
  .refine((state) => state.activeId === null || state.cycles.some((cycle) => cycle.id === state.activeId))

export function isStudyCycleState(value: unknown): value is StudyCycleState {
  return studyCycleStateSchema.safeParse(value).success
}

/** Adds defaults for cycle files written before AO-50 review/practice and AO-51 retest state. */
export function normalizeStudyCycleState(value: unknown): StudyCycleState {
  return studyCycleStateSchema.parse(value)
}

export function hashStudyQuestion(question: unknown): string {
  return createHash('sha256').update(JSON.stringify(question), 'utf8').digest('hex')
}
