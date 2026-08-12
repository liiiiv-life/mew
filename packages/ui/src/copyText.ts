// navigator.clipboard는 보안 컨텍스트(https·localhost)에만 있다. LAN·Tailscale IP를 http로 열면
// undefined라 복사가 조용히 실패하므로 execCommand('copy')로 넘어간다 — 폰에서 접속하는 경로가 그렇다.
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 권한 거부·비활성 문서 등 — 아래 폴백을 시도한다
    }
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}
