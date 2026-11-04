// Before "Gerar": what each topic of a discipline still lacks. Checked by code, no model call and no web call.

export type StudyReadinessState = 'pronto' | 'sem-fonte' | 'poucos-trechos' | 'sem-subtemas' | 'precisa-ocr'

export interface StudyReadinessTopic {
  /** Trail id, e.g. P2-HW-06 (null when the trail item has none). */
  id: string | null
  topic: string
  state: StudyReadinessState
  /** What is missing or what is ready, in plain words. */
  reason: string
  /** Where a book for the topic goes: full paths of the discipline's folders under study sources/textbooks (vault root + folder). */
  folders: string[]
}

export interface StudyReadiness {
  /** Discipline id, e.g. P2-HW. */
  discipline: string
  builtAt: number
  topics: StudyReadinessTopic[]
}
