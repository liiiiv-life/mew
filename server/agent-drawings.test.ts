import './test-isolated-data.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { AgentDrawingError, MAX_DRAWING_BYTES, createAgentDrawingsRouter, listAgentDrawings, readAgentDrawing, saveAgentDrawing, validateDrawingSvg } from './agent-drawings.ts'
import { setFeature, setFileRule } from './access-policy.ts'
import { pathsForWorkspace, workspaceContext } from './paths.ts'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="100" viewBox="-60 -50 120 100" role="img"><metadata id="mew-drawing">{&quot;version&quot;:1,&quot;text&quot;:&quot;&lt;script&gt; &amp; 😀&quot;}</metadata><g transform="translate(-40 -30) rotate(15 40 30)"><rect x="0" y="0" width="80" height="60" fill="#fff" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><text font-family="Noto Sans KR" font-size="24" font-weight="400" xml:space="preserve" fill="#000"><tspan x="0" y="24">그림 &amp; 설명</tspan></text><image href="data:image/png;base64,aGVsbG8=" x="0" y="0" width="80" height="60" preserveAspectRatio="none"/></g></svg>'

test('drawing SVG accepts editable metadata, raster images and embedded Google font subsets', () => {
  assert.doesNotThrow(() => validateDrawingSvg(SVG))
  const fonts = '<defs><style>/* korean */ @font-face { font-family: &apos;Noto Sans KR&apos;; font-style: normal; font-weight: 100 900; font-display: swap; src: url(data:font/woff2;base64,aGVsbG8=) format(&apos;woff2&apos;); unicode-range: U+AC00-D7A3, U+1100-11FF; }</style></defs>'
  assert.doesNotThrow(() => validateDrawingSvg(SVG.replace('<metadata', `${fonts}<metadata`)))
  assert.doesNotThrow(() => validateDrawingSvg(`<?xml version="1.0" encoding="UTF-8"?>${SVG}`))
})

test('drawing SVG rejects scripts, external resources, malformed markup and oversized payloads', () => {
  const invalid = [
    SVG.replace('<g ', '<g onclick="alert(1)" '),
    SVG.replace('</svg>', '<script>alert(1)</script></svg>'),
    SVG.replace('</svg>', '<foreignObject><div>html</div></foreignObject></svg>'),
    SVG.replace('data:image/png;base64,aGVsbG8=', 'https://example.test/image.png'),
    SVG.replace('data:image/png;base64,aGVsbG8=', 'data:image/svg+xml;base64,PHN2Zy8+'),
    SVG.replace('fill="#fff"', 'fill="url(https://example.test/paint)"'),
    SVG.replace('</svg>', '<defs><style>@import url(https://example.test/font.css);</style></defs></svg>'),
    SVG.replace('</svg>', '<defs><style>@font-face{font-family: test;src:url(https://example.test/font.woff2)}</style></defs></svg>'),
    SVG.replace('</svg>', '<defs><style>body{display:none}</style></defs></svg>'),
    SVG.replace('</svg>', '<defs><style>@font-face{font-family: test;src:url(data:font/woff2;base64,aGVsbG8=);behavior:evil}</style></defs></svg>'),
    `<!DOCTYPE svg [<!ENTITY external SYSTEM "file:///etc/passwd">]>${SVG}`,
    SVG.replace('</g>', ''),
    SVG.replace('</svg>', ''),
    SVG.replace('width="120"', 'width="120" width="100"'),
    `${SVG}<svg xmlns="http://www.w3.org/2000/svg"/>`,
  ]
  for (const svg of invalid) assert.throws(() => validateDrawingSvg(svg), AgentDrawingError, svg.slice(-200))
  assert.throws(() => validateDrawingSvg(`${SVG}${' '.repeat(MAX_DRAWING_BYTES)}`), error => error instanceof AgentDrawingError && error.status === 413)
})

test('drawing history is immutable, project-scoped and readable without parsing image payloads', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-drawings-'))
  const otherRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-drawings-other-'))
  try {
    assert.deepEqual(await listAgentDrawings(root), [])
    assert.equal(await fs.stat(path.join(root, '.mew')).catch(() => null), null)
    const first = await saveAgentDrawing(root, SVG, '흐름도')
    const second = await saveAgentDrawing(root, SVG, '흐름도')
    assert.notEqual(first.id, second.id)
    assert.equal(first.path, `.mew/temp/drawings/${first.id}.svg`)
    assert.deepEqual(await readAgentDrawing(root, first.id), { ...first, svg: SVG })
    const listed = await listAgentDrawings(root)
    assert.equal(listed.length, 2)
    assert.equal(listed[0].name, '흐름도')
    assert.equal(listed[0].bytes, Buffer.byteLength(SVG))
    assert.deepEqual(await listAgentDrawings(otherRoot), [])
    assert.deepEqual(await listAgentDrawings(root, relativePath => relativePath === first.path), [first])
    await fs.writeFile(path.join(root, '.mew/temp/drawings/incomplete.json'), '{}')
    await fs.writeFile(path.join(root, '.mew/temp/drawings', `${second.id}.json`), 'invalid json')
    assert.deepEqual(await listAgentDrawings(root), [first])
    await assert.rejects(readAgentDrawing(root, '../outside'), AgentDrawingError)
    await assert.rejects(readAgentDrawing(otherRoot, first.id), error => error instanceof AgentDrawingError && error.status === 404)
  } finally { await Promise.all([fs.rm(root, { recursive: true, force: true }), fs.rm(otherRoot, { recursive: true, force: true })]) }
})

