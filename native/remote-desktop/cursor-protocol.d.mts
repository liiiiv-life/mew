export const MAX_CURSOR_SIZE: number
export type DesktopCursorShape = { width: number; height: number; hotX: number; hotY: number; png: string }
export type DesktopCursor = { type: 'cursor'; visible: boolean; seq: number; x: number; y: number; width: number; height: number; shapeId: number; shape?: DesktopCursorShape }
export function validCursor(value: unknown): value is DesktopCursor
export function pointerBitmap(info: { type: number; width: number; height: number; pitch: number; hotX: number; hotY: number }, bytes: Uint8Array): Omit<DesktopCursorShape, 'png'> & { pixels: Uint8Array }
