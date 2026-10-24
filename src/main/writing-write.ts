import { randomBytes } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { appendSnippet, appendVersion as appendVersionToDocument, parseWriting, serializeWriting, WritingSnippet } from '@shared/writing'

const WRITING_FILE = 'escrita.md'
const CHANGED = 'O escrita.md mudou desde que você abriu a biblioteca, então nada foi escrito. Recarregue a biblioteca e tente outra vez.'

export interface WritingWriterOptions {
  now?: () => Date
  newId?: () => string
  newBackupId?: () => string
  /** Internal test seam for verifying complete writes of staged lock-owner bytes. */
  writeSync?: (fd: number, buffer: Buffer, offset: number, length: number) => number
  /** Internal test seam, invoked after staging the canonical temp and before the final snapshot check. */
  afterCanonicalTempWrite?: () => void
}

/** Create a cryptographically unpredictable sibling without opening an existing path. */
function writeTempSibling(file: string, text: string | Buffer, root?: string): string {
  const temp = `${file}.${randomBytes(16).toString('hex')}.tmp`
  const fd = openSync(temp, 'wx')
  let failure: unknown
  try {
    if (root) assertSafePath(root, temp, false)
    const buffer = Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8')
    let offset = 0
    while (offset < buffer.length) offset += writeSync(fd, buffer, offset, buffer.length - offset)
    fsyncSync(fd)
  } catch (error) {
    failure = error
  }
  try {
    closeSync(fd)
  } catch (error) {
    failure ??= error
  }
  if (failure !== undefined) {
    try {
      rmSync(temp, { force: true })
    } catch {
      // Keep the write/fsync/close failure as the actionable cause.
    }
    throw failure
  }
  return temp
}

/**
 * Replace the target only after a fully-written sibling and last-moment snapshot/path checks.
 * An edit detected during staging is refused. Node lacks portable directory-relative
 * openat/renameat2 operations, so a hostile local process can still swap a checked path in the
 * remaining syscall gap.
 */
function writeSafeAtomic(root: string, file: string, text: string, verifyBeforeRename: (temp: string) => void): void {
  assertSafePath(root, file)
  const temp = writeTempSibling(file, text, root)
  try {
    assertSafePath(root, file)
    assertSafePath(root, temp, false)
    verifyBeforeRename(temp)
    renameSync(temp, file)
  } finally {
    rmSync(temp, { force: true })
  }
}

