export type DesktopVideoSettings = { resolution: '720p' | '1080p' | '1440p' | '2160p'; fps: 30 | 60 | 120 | 144 | 165 | 240; quality: 'balanced' | 'high'; priority?: 'quality' | 'speed' }
export type DesktopVideoMode = DesktopVideoSettings & { width: number; height: number; bitrate: number; profile: 'high' | 'baseline'; payload: number; level: number }
export const VIDEO_FPS: DesktopVideoSettings['fps'][]
export const VIDEO_SIZES: Record<DesktopVideoSettings['resolution'], [number, number]>
export const DEFAULT_VIDEO: Readonly<DesktopVideoSettings>
export const MAX_VIDEO_BYTES: number
export function videoSettings(value?: unknown): DesktopVideoSettings
export function videoRate(settings: DesktopVideoSettings): number
export function videoLevel(width: number, height: number, fps: number): number
export function videoOffer(settings: DesktopVideoSettings): { payload: number; profile: string; fmtp: string }[]
export function videoModes(sdp: string, requested?: DesktopVideoSettings): DesktopVideoMode[]
