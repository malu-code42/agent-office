/** Extracts the host from common HTTPS, SSH URL, or scp-style git remotes. */
export function gitRemoteHost(value: string): string | null {
  try {
    const remote = value.trim()
    const scp = /^(?:[^@/:]+@)?([^/:]+):[^/].*$/.exec(remote)
    const url = new URL(scp ? `ssh://${scp[1]}` : remote)
    if (!['https:', 'ssh:'].includes(url.protocol) || !url.hostname) return null
    return url.hostname.toLowerCase()
  } catch {
    return null
  }
}

/** A gh PR URL must be on the selected repository remote's host. */
export function isPullRequestUrl(value: string, expectedHost: string | null): boolean {
  if (!expectedHost) return false
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.hostname.toLowerCase() === expectedHost.toLowerCase() &&
      !url.username &&
      !url.password &&
      /^\/(?:[\w.-]+\/){2}pull\/\d+\/?$/.test(url.pathname)
    )
  } catch {
    return false
  }
}
