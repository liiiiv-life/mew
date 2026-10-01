import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import koffi from 'koffi'

const modes = { check: 0, accessibility: 1, screen: 2 }, mode = process.argv[2]
if (process.platform !== 'darwin' || modes[mode] === undefined) process.exit(1)
const directory = path.dirname(fileURLToPath(import.meta.url)), library = koffi.load(path.join(directory, 'gpu-macos.dylib'))
const permissions = library.func('int mew_gpu_permissions(int)'), pump = library.func('void mew_gpu_pump()')
const stop = () => process.exit(1)
process.stdin.resume(); process.stdin.on('end', stop); process.stdin.on('error', stop)
process.on('SIGINT', stop); process.on('SIGTERM', stop); process.stdout.on('error', stop)
const watchdog = setTimeout(stop, 35_000), runloop = setInterval(pump, 16)
try {
  if (mode !== 'check') process.stdout.write('MEW_DESKTOP_PERMISSION_REQUESTED\n')
  const value = permissions(modes[mode])
  if (mode !== 'check') {
    const child = spawn('/usr/bin/open', [`x-apple.systempreferences:com.apple.preference.security?${mode === 'screen' ? 'Privacy_ScreenCapture' : 'Privacy_Accessibility'}`], { stdio: 'ignore' })
    child.on('error', () => {})
  }
  clearTimeout(watchdog); clearInterval(runloop)
  process.stdout.write(`MEW_DESKTOP_PERMISSIONS ${JSON.stringify({ accessibility: !!(value & 1), screen: value & 2 ? 'granted' : 'denied' })}\n`, () => process.exit(0))
} catch { stop() }
