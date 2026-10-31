// Configurações → Vídeo (AO-29, AO-32): how often the office may draw.

/** 0 = no cap (the display's refresh rate). */
export type FpsLimit = 0 | 30 | 60

export interface VideoSettings {
  fpsLimit: FpsLimit
  /** On battery the office switches to Economia by itself (30 fps, less movement), and back on the charger. */
  batterySaver: boolean
}

export const DEFAULT_VIDEO: VideoSettings = { fpsLimit: 60, batterySaver: true }

/** Economia: what the office uses on battery when the player asked for it. */
const SAVER_FPS: FpsLimit = 30

/** What the office uses now: Economia on battery when the player asked for it. */
export function effectiveVideo(v: VideoSettings, onBattery: boolean): VideoSettings & { saving: boolean } {
  if (v.batterySaver && onBattery) return { fpsLimit: SAVER_FPS, batterySaver: true, saving: true }
  return { ...v, saving: false }
}

/** Shortest wait between drawn frames, in ms (0 = every animation frame). */
export function frameInterval(o: { fpsLimit: FpsLimit; busy: boolean; focused: boolean; fullSpeed: boolean }): number {
  if (o.fullSpeed) return 0
  let ms = o.fpsLimit ? 1000 / o.fpsLimit : 0
  // nothing moving: a slow tick keeps the typing loop and the routines board alive
  if (!o.busy) ms = Math.max(ms, 1000 / IDLE_FPS)
  if (!o.focused) ms = Math.max(ms, 1000 / BLUR_FPS)
  return ms
}

/** Drawn frames per second while the office stands still. */
export const IDLE_FPS = 12
/** Drawn frames per second while another app has the focus. */
export const BLUR_FPS = 20
