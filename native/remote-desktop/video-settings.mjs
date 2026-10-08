export const VIDEO_FPS = [30, 60, 120, 144, 165, 240]
export const VIDEO_SIZES = { '720p': [1280, 720], '1080p': [1920, 1080], '1440p': [2560, 1440], '2160p': [3840, 2160] }
export const DEFAULT_VIDEO = Object.freeze({ resolution: '1080p', fps: 60, quality: 'balanced', priority: 'speed' })
export const MAX_VIDEO_BYTES = 4 * 1024 * 1024

export function videoSettings(value = DEFAULT_VIDEO) {
  if (!value || !Object.hasOwn(VIDEO_SIZES, value.resolution) || !VIDEO_FPS.includes(value.fps) || !['balanced', 'high'].includes(value.quality)) throw new Error('Invalid desktop video settings')
  const priority = value.priority ?? (value.quality === 'high' ? 'quality' : 'speed')
  if (!['quality', 'speed'].includes(priority)) throw new Error('Invalid desktop video priority')
  return { resolution: value.resolution, fps: value.fps, quality: value.quality, priority }
}
export function videoRate(settings) {
  const base = { '720p': 3_500_000, '1080p': 6_000_000, '1440p': 12_000_000, '2160p': 24_000_000 }[settings.resolution]
  return Math.min(50_000_000, Math.round(base * Math.sqrt(settings.fps / 60) * (settings.quality === 'high' ? 2 : 1)))
}
// Annex A limits; the frame-rate ceiling also matters for small pictures.
const LEVELS = [
  [31, 3600, 108000, 60], [32, 5120, 216000, 120], [40, 8192, 245760, 120],
  [41, 8192, 245760, 120], [42, 8704, 522240, 120], [50, 22080, 589824, 172],
  [51, 36864, 983040, 172], [52, 36864, 2073600, 172],
  [60, 139264, 4177920, 300], [61, 139264, 8355840, 600], [62, 139264, 16711680, 600],
]
const macroblocks = (width, height) => Math.ceil(width / 16) * Math.ceil(height / 16)
export function videoLevel(width, height, fps) {
  const blocks = macroblocks(width, height)
  return LEVELS.find(([, size, rate, ceiling]) => blocks <= size && blocks * fps <= rate && fps <= ceiling)?.[0] ?? 62
}
export function videoOffer(settings) {
  const [width, height] = VIDEO_SIZES[settings.resolution]
  const required = videoLevel(width, height, settings.fps)
  // libwebrtc recognizes levels through 5.2. Keep a separate compatible payload
  // so a level-6 request cannot reject the entire video section on those viewers.
  return (required > 52 ? [required, 52] : [required]).flatMap((value, index) => {
    const level = value.toString(16).padStart(2, '0')
    return [{ payload: 102 + index * 2, profile: 'high', fmtp: `profile-level-id=6400${level};packetization-mode=1;level-asymmetry-allowed=1` },
      { payload: 103 + index * 2, profile: 'baseline', fmtp: `profile-level-id=42e0${level};packetization-mode=1;level-asymmetry-allowed=1` }]
  })
}

/** The answer's receive level, not the offer's level, bounds the encoder. */
export function videoModes(sdp, requested = DEFAULT_VIDEO) {
  requested = videoSettings(requested)
  const section = sdp.split(/(?=^m=)/m).find(value => /^m=video\s+[1-9]/.test(value))
  if (!section || /(?:^|\r?\n)a=(?:inactive|sendonly)(?:\r?\n|$)/.test(section)) throw new Error('The browser cannot receive desktop video')
  const offered = videoOffer(requested), accepted = []
  for (const payload of section.split(/\r?\n/, 1)[0].trim().split(/\s+/).slice(3).map(Number)) {
    const codec = offered.find(value => value.payload === payload)
    if (!codec || !new RegExp(`^a=rtpmap:${payload} H264/90000\\r?$`, 'mi').test(section)) continue
    const fmtp = section.match(new RegExp(`^a=fmtp:${payload} (.+)`, 'm'))?.[1] ?? ''
    const params = Object.fromEntries(fmtp.trim().split(';').map(part => part.trim().split('=')))
    if (params['packetization-mode'] !== '1') continue
    const profile = params['profile-level-id'] ?? '42e01f'
    if (!/^[0-9a-f]{6}$/i.test(profile) || parseInt(profile.slice(0, 2), 16) !== (codec.profile === 'high' ? 100 : 66)) continue
    const level = parseInt(profile.slice(4), 16), limits = LEVELS.find(([value]) => value === level)
    if (!limits) continue
    const limit = (key, fallback) => params[key] === undefined ? fallback : /^\d+$/.test(params[key]) && Number(params[key]) > 0 ? Math.min(fallback, Number(params[key])) : 0
    accepted.push({ ...codec, level, size: limit('max-fs', limits[1]), rate: limit('max-mbps', limits[2]), ceiling: limits[3] })
  }
  if (!accepted.length) throw new Error('The browser did not accept H.264 video')
  const modes = [], resolutions = Object.keys(VIDEO_SIZES).filter(value => VIDEO_SIZES[value][0] <= VIDEO_SIZES[requested.resolution][0]).reverse()
  const rates = VIDEO_FPS.filter(value => value <= requested.fps).reverse()
  for (const resolution of resolutions) for (const fps of rates) for (const codec of accepted) {
    const [width, height] = VIDEO_SIZES[resolution], blocks = macroblocks(width, height)
    if (blocks > codec.size || blocks * fps > codec.rate || fps > codec.ceiling) continue
    const settings = { ...requested, resolution, fps }
    modes.push({ ...settings, width, height, bitrate: videoRate(settings), profile: codec.profile, payload: codec.payload, level: Math.min(codec.level, videoLevel(width, height, fps)) })
  }
  if (!modes.length) throw new Error('The browser receive level is too low')
  return modes
}
