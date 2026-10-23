import os from 'node:os'
import type { MemoryReader } from '../linux/memory.ts'
export function memoryScopeCommand(cmd: string, args: string[]) { return { cmd, args, scoped: process.env.MEW_AGENT_MEMORY_SCOPE !== 'off', unit: undefined } }
export function killMemoryScope(_unit: string | undefined, _signal: NodeJS.Signals): void { /* The process helper owns the job handle. */ }
export const readAgentMemory: MemoryReader = () => [{ source: 'Windows available memory', total: os.totalmem(), available: os.freemem() }]
