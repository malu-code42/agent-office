import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { LocalAudioTranscriber, pythonCandidates, type ExecFileRunner } from '../src/main/audio-transcriber'

const result = (data: unknown) => ({ stdout: JSON.stringify(data), stderr: '' })

describe('transcrição de áudio local', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ao-asr-'))
  const audio = join(dir, 'fala.wav')
  writeFileSync(audio, Buffer.from('synthetic wav fixture'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('prefere runtimes locais por plataforma sem envolver shell', async () => {
    expect(pythonCandidates('win32')).toEqual([
      { executable: 'python', prefix: [] },
      { executable: 'py', prefix: ['-3'] },
      { executable: 'python3', prefix: [] },
    ])
    expect(pythonCandidates('linux').map((x) => x.executable)).toEqual(['python3', 'python'])
  })

  it('decodifica segmentos e marca intervalos incertos pelo score local', async () => {
    const run = vi.fn<ExecFileRunner>().mockResolvedValue(
      result({
        language: 'pt',
        segments: [
          { start: 0, end: 1.4, text: 'Comprar ração', avgLogprob: -0.2, noSpeechProb: 0.03 },
          { start: 1.4, end: 2.1, text: 'na quinta?', avgLogprob: -1.2, noSpeechProb: 0.04 },
        ],
      }),
    )
    const transcriber = new LocalAudioTranscriber({
      platform: 'linux',
      env: {},
      run,
    })

    await expect(transcriber.transcribe(audio)).resolves.toEqual({
      language: 'pt',
      text: 'Comprar ração na quinta?',
      segments: [
        { start: 0, end: 1.4, text: 'Comprar ração', uncertain: false },
        { start: 1.4, end: 2.1, text: 'na quinta?', uncertain: true },
      ],
    })
    expect(run).toHaveBeenCalledTimes(1)
    const [command, args, options] = run.mock.calls[0]!
    expect(command).toBe('python3')
    expect(args).toContain('-c')
    expect(args.at(-1)).toBe(audio)
    expect(options.env.HF_HUB_OFFLINE).toBe('1')
    expect(options.env.TRANSFORMERS_OFFLINE).toBe('1')
    expect(options.timeout).toBeGreaterThan(0)
  })

  it('continua com o runtime local alternativo se o primeiro comando não existir', async () => {
    const missing = Object.assign(new Error('no python3'), { code: 'ENOENT' })
    const run = vi
      .fn<ExecFileRunner>()
      .mockRejectedValueOnce(missing)
      .mockResolvedValueOnce(result({ language: 'pt', segments: [] }))
    const transcriber = new LocalAudioTranscriber({ platform: 'linux', env: {}, run })

    await expect(transcriber.transcribe(audio)).rejects.toThrow(/Não consegui reconhecer fala/)
    expect(run).toHaveBeenCalledTimes(2)
    expect(run.mock.calls[1]?.[0]).toBe('python')
  })

  it('para sem enviar quando não há modelo já em cache', async () => {
    const run = vi.fn<ExecFileRunner>().mockResolvedValue(result({ error: 'no_cached_model' }))
    const transcriber = new LocalAudioTranscriber({ platform: 'linux', env: {}, run })

    await expect(transcriber.transcribe(audio)).rejects.toThrow(/Não há um modelo de transcrição local em cache/)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0]?.[2].env.HF_HUB_OFFLINE).toBe('1')
  })

  it('recusa extensões não reconhecidas, links simbólicos, arquivos vazios e áudio acima do limite', async () => {
    const run = vi.fn<ExecFileRunner>().mockResolvedValue(result({ language: 'pt', segments: [] }))
    const transcriber = new LocalAudioTranscriber({ platform: 'linux', env: {}, run })
    const textFile = join(dir, 'nota.txt')
    const emptyFile = join(dir, 'vazio.mp3')
    const largeFile = join(dir, 'grande.flac')
    const symlink = join(dir, 'link.wav')
    writeFileSync(textFile, 'texto sintético')
    writeFileSync(emptyFile, '')
    writeFileSync(largeFile, Buffer.alloc(20 * 1024 * 1024 + 1))

    await expect(transcriber.transcribe(textFile)).rejects.toThrow(/arquivo de áudio compatível/)
    await expect(transcriber.transcribe(emptyFile)).rejects.toThrow(/arquivo de áudio precisa ser regular/)
    await expect(transcriber.transcribe(largeFile)).rejects.toThrow(/arquivo de áudio precisa ser regular/)
    try {
      const { symlinkSync } = await import('node:fs')
      symlinkSync(audio, symlink)
      await expect(transcriber.transcribe(symlink)).rejects.toThrow(/arquivo de áudio precisa ser regular/)
    } catch (error) {
      if (error instanceof Error && !error.message.includes('EPERM') && !error.message.includes('EACCES')) throw error
    }
    expect(run).not.toHaveBeenCalled()
  })

  it('não revela mensagens brutas do subprocesso e recusa JSON inválido', async () => {
    const error = Object.assign(new Error('raw stdout contains private transcript'), { code: 'EIO' })
    const failed = new LocalAudioTranscriber({ platform: 'linux', env: {}, run: vi.fn<ExecFileRunner>().mockRejectedValue(error) })
    await expect(failed.transcribe(audio)).rejects.toThrow(/transcrição local falhou/i)
    await expect(
      new LocalAudioTranscriber({
        platform: 'linux',
        env: {},
        run: vi.fn<ExecFileRunner>().mockResolvedValue({ stdout: 'not-json', stderr: 'private audio data' }),
      }).transcribe(audio),
    ).rejects.toThrow(/resposta inválida/)
  })
})
