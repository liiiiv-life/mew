import { MEWPET_ACTIONS, MEWPET_ANIMATIONS, MEWPET_TRANSITIONS, type MewpetSprites } from '../../shared/mewpet-skins.ts'

export const MEWCAT_SPRITE_ACTIONS = MEWPET_ACTIONS
export type MewcatSpriteAction = typeof MEWCAT_SPRITE_ACTIONS[number]
export const MEWCAT_TRANSITION_ACTIONS = MEWPET_TRANSITIONS
export type MewcatTransitionAction = typeof MEWCAT_TRANSITION_ACTIONS[number]
export const MEWCAT_ALL_SPRITE_ACTIONS = MEWPET_ANIMATIONS
export type MewcatAnimation = typeof MEWCAT_ALL_SPRITE_ACTIONS[number]
export type MewcatActivity = MewcatSpriteAction | 'land' | 'takeoff'

// One complete cycle has the same duration regardless of the number of frames.
export const MEWCAT_CYCLE_MS: Record<MewcatActivity | MewcatAnimation, number> = {
  idle: 880, walk: 880, run: 340, jump: 560, fall: 560, love: 560, struggle: 600, land: 240,
  'run-walk': 220, 'walk-run': 180, 'run-idle': 260, 'idle-run': 220, 'walk-idle': 240, 'idle-walk': 240,
  takeoff: 240, landing: 240, apex: 180,
}
export const MAX_SPRITE_FRAMES = 256
export const MAX_SPRITE_BYTES = 4 * 1024 * 1024

export type SpriteImage = { blob: Blob; width: number; height: number; frames: number }
export type SpriteStrip = SpriteImage & { src: string; hitPaths: string[]; bottomPadding: number }
export type SpriteSkin = { id: string; name: string; sprites: MewpetSprites<SpriteStrip> }
export type SavedSpriteSkin = { id: string; name: string; sprites: MewpetSprites<SpriteImage> }

export function transitionAction(from: MewcatActivity, to: MewcatActivity): MewcatTransitionAction | undefined {
  if (to === 'takeoff') return 'takeoff'
  if (from === 'jump' && to === 'fall') return 'apex'
  if ((from === 'jump' || from === 'fall') && to === 'land') return 'landing'
  const action = `${from}-${to}`
  return MEWCAT_TRANSITION_ACTIONS.find(candidate => candidate === action)
}

export function roamActivity(random: number, reducedMotion = false): 'idle' | 'walk' | 'run' | 'jump' {
  if (!reducedMotion && random >= 0.9) return 'jump'
  return (['idle', 'walk', 'run'] as const)[Math.min(2, Math.floor(Math.max(0, random) * 3))]
}

export function validSpriteDimensions(width: number, height: number, frames: number): boolean {
  return Number.isInteger(frames) && frames >= 1 && frames <= MAX_SPRITE_FRAMES
    && Number.isInteger(width) && Number.isInteger(height) && height > 0 && height <= 4096
    && width >= frames && width <= 32768 && width % frames === 0 && width * height <= 16_777_216
}

export function spriteFrameAt(activity: MewcatActivity | MewcatAnimation, elapsed: number, frames: number): number {
  if (!Number.isInteger(frames) || frames < 1) return 0
  const start = activity === 'land' ? Math.floor(frames / 2) : 0
  const count = frames - start
  const single = MEWCAT_TRANSITION_ACTIONS.some(action => action === activity) || activity === 'land'
  const phase = single ? Math.min(Math.max(0, elapsed), MEWCAT_CYCLE_MS[activity]) : Math.max(0, elapsed) % MEWCAT_CYCLE_MS[activity]
  return Math.min(frames - 1, start + Math.floor(phase / MEWCAT_CYCLE_MS[activity] * count))
}

export function spriteAction(activity: MewcatActivity): MewcatSpriteAction {
  return activity === 'land' ? 'fall' : activity === 'takeoff' ? 'jump' : activity
}
