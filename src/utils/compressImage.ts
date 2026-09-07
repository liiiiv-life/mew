// 업로드 전 이미지 축소·재압축. 폰 카메라 사진이 8~12MB 그대로 프로젝트에 저장되고 문서를 볼 때마다
// 다시 내려오는 것을 줄인다. 서버는 받은 바이트를 손대지 않으므로 브라우저 기본 기능만
// 쓴다 — createImageBitmap으로 디코드, OffscreenCanvas로 리샘플·재인코딩. 라이브러리 없음.
//
// 안 건드리는 것: GIF(캔버스를 거치면 첫 프레임만 남아 애니메이션이 죽는다) · SVG(벡터라 래스터화하면
// 손해) · 문턱 미만 파일 · 이미지가 아닌 것. 디코드 실패(HEIC 등)나 결과가 더 커지면 원본을 올린다.

/** 이보다 작으면 손대지 않는다 — 스크린샷·아이콘을 괜히 재인코딩하지 않기 위함 */
const MIN_BYTES = 512 * 1024
/** 긴 변 상한. 문서 본문 폭과 레티나 2배를 감당하고도 남는다 */
const MAX_EDGE = 2560
const QUALITY = 0.82

/** 캔버스를 거쳐도 안전한 정지 래스터 이미지만 — 순수 판정이라 테스트가 이 함수를 본다 */
const COMPRESSIBLE = new Set(['image/jpeg', 'image/png', 'image/webp'])

export function shouldCompress(type: string, size: number): boolean {
  return size >= MIN_BYTES && COMPRESSIBLE.has(type)
}

/** 재인코딩 후 내보낼 MIME — jpeg는 jpeg로 두고, 나머지는 webp로 간다.
 * png/webp를 jpeg로 바꾸면 알파 채널이 검게 뭉개지므로 투명도가 있는 쪽은 webp여야 한다. */
export function targetType(sourceType: string): string {
  return sourceType === 'image/jpeg' ? 'image/jpeg' : 'image/webp'
}

/** 확장자를 결과 포맷에 맞춘다 — 서버가 확장자로 asset 파일명을 만들고 클라이언트가 확장자로 미디어 종류를
 * 판정하므로(utils/media.ts), webp 바이트에 .png가 붙어 있으면 안 된다 */
export function renameForType(name: string, type: string): string {
  const ext = type === 'image/jpeg' ? 'jpg' : 'webp'
  const base = name.replace(/\.[^./\\]+$/, '')
  return `${base}.${ext}`
}

/** 긴 변을 MAX_EDGE로 맞춘 정수 크기. 이미 작으면 원래 크기 그대로(확대하지 않는다) */
export function fitSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/**
 * 압축 대상이면 축소·재압축한 새 File을, 아니면 받은 File을 그대로 돌려준다.
 * 절대 던지지 않는다 — 실패는 "원본 업로드"로 흡수한다. 업로드가 압축 때문에 실패하면 안 된다.
 */
export async function compressImage(file: File): Promise<File> {
  if (!shouldCompress(file.type, file.size)) return file
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return file

  let bitmap: ImageBitmap | null = null
  try {
    // imageOrientation: EXIF 회전을 픽셀에 굽는다. 재인코딩하면 EXIF가 날아가므로 이걸 빼면
    // 세로로 찍은 사진이 눕는다.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const { width, height } = fitSize(bitmap.width, bitmap.height)
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, width, height)

    const type = targetType(file.type)
    const blob = await canvas.convertToBlob({ type, quality: QUALITY })
    // 이미 잘 압축된 원본이면 재인코딩이 오히려 키운다 — 그럼 원본이 답이다
    if (blob.size >= file.size) return file
    return new File([blob], renameForType(file.name, type), { type, lastModified: file.lastModified })
  } catch {
    return file
  } finally {
    bitmap?.close()
  }
}
