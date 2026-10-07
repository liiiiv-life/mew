import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { chromium } from 'playwright-core'
import { fixture } from './fixture.ts'
const app = path.resolve(import.meta.dirname, '..'), dist = path.join(app, 'dist')
const executablePath = process.env.MEW_MANAGER_CHROMIUM || chromium.executablePath()

test('manager IPC, setup validation, operation locks, recovery and responsive layouts', { skip: !existsSync(executablePath), timeout: 60_000 }, async t => {
  assert.ok(existsSync(path.join(dist, 'index.html')), 'Build the independent manager frontend before UI tests.')
  const server = http.createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url!, 'http://localhost').pathname)
    const file = path.resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname))
    if (!file.startsWith(dist + '/')) { res.writeHead(403); res.end(); return }
    try {
      res.setHeader('Content-Type', ({ '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.woff2':'font/woff2' } as Record<string,string>)[path.extname(file)] || 'application/octet-stream')
      res.end(await fs.readFile(file))
    } catch { res.writeHead(404); res.end() }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
  const browser = await chromium.launch({ executablePath })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1160, height: 820 }, locale: 'ko-KR', reducedMotion: 'reduce' })
  page.setDefaultTimeout(5000)
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript((initial) => {
    const w = window as any
    w.isTauri = true; w.fixture = initial; w.calls = []; w.failNext = false
    let sequence = 0
    const callbacks = new Map(), listeners = new Map()
    w.emitFixture = (name: string, payload: unknown) => callbacks.get(listeners.get(name))?.({ payload })
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} }
    w.__TAURI_INTERNALS__ = {
      transformCallback: (callback: unknown) => { callbacks.set(++sequence, callback); return sequence },
      invoke: async (command: string, args: any) => {
        if (command === 'plugin:event|listen') { listeners.set(args.event, args.handler); return args.handler }
        if (command === 'plugin:event|unlisten') return
        w.calls.push({ command, args })
        if (command === 'get_settings') return initial.settings
        if (command === 'get_logs') return [{ time: initial.checkedAt, kind: 'stage', text: '단계: health' }, { time: initial.checkedAt, kind: 'info', text: '테스트용 가상 설치 데이터' }]
        if (command === 'set_settings') { w.fixture.settings = args.settings; return args.settings }
        if (command === 'run_operation') {
          if (args.action !== 'inspect') {
            if (args.action === 'check-update') w.emitFixture('manager-update', { ahead: 0, behind: 3, latest: 'b2c3d4e5', commits: ['b2c3d4e5 fix: terminal reconnect', 'c3d4e5f6 feat: workspace navigation', 'd4e5f6a7 docs: installation guide'] })
            else {
              w.emitFixture('manager-stage', 'build')
              w.emitFixture('manager-log', { time: Date.now(), kind: 'info', text: '테스트 작업 진행 중' })
              await new Promise(resolve => { w.releaseOperation = resolve })
              if (w.failNext) { w.failNext = false; throw new Error('테스트 오류: 다운로드를 다시 시도하세요.') }
            }
          }
          return structuredClone(w.fixture)
        }
        return null
      }
    }
  }, fixture)
  await page.goto(`http://127.0.0.1:${(server.address() as any).port}`)
  await page.getByRole('button', { name: 'mew 열기', exact: true }).waitFor()
  await page.evaluate(async () => { await document.fonts.ready; const tag=document.createElement('div'); tag.textContent='테스트용 가상 데이터'; tag.style.cssText='position:fixed;bottom:5px;left:12px;color:#686373;font-size:9px;z-index:999;pointer-events:none'; document.body.append(tag) })
  const review = process.env.MEW_MANAGER_SCREENSHOTS ? path.resolve(process.env.MEW_MANAGER_SCREENSHOTS) : ''
  if (review) await fs.mkdir(review, { recursive: true })
  async function capture(name: string) { if (review) { await page.evaluate(() => window.scrollTo(0,0)); await page.screenshot({ path: path.join(review, name + '.png'), fullPage: true }) } }
  for (const [width,height,name] of [[1160,820,'desktop'],[760,620,'minimum'],[390,844,'mobile']] as const) {
    await page.setViewportSize({ width, height }); await capture(name)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px overflow`)
    if (width === 760) { const control = await page.getByRole('button',{name:'서버 재시작',exact:true}).boundingBox(); assert.ok(control && control.y+control.height <= height, 'Server controls must fit minimum window height') }
  }
  await page.setViewportSize({ width:1160,height:820 })
  await page.getByRole('button', { name:'mew 열기',exact:true }).click()
  assert.equal(await page.evaluate(() => (window as any).calls.at(-1).args.port), 5000)
  await page.getByRole('button',{name:'업데이트',exact:true}).click()
  assert.equal(await page.getByRole('button',{name:'업데이트 적용',exact:true}).isDisabled(),true)
  await page.getByRole('button',{name:'확인',exact:true}).click()
  await page.getByText('3개의 새 커밋이 있어요.').waitFor()
  await capture('updates')
  await page.evaluate(() => { (window as any).fixture.linux.dirty=true })
  await page.getByRole('button',{name:'상태 새로고침',exact:true}).click()
  assert.equal(await page.getByRole('button',{name:'업데이트 적용',exact:true}).isDisabled(),true)
  await page.evaluate(() => { (window as any).fixture.linux.dirty=false; (window as any).failNext=true })
  await page.getByRole('button',{name:'상태 새로고침',exact:true}).click()
  await page.getByRole('button',{name:'업데이트 적용',exact:true}).click()
  await page.getByText('의존성 설치·빌드',{exact:true}).first().waitFor()
  assert.equal(await page.locator('.operation [role=status]').getAttribute('aria-live'),'polite')
  assert.equal(await page.getByRole('button',{name:'상태 새로고침',exact:true}).isDisabled(),true)
  await capture('busy')
  await page.evaluate(() => (window as any).releaseOperation())
  await page.getByRole('alert').getByText('테스트 오류: 다운로드를 다시 시도하세요.').waitFor()
  await page.getByRole('button',{name:'상태 새로고침',exact:true}).click()
  assert.equal(await page.getByRole('alert').isVisible(),true,'Polling must not discard failure evidence')
  await page.getByRole('button',{name:'오류 닫기',exact:true}).click()
  await page.getByRole('button',{name:'설정',exact:true}).click()
  assert.equal(await page.getByLabel('mew 설치 폴더',{exact:true}).isDisabled(),true)
  await page.getByRole('button',{name:'다크',exact:true}).click()
  await capture('settings-dark')
  await page.getByRole('button',{name:'개요',exact:true}).click()
  await capture('desktop-dark')
  await page.evaluate(() => { (window as any).fixture.system.rebootRequired=true })
  await page.getByRole('button',{name:'상태 새로고침',exact:true}).click()
  await page.getByRole('heading',{name:/한 번만 재부팅하면/}).waitFor()
  assert.equal(await page.getByRole('button',{name:'설치 시작',exact:true}).count(),0)
  await page.evaluate(() => { const w=window as any; w.fixture.system.rebootRequired=false; w.fixture.system.distroInstalled=false; w.fixture.linux=null; w.fixture.httpOk=false })
  await page.getByRole('button',{name:'상태 새로고침',exact:true}).click()
  await page.getByRole('button',{name:'설정',exact:true}).click()
  await page.getByLabel('첫 관리자 이메일').fill('')
  await page.getByRole('button',{name:'저장하고 설치',exact:true}).click()
  await page.getByRole('alert').getByText('첫 관리자 계정의 이메일을 입력하세요.').waitFor()
  assert.equal(await page.evaluate(() => (window as any).calls.filter((x:any)=>x.command==='run_operation' && x.args.action==='install').length),0)
  await page.getByLabel('첫 관리자 이메일').fill('owner@example.test')
  await page.getByRole('button',{name:'오류 닫기',exact:true}).click()
  await capture('setup')
  await page.getByRole('button',{name:'저장하고 설치',exact:true}).click()
  await page.getByText('의존성 설치·빌드',{exact:true}).first().waitFor()
  await page.evaluate(() => { (window as any).emitFixture('manager-credential',{email:'owner@example.test',password:'fixture-secret'}) })
  assert.equal(await page.getByText('fixture-secret',{exact:true}).count(),0)
  await page.getByRole('button',{name:'비밀번호 보기',exact:true}).click()
  await page.getByText('fixture-secret',{exact:true}).waitFor()
  assert.equal(await page.locator('.log-view').getByText('fixture-secret').count(),0)
  await page.getByRole('button',{name:'로그인 정보 닫기',exact:true}).click()
  await page.evaluate(() => (window as any).releaseOperation())
  await page.getByRole('button',{name:'저장하고 설치',exact:true}).waitFor({state:'visible'})
  assert.deepEqual(errors,[])
})
