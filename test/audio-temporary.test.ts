import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupTemporaryAudio, materializeAudioAttachment, materializeTemporaryAudio } from '../src/main/audio-temporary'

const dirs: string[] = []
const dataDirectory = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'ao-audio-temp-'))
  dirs.push(path)
  return path
}

afterEach(() => {
  for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('cópia efêmera de áudio', () => {
  it('grava apenas bytes sintéticos e apaga a cópia após a liberação', () => {
    const data = Buffer.from('synthetic audio bytes')
    const copy = materializeTemporaryAudio(dataDirectory(), 'voice.ogg', 'audio/ogg', data)
    expect(readFileSync(copy.path)).toEqual(data)
    copy.dispose()
    expect(existsSync(copy.path)).toBe(false)
  })

  it('recusa formato inesperado, buffer vazio e limite acima de 20 MB sem criar arquivos', () => {
    const dir = dataDirectory()
    expect(() => materializeTemporaryAudio(dir, 'note.txt', 'text/plain', Buffer.from('not audio'))).toThrow(/não é áudio/)
    expect(() => materializeTemporaryAudio(dir, 'empty.ogg', 'audio/ogg', Buffer.alloc(0))).toThrow(/até 20 MB/)
    expect(() => materializeTemporaryAudio(dir, 'large.ogg', 'audio/ogg', Buffer.alloc(20 * 1024 * 1024 + 1))).toThrow(/até 20 MB/)
    expect(existsSync(join(dir, 'audio-pending'))).toBe(false)
  })

  it('nunca abre caminhos de arquivo arbitrários recebidos pela IPC da Luna', () => {
    expect(() =>
      materializeAudioAttachment(dataDirectory(), {
        name: 'voice.wav',
        mime: 'audio/wav',
        path: 'C:/synthetic/not-selected-by-user.wav',
      }),
    ).toThrow(/caminhos de arquivo não são aceitos/)
  })

  it('limpa apenas arquivos temporários próprios deixados por uma queda', () => {
    const data = dataDirectory()
    const pending = join(data, 'audio-pending')
    mkdirSync(pending)
    const staleAudio = join(pending, 'audio-123e4567-e89b-42d3-a456-426614174000.wav')
    const unrelated = join(pending, 'keep-this.txt')
    writeFileSync(staleAudio, 'synthetic orphan')
    writeFileSync(unrelated, 'not ours')

    cleanupTemporaryAudio(data)
    expect(existsSync(staleAudio)).toBe(false)
    expect(readFileSync(unrelated, 'utf8')).toBe('not ours')
  })
})
