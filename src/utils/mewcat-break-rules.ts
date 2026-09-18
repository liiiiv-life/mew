export interface BreakPreferences { enabled: boolean; workMinutes: number; restMinutes: number }
export const DEFAULT_BREAK_PREFERENCES: BreakPreferences = { enabled: false, workMinutes: 50, restMinutes: 10 }
export const MAX_BREAK_MINUTES = 24 * 60 - 1
export interface BreakProgress { usedMs: number; restUntil: number | null }
export const freshBreakProgress = (): BreakProgress => ({ usedMs: 0, restUntil: null })

export function validBreakMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_BREAK_MINUTES
}
export function parseBreakPreferences(raw: string | null): BreakPreferences {
  try {
    const value = JSON.parse(raw ?? '{}')
    return {
      enabled: value?.enabled === true,
      workMinutes: validBreakMinutes(value?.workMinutes) ? value.workMinutes : DEFAULT_BREAK_PREFERENCES.workMinutes,
      restMinutes: validBreakMinutes(value?.restMinutes) ? value.restMinutes : DEFAULT_BREAK_PREFERENCES.restMinutes,
    }
  } catch { return { ...DEFAULT_BREAK_PREFERENCES } }
}
export const breakSignature = (preferences: BreakPreferences) => `${preferences.enabled}:${preferences.workMinutes}:${preferences.restMinutes}`
export function restoreBreakProgress(raw: string | null, preferences: BreakPreferences, now: number): BreakProgress {
  try {
    const saved = JSON.parse(raw ?? 'null')
    if (!preferences.enabled || saved?.signature !== breakSignature(preferences)) return freshBreakProgress()
    if (saved.restUntil !== null) {
      if (!Number.isFinite(saved.restUntil) || saved.restUntil <= now) return freshBreakProgress()
      return { usedMs: 0, restUntil: Math.min(saved.restUntil, now + preferences.restMinutes * 60_000) }
    }
    return { usedMs: Number.isFinite(saved.usedMs) ? Math.max(0, Math.min(saved.usedMs, preferences.workMinutes * 60_000)) : 0, restUntil: null }
  } catch { return freshBreakProgress() }
}

/** Foreground time only. Large timer gaps (sleep/suspension) are not evidence of screen use. */
export function advanceBreak(progress: BreakProgress, preferences: BreakPreferences, now: number, elapsed: number, wasActive: boolean): BreakProgress {
  if (!preferences.enabled) return freshBreakProgress()
  if (progress.restUntil !== null) return now >= progress.restUntil ? freshBreakProgress() : progress
  const usedMs = progress.usedMs + (wasActive && elapsed >= 0 && elapsed <= 5000 ? elapsed : 0)
  if (usedMs >= preferences.workMinutes * 60_000) return { usedMs: 0, restUntil: now + preferences.restMinutes * 60_000 }
  return { usedMs, restUntil: null }
}
export function formatBreakCountdown(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds % 3600 / 60)
  const rest = String(seconds % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}
