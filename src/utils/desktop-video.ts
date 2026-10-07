import { DEFAULT_VIDEO, videoModes, videoOffer, videoSettings, type DesktopVideoSettings } from '../../native/remote-desktop/video-settings.mjs'
import { scopedBrowserStorage } from '@mew/ui/browser-storage-scope'

const VIDEO_KEY = 'mew-desktop-video'
export function readDesktopVideo(): DesktopVideoSettings {
  try { return videoSettings(JSON.parse(scopedBrowserStorage().getItem(VIDEO_KEY) ?? 'null')) } catch { return { ...DEFAULT_VIDEO } }
}
export function saveDesktopVideo(value: DesktopVideoSettings) {
  try { scopedBrowserStorage().setItem(VIDEO_KEY, JSON.stringify(videoSettings(value))) } catch { /* Settings still apply for this viewer. */ }
}

/** Some browsers answer with the default level 3.1 even when their decoder supports more. */
export async function desktopVideoAnswer(sdp: string, settings: DesktopVideoSettings, decode: (configuration: MediaDecodingConfiguration) => Promise<MediaCapabilitiesInfo> = configuration => navigator.mediaCapabilities.decodingInfo(configuration)): Promise<string> {
  const sections = sdp.split(/(?=^m=)/m)
  const index = sections.findIndex(value => /^m=video\s+[1-9]/.test(value))
  if (index < 0) return sdp
  let section = sections[index]
  const accepted = section.split(/\r?\n/,1)[0].trim().split(/\s+/).slice(3).map(Number)
  await Promise.all(videoOffer(settings).map(async codec => {
    if (!accepted.includes(codec.payload)) return
    const pattern = new RegExp(`(^a=fmtp:${codec.payload} )(.*)$`, 'm'), line = section.match(pattern)
    if (!line || !/(?:^|;)\s*level-asymmetry-allowed=1(?:;|\r?$)/.test(line[2]) || !/(?:^|;)\s*packetization-mode=1(?:;|\r?$)/.test(line[2])) return
    const current = line[2].match(/profile-level-id=([0-9a-f]{6})/i)?.[1], wanted = codec.fmtp.match(/profile-level-id=([0-9a-f]{6})/)![1]
    if (!current || current.slice(0,4).toLowerCase() !== wanted.slice(0,4) || parseInt(current.slice(4),16) >= parseInt(wanted.slice(4),16)) return
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      const mode = videoModes(`v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF ${codec.payload}\r\na=recvonly\r\na=rtpmap:${codec.payload} H264/90000\r\na=fmtp:${codec.payload} ${codec.fmtp}\r\n`, settings)[0]
      const info = await Promise.race([decode({ type: 'webrtc', video: { contentType: `video/H264;${codec.fmtp}`, width: mode.width, height: mode.height, framerate: mode.fps, bitrate: mode.bitrate } }),
        new Promise<undefined>(resolve => { timeout = setTimeout(resolve,500) })])
      if (info?.supported && info.smooth) section = section.replace(pattern, (_line, prefix: string, fmtp: string) => prefix + fmtp.replace(/profile-level-id=[0-9a-f]{6}/i, `profile-level-id=${wanted}`))
    } catch { /* No verified receive capability: preserve the browser's original level. */ }
    finally { clearTimeout(timeout) }
  }))
  sections[index] = section
  return sections.join('')
}

type VideoCounters = { id: string; packetsReceived?: number; packetsLost?: number; framesReceived?: number; framesDecoded?: number; jitterBufferDelay?: number; jitterBufferEmittedCount?: number; totalDecodeTime?: number }
const count = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
export function desktopVideoFeedback() {
  let previous: VideoCounters | undefined
  return (value: VideoCounters, rtt?: number) => {
    const old = previous?.id === value.id ? previous : undefined
    const delta = (key: keyof VideoCounters) => old && count(value[key]) && count(old[key]) ? Math.max(0, (value[key] as number) - (old[key] as number)) : 0
    const received = delta('packetsReceived'), lost = delta('packetsLost'), frames = delta('framesDecoded'), emitted = delta('jitterBufferEmittedCount')
    const feedback = { loss: lost / Math.max(1, received + lost), delay: emitted ? Math.min(10000, delta('jitterBufferDelay') * 1000 / emitted) : 0,
      decoded: count(value.framesDecoded) && value.framesDecoded > 0,
      ...(count(value.framesReceived) ? { received: delta('framesReceived'), decodedFrames: frames } : {}),
      ...(count(rtt) ? { rtt: Math.min(10000, rtt) } : {}),
      ...(count(value.totalDecodeTime) && frames ? { decode: Math.min(10000, delta('totalDecodeTime') * 1000 / frames) } : {}),
    }
    previous = { ...value }
    return feedback
  }
}
