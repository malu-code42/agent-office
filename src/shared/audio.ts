export const AUDIO_MAX_BYTES = 20 * 1024 * 1024

const AUDIO_EXTENSIONS = new Set(['wav', 'mp3', 'm4a', 'mp4', 'ogg', 'oga', 'opus', 'webm', 'flac', 'aac', 'wma'])
const AUDIO_MIME = /^audio\/(?:aac|flac|mpeg|mp4|ogg|opus|wav|webm|x-m4a|x-wav)$/i

export function isAudioFile(name: string, mime = ''): boolean {
  const extension = name.split(/[\\/]/).at(-1)?.split('.').at(-1)?.toLowerCase()
  return AUDIO_MIME.test(mime) || (extension !== undefined && AUDIO_EXTENSIONS.has(extension))
}

export interface AudioTranscriptSegment {
  start: number
  end: number
  text: string
  uncertain: boolean
}

export interface LocalAudioTranscript {
  language: string
  text: string
  segments: AudioTranscriptSegment[]
}

export interface AudioTaskDraft {
  title: string
  /** Local-calendar date in DD.MM.YYYY, when the transcript gives a clear date. */
  date?: string
  /** HH:MM, when the transcript gives a clear time. */
  time?: string
}

export type AudioRoute = 'agenda' | 'media' | 'goals' | 'writing' | 'unknown'

export type AudioPlanGroup =
  { kind: 'tasks'; list: string; tasks: AudioTaskDraft[]; sourceText?: string } | { kind: 'route'; domain: AudioRoute; text: string }

export interface AudioPlan {
  groups: AudioPlanGroup[]
  /** If a date/list/destination is ambiguous, ask before producing any writable groups. */
  question?: string
}
