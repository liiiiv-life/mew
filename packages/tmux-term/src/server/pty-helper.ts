import { chmodSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)

/** node-pty 1.1.0's macOS prebuilds ship spawn-helper without its executable bit. */
export function ensureExecutableHelper(helper: string) {
  const mode = statSync(helper).mode
  if (!(mode & 0o100)) chmodSync(helper, (mode & 0o777) | 0o100)
}

export function preparePtyHelper() {
  if (process.platform !== 'darwin') return
  const root = path.dirname(require.resolve('node-pty/package.json'))
  // Use the native module actually loaded by node-pty, including local builds.
  const native = Object.keys(require.cache).find((file) =>
    file.startsWith(root + path.sep) && path.basename(file) === 'pty.node',
  )
  if (!native) throw new Error('Cannot locate the loaded node-pty native module')
  ensureExecutableHelper(path.join(path.dirname(native), 'spawn-helper'))
}
