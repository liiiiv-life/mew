export const RELAY_CODEC: 'vp8'
export const FRAME_HEADER: number
export const MAX_FRAME_BYTES: number
export const MAX_IN_FLIGHT: number
export type RelayFrame = { seq: number; timestamp: number; width: number; height: number; key: boolean; data: Uint8Array }
export function readFrame(packet: Uint8Array): RelayFrame
export function packFrame(metadata: Omit<RelayFrame, 'data'>, data: Uint8Array): Uint8Array
export function relayWindow(now?: () => number): { available(): boolean; sent(seq: number, size: number): void; ack(seq: number): number | null; expired(): boolean; readonly count: number; readonly bytes: number }
