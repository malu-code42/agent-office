import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AudioDictionaryStore, isAudioDictionaryData, normalizeAudioPhrase } from '../src/main/audio-dictionary'

const dirs: string[] = []
const store = (now = 123) => {
  const directory = mkdtempSync(join(tmpdir(), 'ao-audio-dict-'))
  dirs.push(directory)
  return new AudioDictionaryStore(directory, () => now)
}

afterEach(() => {
  for (const directory of dirs.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('dicionário contextual local de áudio', () => {
  it('normaliza acentos e registra somente a correção confirmada com contexto', () => {
    const dictionary = store()
    expect(normalizeAudioPhrase('Amanhã, São João!')).toBe('amanha sao joao')
    dictionary.remember('casa da Agatha', 'Casa da Agatha', 'Vou passar na casa da Agatha amanhã')
    expect(dictionary.find('CASA da Ágatha')).toEqual([
      { heard: 'casa da Agatha', correction: 'Casa da Agatha', context: 'Vou passar na casa da Agatha amanhã', updatedAt: 123 },
    ])
  })

  it('mantém correções conflitantes distintas para perguntar quando o contexto não decidir', () => {
    const dictionary = store()
    dictionary.remember('luna', 'Luna', 'A agente Luna')
    dictionary.remember('luna', 'lona', 'Compre uma lona')
    expect(dictionary.find('Luna').map((entry) => entry.correction)).toEqual(['Luna', 'lona'])
  })

  it('deduplica a mesma correção e rejeita valores inválidos', () => {
    const dictionary = store()
    dictionary.remember('Rita', 'Rita', 'Nome de pessoa')
    dictionary.remember('rita', 'Rita', 'Nome confirmado')
    expect(dictionary.find('Rita')).toHaveLength(1)
    expect(() => dictionary.remember('', 'Rita', '')).toThrow(/não pode ficar vazia/)
    expect(isAudioDictionaryData({ entries: [{ heard: 'Rita', correction: 'Rita', context: 'ok', updatedAt: 1 }] })).toBe(true)
    expect(isAudioDictionaryData({ entries: [{ heard: '', correction: 'Rita', context: 'ok', updatedAt: 1 }] })).toBe(false)
  })
})
