import { MEWCAT_CYCLE_MS, spriteFrameAt, type MewcatActivity, type MewcatAnimation } from './mewcat-sprites.ts'
import type { MewpetMotion } from '../../shared/mewpet-motion.ts'

export function motionFrameAt(action: MewcatActivity | MewcatAnimation, elapsed: number, frames: number, duration: number): number {
  return spriteFrameAt(action, elapsed * MEWCAT_CYCLE_MS[action] / duration, frames)
}

export function motionCycleDuration(action: MewcatActivity | MewcatAnimation, duration: number, motion?: MewpetMotion): number {
  const locomotion = action === 'walk' || action === 'run' || /^(?:idle|walk|run)-(?:idle|walk|run)$/.test(action)
  return motion?.stride && locomotion ? duration / motion.movementSpeed : duration
}

export function motionMovementSpeed(action: 'walk' | 'run', duration: number, size: number, frameWidth: number, motion?: MewpetMotion): number {
  if (motion?.stride) return motion.stride[action] * size / frameWidth * 1000 / motionCycleDuration(action, duration, motion)
  return (action === 'walk' ? 48 : 115) * (motion?.movementSpeed ?? 1)
}

export function nextMotionBoundary(started: number, now: number, duration: number): number {
  return started + Math.ceil(Math.max(0, now - started) / duration) * duration
}

export function apexDurationBeforeLanding(duration: number, height: number, verticalVelocity: number, frameMs = 16): number {
  // Match the runtime's semi-implicit gravity, then reserve one displayed fall frame.
  const velocity = verticalVelocity + 1600 * frameMs / 2000
  const remaining = (Math.sqrt(velocity ** 2 + 3200 * Math.max(0, height)) - velocity) / 1600 * 1000
  return remaining <= frameMs * 2 ? 0 : Math.min(duration, remaining - frameMs)
}
