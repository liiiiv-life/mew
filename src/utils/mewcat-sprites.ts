export const MEWCAT_SPRITE_ACTIONS = ['idle', 'walk', 'run', 'love', 'struggle'] as const
export type MewcatSpriteAction = typeof MEWCAT_SPRITE_ACTIONS[number]
export type MewcatActivity = MewcatSpriteAction | 'fall' | 'land'

// One complete cycle has the same duration regardless of the number of frames.
export const MEWCAT_CYCLE_MS: Record<MewcatActivity, number> = {
  idle: 880, walk: 880, run: 340, love: 560, struggle: 600, fall: 180, land: 240,
}
export const MAX_SPRITE_FRAMES = 256
export const MAX_SPRITE_BYTES = 4 * 1024 * 1024

export type SpriteImage = { blob: Blob; width: number; height: number; frames: number }
export type SpriteStrip = SpriteImage & { src: string; hitPaths: string[]; bottomPadding: number }
export type SpriteSkin = { id: string; name: string; sprites: Record<MewcatSpriteAction, SpriteStrip> }
export type SavedSpriteSkin = { id: string; name: string; sprites: Record<MewcatSpriteAction, SpriteImage> }

export function validSpriteDimensions(width: number, height: number, frames: number): boolean {
  return Number.isInteger(frames) && frames >= 1 && frames <= MAX_SPRITE_FRAMES
    && Number.isInteger(width) && Number.isInteger(height) && height > 0 && height <= 4096
    && width >= frames && width <= 32768 && width % frames === 0 && width * height <= 16_777_216
}

export function spriteFrameAt(activity: MewcatActivity, elapsed: number, frames: number): number {
  if (!Number.isInteger(frames) || frames < 1) return 0
  const start = activity === 'fall' ? Math.floor(frames / 4) : activity === 'land' ? Math.floor(frames / 2) : 0
  const count = activity === 'fall' ? Math.max(1, Math.ceil(frames / 2)) : frames - start
  const phase = Math.max(0, elapsed) % MEWCAT_CYCLE_MS[activity]
  return Math.min(frames - 1, start + Math.floor(phase / MEWCAT_CYCLE_MS[activity] * count))
}

export function spriteAction(activity: MewcatActivity): MewcatSpriteAction {
  return activity === 'fall' || activity === 'land' ? 'run' : activity
}
