import { ipcMain, systemPreferences } from 'electron'
import { VOICE_MAX_BYTES, type Dictation } from '@shared/voice'
import { LocalAudioTranscriber } from '../audio-transcriber'
import { materializeTemporaryAudio } from '../audio-temporary'
import type { IpcContext } from './context'

type Transcriber = Pick<LocalAudioTranscriber, 'transcribe'>

/**
 * Modo voz: o microfone (o macOS pergunta uma vez) e a gravação virando texto pelo transcritor
 * local de áudio. Nada de nuvem, e a cópia temporária do áudio é apagada em qualquer desfecho.
 */
export function registerVoiceIpc(ctx: Pick<IpcContext, 'store'>, transcriber: Transcriber = new LocalAudioTranscriber()): void {
  ipcMain.handle('office:micAccess', async () => {
    if (process.platform !== 'darwin') return true
    const status = systemPreferences.getMediaAccessStatus('microphone')
    if (status === 'granted') return true
    if (status === 'not-determined') return systemPreferences.askForMediaAccess('microphone')
    return false
  })
  ipcMain.handle('office:transcribe', async (_e, audio: unknown): Promise<Dictation> => {
    if (!(audio instanceof Uint8Array) || audio.byteLength === 0) throw new Error('A gravação chegou vazia. Grave de novo.')
    if (audio.byteLength > VOICE_MAX_BYTES) throw new Error('A gravação passou do limite. Grave um trecho mais curto.')
    const started = Date.now()
    const copy = materializeTemporaryAudio(ctx.store.dataDirectory, 'fala.webm', 'audio/webm', audio)
    try {
      const t = await transcriber.transcribe(copy.path)
      return { text: t.text, lang: t.language || undefined, ms: Date.now() - started }
    } finally {
      copy.dispose()
    }
  })
}
