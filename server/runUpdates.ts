import './config.ts'
import { MEW_APP_ROOT } from './mewUpdate.ts'
import { readUpdateQueue, writeUpdateQueue } from './updateSessions.ts'
import { assertAgentIdle, runUpdateQueue } from './updates.ts'
import { runLoggedUpdate } from './updateProcess.ts'

const queue = readUpdateQueue()
if (!queue?.job.running) throw new Error('실행할 업데이트 작업이 없습니다')
queue.workerPid = process.pid
writeUpdateQueue(queue)

await runUpdateQueue(queue.selected, queue.job, async spec => {
  const row = queue.selected.find(row => row.command === spec)!
  await assertAgentIdle(row)
  process.stdout.write(`\n[mew] ${row.label} 업데이트\n\n`)
  await runLoggedUpdate(spec, MEW_APP_ROOT)
}, () => writeUpdateQueue(queue))

const failed = queue.job.items.some(row => row.state === 'failed')
process.stdout.write(`\n[mew] 업데이트 ${failed ? '실패 — 위 출력을 확인해 주세요.' : '완료'}\n`)
process.exitCode = failed ? 1 : 0
