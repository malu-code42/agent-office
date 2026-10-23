import { describe, expect, it, vi } from 'vitest'
import { createReviewDraftSaver, closeReviewAfterSave } from '../src/renderer/src/ui/review-draft'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('review draft saves', () => {
  it('drains queued writes before confirmation and blocks a close that completes late', async () => {
    const first = deferred<void>()
    const events: string[] = []
    const saver = createReviewDraftSaver(async (step) => {
      events.push(`save:${step}:start`)
      if (step === 1) await first.promise
      events.push(`save:${step}:done`)
    })
    let confirming = false
    const closed = vi.fn()
    const close = closeReviewAfterSave(saver.save(1, {}), () => confirming, closed)

    confirming = true
    const confirmation = saver.drain().then(() => events.push('confirm'))
    first.resolve()
    await Promise.all([close, confirmation])

    expect(events).toEqual(['save:1:start', 'save:1:done', 'confirm'])
    expect(closed).not.toHaveBeenCalled()
  })

  it('does not close after a failed draft write and permits a retry', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce(undefined)
    const saver = createReviewDraftSaver(write)
    const closed = vi.fn()

    await expect(closeReviewAfterSave(saver.save(2, {}), () => false, closed)).rejects.toThrow('disk full')
    expect(closed).not.toHaveBeenCalled()

    await expect(closeReviewAfterSave(saver.save(2, {}), () => false, closed)).resolves.toBe(true)
    expect(closed).toHaveBeenCalledOnce()
  })
})
