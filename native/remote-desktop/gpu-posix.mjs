import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAX_VIDEO_BYTES } from './video-settings.mjs'

/** Only compressed Annex B access units leave the native capture/encoder. */
export function posixGpu(koffi, directory = path.dirname(fileURLToPath(import.meta.url)), platform = process.platform) {
  const library = koffi.load(path.join(directory, platform === 'darwin' ? 'gpu-macos.dylib' : 'gpu-linux.so'))
  if (library.func('int mew_gpu_abi()')() !== 2) throw new Error('네이티브 영상 모듈을 다시 준비해 주세요.')
  const handle = library.func('void *mew_gpu_create()')()
  if (!handle) throw new Error('네이티브 영상 장치를 준비하지 못했습니다. 로그인한 데스크톱과 하드웨어 H.264·OS 라이브러리를 확인해 주세요.')
  const list = library.func('int mew_gpu_screens(void *, void *, int)'), begin = library.func('int mew_gpu_start(void *, int, int, int, int, int, int, uint32, int, int)')
  const current = library.func('int mew_gpu_current(void *, void *)'), poll = library.func('int mew_gpu_poll(void *, void *, int, void *)')
  const force = library.func('void mew_gpu_keyframe(void *)'), rate = library.func('void mew_gpu_bitrate(void *, int)')
  const end = library.func('int mew_gpu_stop(void *)'), destroy = library.func('void mew_gpu_destroy(void *)')
  const error = library.func('const char *mew_gpu_error(void *)'), data = Buffer.alloc(MAX_VIDEO_BYTES), meta = Buffer.alloc(24)
  let closed = false
  const failure = () => new Error(error(handle) || '네이티브 영상 처리가 종료됐습니다.')
  const screen = (buffer, offset = 0) => ({ id: `gpu:${buffer.readUInt32LE(offset)}`, label: '화면', x: buffer.readInt32LE(offset + 4), y: buffer.readInt32LE(offset + 8), width: buffer.readInt32LE(offset + 12), height: buffer.readInt32LE(offset + 16) })
  return {
    refresh() {},
    screens() {
      const buffer = Buffer.alloc(24 * 32), count = list(handle, buffer, 32)
      if (count < 0) throw failure()
      return Array.from({ length: count }, (_, i) => ({ ...screen(buffer, i * 24), label: `화면 ${i + 1}` }))
    },
    start(id, bitrate = 6_000_000, source = {}, mode = { width: 1920, height: 1080, fps: 60, profile: 'baseline', level: 42 }) {
      if (closed || !/^gpu:\d{1,10}$/.test(id) || Number(id.slice(4)) > 0xffffffff) throw new Error('공유할 화면을 다시 선택해 주세요.')
      if (source.bounds && platform === 'linux') {
        const { x, y, width, height } = source.bounds
        if ([x, y, width, height].some(value => !Number.isInteger(value)) || library.func('int mew_gpu_source(void *, int, int, int, int)')(handle, x, y, width, height) !== 0) throw failure()
      }
      if (begin(handle, Number(id.slice(4)), mode.width, mode.height, mode.fps, bitrate, source.fd ?? -1, source.node ?? 0, mode.profile === 'high' ? 100 : 66, mode.level) !== 0) throw failure()
      const buffer = Buffer.alloc(24)
      if (current(handle, buffer) !== 0) throw failure()
      return source.bounds ? { ...screen(buffer), ...source.bounds, id } : screen(buffer)
    },
    next() {
      if (closed) throw new Error('Native host closed')
      const length = poll(handle, data, data.length, meta)
      if (length < 0) throw failure()
      if (!length) return null
      if (length > data.length || meta.readInt32LE(4) < 2 || meta.readInt32LE(8) < 2) throw new Error('잘못된 네이티브 영상입니다.')
      const frame = new Uint8Array(length); frame.set(data.subarray(0, length))
      return { data: frame, width: meta.readInt32LE(4), height: meta.readInt32LE(8), key: !!meta.readInt32LE(12), timestamp: Number(meta.readBigInt64LE(16)) }
    },
    keyframe() { if (!closed) force(handle) }, bitrate(value) { if (!closed) rate(handle, Math.round(value)) },
    stop() { if (!closed && end(handle) !== 0) throw failure() }, close() { if (!closed) { closed = true; destroy(handle) } },
  }
}
