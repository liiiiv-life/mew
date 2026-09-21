// Runs inside the command's tmux pane; survives mew/browser restarts and owns output + cleanup.
import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify, stripVTControlCharacters } from 'node:util'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import * as pty from 'node-pty'
import { preparePtyHelper } from '../packages/tmux-term/src/server/pty-helper.ts'
import { writeFileAtomic } from './dataDir.ts'
import type { StoredAgentCommand } from './agent-commands.ts'
import { killMemoryScope, memoryScopeCommand } from './agent-memory.ts'

const exec = promisify(execFile)
export const COMMAND_PREVIEW_CHARS = 512 * 1024

export async function runAgentCommand(directory: string): Promise<void> {
  const recordFile = path.join(directory, 'record.json')
  const record = JSON.parse(fs.readFileSync(recordFile, 'utf8')) as StoredAgentCommand
  const archiveFile = path.join(directory, 'output.gz')
  const archiveFd = fs.openSync(`${archiveFile}.tmp`, 'w', 0o600)
  let archiveError: unknown
  let archiveBytes = 0
  let terminal: pty.IPty | undefined
  let memoryScope: string | undefined
  let preview = ''
  let truncated = false
  let interrupted = false
  let exited = false
  let forceStop: NodeJS.Timeout | undefined
  const marker = `\x1b]mew-complete-${crypto.randomUUID()}\x07`
  const drainedFile = path.join(directory, 'drained')
  let pendingOutput = ''
  const interrupt = () => {
    if (exited || interrupted) return
    interrupted = true
    killMemoryScope(memoryScope, 'SIGTERM')
    try { if (terminal) process.kill(-terminal.pid, 'SIGTERM') } catch { /* process already exited */ }
    forceStop = setTimeout(() => {
      killMemoryScope(memoryScope, 'SIGKILL')
      try { if (terminal) process.kill(-terminal.pid, 'SIGKILL') } catch { /* exited */ }
    }, 2_000)
  }
  const stopTimer = setInterval(() => {
    if (fs.existsSync(path.join(directory, 'stop'))) interrupt()
  }, 200)
  const resize = () => {
    if (!exited) try { terminal?.resize(process.stdout.columns || 80, process.stdout.rows || 24) } catch { /* exited */ }
  }
  const input = (data: Buffer) => { if (!exited) try { terminal?.write(data.toString()) } catch { /* exited */ } }
  const display = (data: string) => {
    preview += data
    if (preview.length > COMMAND_PREVIEW_CHARS) { truncated = true; preview = preview.slice(-COMMAND_PREVIEW_CHARS) }
    if (!archiveError) try {
      // Concatenated gzip members are standard gzip. Compressing each PTY chunk synchronously
      // bounds memory without pausing the PTY (which can lose its final bytes on fast exit).
      const compressed = gzipSync(data, { level: 1 })
      let written = 0
      while (written < compressed.length) written += fs.writeSync(archiveFd, compressed, written)
      archiveBytes += written
    } catch (error) { archiveError = error; interrupt() }
    // A closed attach client must never prevent archiving.
    if (!process.stdout.destroyed) process.stdout.write(data)
  }
  process.stdout.on('error', () => {})
  process.on('SIGTERM', interrupt)
  process.on('SIGHUP', interrupt)
  process.on('SIGWINCH', resize)
  try {
    if (fs.existsSync(path.join(directory, 'stop'))) {
      interrupted = true
      throw new Error('실행 전에 취소되었습니다')
    }
    preparePtyHelper()
    const shell = process.env.SHELL && path.isAbsolute(process.env.SHELL) ? process.env.SHELL : '/bin/sh'
    // Keep the slave open until its last byte reaches us: PTY close can discard unread output.
    // All user text is an argument; neither the command nor file paths become wrapper syntax.
    const wrapper = '"$1" -lc "$2"; result=$?; printf "%s" "$4"; while [ ! -f "$3" ]; do sleep 0.02; done; exit "$result"'
    const command = memoryScopeCommand('/bin/sh', ['-c', wrapper, 'mew-command', shell, record.command, drainedFile, marker])
    memoryScope = command.unit
    terminal = pty.spawn(command.cmd, command.args, {
      name: 'xterm-256color', cwd: record.cwd,
      cols: process.stdout.columns || 80, rows: process.stdout.rows || 24,
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
    })
    terminal.onData(data => {
      pendingOutput += data
      const end = pendingOutput.indexOf(marker)
      if (end !== -1) {
        display(pendingOutput.slice(0, end))
        pendingOutput = pendingOutput.slice(end + marker.length)
        fs.writeFileSync(drainedFile, '', { mode: 0o600 })
      } else {
        // Keep only a possible split marker, so small interactive prompts appear immediately.
        let keep = 0
        for (let size = 1; size < marker.length && size <= pendingOutput.length; size++) {
          if (pendingOutput.endsWith(marker.slice(0, size))) keep = size
        }
        display(pendingOutput.slice(0, pendingOutput.length - keep))
        pendingOutput = keep ? pendingOutput.slice(-keep) : ''
      }
    })
    if (process.stdin.isTTY) process.stdin.setRawMode(true)
    process.stdin.on('data', input)
    process.stdin.resume()
    const result = await new Promise<{ exitCode: number; signal?: number }>(resolve => terminal!.onExit(resolve))
    if (pendingOutput) display(pendingOutput)
    exited = true
    record.exitCode = result.exitCode
    record.state = interrupted || result.signal ? 'interrupted' : result.exitCode === 0 ? 'completed' : 'failed'
  } catch (error) {
    exited = true
    record.state = interrupted ? 'interrupted' : 'failed'
    record.error = error instanceof Error ? error.message : String(error)
    display(`\r\n${record.error}\r\n`)
  } finally {
    if (interrupted && terminal) {
      killMemoryScope(memoryScope, 'SIGKILL')
      // The wrapper may exit on TERM before a child that ignores it. Do not leave that group behind.
      try { process.kill(-terminal.pid, 'SIGKILL') } catch { /* group already gone */ }
    }
    clearInterval(stopTimer)
    clearTimeout(forceStop)
    process.stdin.off('data', input)
    process.stdin.pause()
    if (process.stdin.isTTY) process.stdin.setRawMode(false)
    process.off('SIGWINCH', resize)
    try {
      if (!archiveBytes && !archiveError) fs.writeSync(archiveFd, gzipSync(''))
      fs.closeSync(archiveFd)
      if (archiveError) {
        record.state = 'failed'
        record.error = `출력 저장 실패: ${archiveError instanceof Error ? archiveError.message : String(archiveError)}`
      } else {
        fs.renameSync(`${archiveFile}.tmp`, archiveFile)
        record.archived = true
      }
    } catch (error) {
      record.state = 'failed'
      record.error = `출력 저장 실패: ${error instanceof Error ? error.message : String(error)}`
    }
    // A bounded, inert text preview avoids replaying terminal control sequences in the browser.
    const text = stripVTControlCharacters(preview).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    writeFileAtomic(path.join(directory, 'preview.txt'), text)
    record.previewTruncated = truncated
    record.finishedAt = Date.now()
    writeFileAtomic(recordFile, JSON.stringify(record))
    // Explicit cleanup also works when the user's tmux config has remain-on-exit enabled.
    await exec('tmux', ['kill-session', '-t', record.session]).catch(() => {})
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runAgentCommand(process.argv[2]).catch(error => { console.error(error); process.exitCode = 1 })
}
