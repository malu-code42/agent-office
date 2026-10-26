import { execFile as execFileCallback } from 'node:child_process'
import { constants, fstatSync, lstatSync, openSync, closeSync } from 'node:fs'
import { resolve } from 'node:path'
import type { LocalAudioTranscript, AudioTranscriptSegment } from '@shared/audio'
import { AUDIO_MAX_BYTES, isAudioFile } from '@shared/audio'

const TRANSCRIBE_TIMEOUT_MS = 5 * 60_000
const MAX_TRANSCRIPT_BYTES = 1024 * 1024
const UNCERTAIN_LOG_PROB = -0.8
const UNCERTAIN_NO_SPEECH = 0.4

interface ExecResult {
  stdout: string
  stderr: string
}

export type ExecFileRunner = (
  file: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number; windowsHide: boolean },
) => Promise<ExecResult>

export class LocalAudioRuntimeUnavailable extends Error {}
export class LocalAudioProcessingFailure extends Error {}

export interface LocalAudioTranscriberOptions {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  run?: ExecFileRunner
  timeoutMs?: number
}

interface RuntimeCandidate {
  executable: string
  prefix: string[]
}

const TRANSCRIBE_SCRIPT = String.raw`
import json, os, sys
from pathlib import Path

audio_path = sys.argv[1]
roots = []
for key in ('HF_HUB_CACHE', 'HUGGINGFACE_HUB_CACHE'):
    value = os.environ.get(key)
    if value:
        roots.append(Path(value).expanduser())
home = Path.home()
hf_home = os.environ.get('HF_HOME')
if hf_home:
    roots.append(Path(hf_home).expanduser() / 'hub')
roots.append(home / '.cache' / 'huggingface' / 'hub')
roots = list(dict.fromkeys(roots))

snapshot = None
for size in ('small', 'base', 'tiny'):
    model_dir = 'models--Systran--faster-whisper-' + size
    for root in roots:
        snapshots = root / model_dir / 'snapshots'
        if not snapshots.is_dir():
            continue
        for candidate in sorted(snapshots.iterdir(), reverse=True):
            if (candidate / 'model.bin').is_file() and (candidate / 'config.json').is_file():
                snapshot = candidate
                break
        if snapshot:
            break
    if snapshot:
        break
if snapshot is None:
    print(json.dumps({'error': 'no_cached_model'}))
    sys.exit(42)

try:
    from faster_whisper import WhisperModel
except Exception:
    print(json.dumps({'error': 'runtime_unavailable'}))
    sys.exit(43)

try:
    model = WhisperModel(str(snapshot), device='cpu', compute_type='int8', local_files_only=True)
    segments, info = model.transcribe(audio_path, language='pt', vad_filter=True)
    output = []
    for segment in segments:
        output.append({
            'start': float(segment.start),
            'end': float(segment.end),
            'text': str(segment.text),
            'avgLogprob': float(segment.avg_logprob),
            'noSpeechProb': float(segment.no_speech_prob),
        })
    print(json.dumps({'language': str(info.language), 'segments': output}, ensure_ascii=False))
except Exception:
    print(json.dumps({'error': 'transcription_failed'}))
    sys.exit(44)
`

