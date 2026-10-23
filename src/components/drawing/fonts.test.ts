import test from 'node:test'
import assert from 'node:assert/strict'
import { embeddedDrawingFontCss } from './fonts.ts'

test('drawing fonts embed used glyphs and weights, reuse downloads, and retry failed requests', async () => {
  const originalFetch = globalThis.fetch
  const requests: URL[] = []
  let rejectNext = false
  globalThis.fetch = async input => {
    const url = new URL(String(input))
    requests.push(url)
    if (rejectNext) { rejectNext = false; return new Response('Unavailable', { status: 503 }) }
    if (url.hostname === 'fonts.googleapis.com') return new Response(`@font-face{font-family:'Fixture Sans';font-style:normal;font-weight:400;src:url(https://fonts.gstatic.com/s/fixture.woff2) format('woff2');}`)
    return new Response(new Uint8Array([119, 79, 70, 50, 1, 2, 3]), { headers: { 'Content-Type': 'font/woff2' } })
  }
  try {
    assert.equal(await embeddedDrawingFontCss([{ fontFamily: 'Arial', text: '오프라인 기본 글꼴' }]), '')
    assert.equal(requests.length, 0)
    const objects = [{ fontFamily: 'Fixture Sans', fontWeight: 400, text: '나가나' }, { fontFamily: 'Fixture Sans', fontWeight: 400, text: '가A' }, { fontFamily: 'Fixture Sans', fontWeight: 700, text: '굵게' }]
    const css = await embeddedDrawingFontCss(objects)
    assert.ok(css.includes('data:font/woff2;base64,d09GMgECAw=='))
    assert.ok(!css.includes('https://'))
    const stylesheetRequests = requests.filter(url => url.hostname === 'fonts.googleapis.com')
    assert.equal(stylesheetRequests.length, 2)
    assert.ok(stylesheetRequests.some(url => url.searchParams.get('family') === 'Fixture Sans:wght@700'))
    assert.ok(stylesheetRequests.some(url => url.searchParams.get('text') === 'A가나'))
    const count = requests.length
    assert.equal(await embeddedDrawingFontCss(objects), css)
    assert.equal(requests.length, count, 'identical export reuses downloaded font data')
    rejectNext = true
    await assert.rejects(embeddedDrawingFontCss([{ fontFamily: 'Retry Sans', text: 'Retry' }]), /Retry Sans/)
    assert.ok((await embeddedDrawingFontCss([{ fontFamily: 'Retry Sans', text: 'Retry' }])).includes('data:font/woff2'))
    globalThis.fetch = async () => new Response("@font-face{src:url(https://unexpected.example/font.woff2)}")
    await assert.rejects(embeddedDrawingFontCss([{ fontFamily: 'Untrusted Sans', text: 'No' }]), /Untrusted Sans/)
  } finally { globalThis.fetch = originalFetch }
})
