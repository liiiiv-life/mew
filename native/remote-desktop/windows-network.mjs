import path from 'node:path'

/** Local kernel lookup, without a cold PowerShell/CIM process or router traffic.
 * Windows SDK x64/arm64: SOCKADDR_INET=28, MIB_IPFORWARD_ROW2=104,
 * NextHop offset=44. IPv4 bytes begin four bytes into SOCKADDR_INET. */
export async function windowsDesktopRoutes({ signal, load = () => import('koffi') } = {}) {
  signal?.throwIfAborted()
  const binding = await load()
  signal?.throwIfAborted()
  const koffi = binding.default ?? binding
  const library = koffi.load(path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'iphlpapi.dll'))
  const bestRoute = library.func('uint32 __stdcall GetBestRoute2(const void *, uint32, const void *, const void *, uint32, void *, void *)')
  const destination = Buffer.alloc(28), row = Buffer.alloc(104), source = Buffer.alloc(28)
  destination.writeUInt16LE(2); Buffer.from([1, 1, 1, 1]).copy(destination, 4)
  const result = bestRoute(null, 0, null, destination, 0, row, source)
  if (result !== 0) throw new Error('Windows IPv4 경로를 확인할 수 없습니다.')
  if (row.readUInt16LE(44) !== 2 || source.readUInt16LE(0) !== 2) return []
  const address = buffer => Array.from(buffer).join('.')
  return [{ gateway: address(row.subarray(48, 52)), address: address(source.subarray(4, 8)) }]
}
