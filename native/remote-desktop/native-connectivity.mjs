import { networkInterfaces } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isIP } from 'node:net'
import { randomBytes } from 'node:crypto'
import { pcpMap, pmpMap } from './nat-port-map.mjs'
import { upnpMap } from './nat-upnp.mjs'
import { linuxNetworkTool } from './network-support.mjs'
import { windowsDesktopRoutes } from './windows-network.mjs'
const run = promisify(execFile)
const privateV4 = value => {
  if (isIP(value) !== 4) return false
  const [a, b] = value.split('.').map(Number)
  return a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254
}
export async function desktopRoutes({ platform = process.platform, execute = run, interfaces = networkInterfaces, tool = linuxNetworkTool, windowsRoutes = windowsDesktopRoutes, signal } = {}) {
  let routes
  const options = { timeout: 2500, maxBuffer: 16384, signal, windowsHide: true }
  if (platform === 'win32') {
    routes = await windowsRoutes({ signal })
  } else if (platform === 'linux') {
    const ip = tool('ip')
    if (!ip) throw new Error('Linux IPv4 경로 탐색에는 iproute2가 필요합니다.')
    // Kernel lookup honors policy routing/VPN and chooses a source address.
    // This fixed public destination is looked up locally; no packet is sent.
    const data = JSON.parse((await execute(ip, ['-j', '-4', 'route', 'get', '1.1.1.1'], options)).stdout)
    const nics = interfaces()
    if (!Array.isArray(data)) throw new Error('잘못된 Linux IPv4 경로입니다.')
    routes = data.flatMap(route => (nics[route.dev] ?? []).filter(info => info.family === 'IPv4' && !info.internal && (!route.prefsrc || route.prefsrc === info.address)).map(info => ({ gateway: route.gateway, address: info.address })))
  } else if (platform === 'darwin') {
    const data = (await execute('/sbin/route', ['-n', 'get', '-inet', '1.1.1.1'], options)).stdout
    const gateway = /^\s*gateway:\s*(\S+)$/m.exec(data)?.[1], nic = /^\s*interface:\s*(\S+)$/m.exec(data)?.[1]
    routes = (interfaces()[nic] ?? []).filter(info => info.family === 'IPv4' && !info.internal).map(info => ({ gateway, address: info.address }))
  } else routes = []
  return (Array.isArray(routes) ? routes : [routes]).filter(route => route && privateV4(route.gateway) && privateV4(route.address)).slice(0, 4)
}

/** One mapping of the observed ICE UDP socket on the matching OS default route. */
export function nativeConnectivity({ emit, status = () => {}, enabled = true, delayMs = 2000, routes = desktopRoutes, map = [pcpMap, pmpMap, upnpMap], setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const controller = new AbortController(), jobs = [], attempts = new Set()
  let routePromise, mapping, timer, closed = false, connected = false, closing
  const report = state => { if (!closed) status(state) }
  const renew = lease => {
    clearTimer(timer)
    timer = setTimer(() => {
      if (closed || !mapping) return
      const current = mapping
      const job = current.renew().then(value => { if (!closed && mapping === current) renew(value) }).catch(() => {
        if (mapping === current && !closed) { report('expired'); mapping = undefined; return current.close().catch(() => {}) }
      })
      jobs.push(job)
    }, Math.max(250, Math.floor(lease * 1000 / 2)))
    timer?.unref?.()
  }
  const candidate = (candidate, mid) => {
    if (!enabled || closed || mapping || connected) return
    const fields = candidate.trim().split(/\s+/), index = fields.indexOf('typ'), port = Number(fields[5]), address = fields[4]
    if (fields.length < 8 || fields[1] !== '1' || fields[2]?.toLowerCase() !== 'udp' || fields[index + 1] !== 'host' || !privateV4(address) || !Number.isInteger(port) || port < 1024 || port > 65535 || attempts.has(address)) return
    attempts.add(address)
    const job = (async () => {
      await new Promise(resolve => {
        let wait
        const done = () => { clearTimer(wait); controller.signal.removeEventListener('abort', done); resolve() }
        wait = setTimer(done, delayMs); controller.signal.addEventListener('abort', done, { once: true })
        if (controller.signal.aborted) done()
      })
      if (closed || connected || mapping) return
      routePromise ??= routes({ signal: controller.signal }).catch(() => { report('route-unavailable'); return undefined })
      const available = await routePromise
      if (!available) return
      const route = available.find(value => value.address === address)
      if (closed || connected || mapping) return
      if (!route) { report('no-router'); return }
      report('discovering')
      for (const create of map) {
        if (closed || connected || mapping) return
        let current
        try {
          current = await create(route, port, { signal: controller.signal })
          if (closed || connected || mapping) { await current.close(); return }
          mapping = current; renew(current.lease); report('mapped')
          emit(`candidate:mew${randomBytes(8).toString('hex')} 1 UDP 1694498815 ${current.address} ${current.port} typ srflx raddr ${address} rport ${port}`, mid)
          return
        } catch { if (current) await current.close().catch(() => {}); if (controller.signal.aborted) return }
      }
      report('unavailable')
    })()
    jobs.push(job.catch(() => {}))
  }
  return {
    candidate,
    connected() { connected = true; if (!mapping) controller.abort() },
    close() {
      if (closing) return closing
      closed = true; clearTimer(timer); controller.abort()
      closing = (async () => { await Promise.allSettled(jobs); if (mapping) await mapping.close().catch(() => {}); mapping = undefined })()
      return closing
    },
  }
}
