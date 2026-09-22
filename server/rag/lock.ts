import fs from 'node:fs'
import path from 'node:path'
import { setTimeout } from 'node:timers/promises'

/** The UI server and runtime-neutral CLI share one derived index. */
export async function withRagLock<T>(directory: string, task: () => Promise<T>): Promise<T> {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const lock = path.join(directory, 'index.lock'), deadline = Date.now() + 600_000
  while (true) {
    try {
      const fd = fs.openSync(lock, 'wx', 0o600)
      try { fs.writeFileSync(fd, String(process.pid)) } catch (error) { fs.unlinkSync(lock); throw error } finally { fs.closeSync(fd) }
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const recovery = `${lock}.recovery`
      let recovering = false
      try {
        const fd = fs.openSync(recovery, 'wx', 0o600); recovering = true; fs.closeSync(fd)
        const pid = Number(fs.readFileSync(lock, 'utf8')), stat = fs.statSync(lock)
        if (Number.isInteger(pid) && pid > 0) {
          try { process.kill(pid, 0) } catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ESRCH') fs.unlinkSync(lock) }
        } else if (Date.now() - stat.mtimeMs > 30_000) fs.unlinkSync(lock)
      } catch (cause) {
        if (!['ENOENT', 'EEXIST'].includes((cause as NodeJS.ErrnoException).code ?? '')) throw cause
      } finally { if (recovering) fs.unlinkSync(recovery) }
      if (Date.now() > deadline) throw new Error('RAG 색인이 사용 중입니다. 잠시 후 다시 시도하세요.')
      await setTimeout(100)
    }
  }
  try { return await task() } finally { fs.unlinkSync(lock) }
}