function stampOf(date: Date): string {
  const p = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

interface LockOwner {
  pid: number
  nonce: string
}

function parseLockOwner(contents: string): LockOwner {
  try {
    const owner = JSON.parse(contents) as Partial<LockOwner>
    if (!Number.isSafeInteger(owner.pid) || owner.pid! <= 0 || typeof owner.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(owner.nonce))
      throw new Error('invalid')
    return owner as LockOwner
  } catch {
    throw new Error(
      'O lock de escrita está ambíguo. Verifique escrita.md.lock e remova-o somente após confirmar que não há uma gravação ativa.',
    )
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return false
    if (code === 'EPERM') return true
    throw error
  }
}

/**
 * Publish a complete owner record without exposing partial lock contents. Stale or ambiguous locks
 * require manual recovery after confirming no writer is active. Portable path APIs cannot fully
 * eliminate TOCTOU races against a hostile local process.
 */
function acquireWriteLock(root: string, write: (fd: number, buffer: Buffer, offset: number, length: number) => number): () => void {
  const path = join(root, `${WRITING_FILE}.lock`)
  for (let attempt = 0; attempt < 2; attempt++) {
    assertSafePath(root, path)
    const nonce = randomBytes(16).toString('hex')
    const temp = `${path}.${randomBytes(16).toString('hex')}.tmp`
    let fd: number | undefined
    try {
      fd = openSync(temp, 'wx')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw error
    }
    let published = false
    let retry = false
    let operationError: unknown
    try {
      assertSafePath(root, temp, false)
      const payload = JSON.stringify({ pid: process.pid, nonce } satisfies LockOwner)
      const bytes = Buffer.from(payload, 'utf8')
      let offset = 0
      while (offset < bytes.length) {
        const written = write(fd, bytes, offset, bytes.length - offset)
        if (written <= 0) throw new Error('Não foi possível completar a gravação do lock de escrita.')
        offset += written
      }
      fsyncSync(fd)
      closeSync(fd)
      fd = undefined
      assertSafePath(root, temp, false)
      assertSafePath(root, path)
      try {
        linkSync(temp, path)
        published = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        let stat
        try {
          stat = lstatSync(path)
        } catch (statError) {
          if ((statError as NodeJS.ErrnoException).code === 'ENOENT') retry = true
          else throw statError
        }
        if (!retry) {
          if (stat!.isSymbolicLink()) throw new Error('O lock escrita.md.lock não pode ser um atalho simbólico.', { cause: error })
          if (!stat!.isFile()) throw new Error('O lock de escrita está ambíguo. Verifique escrita.md.lock manualmente.', { cause: error })
          const owner = parseLockOwner(readFileSync(path, 'utf8'))
          if (processExists(owner.pid))
            throw new Error('A escrita está ocupada por outro processo. Aguarde e tente novamente.', { cause: error })
          throw new Error(
            'O lock de escrita parece stale. Para recuperar, remova escrita.md.lock manualmente somente após confirmar que não há uma gravação ativa.',
            { cause: error },
          )
        }
      }
    } catch (error) {
      operationError = error
    }
    let cleanupError: unknown
    try {
      if (fd !== undefined) closeSync(fd)
    } catch (error) {
      cleanupError = error
    }
    try {
      rmSync(temp, { force: true })
    } catch (error) {
      cleanupError ??= error
    }
    if (cleanupError !== undefined) {
      if (published) {
        try {
          assertSafePath(root, path, false)
          const owner = parseLockOwner(readFileSync(path, 'utf8'))
          if (owner.nonce !== nonce) throw new Error('O lock agora pertence a outro processo.')
          rmSync(path)
        } catch (releaseError) {
          if ((releaseError as NodeJS.ErrnoException).code !== 'ENOENT')
            operationError = new Error(
              'Não foi possível liberar o lock de escrita com segurança. Verifique escrita.md.lock e recupere-o manualmente somente após confirmar que não há uma gravação ativa.',
              { cause: releaseError },
            )
        }
        // The first temp cleanup failed; retry once after rolling back the published lock.
        try {
          rmSync(temp, { force: true })
        } catch {
          // The original cleanup error remains the reported failure.
        }
      }
    }
    if (operationError !== undefined) throw operationError
    if (cleanupError !== undefined) throw cleanupError
    if (retry) continue
    return () => {
      try {
        assertSafePath(root, path, false)
        const owner = parseLockOwner(readFileSync(path, 'utf8'))
        if (owner.nonce === nonce) rmSync(path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  }
  throw new Error('Não foi possível recuperar o lock de escrita com segurança. Verifique escrita.md.lock manualmente.')
}

/** Reject symlink path components and existing paths that resolve outside the canonical vault. */
function assertSafePath(root: string, path: string, allowMissingLeaf = true): void {
  if (!inside(root, resolve(path))) throw new Error('O caminho de escrita saiu do vault; nada foi alterado.')
  const rel = relative(root, resolve(path))
  let current = root
  for (const part of rel ? rel.split(sep) : []) {
    current = join(current, part)
    try {
      const stat = lstatSync(current)
      if (stat.isSymbolicLink()) throw new Error('Atalhos simbólicos não são permitidos nos arquivos de escrita ou backups.')
      if (current !== path && !stat.isDirectory() && current !== resolve(path))
        throw new Error('Um diretório do caminho de escrita não é válido; nada foi alterado.')
      const actual = realpathSync(current)
      if (!inside(root, actual)) throw new Error('O caminho de escrita saiu do vault; nada foi alterado.')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && allowMissingLeaf) continue
      throw error
    }
  }
}

/** One writer per app session. It owns escrita.md only; a dated backup is made once per vault per writer instance, like goals-write. */
export function createWritingWriter(options: WritingWriterOptions = {}) {
  const snapshots = new Map<string, Buffer | null>()
  const backedUp = new Set<string>()
  const now = options.now ?? (() => new Date())
  const newId = options.newId ?? (() => randomBytes(16).toString('hex'))
  const newBackupId = options.newBackupId ?? (() => randomBytes(8).toString('hex'))

  const rootOf = (vault: string): string => {
    try {
      return realpathSync(vault)
    } catch (error) {
      throw new Error('Não foi possível acessar o vault para ler escrita.md.', { cause: error })
    }
  }
  const fileOf = (root: string) => join(root, WRITING_FILE)
  const readDisk = (root: string): Buffer | null => {
    const file = fileOf(root)
    assertSafePath(root, file)
    try {
      return readFileSync(file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }
  const snapshot = (root: string): Buffer | null => {
    if (!snapshots.has(root)) throw new Error('Abra a biblioteca de escrita de novo antes de salvar alterações.')
    const before = snapshots.get(root)!
    if (!sameBytes(readDisk(root), before)) throw new Error(CHANGED)
    return before
  }
  const sameBytes = (left: Buffer | null, right: Buffer | null): boolean =>
    left === null ? right === null : right !== null && left.equals(right)
  const backup = (root: string, text: Buffer): void => {
    const dir = join(root, 'backups', 'escrita')
    // Check every existing ancestor before mkdir so an existing symlink cannot redirect creation.
    assertSafePath(root, dir)
    mkdirSync(dir, { recursive: true })
    assertSafePath(root, dir, false)
    const stamp = stampOf(now())
    const base = `escrita-${stamp}`
    let sequence = 1
    for (;;) {
      const suffix = sequence === 1 ? '' : `-${sequence}`
      let dest = join(dir, `${base}${suffix}.md`)
      try {
        assertSafePath(root, dest)
        assertSafePath(root, dir, false)
        assertSafePath(root, dest)
        const temp = writeTempSibling(dest, text, root)
        try {
          assertSafePath(root, dir, false)
          assertSafePath(root, dest)
          assertSafePath(root, temp, false)
          linkSync(temp, dest)
          return
        } finally {
          rmSync(temp, { force: true })
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        // Keep the readable date/counter; a random suffix lets concurrent reservations coexist.
        if (sequence > 1) dest = join(dir, `${base}-${sequence}-${newBackupId()}.md`)
        else {
          sequence++
          continue
        }
        try {
          assertSafePath(root, dest)
          assertSafePath(root, dir, false)
          assertSafePath(root, dest)
          const temp = writeTempSibling(dest, text, root)
          try {
            assertSafePath(root, dir, false)
            assertSafePath(root, dest)
            assertSafePath(root, temp, false)
            linkSync(temp, dest)
            return
          } finally {
            rmSync(temp, { force: true })
          }
        } catch (retryError) {
          if ((retryError as NodeJS.ErrnoException).code !== 'EEXIST') throw retryError
          sequence++
        }
      }
    }
  }
  const save = (root: string, before: Buffer | null, after: string): void => {
    const release = acquireWriteLock(root, options.writeSync ?? writeSync)
    try {
      if (!sameBytes(readDisk(root), before)) throw new Error(CHANGED)
      if (!backedUp.has(root)) {
        backup(root, before ?? Buffer.alloc(0))
        backedUp.add(root)
      }
      // Backup creation can take time; ensure no external edit happened before the canonical write.
      if (!sameBytes(readDisk(root), before)) throw new Error(CHANGED)
      assertSafePath(root, fileOf(root))
      writeSafeAtomic(root, fileOf(root), after, (temp) => {
        assertSafePath(root, fileOf(root))
        assertSafePath(root, temp, false)
        options.afterCanonicalTempWrite?.()
        assertSafePath(root, fileOf(root))
        assertSafePath(root, temp, false)
        if (!sameBytes(readDisk(root), before)) throw new Error(CHANGED)
      })
      snapshots.set(root, Buffer.from(after, 'utf8'))
    } finally {
      release()
    }
  }

  return {
    assertSnapshot(vault: string, expectedSnapshot: string | null): void {
      const root = rootOf(vault)
      const expected = expectedSnapshot === null ? null : Buffer.from(expectedSnapshot, 'utf8')
      if (!sameBytes(readDisk(root), expected)) throw new Error(CHANGED)
    },
    read(vault: string) {
      const root = rootOf(vault)
      const text = readDisk(root)
      const document = parseWriting(text?.toString('utf8') ?? '')
      snapshots.set(root, text)
      return { text: text?.toString('utf8') ?? null, snapshot: text?.toString('utf8') ?? null, snippets: document.snippets }
    },
    createOriginal(vault: string, input: { title: string; body: string }): string {
      const root = rootOf(vault)
      const before = snapshot(root)
      const document = parseWriting(before?.toString('utf8') ?? '')
      const id = `w${newId()}`
      const snippet = WritingSnippet.createOriginal({ id, title: input.title, body: input.body, createdAt: now().toISOString() })
      const after = serializeWriting(appendSnippet(document, snippet))
      save(root, before, after)
      return id
    },
    appendVersion(
      vault: string,
      input: { snippetId: string; baseVersionId: string; body: string; expectedSnapshot?: string | null },
    ): void {
      const root = rootOf(vault)
      // A long-running assistant call must use the bytes captured before send, not a later read's cache.
      const before = Object.hasOwn(input, 'expectedSnapshot')
        ? input.expectedSnapshot === null
          ? null
          : Buffer.from(input.expectedSnapshot!, 'utf8')
        : snapshot(root)
      if (!sameBytes(readDisk(root), before)) throw new Error(CHANGED)
      const document = parseWriting(before?.toString('utf8') ?? '')
      const snippet = document.snippets.find((item) => item.id === input.snippetId)
      if (!snippet) throw new Error('O trecho solicitado não existe em escrita.md. Recarregue a biblioteca.')
      // Work on a detached aggregate: the domain method mutates its in-memory version list.
      const updatedSnippet = WritingSnippet.restore(snippet.id, snippet.title, snippet.versions)
      const version = updatedSnippet.appendVersion({
        versionId: `v${newId()}`,
        baseVersionId: input.baseVersionId,
        body: input.body,
        createdAt: now().toISOString(),
      })
      const after = serializeWriting(appendVersionToDocument(document, input.snippetId, version))
      save(root, before, after)
    },
  }
}

export type WritingWriter = ReturnType<typeof createWritingWriter>
