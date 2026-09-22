import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { AgentSession, type AgentEvent } from './agentAcp.ts'
import { writeFileAtomic } from './dataDir.ts'
import { parseCommitDraft, type GitAiCommitInput } from './git-ai-commit.ts'
import type { GitAiCommitJob } from '../shared/git-ai-commit.ts'

type DraftSession = Pick<AgentSession, 'attach' | 'setModel' | 'runOnce' | 'answerPermission' | 'cancel' | 'disposeAndWait'>
type StartSession = (runtime: string, cwd: string) => Promise<DraftSession>

/** A separate process inside tmux owns the ACP lifetime and durable result. */
export async function runCommitDraft(directory: string, start: StartSession = (runtime, cwd) => AgentSession.start(runtime, undefined, cwd), timeoutMs = 10 * 60_000): Promise<void> {
  const input = JSON.parse(fs.readFileSync(path.join(directory, 'input.json'), 'utf8')) as GitAiCommitInput
  let job = JSON.parse(fs.readFileSync(path.join(directory, 'state.json'), 'utf8')) as GitAiCommitJob
  let session: DraftSession | undefined
  let starting: Promise<DraftSession> | undefined
  let detach: (() => void) | undefined
  let answer = ''
  let cancelled = false
  let halted = false
  let ended = false
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
    if (fs.existsSync(path.join(directory, 'stop'))) { cancelled = true; stop('생성을 취소했습니다') }
  }, 200)
  const timeout = setTimeout(() => stop('생성 시간이 10분을 초과했습니다. 다시 시도해 주세요.'), timeoutMs)
  try {
    if (fs.existsSync(path.join(directory, 'stop'))) { cancelled = true; throw new Error('생성을 취소했습니다') }
    job.state = 'running'; save()
    log('에이전트 준비 중…\n')
    await Promise.race([interrupted, (async () => {
      starting = start(input.agentSet.runtime, input.cwd)
      session = await starting
      if (halted) throw new Error('생성이 중단되었습니다')
      detach = session.attach((event: AgentEvent) => {
        if (event.type === 'permission') {
          session!.answerPermission(event.id, null)
          stop('초안 생성 중 도구 승인을 요청했습니다. 도구 없이 메시지를 작성하도록 에이전트셋의 역할을 조정해 주세요.')
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
      if (input.agentSet.modelId) await session.setModel(input.agentSet.modelId)
      if (halted) throw new Error('생성이 중단되었습니다')
      log('변경사항을 분석하고 커밋 초안을 작성하는 중…\n')
      const reason = await session.runOnce(input.prompt)
      if (halted) throw new Error('생성이 중단되었습니다')
      if (reason !== 'end_turn') throw new Error(`에이전트가 초안 생성을 완료하지 못했습니다: ${reason}`)
      job.result = parseCommitDraft(answer)
    })()])
    job.state = 'completed'
  } catch (error) {
    job = { ...job, state: cancelled ? 'cancelled' : 'failed', result: undefined, error: error instanceof Error ? error.message : String(error) }
  } finally {
    ended = true
    clearInterval(poll); clearTimeout(timeout)
    // Cancellation during initialize must also wait for and dispose the adapter.
    const started = session ?? await starting?.catch(() => undefined)
    detach?.()
    await started?.disposeAndWait()
    if (flush) clearTimeout(flush)
    // A late cancelled task must never publish a draft.
    if (job.state !== 'completed') job.result = undefined
    job.finishedAt = Date.now(); save()
    fs.rmSync(path.join(directory, 'input.json'), { force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = process.argv[2]
  let session: string | undefined
  try {
    session = (JSON.parse(fs.readFileSync(path.join(directory, 'input.json'), 'utf8')) as GitAiCommitInput).session
    await runCommitDraft(directory)
  } catch (error) { console.error(error); process.exitCode = 1 }
  finally {
    // Also clean up when the user's tmux config enables remain-on-exit.
    if (session && /^mewcmd-git-[a-f0-9-]{36}$/.test(session)) execFile('tmux', ['kill-session', '-t', session], () => {})
  }
}
