import * as linux from './platform/linux/memory.ts'
import * as windows from './platform/windows/memory.ts'
const implementation = process.platform === 'win32' ? windows : linux
export const memoryScopeCommand = implementation.memoryScopeCommand
export const killMemoryScope = implementation.killMemoryScope
export const readAgentMemory = implementation.readAgentMemory
export { parseHostMemory, dynamicAgentBudget, memoryLimitProperties, memoryPressure } from './platform/linux/memory.ts'
export type { MemoryBudget, MemoryReader } from './platform/linux/memory.ts'
