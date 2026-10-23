import type { ReviewChoices } from '@shared/review'

/** Serialize renderer writes so an older in-flight draft cannot overwrite a newer one. */
export function createReviewDraftSaver(write: (step: number, choices: ReviewChoices) => Promise<void>) {
  let tail: Promise<void> = Promise.resolve()
  const save = (step: number, choices: ReviewChoices): Promise<void> => {
    const next = tail.catch(() => undefined).then(() => write(step, choices))
    tail = next
    return next
  }
  return { save, drain: () => tail }
}

/** Keep the wizard open if persistence fails or confirmation takes ownership while the save is pending. */
export async function closeReviewAfterSave(save: Promise<void>, confirming: () => boolean, close: () => void): Promise<boolean> {
  if (confirming()) return false
  await save
  if (confirming()) return false
  close()
  return true
}
