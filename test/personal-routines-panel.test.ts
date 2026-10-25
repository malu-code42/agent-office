import { describe, expect, it, vi } from 'vitest'
import { loadPersonalRoutineOverview } from '../src/renderer/src/ui/personal-routines-model'

describe('entrada independente de Rotinas pessoais', () => {
  it('carrega só a visão de rotinas sem invocar nem alterar o rascunho da revisão', async () => {
    const reviewDraft = { step: 2, choices: { task1: { kind: 'revisar' } } }
    const personalRoutineOverview = vi.fn().mockResolvedValue({ today: '2026-10-25', rows: [], candidates: [], pending: [] })
    const openReview = vi.fn(() => reviewDraft)
    const reviewGate = vi.fn()
    const saveReviewDraft = vi.fn((step: number) => {
      reviewDraft.step = step
    })
    const confirmReview = vi.fn()
    const api = { personalRoutineOverview, openReview, reviewGate, saveReviewDraft, confirmReview }

    await expect(loadPersonalRoutineOverview(api)).resolves.toEqual({ today: '2026-10-25', rows: [], candidates: [], pending: [] })

    expect(personalRoutineOverview).toHaveBeenCalledOnce()
    expect(openReview).not.toHaveBeenCalled()
    expect(reviewGate).not.toHaveBeenCalled()
    expect(saveReviewDraft).not.toHaveBeenCalled()
    expect(confirmReview).not.toHaveBeenCalled()
    expect(reviewDraft).toEqual({ step: 2, choices: { task1: { kind: 'revisar' } } })
  })
})
