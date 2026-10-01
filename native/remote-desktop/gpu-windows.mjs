import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** All calls run on the capture worker's COM thread. Only H.264 crosses IPC. */
export function windowsGpu(koffi, directory = path.dirname(fileURLToPath(import.meta.url))) {
  const library = koffi.load(path.join(directory, 'gpu-windows.dll'))
  if (library.func('int mew_gpu_abi()')() !== 3) throw new Error('Windows 영상 모듈을 다시 준비해 주세요.')
  const create = library.func('void *mew_gpu_create()')
  const screens = library.func('int mew_gpu_screens(void *, void *, int)')
  const refresh = library.func('int mew_gpu_refresh(void *)')
  const start = library.func('int mew_gpu_start(void *, int, int, int, int, int)')
  const current = library.func('int mew_gpu_current(void *, void *)')
  const poll = library.func('int mew_gpu_poll(void *, void *, int, void *)')
  const stop = library.func('void mew_gpu_stop(void *)')
  const destroy = library.func('void mew_gpu_destroy(void *)')
  const keyframe = library.func('int mew_gpu_keyframe(void *)')
  const bitrate = library.func('int mew_gpu_bitrate(void *, int)')
  const error = library.func('uint32 mew_gpu_error(void *)')
  const handle = create()
  if (!handle) throw new Error('Windows의 잠금 해제된 로그인 데스크톱과 그래픽 드라이버를 확인해 주세요.')
  let closed = false
  const failure = () => new Error(`Windows GPU 영상 처리가 종료됐습니다 (0x${error(handle).toString(16)}). 화면 구성·잠금 상태·하드웨어 H.264 지원을 확인해 주세요.`)
  const metadata = Buffer.alloc(24), encoded = Buffer.alloc(1024 * 1024)
  return {
    refresh() { if (closed || refresh(handle) !== 0) throw failure() },
    screens() {
      const buffer = Buffer.alloc(24 * 32), count = screens(handle, buffer, 32)
      if (count < 0) throw failure()
      return Array.from({ length: count }, (_, i) => {
        const offset = i * 24
        const id = buffer.readInt32LE(offset)
        return { id: `gpu:${id}`, label: id === 99 ? 'Mew 가상 화면' : `화면 ${i + 1}`, x: buffer.readInt32LE(offset + 4), y: buffer.readInt32LE(offset + 8), width: buffer.readInt32LE(offset + 12), height: buffer.readInt32LE(offset + 16) }
      })
    },
    start(id, rate = 6_000_000) {
      if (closed || !/^gpu:\d{1,2}$/.test(id) || start(handle, Number(id.slice(4)), 1920, 1080, 60, rate) !== 0) throw failure()
      const bounds = Buffer.alloc(24)
      if (current(handle, bounds) !== 0) throw failure()
      return { id, label: id === 'gpu:99' ? 'Mew 가상 화면' : '화면', x: bounds.readInt32LE(4), y: bounds.readInt32LE(8), width: bounds.readInt32LE(12), height: bounds.readInt32LE(16) }
    },
    next() {
      if (closed) throw new Error('GPU host closed')
      const length = poll(handle, encoded, encoded.length, metadata)
      if (length < 0) throw failure()
      return length ? { data: Buffer.from(encoded.subarray(0, length)), width: metadata.readInt32LE(4), height: metadata.readInt32LE(8), key: !!metadata.readInt32LE(12), timestamp: Number(metadata.readBigInt64LE(16)) } : null
    },
    keyframe() { if (!closed) keyframe(handle) },
    bitrate(value) { if (!closed) bitrate(handle, Math.round(value)) },
    stop() { if (!closed) stop(handle) },
    close() { if (closed) return; closed = true; destroy(handle) },
  }
}
