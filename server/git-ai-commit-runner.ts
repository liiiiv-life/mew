import { gitConnections } from './git-connections.ts'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { AgentSession, describeError, type AgentEvent } from './agentAcp.ts'
import { writeFileAtomic } from './dataDir.ts'
import { captureCommitChanges, parseCommitPlan, type GitAiCommitInput } from './git-ai-commit.ts'
import { commitSnapshotFiles } from './git-commit-files.ts'
import simpleGit from 'simple-git'
import type { GitAiCommitJob } from '../shared/git-ai-commit.ts'

type CommitSession = Pick<AgentSession, 'attach' | 'setModel' | 'runOnce' | 'answerPermission' | 'cancel' | 'disposeAndWait'>
type StartSession = (runtime: string, cwd: string) => Promise<CommitSession>

/** A separate process inside tmux owns the ACP lifetime and durable result. */
export async function runAutomaticCommit(directory: string, start: StartSession = (runtime, cwd) => AgentSession.start(runtime, undefined, cwd), timeoutMs = 10 * 60_000): Promise<void> {
  const input = JSON.parse(fs.readFileSync(path.join(directory, 'input.json'), 'utf8')) as GitAiCommitInput
  let job = JSON.parse(fs.readFileSync(path.join(directory, 'state.json'), 'utf8')) as GitAiCommitJob
  if (job.mode !== 'commit' || !input.snapshot) throw new Error('이전 버전의 초안 작업은 자동 실행할 수 없습니다')
  let lock: string | undefined
  let session: CommitSession | undefined
  let starting: Promise<CommitSession> | undefined
  let detach: (() => void) | undefined
  let answer = ''
  let cancelled = false
  let halted = false
  let ended = false
  let phase = '에이전트 준비'
  let flush: NodeJS.Timeout | undefined
  const save = () => writeFileAtomic(path.join(directory, 'state.json'), JSON.stringify(job))
  const log = (text: string) => {
    process.stdout.write(text)
    job.output = (job.output + text).slice(-12_000)
    if (!flush) flush = setTimeout(() => { flush = undefined; save() }, 200)
  }
  let interrupt!: (error: Error) => void
  const interrupted = new Promise<never>((_resolve, reject) => { interrupt = reject })
  const stop = (message: string) => { if (!ended) { halted = true; session?.cancel(); interrupt(new Error(message)) } }
  const poll = setInterval(() => {
    if (fs.existsSync(path.join(directory, 'stop'))) { cancelled = true; stop('커밋 작업을 취소했습니다. 이미 만든 커밋은 유지됩니다.') }
  }, 200)
  const timeout = setTimeout(() => stop('분석 시간이 10분을 초과했습니다. 다시 시도해 주세요.'), timeoutMs)
  try {
    if (fs.existsSync(path.join(directory, 'stop'))) { cancelled = true; throw new Error('커밋 작업을 취소했습니다. 이미 만든 커밋은 유지됩니다.') }
    if (!input.owner || !input.connection) throw new Error('Git 계정을 연결하고 자동 커밋을 새로 실행하세요.')
    gitConnections.require(input.owner, input.connection.provider, input.connection.host, input.connection.id)
    const git = simpleGit(input.cwd)
    const gitDir = (await git.raw(['rev-parse', '--absolute-git-dir'])).trim()
    const lockPath = path.join(gitDir, 'mew-ai-commit.lock')
    try { fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, directory }), { flag: 'wx', mode: 0o600 }); lock = lockPath }
    catch { throw new Error('이 저장소의 다른 AI 커밋이 진행 중입니다. 남은 변경을 확인하고 다시 실행하세요.') }
    job.state = 'running'; save()
    log('에이전트 준비 중…\n')
    await Promise.race([interrupted, (async () => {
      starting = start(input.agentSet.runtime, input.cwd)
      session = await starting
      if (halted) throw new Error('커밋 작업이 중단되었습니다')
      detach = session.attach((event: AgentEvent) => {
        if (event.type === 'permission') {
          session!.answerPermission(event.id, null)
          stop('커밋 계획 분석 중 도구 승인을 요청했습니다. 이 작업은 제공된 변경으로 계획을 만들고 Mew가 커밋을 실행합니다.')
        }
        if (event.type === 'update' && event.update.sessionUpdate === 'agent_message_chunk') {
          const content = event.update.content
          if (!Array.isArray(content) && content.type === 'text') {
            answer += content.text
            if (answer.length > 64_000) { stop('에이전트 응답이 너무 깁니다'); return }
            log(content.text)
          }
        }
      })
      if (input.agentSet.modelId) {
        phase = '모델 설정'
        log(`모델 설정 중: ${input.agentSet.modelId}\n`)
        await session.setModel(input.agentSet.modelId)
      }
      if (halted) throw new Error('커밋 작업이 중단되었습니다')
      phase = '커밋 계획 분석'
      log('Mew 커밋 스킬로 변경사항을 작업 단위로 나누는 중…\n')
      const reason = await session.runOnce(input.prompt)
      if (halted) throw new Error('커밋 작업이 중단되었습니다')
      if (reason !== 'end_turn') throw new Error(`에이전트가 커밋 계획을 완료하지 못했습니다: ${reason}`)
      parseCommitPlan(answer, input.snapshot.files)
    })()])
    const plan = parseCommitPlan(answer, input.snapshot.files)
    job.result = { commits: [], skipped: plan.skipped }
    clearTimeout(timeout)
    if (halted) throw new Error('커밋 작업이 중단되었습니다')
    let expectedHead = input.snapshot.head
    const remaining = new Set(input.snapshot.files)
    job.state = 'committing'; save()
    phase = '커밋 생성'
    for (const group of plan.commits) {
      if (halted || fs.existsSync(path.join(directory, 'stop'))) { cancelled = true; throw new Error('커밋 작업을 취소했습니다. 이미 만든 커밋은 유지됩니다.') }
      const current = await captureCommitChanges(input.cwd, [...remaining])
      const pendingPaths = new Set(current.paths.map(file => file.slice(':(literal)'.length)))
      const originalIndex = input.snapshot.index.split('\0').filter(entry => entry && pendingPaths.has(entry.slice(entry.indexOf('\t') + 1))).join('\0')
      if (current.head !== expectedHead || current.branch !== input.snapshot.branch || current.tree !== input.snapshot.tree || current.index.split('\0').filter(Boolean).join('\0') !== originalIndex) {
        throw new Error('분석 이후 변경사항 또는 stage가 달라졌습니다. 남은 변경을 확인하고 다시 실행하세요.')
      }
      if (halted || fs.existsSync(path.join(directory, 'stop'))) { cancelled = true; throw new Error('커밋 작업을 취소했습니다. 이미 만든 커밋은 유지됩니다.') }
      log(`\n커밋 중: ${group.title} (${group.files.length}개 파일)\n`)
      const connection = gitConnections.require(input.owner, input.connection.provider, input.connection.host, input.connection.id)
      const hash = await commitSnapshotFiles(input.cwd, group, current, hash => {
        job.result!.commits.push({ ...group, hash })
        save()
      }, connection.identity)
      expectedHead = hash
      group.files.forEach(file => remaining.delete(file))
      save()
      log(`${hash.slice(0, 8)} · ${group.title}\n`)
    }
    job.state = 'completed'
  } catch (error) {
    const message = `${phase}: ${describeError(error)}`
    job = { ...job, state: cancelled ? 'cancelled' : 'failed', error: message }
    log(`\n${message}\n`)
  } finally {
    ended = true
    clearInterval(poll); clearTimeout(timeout)
    // Cancellation during initialize must also wait for and dispose the adapter.
    const started = session ?? await starting?.catch(() => undefined)
    detach?.()
    await started?.disposeAndWait()
    if (flush) clearTimeout(flush)
    if (lock) fs.rmSync(lock, { force: true })
    job.finishedAt = Date.now(); save()
    fs.rmSync(path.join(directory, 'input.json'), { force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = process.argv[2]
  let session: string | undefined
  try {
    session = (JSON.parse(fs.readFileSync(path.join(directory, 'input.json'), 'utf8')) as GitAiCommitInput).session
    await runAutomaticCommit(directory)
  } catch (error) { console.error(error); process.exitCode = 1 }
  finally {
    // Also clean up when the user's tmux config enables remain-on-exit.
    if (session && /^mewcmd-git-[a-f0-9-]{36}$/.test(session)) execFile('tmux', ['kill-session', '-t', session], () => {})
  }
}
