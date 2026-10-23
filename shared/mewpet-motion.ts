import { MEWPET_ACTIONS, MEWPET_ANIMATIONS, type MewpetAnimation } from './mewpet-skins.ts'

export const MEWPET_REQUIRED_ACTIONS = ['idle', 'walk', 'struggle'] as const
export const MEWPET_DEFAULT_DURATIONS: Record<MewpetAnimation, number> = {
  idle: 880, walk: 880, run: 340, jump: 560, fall: 560, love: 560, struggle: 600,
  'run-walk': 220, 'walk-run': 180, 'run-idle': 260, 'idle-run': 220, 'walk-idle': 240, 'idle-walk': 240,
  takeoff: 240, landing: 240, apex: 180,
}
export type MewpetStride = { walk: number; run: number }
export type MewpetMotion = { durations: Record<MewpetAnimation, number>; enabled: Record<MewpetAnimation, boolean>; movementSpeed: number; stride?: MewpetStride }
export function requiredMewpetAction(action: MewpetAnimation): boolean {
  return MEWPET_REQUIRED_ACTIONS.some(required => required === action)
}
export function parseMewpetMotion(value?: unknown): MewpetMotion {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) throw new Error('SKIN_MOTION_INVALID')
  const input = (value ?? {}) as Partial<MewpetMotion>
  for (const field of ['durations', 'enabled'] as const) {
    if (input[field] !== undefined && (!input[field] || typeof input[field] !== 'object' || Array.isArray(input[field]))) throw new Error('SKIN_MOTION_INVALID')
  }
  const movementSpeed = input.movementSpeed ?? 1
  if (!Number.isFinite(movementSpeed) || movementSpeed < 0.1 || movementSpeed > 5) throw new Error('SKIN_MOTION_INVALID')
  let stride: MewpetStride | undefined
  if (input.stride !== undefined) {
    if (!input.stride || typeof input.stride !== 'object' || Array.isArray(input.stride)
      || ![input.stride.walk, input.stride.run].every(length => Number.isFinite(length) && length > 0 && length <= 4096)) throw new Error('SKIN_MOTION_INVALID')
    stride = { walk: input.stride.walk, run: input.stride.run }
  }
  const durations = {} as MewpetMotion['durations'], enabled = {} as MewpetMotion['enabled']
  for (const action of MEWPET_ANIMATIONS) {
    const duration = input.durations?.[action] ?? MEWPET_DEFAULT_DURATIONS[action]
    const active = input.enabled?.[action] ?? true
    if (!Number.isInteger(duration) || duration < 50 || duration > 60000 || typeof active !== 'boolean' || (requiredMewpetAction(action) && !active)) throw new Error('SKIN_MOTION_INVALID')
    durations[action] = duration; enabled[action] = active
  }
  return { durations, enabled, movementSpeed, ...(stride ? { stride } : {}) }
}
export function mewpetMotionEnabled(action: MewpetAnimation, motion?: MewpetMotion): boolean {
  if (requiredMewpetAction(action)) return true
  if (motion?.enabled[action] === false) return false
  const dependencies: Partial<Record<MewpetAnimation, MewpetAnimation[]>> = {
    'run-walk': ['run', 'walk'], 'walk-run': ['walk', 'run'], 'run-idle': ['run', 'idle'], 'idle-run': ['idle', 'run'],
    'walk-idle': ['walk', 'idle'], 'idle-walk': ['idle', 'walk'], takeoff: ['jump'], landing: ['fall'], apex: ['jump', 'fall'],
  }
  return (dependencies[action] ?? []).every(dependency => motion?.enabled[dependency] !== false)
}
export function validateMewpetMotionSprites(sprites: Partial<Record<MewpetAnimation, unknown>>, motion: MewpetMotion): boolean {
  return MEWPET_ACTIONS.every(action => !mewpetMotionEnabled(action, motion) || !!sprites[action])
}
