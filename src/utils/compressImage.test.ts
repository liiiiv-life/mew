// 압축 경로 자체(캔버스 디코드·재인코딩)는 node:test 환경에 createImageBitmap·OffscreenCanvas가
// 없어 돌지 않는다 — 그래서 "무엇을 건드리고 무엇을 그냥 두는가"의 판정과 이름·크기 계산을 본다.
// 여기가 틀리면 GIF 애니메이션이 죽거나(첫 프레임만 남는다) webp 바이트에 .png가 붙는다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { compressImage, fitSize, renameForType, shouldCompress, targetType } from './compressImage.ts'

const MB = 1024 * 1024

test('큰 정지 래스터 이미지만 압축 대상이다', () => {
  assert.equal(shouldCompress('image/jpeg', 4 * MB), true)
  assert.equal(shouldCompress('image/png', 4 * MB), true)
  assert.equal(shouldCompress('image/webp', 4 * MB), true)

  // 애니메이션·벡터는 캔버스를 거치면 망가진다
  assert.equal(shouldCompress('image/gif', 4 * MB), false)
  assert.equal(shouldCompress('image/svg+xml', 4 * MB), false)
  // 이미지가 아닌 것
  assert.equal(shouldCompress('video/mp4', 40 * MB), false)
  assert.equal(shouldCompress('application/pdf', 4 * MB), false)
  // 문턱 미만 — 스크린샷·아이콘은 재인코딩할 값이 없다
  assert.equal(shouldCompress('image/png', 100 * 1024), false)
})

test('jpeg는 jpeg로, 알파가 있을 수 있는 쪽은 webp로 내보낸다', () => {
  assert.equal(targetType('image/jpeg'), 'image/jpeg')
  assert.equal(targetType('image/png'), 'image/webp')
  assert.equal(targetType('image/webp'), 'image/webp')
})

test('확장자를 결과 포맷에 맞춘다', () => {
  assert.equal(renameForType('사진.png', 'image/webp'), '사진.webp')
  assert.equal(renameForType('IMG_0421.JPEG', 'image/jpeg'), 'IMG_0421.jpg')
  // 이름 안의 점은 확장자가 아니다
  assert.equal(renameForType('v1.2.3-shot.png', 'image/webp'), 'v1.2.3-shot.webp')
  // 확장자가 없어도 붙는다
  assert.equal(renameForType('clipboard', 'image/webp'), 'clipboard.webp')
})

test('긴 변만 상한에 맞추고 비율을 지킨다 — 작은 이미지는 확대하지 않는다', () => {
  assert.deepEqual(fitSize(4032, 3024), { width: 2560, height: 1920 })
  assert.deepEqual(fitSize(3024, 4032), { width: 1920, height: 2560 })
  assert.deepEqual(fitSize(800, 600), { width: 800, height: 600 })
  // 극단적 비율에서도 0이 나오지 않아야 한다 (OffscreenCanvas가 0을 거부한다)
  assert.equal(fitSize(10000, 1).height, 1)
})

test('캔버스가 없는 환경에선 원본을 그대로 돌려준다', async () => {
  assert.equal(typeof (globalThis as { createImageBitmap?: unknown }).createImageBitmap, 'undefined')
  const file = new File([new Uint8Array(2 * MB)], 'big.png', { type: 'image/png' })
  assert.equal(await compressImage(file), file)
})

test('디코드가 실패해도 던지지 않고 원본을 돌려준다', async () => {
  const g = globalThis as Record<string, unknown>
  g.createImageBitmap = () => Promise.reject(new Error('unsupported image type'))
  g.OffscreenCanvas = class {}
  try {
    const file = new File([new Uint8Array(2 * MB)], 'photo.heic.jpg', { type: 'image/jpeg' })
    assert.equal(await compressImage(file), file)
  } finally {
    delete g.createImageBitmap
    delete g.OffscreenCanvas
  }
})
