import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

async function isMewServer(pid) {
  try {
    const command = process.platform === 'linux'
      ? await fs.readFile(`/proc/${pid}/cmdline`, 'utf8')
      : (await exec('ps', ['-p', String(pid), '-o', 'command='], { timeout: 3000 })).stdout
    return /(?:^|[\s/])server\/serve\.(?:ts|js)(?:\s|$)/.test(command.replaceAll('\0', ' '))
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 1) return false
    throw new Error('기존 mew 프로세스를 확인하지 못했습니다. 실행 상태를 확인한 뒤 다시 실행하세요.')
  }
}

export async function checkLegacyInstance(filename, alive = pid => {
  try { process.kill(pid, 0); return true } catch (error) { return error.code !== 'ESRCH' }
}, isServer = isMewServer) {
  if (process.platform === 'win32') return
  let pid
  try { pid = Number((await fs.readFile(filename, 'utf8')).trim()) } catch (error) { if (error.code === 'ENOENT') return; throw error }
  if (Number.isSafeInteger(pid) && pid > 0 && alive(pid) && await isServer(pid)) throw new Error('기존 ./mew 서버가 실행 중입니다. 해당 서버를 종료한 뒤 CLI를 실행하세요. 계정·대화 데이터는 유지됩니다.')
}

export async function acquireDataLock(dataDir, alive = pid => {
  try { process.kill(pid, 0); return true } catch (error) { return error.code !== 'ESRCH' }
}) {
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 })
  const filename = path.join(dataDir, 'cli-host.lock')
  const token = randomUUID()
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const handle = await fs.open(filename, 'wx', 0o600)
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, token })) } finally { await handle.close() }
      return async () => {
        try { if (JSON.parse(await fs.readFile(filename, 'utf8')).token === token) await fs.unlink(filename) } catch (error) { if (error.code !== 'ENOENT') throw error }
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const recoveryFile = `${filename}.recovery`
      let recovery
      try { recovery = await fs.open(recoveryFile, 'wx', 0o600) } catch (recoveryError) {
        if (recoveryError.code === 'EEXIST') throw new Error(`다른 실행이 잠금 파일을 확인 중입니다. 잠시 후 다시 실행하세요. 계속 실패하면 실행 중인 mew를 확인한 뒤 ${recoveryFile}을 삭제하세요.`)
        throw recoveryError
      }
      try {
        let previous
        try { previous = JSON.parse(await fs.readFile(filename, 'utf8')) } catch (readError) {
          if (readError.code === 'ENOENT') continue
          throw new Error(`실행 잠금 파일을 확인하지 못했습니다. 실행 중인 mew를 확인하세요: ${filename}`)
        }
        if (!Number.isSafeInteger(previous.pid) || previous.pid < 1 || alive(previous.pid)) throw new Error('같은 데이터 폴더의 mew가 이미 실행 중입니다. 기존 실행을 종료하거나 --data-dir로 다른 폴더를 지정하세요.')
        await fs.unlink(filename)
      } finally {
        await recovery.close()
        await fs.unlink(recoveryFile)
      }
    }
  }
  throw new Error('mew 실행 잠금을 얻지 못했습니다. 잠시 후 다시 실행하세요.')
}