test('drawing storage rejects directory links, linked files and hard links', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-drawing-links-'))
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-drawing-outside-'))
  try {
    await fs.symlink(outside, path.join(root, '.mew'), 'dir')
    await assert.rejects(saveAgentDrawing(root, SVG), AgentDrawingError)
    await assert.rejects(listAgentDrawings(root), AgentDrawingError)
    assert.deepEqual(await fs.readdir(outside), [])
    await fs.unlink(path.join(root, '.mew'))
    const saved = await saveAgentDrawing(root, SVG)
    const svgPath = path.join(root, saved.path)
    await fs.writeFile(path.join(outside, 'image.svg'), SVG)
    await fs.unlink(svgPath)
    await fs.symlink(path.join(outside, 'image.svg'), svgPath)
    await assert.rejects(readAgentDrawing(root, saved.id), AgentDrawingError)
    assert.deepEqual(await listAgentDrawings(root), [])
    await fs.unlink(svgPath)
    await fs.link(path.join(outside, 'image.svg'), svgPath)
    await assert.rejects(readAgentDrawing(root, saved.id), AgentDrawingError)
    assert.deepEqual(await listAgentDrawings(root), [])
    await fs.unlink(svgPath)
    await fs.rm(path.join(root, '.mew/temp/drawings'), { recursive: true })
    await fs.symlink(outside, path.join(root, '.mew/temp/drawings'), 'dir')
    await assert.rejects(saveAgentDrawing(root, SVG), AgentDrawingError)
  } finally { await Promise.all([fs.rm(root, { recursive: true, force: true }), fs.rm(outside, { recursive: true, force: true })]) }
})

test('drawing API checks authentication, feature/file permissions and expected project root', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-drawing-api-'))
  const email = 'drawing@example.test'
  let role: 'owner' | 'member' | 'guest' = 'owner'
  const app = express()
  app.use((req, _res, next) => {
    req.auth = { role, email: role === 'guest' ? null : email, mustChangePassword: false }
    workspaceContext.run(pathsForWorkspace(root, req.auth.email), next)
  })
  app.use('/drawings', createAgentDrawingsRouter())
  const server = http.createServer(app)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/drawings`
  const post = (body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  try {
    role = 'guest'
    assert.equal((await fetch(url)).status, 403)
    assert.equal((await post({ svg: SVG })).status, 403)
    role = 'member'
    assert.equal((await fetch(url)).status, 403)
    role = 'owner'
    assert.equal((await post({ svg: SVG, projectRoot: `${root}/other` })).status, 409)
    assert.equal((await fetch(`${url}?projectRoot=${encodeURIComponent(`${root}/other`)}`)).status, 409)
    const created = await post({ svg: SVG, name: '시스템 그림', projectRoot: root })
    assert.equal(created.status, 201, await created.clone().text())
    const drawing = await created.json() as { id: string; path: string; projectRoot: string }
    assert.equal(drawing.projectRoot, root)
    assert.equal((await (await fetch(`${url}/${drawing.id}`)).json() as { svg: string }).svg, SVG)
    assert.equal((await fetch(`${url}/${drawing.id}?projectRoot=stale`)).status, 409)
    assert.equal((await fetch(`${url}/bad-id`)).status, 400)
    assert.equal((await post({ svg: '<svg><script/></svg>' })).status, 400)
    assert.equal((await post({ svg: SVG, name: 'x'.repeat(121) })).status, 400)
    await workspaceContext.run(pathsForWorkspace(root, email), async () => {
      setFileRule(email, '.workspace', drawing.path, 'deny')
      assert.equal((await fetch(`${url}/${drawing.id}`)).status, 403)
      assert.deepEqual((await (await fetch(url)).json() as { drawings: unknown[] }).drawings, [])
      setFileRule(email, '.workspace', '.mew/temp/drawings', 'view')
      assert.equal((await post({ svg: SVG })).status, 403)
      setFileRule(email, '.workspace', '.mew/temp/drawings', 'inherit')
    })
    setFeature(email, 'agent', false)
    assert.equal((await fetch(url)).status, 403)
    assert.equal((await post({ svg: SVG })).status, 403)
    setFeature(email, 'agent', null)
    const screenshot = SVG.replace('data:image/png;base64,aGVsbG8=', `data:image/png;base64,${'a'.repeat(11 * 1024 * 1024)}`)
    const large = await post({ svg: screenshot, name: '큰 스크린샷' })
    assert.equal(large.status, 201, await large.clone().text())
    assert.equal((await large.json() as { bytes: number }).bytes, Buffer.byteLength(screenshot))
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('legacy drawing history remains readable while new drawings stay under temp', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-drawings-legacy-'))
  try {
    const legacy = await saveAgentDrawing(root, SVG, '기존 그림')
    await fs.rename(path.join(root, '.mew/temp/drawings'), path.join(root, '.mew/drawings'))
    const current = await saveAgentDrawing(root, SVG, '새 그림')
    assert.equal((await readAgentDrawing(root, legacy.id)).path, `.mew/drawings/${legacy.id}.svg`)
    assert.equal((await readAgentDrawing(root, current.id)).path, `.mew/temp/drawings/${current.id}.svg`)
    assert.equal((await listAgentDrawings(root)).length, 2)
    assert.deepEqual(await listAgentDrawings(root, relative => relative.startsWith('.mew/temp/')), [current])
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
