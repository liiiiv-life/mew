import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('chat history UI supports owner confirmation, cancellation, errors and mobile; other roles have no delete button', { skip: !domBrowserExecutable(), timeout: 45_000 }, async () => {
  const source = `import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {ChatPanel} from '${root}/src/components/ChatPanel.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
localStorage.setItem('mew:locale','ko');
createRoot(document.getElementById('root')).render(<I18nProvider><div style={{height:'100dvh'}}><ChatPanel authEmail="owner@example.com" authDisplayName="Owner" project="test" tree={[]} onOpenFile={()=>{}} onClose={()=>{}}/></div></I18nProvider>);`
  const bundle = await build({ input: 'virtual:chat.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:chat.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:chat.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const content = (await Promise.all(['src/components/ChatPanel.tsx', 'packages/ui/src/ConfirmDialog.tsx', 'packages/ui/src/dialog-frame.tsx'].map(file => fs.readFile(`${root}/${file}`, 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const server = http.createServer((request, response) => {
    if (request.url === '/app.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(chunk.code); return }
    response.setHeader('Content-Type', 'text/html')
    response.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(5000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    let canDelete = true
    let fail = false
    const requests: string[] = []
    const initial = [
      { id: 'group', author: 'peer@example.com', time: 1, text: '단체 기록', unread: 0 },
      { id: 'dm', author: 'peer@example.com', to: ['owner@example.com'], time: 2, text: '개인 기록', unread: 0 },
    ]
    let messages = [...initial]
    await page.route('**/api/**', async route => {
      const request = route.request()
      const pathname = new URL(request.url()).pathname
      if (pathname === '/api/member-profiles') {
        await route.fulfill({ json: { members: [{ email: 'peer@example.com', displayName: 'Peer', avatarDataUrl: null }] } }); return
      }
      if (pathname === '/api/chat' && request.method() === 'DELETE') {
        const { conversation } = request.postDataJSON() as { conversation: string }
        requests.push(conversation)
        if (fail) { await route.fulfill({ status: 500, json: { error: '삭제 실패 테스트' } }); return }
        messages = messages.filter(message => conversation === 'group' ? !!message.to : !message.to)
        await route.fulfill({ json: { ok: true, deleted: 1 } }); return
      }
      await route.fulfill({ json: { messages, unread: {}, canDeleteHistory: canDelete } })
    })
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    for (const width of [1100, 390]) {
      messages = [...initial]
      await page.setViewportSize({ width, height: 750 })
      await page.goto(base)
      await page.getByText('단체 기록', { exact: true }).waitFor()
      const remove = page.getByRole('button', { name: '채팅 기록 삭제', exact: true })
      await remove.click()
      const dialog = page.getByRole('dialog')
      await dialog.waitFor()
      assert.ok((await dialog.innerText()).includes('단체 대화방의 채팅 기록을 삭제할까요?'))
      await page.screenshot({ path: `/tmp/mew-chat-history-${width}.png` })
      const box = await dialog.boundingBox()
      assert.ok(box && box.x >= 0 && box.x + box.width <= width)
      assert.equal(await page.getByRole('button', { name: '취소', exact: true }).evaluate(el => el === el.ownerDocument.activeElement), true)
      const before = requests.length
      await page.getByRole('button', { name: '취소', exact: true }).click()
      assert.equal(requests.length, before)
      await remove.click()
      await dialog.getByRole('button', { name: '채팅 기록 삭제', exact: true }).click()
      await page.getByText('단체 기록', { exact: true }).waitFor({ state: 'hidden' })
      assert.equal(requests.at(-1), 'group')
      assert.equal(await remove.isDisabled(), true)
      await page.getByRole('button', { name: 'Peer · peer@example.com' }).click()
      await page.getByText('개인 기록', { exact: true }).waitFor()
      fail = true
      await remove.click()
      await dialog.getByRole('button', { name: '채팅 기록 삭제', exact: true }).click()
      await page.getByText('삭제 실패 테스트', { exact: true }).waitFor()
      assert.equal(await page.getByText('개인 기록', { exact: true }).count(), 1)
      fail = false
      await remove.click()
      await dialog.getByRole('button', { name: '채팅 기록 삭제', exact: true }).click()
      await page.getByText('개인 기록', { exact: true }).waitFor({ state: 'hidden' })
      assert.equal(requests.at(-1), 'peer@example.com')
      messages = [...initial]
      await page.locator('body').evaluate(el => { const win = el.ownerDocument.defaultView!; win.dispatchEvent(new win.CustomEvent('mew:signal', { detail: { type: 'chat' } })) })
      await page.getByText('개인 기록', { exact: true }).waitFor()
      canDelete = false
      messages = [...initial]
      await page.goto(base)
      await page.getByText('단체 기록', { exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: '채팅 기록 삭제', exact: true }).count(), 0)
      canDelete = true
    }
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
