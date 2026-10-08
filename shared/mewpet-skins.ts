export const MEWPET_ACTIONS = ['idle', 'walk', 'run', 'jump', 'fall', 'love', 'struggle'] as const
export const MEWPET_TRANSITIONS = ['run-walk', 'walk-run', 'run-idle', 'idle-run', 'walk-idle', 'idle-walk', 'takeoff', 'landing', 'apex'] as const
export const MEWPET_ANIMATIONS = [...MEWPET_ACTIONS, ...MEWPET_TRANSITIONS] as const
export type MewpetAnimation = typeof MEWPET_ANIMATIONS[number]
export type MewpetSprites<T> = Record<typeof MEWPET_ACTIONS[number], T> & Partial<Record<typeof MEWPET_TRANSITIONS[number], T>>
