export const INPUT_VERSION: number
export const INPUT_TIMEOUT: number
export const MAX_SIGNAL_BYTES: number
export const INPUT_LIMIT: number
export const BUTTONS: number[]
export function validSnapshot(value: unknown): boolean
export function createInputReceiver(adapter: { move(x: number, y: number): void; moveTo?(x: number, y: number): void; wheel(x: number, y: number): void; button(bit: number, down: boolean): void; key(code: string, down: boolean): void }, now?: () => number): { accept(value: unknown, reliable?: boolean): void; release(): void; pause(): void; tick(): boolean }
