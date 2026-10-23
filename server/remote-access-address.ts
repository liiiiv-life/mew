export async function resolveRemoteAddress(origin: string, owner: string, name: string): Promise<{ url: string; username: string; dashboardUrl: string }> {
  const publicOrigin = origin === 'https://mew.saens.kr' ? 'https://mew.run' : origin
  const address = new URL(`/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, publicOrigin)
  const response = await fetch(address, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(5000) })
  const location = response.headers.get('location')
  if (![301, 302, 307, 308].includes(response.status) || !location) throw new Error('public-username-unavailable')
  const target = new URL(location, address)
  const parts = target.pathname.split('/')
  if (target.origin !== publicOrigin || target.username || target.password || target.search || target.hash || parts.length !== 3 || !/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/.test(parts[1]) || parts[1] === owner || parts[2] !== encodeURIComponent(name)) throw new Error('invalid-public-address')
  return { url: target.href, username: parts[1], dashboardUrl: `${publicOrigin}/${parts[1]}` }
}
