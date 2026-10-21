/** Extracts the host from common HTTPS, SSH URL, or scp-style git remotes. */
export function gitRemoteHost(value: string): string | null {
  try {
    const remote = value.trim()
    const scp = /^(?:[^@/:]+@)?([^/:]+):[^/].*$/.exec(remote)
    const url = new URL(scp ? `ssh://${scp[1]}` : remote)
    if (!['https:', 'ssh:'].includes(url.protocol) || !url.hostname) return null
    return url.host.toLowerCase()
  } catch {
    return null
  }
}

/** Returns the owner/repository identity from HTTPS, SSH, or scp-style git remotes. */
export function gitRemoteRepository(value: string): string | null {
  try {
    const remote = value.trim()
    const scp = remote.includes('://') ? null : /^(?:[^@/:]+@)?([^/:]+):(.+)$/.exec(remote)
    const url = new URL(scp ? `ssh://${scp[1]}/${scp[2]}` : remote)
    if (!['https:', 'ssh:'].includes(url.protocol) || !url.hostname) return null
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length < 2) return null
    const owner = parts.at(-2)!
    const repository = parts.at(-1)!.replace(/\.git$/i, '')
    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repository)) return null
    return `${owner}/${repository}`.toLowerCase()
  } catch {
    return null
  }
}

/** A gh PR URL must identify the exact repository selected by the git remote. */
export function isPullRequestUrl(value: string, expectedHost: string | null, expectedRepository: string | null): boolean {
  if (!expectedHost || !expectedRepository) return false
  try {
    const url = new URL(value)
    const match = /^\/([\w.-]+)\/([\w.-]+)\/pull\/\d+\/?$/.exec(url.pathname)
    return (
      url.protocol === 'https:' &&
      url.host.toLowerCase() === expectedHost.toLowerCase() &&
      !url.username &&
      !url.password &&
      !!match &&
      `${match[1]}/${match[2]}`.toLowerCase() === expectedRepository.toLowerCase()
    )
  } catch {
    return false
  }
}
