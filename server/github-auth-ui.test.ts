import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import type { GitHubAuthStatus } from '../shared/github-auth.ts'

const root = path.resolve(import.meta.dirname, '..')
test('GitHub login resumes, retries polling, preserves errors and supports keyboard approval on desktop/mobile', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  const source = `
import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {GitHubAccount} from '${root}/src/components/github-account.tsx';
createRoot(document.getElementById('root')).render(<GitHubAccount project='.workspace'/>);`
  const bundle = await build({ input: 'virtual:github.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{
    name: 'fixture',
    resolveId(id) { if (id === 'virtual:github.tsx') return id; if (id === './server-dom-browser') return 'virtual:browser.tsx'; if (id.endsWith('.css')) return 'virtual:style' },
    async load(id) {
      if (id === 'virtual:github.tsx') return source
      if (id === 'virtual:style') return ''
      if (id.endsWith('?raw')) return `export default ${JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8'))}`
      // Only the remote site's content is a stand-in; exercise the real modal focus trap.
      if (id === 'virtual:browser.tsx') return `import React from '${root}/node_modules/react/index.js'; export function ServerDomBrowserTabs(){return <iframe title="승인 테스트" srcDoc='<input aria-label="Device code" />' style={{flex:1}}/>}`
    },
  }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const content = (await Promise.all(['src/components/github-account.tsx', 'packages/ui/src/dialog-frame.tsx'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1100, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } })
      page.setDefaultTimeout(9000)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      let status: GitHubAuthStatus = { available: true, login: null, environmentToken: false, busy: false, job: null }
      let starts = 0, failPoll = false, browserFailure = true
      await page.route('http://localhost:48977/**', async route => {
        const req = route.request(), url = new URL(req.url())
        if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: chunk.code })
        if (!url.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="${width === 1100 ? 'dark' : ''}" lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body class="bg-surface text-ink"><div id="root"></div><script src="/app.js"></script></body></html>` })
        assert.equal(url.searchParams.get('project'), '.workspace')
        if (url.pathname.endsWith('/browser')) return browserFailure ? route.fulfill({ status: 500, json: { error: '브라우저를 준비하지 못했습니다.' } }) : route.fulfill({ json: { streamUrl: '/fixture-stream' } })
        if (url.pathname.endsWith('/stop')) { status.job = { ...status.job!, state: 'cancelled', code: null }; return route.fulfill({ json: { ok: true } }) }
        if (req.method() === 'POST') {
          starts++
          status.job = { id: `job-${starts}`, state: 'waiting', code: 'ABCD-1234', error: null }
          return route.fulfill({ json: { job: status.job } })
        }
        if (failPoll) { failPoll = false; return route.fulfill({ status: 503, json: { error: '일시적인 연결 오류' } }) }
        return route.fulfill({ json: status })
      })
      const click = (name: string) => page.getByRole('button', { name, exact: true }).click()
      await page.goto('http://localhost:48977/')
      await click('GitHub 로그인')
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('button', { name: 'GitHub 로그인', exact: true }).click()
      await page.getByText('ABCD-1234', { exact: true }).waitFor()
      if (process.env.MEW_GITHUB_SCREENSHOTS) {
        await fs.mkdir(process.env.MEW_GITHUB_SCREENSHOTS, { recursive: true })
        await page.screenshot({ path: path.join(process.env.MEW_GITHUB_SCREENSHOTS, `${width}-waiting.png`) })
      }
      assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true)
      await click('로그인 계속하기')
      await page.getByRole('alert').filter({ hasText: '브라우저를 준비하지 못했습니다.' }).waitFor()
      await page.waitForTimeout(1700)
      assert.match(await page.getByRole('alert').innerText(), /브라우저를 준비/)
      browserFailure = false
      await click('로그인 계속하기')
      await page.frameLocator('iframe').getByRole('textbox').waitFor()
      await page.getByRole('button', { name: '코드 복사' }).focus()
      await page.keyboard.press('Tab')
      assert.equal(await page.evaluate('document.activeElement?.tagName'), 'IFRAME')
      await page.keyboard.press('Tab')
      assert.equal(await page.getByRole('button', { name: '로그인 취소' }).evaluate(el => el === el.ownerDocument.activeElement), true)
      await click('닫기')
      await click('GitHub 로그인 중…')
      assert.equal(starts, 1)
      await click('로그인 취소')
      await dialog.getByRole('button', { name: 'GitHub 로그인', exact: true }).waitFor()
      await dialog.getByRole('button', { name: 'GitHub 로그인', exact: true }).click()
      await page.getByText('ABCD-1234', { exact: true }).waitFor()
      status.job = { ...status.job!, state: 'configuring', code: null }
      await page.getByText('Git 연결을 마무리하는 중…').waitFor()
      failPoll = true
      await page.getByRole('alert').filter({ hasText: '일시적인 연결 오류' }).waitFor()
      status = { ...status, login: 'octocat', job: { ...status.job!, state: 'complete' } }
      await page.getByText('octocat', { exact: true }).waitFor()
      assert.equal(starts, 2)
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
