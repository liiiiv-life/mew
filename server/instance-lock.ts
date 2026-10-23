import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DATA_DIR } from './dataDir.ts'
import { protectDirectory } from './platform/storage.ts'

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH' }
}

/** All entrypoints share a lease so two app versions cannot modify one account store. */
export function lockInstance(directory: string, alive = isAlive): () => void {
  protectDirectory(directory)
  const file = path.join(directory, 'server.lock'), recoveryFile = `${file}.recovery`, token = randomUUID()
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx', 0o600)
      try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token })) } finally { fs.closeSync(fd) }
      return () => {
        try { if (JSON.parse(fs.readFileSync(file, 'utf8')).token === token) fs.unlinkSync(file) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      let guard: number
      try { guard = fs.openSync(recoveryFile, 'wx', 0o600) } catch (recoveryError) {
        if ((recoveryError as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`다른 mew가 실행 잠금을 확인 중입니다. 계속 실패하면 실행 중인 mew를 확인한 뒤 ${recoveryFile}을 삭제하세요.`)
        throw recoveryError
      }
      try {
        let previous: { pid: number }
        try { previous = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (readError) {
          if ((readError as NodeJS.ErrnoException).code === 'ENOENT') continue
          throw new Error(`mew 실행 잠금을 읽지 못했습니다. 실행 중인 서버를 확인하세요: ${file}`)
        }
        if (!Number.isSafeInteger(previous.pid) || previous.pid < 1 || alive(previous.pid)) throw new Error('같은 데이터 폴더의 mew 서버가 이미 실행 중입니다. 기존 서버를 종료하거나 별도 데이터 폴더를 사용하세요.')
        fs.unlinkSync(file)
      } finally { fs.closeSync(guard); fs.unlinkSync(recoveryFile) }
    }
  }
  throw new Error('mew 서버 실행 잠금을 얻지 못했습니다.')
}

let held = false
export function acquireInstanceLock(): void {
  if (held) return
  const release = lockInstance(DATA_DIR)
  held = true
  process.once('exit', () => { try { release() } catch { /* An abrupt exit leaves a recoverable lease. */ } })
}
