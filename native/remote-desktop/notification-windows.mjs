import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Shell notification work runs on its own short-lived native thread. */
export function windowsNotification(koffi, directory = path.dirname(fileURLToPath(import.meta.url))) {
  let library, start, stop
  return () => {
    library ??= koffi.load(path.join(directory, 'gpu-windows.dll'))
    start ??= library.func('void *mew_notice_start()')
    stop ??= library.func('void mew_notice_stop(void *)')
    const handle = start()
    let closed = false
    return () => { if (!closed) { closed = true; if (handle) stop(handle) } }
  }
}
