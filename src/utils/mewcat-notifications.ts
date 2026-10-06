import { useSyncExternalStore } from 'react'
import type { NoticeInput } from './mewcat-notification-rules.ts'

export type NotificationPreferences = { visual: boolean; desktop: boolean; sound: boolean; resources: boolean }
export type MewcatNotice = NoticeInput & { id: number; createdAt: number }
export const NOTIFICATION_KEY = 'mew:notification-preferences'
const defaults: NotificationPreferences = { visual: true, desktop: false, sound: false, resources: true }
export function parseNotificationPreferences(raw: string | null): NotificationPreferences {
  try {
    const value = JSON.parse(raw ?? '{}')
    return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, typeof value?.[key] === 'boolean' ? value[key] : fallback])) as NotificationPreferences
  } catch { return { ...defaults } }
}
let preferences = { ...defaults }
try { preferences = parseNotificationPreferences(localStorage.getItem(NOTIFICATION_KEY)) } catch { /* restricted storage */ }
const dismissedUpdateKey = 'mew:dismissed-update-versions'
const dismissedUpdates = new Set<string>()
try {
  const saved: unknown = JSON.parse(localStorage.getItem(dismissedUpdateKey) ?? '[]')
  if (Array.isArray(saved)) for (const version of saved) if (typeof version === 'string') dismissedUpdates.add(version)
} catch { /* session-only dismissal */ }
let notices: MewcatNotice[] = []
let sequence = 0
const recent = new Map<string, number>()
const listeners = new Set<() => void>()
const deliveries = new Set<(notice: MewcatNotice) => void>()
const emit = () => listeners.forEach(listener => listener())
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const useMewcatNotices = () => useSyncExternalStore(subscribe, () => notices)
export const useNotificationPreferences = () => useSyncExternalStore(subscribe, () => preferences)
export function setNotificationPreferences(patch: Partial<NotificationPreferences>) {
  preferences = { ...preferences, ...patch }
  try { localStorage.setItem(NOTIFICATION_KEY, JSON.stringify(preferences)) } catch { /* session settings still work */ }
  emit()
}
export function publishMewcatNotice(input: NoticeInput) {
  if (input.kind === 'updates' && input.updateVersions?.length && input.updateVersions.every(version => dismissedUpdates.has(version))) return
  const now = Date.now()
  // Repeated errors / duplicate sockets must not flood the queue or audio output.
  if (now - (recent.get(input.key) ?? -Infinity) < 30_000) return
  recent.delete(input.key)
  recent.set(input.key, now)
  if (recent.size > 256) recent.delete(recent.keys().next().value!)
  const notice = { ...input, id: ++sequence, createdAt: now }
  notices = [...notices.filter(item => item.key !== input.key), notice].slice(-30)
  emit()
  deliveries.forEach(deliver => deliver(notice))
}
export function dismissMewcatNotice(id: number) {
  const notice = notices.find(item => item.id === id)
  if (notice?.kind === 'updates') {
    for (const version of notice.updateVersions ?? []) dismissedUpdates.add(version)
    try { localStorage.setItem(dismissedUpdateKey, JSON.stringify([...dismissedUpdates].slice(-512))) } catch { /* session-only dismissal */ }
  }
  notices = notices.filter(notice => notice.id !== id); emit() }
export function resolveMewcatNotice(key: string) { notices = notices.filter(notice => notice.key !== key); emit() }
export function clearMewcatNotices() { for (const notice of [...notices]) dismissMewcatNotice(notice.id) }
export function onMewcatNotice(deliver: (notice: MewcatNotice) => void) { deliveries.add(deliver); return () => { deliveries.delete(deliver) } }
export const OPEN_NOTICE_EVENT = 'mew:open-notification'
export function openMewcatNotice(notice: MewcatNotice) {
  window.dispatchEvent(new CustomEvent(OPEN_NOTICE_EVENT, { detail: notice }))
  dismissMewcatNotice(notice.id)
}

let audio: AudioContext | null = null
let lastSound = 0
export async function unlockNotificationAudio(): Promise<boolean> {
  try {
    audio ??= new AudioContext()
    if (audio.state !== 'running') await audio.resume()
    return audio.state === 'running'
  } catch { return false }
}
export function playNotificationSound(level: NoticeInput['level'], force = false): boolean {
  if (!audio || audio.state !== 'running') return false
  if (!force && Date.now() - lastSound < 3000) return true
  try {
    lastSound = Date.now()
    const start = audio.currentTime
    const oscillator = audio.createOscillator()
    const gain = audio.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(level === 'success' ? 660 : 440, start)
    oscillator.frequency.setValueAtTime(level === 'success' ? 880 : 330, start + 0.12)
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(0.09, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35)
    oscillator.connect(gain).connect(audio.destination)
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
    oscillator.start(start)
    oscillator.stop(start + 0.36)
    return true
  } catch { return false }
}
export function desktopNotificationPermission(): NotificationPermission | 'unsupported' {
  return typeof Notification !== 'undefined' && window.isSecureContext ? Notification.permission : 'unsupported'
}
