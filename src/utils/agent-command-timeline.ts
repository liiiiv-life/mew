import type { AgentCommandRecord } from '../../shared/agent-command.ts'
import type { Item } from './agentFold.ts'

export type CommandTimelineItem = { key: string; kind: 'command'; command: AgentCommandRecord }

/** Insert after the matching user turn; ACP replay may re-chunk events but keeps user order. */
export function commandTimeline(items: Item[], commands: AgentCommandRecord[], usersBefore = 0): (Item | CommandTimelineItem)[] {
  const result: (Item | CommandTimelineItem)[] = []
  const pending = commands.filter(command => command.state !== 'queued' && !command.cancelledBeforeStart && command.afterUserCount >= usersBefore).sort((a, b) => a.afterUserCount - b.afterUserCount || a.startedAt - b.startedAt)
  let users = usersBefore
  const flush = () => {
    while (pending.length && pending[0].afterUserCount <= users) {
      const command = pending.shift()!
      result.push({ key: `command-${command.id}`, kind: 'command', command })
    }
  }
  for (const item of items) {
    if (item.kind === 'user') { flush(); users++ }
    result.push(item)
  }
  flush()
  for (const command of pending) result.push({ key: `command-${command.id}`, kind: 'command', command })
  return result
}
