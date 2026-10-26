import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { AttachmentInput } from '@shared/types'
import { AUDIO_MAX_BYTES, isAudioFile } from '@shared/audio'
import { writeFileAtomic } from './fs-safe'

const EXTENSION_BY_MIME: Record<string, string> = {
  'audio/aac': '.aac',
  'audio/flac': '.flac',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
  'audio/wav': '.wav',
  'audio/webm': '.webm',
  'audio/x-m4a': '.m4a',
  'audio/x-wav': '.wav',
}

const PENDING_NAME =
  /^audio-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:aac|flac|mp3|m4a|ogg|opus|wav|webm)$/i

export interface TemporaryAudio {
  path: string
  fingerprint: string
  dispose(): void
}

export function materializeAudioAttachment(dataDirectory: string, input: AttachmentInput): TemporaryAudio {
  if (!isAudioFile(input.name, input.mime)) throw new Error('Anexe somente um áudio compatível para a transcrição local.')
  if (input.path)
    throw new Error('Por segurança, envie o áudio novamente pelo seletor local; caminhos de arquivo não são aceitos para transcrição.')
  if (
    typeof input.dataBase64 !== 'string' ||
    !input.dataBase64 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.dataBase64)
  )
    throw new Error('O anexo de áudio veio vazio ou inválido.')
  return materializeTemporaryAudio(dataDirectory, basename(input.name), input.mime, Buffer.from(input.dataBase64, 'base64'))
}

/** Saves an in-memory Telegram audio buffer into a private disposable directory; never persists metadata. */
export function materializeTemporaryAudio(
  dataDirectory: string,
  fileName: string,
  mime: string | undefined,
  bytes: Uint8Array,
): TemporaryAudio {
  if (!isAudioFile(fileName, mime)) throw new Error('O Telegram enviou um formato que não é áudio reconhecido.')
  if (!bytes.byteLength || bytes.byteLength > AUDIO_MAX_BYTES) throw new Error('O áudio precisa ter até 20 MB.')
  const suppliedExtension = extname(fileName).toLowerCase()
  const extension = suppliedExtension && isAudioFile(`audio${suppliedExtension}`) ? suppliedExtension : EXTENSION_BY_MIME[mime ?? '']
  if (!extension) throw new Error('Não reconheci a extensão deste áudio. Peça o reenvio em WAV, MP3, M4A, OGG ou WebM.')

  const directory = join(dataDirectory, 'audio-pending')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const directoryInfo = lstatSync(directory)
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error('A pasta temporária de áudio não é segura.')
  const path = join(directory, `audio-${randomUUID()}${extension}`)
  writeFileAtomic(path, bytes, 0o600)
  const fingerprint = createHash('sha256').update(bytes).digest('hex')
  let disposed = false
  return {
    path,
    fingerprint,
    dispose: () => {
      if (disposed) return
      disposed = true
      try {
        unlinkSync(path)
      } catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT')
          // Avoid leaking a full temporary path in user-visible UI/log output.
          // eslint-disable-next-line preserve-caught-error
          throw new Error('Não consegui apagar a cópia temporária do áudio.')
      }
    },
  }
}

/** Removes only stale, app-named disposable audio files left behind by a previous process crash. */
export function cleanupTemporaryAudio(dataDirectory: string): void {
  const directory = join(dataDirectory, 'audio-pending')
  try {
    const directoryInfo = lstatSync(directory)
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) return
    for (const name of readdirSync(directory)) {
      if (!PENDING_NAME.test(name)) continue
      const path = join(directory, name)
      const info = lstatSync(path)
      if (info.isFile() && !info.isSymbolicLink()) unlinkSync(path)
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return
    // Stale-file cleanup is best-effort and deliberately hides local path details.
    // eslint-disable-next-line preserve-caught-error
    throw new Error('Não consegui limpar os áudios temporários antigos com segurança.')
  }
}
