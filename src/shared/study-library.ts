export interface StudyLibraryHit {
  id: string
  sourceRef: string
  title: string
  excerpt: string
  line: number
  score: number
}

export interface StudyLibrarySearch {
  token: string
  query: string
  complete: boolean
  hits: StudyLibraryHit[]
  warning?: string
}
