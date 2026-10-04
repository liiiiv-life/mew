/** Convert a Git fetch remote into a credential-free browser link. */
export function gitOriginLink(remote: string | undefined): string | null {
  if (!remote || /^(?:javascript|data|file|vbscript):/i.test(remote) || /^[A-Za-z]:[\\/]/.test(remote)) return null
  const scp = /^(?:[^@/:]+@)?([^/:]+):(.+)$/.exec(remote)
  const address = !remote.includes('://') && scp ? `https://${scp[1]}/${scp[2]}` : remote
  try {
    const url = new URL(address)
    if (['ssh:', 'git:'].includes(url.protocol)) {
      return gitOriginLink(`https://${url.hostname}${url.pathname}`)
    }
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname) return null
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    url.pathname = url.pathname.replace(/\/+$/, '').replace(/\.git$/, '')
    return url.href
  } catch {
    return null
  }
}