function execFile(
  file: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number; windowsHide: boolean },
): Promise<ExecResult> {
  return new Promise((resolvePromise, reject) => {
    execFileCallback(file, args, options, (error, stdout, stderr) => {
      if (error) {
        Object.assign(error, { stdout, stderr })
        reject(error)
        return
      }
      resolvePromise({ stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

export function pythonCandidates(platform: NodeJS.Platform): RuntimeCandidate[] {
  return platform === 'win32'
    ? [
        { executable: 'python', prefix: [] },
        { executable: 'py', prefix: ['-3'] },
        { executable: 'python3', prefix: [] },
      ]
    : [
        { executable: 'python3', prefix: [] },
        { executable: 'python', prefix: [] },
      ]
}

/** Local-only faster-whisper runner. It never downloads a model or falls back to a cloud service. */
export class LocalAudioTranscriber {
  private readonly platform: NodeJS.Platform
  private readonly env: NodeJS.ProcessEnv
  private readonly run: ExecFileRunner
  private readonly timeoutMs: number

  constructor(options: LocalAudioTranscriberOptions = {}) {
    this.platform = options.platform ?? process.platform
    this.env = options.env ?? process.env
    this.run = options.run ?? execFile
    this.timeoutMs = options.timeoutMs ?? TRANSCRIBE_TIMEOUT_MS
  }

  async transcribe(path: string): Promise<LocalAudioTranscript> {
    validateAudioFile(path)
    for (const candidate of pythonCandidates(this.platform)) {
      let result: ExecResult
      try {
        result = await this.run(candidate.executable, [...candidate.prefix, '-c', TRANSCRIBE_SCRIPT, resolve(path)], {
          env: { ...this.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', PYTHONIOENCODING: 'utf-8' },
          timeout: this.timeoutMs,
          maxBuffer: MAX_TRANSCRIPT_BYTES,
          windowsHide: true,
        })
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
        if (code === 'ENOENT' || code === 'EACCES') continue
        // Intentionally discard stderr/stdout because a subprocess failure may include transcript text or paths.
        throw new LocalAudioProcessingFailure('A transcrição local falhou. O áudio não foi enviado a nenhum serviço externo.')
      }

      let raw: unknown
      try {
        raw = JSON.parse(result.stdout.trim()) as unknown
      } catch {
        throw new LocalAudioProcessingFailure('O transcritor local devolveu uma resposta inválida. O áudio não saiu deste computador.')
      }
      if (!isRecord(raw)) {
        throw new LocalAudioProcessingFailure('O transcritor local devolveu uma resposta inválida. O áudio não saiu deste computador.')
      }
      if (raw.error === 'runtime_unavailable') continue
      if (raw.error === 'no_cached_model')
        throw new LocalAudioRuntimeUnavailable(
          'Não há um modelo de transcrição local em cache. Não baixei nem instalei um modelo; o áudio não foi enviado.',
        )
      if (raw.error === 'transcription_failed') {
        throw new LocalAudioProcessingFailure('A transcrição local falhou. Confira o formato do áudio e tente novamente.')
      }
      const transcript = parseTranscript(raw)
      return transcript
    }
    throw new LocalAudioRuntimeUnavailable(
      'Não encontrei Python com faster-whisper e modelo local em cache. Não instalei dependências nem enviei o áudio.',
    )
  }
}

function parseTranscript(raw: Record<string, unknown>): LocalAudioTranscript {
  if (typeof raw.language !== 'string' || !Array.isArray(raw.segments))
    throw new Error('O transcritor local devolveu uma resposta inválida.')
  const segments: AudioTranscriptSegment[] = []
  for (const value of raw.segments) {
    if (
      !isRecord(value) ||
      typeof value.text !== 'string' ||
      typeof value.start !== 'number' ||
      !Number.isFinite(value.start) ||
      typeof value.end !== 'number' ||
      !Number.isFinite(value.end) ||
      typeof value.avgLogprob !== 'number' ||
      !Number.isFinite(value.avgLogprob) ||
      typeof value.noSpeechProb !== 'number' ||
      !Number.isFinite(value.noSpeechProb)
    )
      throw new Error('O transcritor local devolveu um trecho inválido.')
    segments.push({
      start: value.start,
      end: value.end,
      text: value.text,
      uncertain: value.avgLogprob < UNCERTAIN_LOG_PROB || value.noSpeechProb > UNCERTAIN_NO_SPEECH,
    })
  }
  const text = segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(' ')
  if (!text) throw new Error('Não consegui reconhecer fala neste áudio. Nenhum dado foi gravado.')
  return { language: raw.language, text, segments }
}

function validateAudioFile(path: string): void {
  if (!isAudioFile(path, '')) throw new Error('Escolha um arquivo de áudio compatível para transcrever localmente.')
  let fd: number | undefined
  try {
    const before = lstatSync(path)
    if (!before.isFile() || before.isSymbolicLink() || before.size <= 0 || before.size > AUDIO_MAX_BYTES)
      throw new Error('O arquivo de áudio precisa ser regular e ter até 20 MB.')
    const noFollow = (constants as typeof constants & { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0
    fd = openSync(path, constants.O_RDONLY | noFollow)
    const opened = fstatSync(fd)
    const real = lstatSync(path)
    if (!opened.isFile() || real.isSymbolicLink() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size)
      throw new Error('O arquivo de áudio mudou durante a validação.')
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('O arquivo de áudio')) throw error
    // Do not expose local absolute paths or filesystem details in the user-visible error.
    // eslint-disable-next-line preserve-caught-error
    throw new Error('Não consegui ler o arquivo de áudio. Escolha outro arquivo e tente novamente.')
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
