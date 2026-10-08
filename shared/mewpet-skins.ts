export const MEWPET_ACTIONS = ['idle', 'walk', 'run', 'jump', 'fall', 'love', 'struggle'] as const
export const MEWPET_TRANSITIONS = ['run-walk', 'walk-run', 'run-idle', 'idle-run', 'walk-idle', 'idle-walk', 'takeoff', 'landing', 'apex'] as const
export const MEWPET_ANIMATIONS = [...MEWPET_ACTIONS, ...MEWPET_TRANSITIONS] as const
export type MewpetAnimation = typeof MEWPET_ANIMATIONS[number]
export type MewpetSprites<T> = Record<typeof MEWPET_ACTIONS[number], T> & Partial<Record<typeof MEWPET_TRANSITIONS[number], T>>
export const MEWPET_MAX_FILE_BYTES = 4 * 1024 * 1024
export const MEWPET_MAX_PACK_BYTES = 24 * 1024 * 1024

export function validMewpetSkinId(id: unknown): id is string {
  return typeof id === 'string' && /^(?:custom:)?[a-zA-Z0-9][\w-]{0,79}$/.test(id) && id !== 'none' && id !== 'oreo'
}

export function validMewpetSprite(width: number, height: number, frames: number): boolean {
  return Number.isInteger(frames) && frames >= 1 && frames <= 256
    && Number.isInteger(width) && Number.isInteger(height) && height > 0 && height <= 4096
    && width >= frames && width <= 32768 && width % frames === 0 && width * height <= 16_777_216
}

export type MewpetFileSprite = { url: string; frames: number; width: number; height: number }
export type MewpetFileSkin = { id: string; name: string; revision: string; managed: boolean; translated?: boolean; sprites: MewpetSprites<MewpetFileSprite> }
export type MewpetSkinCatalog = { skins: MewpetFileSkin[]; failed: boolean; canManage: boolean }
