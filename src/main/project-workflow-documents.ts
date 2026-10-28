import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'

export interface ProjectDocument {
  path: string
  content: string
}

export interface ProjectDocuments {
  documents: ProjectDocument[]
  bytes: number
  skipped: number
}

const MAX_DOCUMENTS = 40
const MAX_FILE_BYTES = 100_000
const MAX_TOTAL_BYTES = 400_000
const DOCUMENT_EXTENSIONS = new Set(['.md', '.mdx', '.rst', '.txt'])
const EXCLUDED_DIRS = new Set(['.git', '.claude', '.obsidian', 'node_modules', 'vendor', 'dist', 'build', 'coverage', '.next', '.venv', 'venv'])
const SENSITIVE_NAME = /(^|[._-])(secret|secrets|credential|credentials|private|token|password|passwd)([._-]|$)|\.env/i
const SECRET_CONTENT = [
  /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/i,
  /\bsk-ant-[A-Za-z0-9_-]{12,}/,
  /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?[^\s"']{8,}/i,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
]

const inside = (root: string, path: string): boolean => {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

/**
 * Reads bounded, unignored text documentation from a Git project floor.
 * Git applies .gitignore; symlinks, source trees and likely secrets are excluded.
 */
export function readProjectDocuments(projectPath: string, excludedPaths: string[] = []): ProjectDocuments {
  let root: string
  try {
    root = realpathSync(projectPath)
  } catch {
    throw new Error('A pasta deste projeto não está disponível para leitura de documentos.')
  }
  const excludedRoots = excludedPaths.flatMap((path) => {
    try { return [realpathSync(path)] } catch { return [] }
  })

  let listed: string[]
  try {
    const output = execFileSync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '--', '*.md', '*.mdx', '*.rst', '*.txt'], {
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 2_000_000,
      windowsHide: true,
    })
    listed = [...new Set(output.split(/\r?\n/).filter(Boolean))].sort()
  } catch {
    throw new Error('A Emi só pode buscar documentos em um projeto Git para respeitar o .gitignore.')
  }

  const documents: ProjectDocument[] = []
  let bytes = 0
  let skipped = 0
  for (const path of listed) {
    if (documents.length >= MAX_DOCUMENTS || bytes >= MAX_TOTAL_BYTES) {
      skipped++
      continue
    }
    const parts = path.split(/[\\/]/)
    if (parts.some((part) => EXCLUDED_DIRS.has(part.toLowerCase())) || parts.some((part) => SENSITIVE_NAME.test(part))) {
      skipped++
      continue
    }
    if (!DOCUMENT_EXTENSIONS.has(extname(path).toLowerCase())) continue

    const fullPath = resolve(root, path)
    if (!inside(root, fullPath)) {
      skipped++
      continue
    }
    if (excludedRoots.some((excluded) => inside(excluded, fullPath))) {
      skipped++
      continue
    }
    try {
      const stat = lstatSync(fullPath)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES || bytes + stat.size > MAX_TOTAL_BYTES) {
        skipped++
        continue
      }
      const realPath = realpathSync(fullPath)
      if (!inside(root, realPath) || excludedRoots.some((excluded) => inside(excluded, realPath))) {
        skipped++
        continue
      }
      const content = readFileSync(realPath, 'utf8')
      if (content.includes('\0') || SECRET_CONTENT.some((pattern) => pattern.test(content))) {
        skipped++
        continue
      }
      documents.push({ path: path.replaceAll('\\', '/'), content })
      bytes += stat.size
    } catch {
      skipped++
    }
  }
  return { documents, bytes, skipped }
}
