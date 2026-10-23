/** Revoke first, then give native capture and temporary NAT cleanup a bounded
 * chance to finish. Clear race timers so a fast shutdown stays fast. */
const settle = async (operation, timeout) => {
  let timer
  try { await Promise.race([operation, new Promise(resolve => { timer = setTimeout(resolve, timeout) })]) }
  finally { clearTimeout(timer) }
}
export async function shutdownNativeHost({ stop, worker, platform, parent, rtc, cleanupMs = 3500, workerMs = 500 }) {
  try {
    await settle(Promise.resolve().then(stop).catch(() => {}), cleanupMs)
    const exited = worker.threadId === -1 ? Promise.resolve() : new Promise(resolve => worker.once('exit', resolve))
    worker.postMessage({ type: 'close' })
    await settle(exited, workerMs)
  } finally {
    await worker.terminate().catch(() => {})
    try { platform.close?.() } catch { /* Still release parent channels and RTC. */ }
    parent.input.destroy(); parent.output.destroy(); rtc.cleanup()
  }
}
