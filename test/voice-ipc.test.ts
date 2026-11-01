import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerVoiceIpc } from '../src/main/ipc/voice'
import { LocalAudioRuntimeUnavailable } from '../src/main/audio-transcriber'
import { VOICE_MAX_BYTES } from '../src/shared/voice'
import type { LocalAudioTranscript } from '../src/shared/audio'
import { callHandler, ipcMain } from './mocks/electron'

let dir: string
const pending = (): string[] => (existsSync(join(dir, 'audio-pending')) ? readdirSync(join(dir, 'audio-pending')) : [])
const AUDIO = new Uint8Array([1, 2, 3, 4])
const OK: LocalAudioTranscript = { language: 'pt', text: 'Abre um ticket.', segments: [] }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ao-voice-'))
})
afterEach(() => {
  ipcMain.removeHandler('office:micAccess')
  ipcMain.removeHandler('office:transcribe')
  rmSync(dir, { recursive: true, force: true })
})

const register = (transcribe: (path: string) => Promise<LocalAudioTranscript>): void =>
  registerVoiceIpc({ store: { dataDirectory: dir } } as never, { transcribe })

describe('office:transcribe', () => {
  it('transcreve a cópia temporária e devolve texto, idioma e tempo', async () => {
    let seen: Uint8Array | undefined
    register(async (path) => {
      seen = readFileSync(path)
      expect(path.startsWith(join(dir, 'audio-pending'))).toBe(true)
      return OK
    })
    const d = (await callHandler('office:transcribe', AUDIO)) as { text: string; lang: string; ms: number }
    expect(d).toMatchObject({ text: 'Abre um ticket.', lang: 'pt' })
    expect(d.ms).toBeGreaterThanOrEqual(0)
    expect(Array.from(seen!)).toEqual([1, 2, 3, 4])
  })

  it('apaga o áudio temporário depois de transcrever', async () => {
    register(async () => OK)
    await callHandler('office:transcribe', AUDIO)
    expect(pending()).toEqual([])
  })

  it('apaga o áudio também quando o transcritor falha, e repassa a mensagem em português', async () => {
    register(async () => {
      throw new LocalAudioRuntimeUnavailable('Não encontrei Python com faster-whisper e modelo local em cache.')
    })
    await expect(callHandler('office:transcribe', AUDIO)).rejects.toThrow(/faster-whisper/)
    expect(pending()).toEqual([])
  })

  it('recusa gravação vazia, grande demais ou de tipo errado sem criar arquivo nem chamar o transcritor', async () => {
    let calls = 0
    register(async () => {
      calls++
      return OK
    })
    await expect(callHandler('office:transcribe', new Uint8Array(0))).rejects.toThrow(/vazia/)
    await expect(callHandler('office:transcribe', new Uint8Array(VOICE_MAX_BYTES + 1))).rejects.toThrow(/limite/)
    await expect(callHandler('office:transcribe', 'texto')).rejects.toThrow(/vazia/)
    expect(calls).toBe(0)
    expect(pending()).toEqual([])
  })

  it('o microfone é liberado fora do macOS', async () => {
    register(async () => OK)
    if (process.platform !== 'darwin') expect(await callHandler('office:micAccess')).toBe(true)
  })
})
