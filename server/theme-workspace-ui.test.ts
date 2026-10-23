import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium, type Locator, type Page } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')
type Point = { x: number; y: number }

// Inspect the rendered PNG, including every opaque ancestor between the real
// conversation and the backdrop. A computed gradient alone cannot detect occlusion.
async function pixels(page: Page, image: Buffer, points: Point[]): Promise<number[][]> {
  return page.locator('body').evaluate(async (el, { image, points }) => {
    const doc = el.ownerDocument, view = doc.defaultView!
    const bytes = Uint8Array.from(view.atob(image), value => String(value).charCodeAt(0))
    const bitmap = await view.createImageBitmap(new view.Blob([bytes], { type: 'image/png' }))
    const canvas = doc.createElement('canvas')
    canvas.width = bitmap.width; canvas.height = bitmap.height
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0)
    return points.map(({ x, y }) => [...context.getImageData(x, y, 1, 1).data].slice(0, 3))
  }, { image: image.toString('base64'), points })
}

const distance = (a: number[], b: number[]) => a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0)
const spread = (colors: number[][]) => Math.max(...colors.flatMap(first => colors.map(second => distance(first, second))))
const luminance = (rgb: number[]) => rgb.reduce((sum, value, index) => {
  const channel = value / 255
  return sum + (channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][index]
}, 0)
const contrast = (a: number[], b: number[]) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05)

async function backgroundAlpha(surface: Locator): Promise<number> {
  return surface.evaluate(el => {
    const canvas = el.ownerDocument.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')!
    context.fillStyle = el.ownerDocument.defaultView!.getComputedStyle(el).backgroundColor
    context.fillRect(0, 0, 1, 1)
    return context.getImageData(0, 0, 1, 1).data[3] / 255
  })
}

test('real docked agent conversations and saved history show animated theme gradients on desktop/mobile', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  const source = `import React,{useState} from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {AgentPanel} from '${root}/src/components/AgentPanel.tsx';
import {DockWorkspace} from '${root}/src/components/DockWorkspace.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {applyThemePalette,THEME_PRESETS} from '${root}/src/utils/theme-color.ts';
localStorage.setItem('mew:locale','ko');
window.setFixtureTheme=id=>applyThemePalette(THEME_PRESETS.find(theme=>theme.id===id).palette);
window.fixturePresets=THEME_PRESETS;
window.setFixtureTheme(new URL(location.href).searchParams.get('theme'));
const message=(role,text)=>({type:'update',update:{sessionUpdate:role+'_message_chunk',content:{type:'text',text}}});
const events=id=>[message('user',id==='saved'?'Saved theme question':'Theme background question'),{type:'turn_start'},message('agent',id==='saved'?'Saved theme answer':'Theme background answer'),{type:'turn_end',stopReason:'end_turn'}];
const meta=id=>({type:'meta',meta:{sessionId:id,startedAt:new Date().toISOString(),turns:1,busy:false,queued:[],usage:null,canLoad:true,canList:true}});
class Socket {
 static OPEN=1;readyState=0;
 constructor(){setTimeout(()=>{this.readyState=1;this.onopen?.();this.restore('current')},10)}
 emit(event){this.onmessage?.({data:JSON.stringify(event)})}
 restore(id){const content=events(id);this.emit({type:'history',page:{generation:'theme-'+id,sessionId:id,start:0,end:content.length,total:content.length,usersBefore:0,mode:'replace',events:content,controls:[]}});this.emit(meta(id))}
 send(raw){const request=JSON.parse(raw);if(request.type==='list_sessions')this.emit({type:'sessions',sessions:[{sessionId:'saved',title:'Saved theme session'}]});if(request.type==='load_session')setTimeout(()=>this.restore(request.sessionId),10)}
 close(){this.readyState=3;this.onclose?.()}
}
window.WebSocket=Socket;
function Fixture(){
 const [layout,setLayout]=useState({version:1,groups:[{id:'agent',kind:'agent'}],tabs:{'agent:theme':'agent'},active:{agent:'theme'},tree:{id:'agent'}});
 return <main className="mew-workspace flex h-full flex-col bg-surface-deep"><div className="mew-workspace-content flex min-h-0 flex-1"><DockWorkspace value={layout} onChange={setLayout} foreground="agent" apiRef={null} onEditorDrop={()=>'main'}><AgentPanel cacheAccount="theme-owner" project="test" workspacePath="/workspace" tree={[]} focusedFilePath={null} onOpenFile={()=>{}} onClose={()=>{}} /></DockWorkspace></div></main>;
}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:theme-workspace.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{
    name: 'theme-workspace-fixture',
    async resolveId(id, importer) {
      if (id === 'virtual:theme-workspace.tsx') return id
      if (id === '@mew/tmux-term') return 'virtual:terminal'
      if (id.endsWith('.css')) return 'virtual:style'
      if (id.endsWith('?raw')) { const resolved = await this.resolve(id.slice(0, -4), importer, { skipSelf: true }); if (resolved) return `${resolved.id}?raw` }
    },
    async load(id) {
      if (id === 'virtual:theme-workspace.tsx') return source
      if (id === 'virtual:terminal') return 'export const isHiddenTmuxSession=()=>false;export function TmuxTerminal(){return null}'
      if (id === 'virtual:style') return ''
      if (id.endsWith('?raw')) return `export default ${JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8'))}`
    },
  }] })
  const chunk = bundle.output.find(item => item.type === 'chunk'); assert.ok(chunk)
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const content = (await Promise.all(['src/components/AgentPanel.tsx', 'src/components/MentionTextarea.tsx', 'src/components/DockWorkspace.tsx'].map(file => fs.readFile(`${root}/${file}`, 'utf8')))).join('\n')
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@!&:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1100, 390]) for (const theme of ['midnight', 'rose', 'ocean']) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: 'no-preference' })
      page.setDefaultTimeout(5000)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('http://mew-theme-workspace.test/**', route => {
        const pathname = new URL(route.request().url()).pathname
        if (pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: chunk.code })
        if (pathname === '/api/user-ui/agent-tabs') return route.fulfill({ json: { state: { tabs: [{ id: 'theme', label: 'Theme conversation', renamed: true, runtime: 'codex', cwd: '/workspace', sessionIds: { [JSON.stringify(['codex', '/workspace'])]: 'current' } }], activeId: 'theme' }, claims: [] } })
        if (pathname === '/api/agent-cwd') return route.fulfill({ json: { cwd: '/workspace' } })
        if (pathname === '/api/projects') return route.fulfill({ json: [] })
        if (pathname.startsWith('/api/')) return route.fulfill({ json: { settings: null, skills: [], jobs: [], commands: [], runtimes: [] } })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}html,body,#root{height:100%;margin:0}</style><div id="root"></div><script src="/app.js"></script></html>` })
      })
      await page.goto(`http://mew-theme-workspace.test/?theme=${theme}`)
      await page.getByText('Theme background question', { exact: true }).waitFor()
      const conversation = page.locator('[data-agent-conversation] > div').first()
      const translucentSurfaces = [
        { name: 'user bubble', locator: page.locator('[data-agent-question] button[aria-expanded]') },
        { name: 'assistant bubble', locator: page.locator('[data-agent-turn-header]').locator('..') },
        { name: 'composer input', locator: page.locator('[data-agent-composer] .bg-surface').first() },
        { name: 'session toolbar', locator: page.getByRole('button', { name: '히스토리', exact: true }).locator('..').locator('..') },
        { name: 'neutral button', locator: page.getByRole('button', { name: '그림판 열기', exact: true }) },
      ]
      for (const surface of translucentSurfaces) {
        const alpha = await backgroundAlpha(surface.locator)
        assert.ok(alpha > .2 && alpha < .95, `${theme}/${width} ${surface.name} has a tinted translucent surface: alpha ${alpha}`)
      }
      assert.equal(await backgroundAlpha(page.locator('[data-agent-composer] button.bg-accent')), 1, 'the primary action retains its solid semantic color')
      const palette = await page.evaluate<{ background: string; text: string; primary: string }>(`window.fixturePresets.find(preset=>preset.id===${JSON.stringify(theme)}).palette`)
      const sourceTokens = await page.locator('html').evaluate(el => {
        const style = el.ownerDocument.defaultView!.getComputedStyle(el)
        return ['surface-deep', 'ink', 'accent'].map(token => style.getPropertyValue('--color-' + token).trim())
      })
      assert.deepEqual(sourceTokens, [palette.background, palette.text, palette.primary], 'translucency preserves the chosen background, text and primary source colors')
      const componentPoints = await Promise.all(translucentSurfaces.slice(0, 3).map(async ({ locator }) => locator.evaluate(el => {
        const bounds = el.getBoundingClientRect()
        return [.25, .5, .75].map(x => ({ x: Math.floor(bounds.x + bounds.width * x), y: Math.floor(bounds.bottom - 4) }))
      })))
      const componentText = await Promise.all(translucentSurfaces.slice(0, 3).map(async ({ locator }) => locator.evaluate(el => {
        const canvas = el.ownerDocument.createElement('canvas')
        canvas.width = canvas.height = 1
        const context = canvas.getContext('2d')!
        context.fillStyle = el.ownerDocument.defaultView!.getComputedStyle(el).color
        context.fillRect(0, 0, 1, 1)
        return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
      })))
      const points = await conversation.evaluate(el => {
        const bounds = el.getBoundingClientRect()
        return [.30, .60, .90].flatMap(y => [3, bounds.width / 2, bounds.width - 4].map(x => ({ x: Math.floor(bounds.x + x), y: Math.floor(bounds.y + bounds.height * y) })))
      })
      const surfaces = await conversation.evaluate(el => {
        const ancestors = []
        for (let current: typeof el | null = el; current; current = current.parentElement) {
          const style = el.ownerDocument.defaultView!.getComputedStyle(current)
          ancestors.push({ tag: current.tagName, class: current.className, color: style.backgroundColor, image: style.backgroundImage, opacity: style.opacity })
        }
        return ancestors
      })
      const snapshot = async (name: string, samplePoints = points) => {
        const screenshot = await page.screenshot()
        if (process.env.MEW_THEME_SCREENSHOTS) {
          await fs.mkdir(process.env.MEW_THEME_SCREENSHOTS, { recursive: true })
          await fs.writeFile(path.join(process.env.MEW_THEME_SCREENSHOTS, `${theme}-${width}-${name}.png`), screenshot)
        }
        return pixels(page, screenshot, samplePoints)
      }
      const frame = async (time: number) => {
        const count = await page.locator('body').evaluate((el, time) => {
          const animations = el.ownerDocument.getAnimations().filter((animation: { animationName?: string }) => String(animation.animationName).startsWith('theme-background-'))
          for (const animation of animations) { animation.pause(); animation.currentTime = time }
          return animations.length
        }, time)
        assert.ok(count > 0, `${theme}/${width} has a live theme animation`)
        await page.locator('body').evaluate(el => new Promise(resolve => {
          const view = el.ownerDocument.defaultView!
          view.requestAnimationFrame(() => view.requestAnimationFrame(resolve))
        }))
      }
      await frame(0)
      const first = await snapshot('conversation')
      const firstComponents = await snapshot('component-surfaces', componentPoints.flat())
      assert.ok(spread(first) >= 10, `${theme}/${width} PNG shows a visible gradient across the real conversation: ${JSON.stringify({ pixels: first, surfaces })}`)
      assert.equal(await page.locator('[data-dock-workspace]').evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'the real dock host reveals the backdrop')
      await frame(12_000)
      const moving = await snapshot('motion')
      assert.ok(first.some((color, index) => distance(color, moving[index]) >= 3), `${theme}/${width} backdrop animation changes rendered conversation pixels`)
      const movingComponents = await snapshot('component-motion', componentPoints.flat())
      for (let index = 0; index < componentPoints.length; index++) {
        assert.ok(componentPoints[index].some((_point, pointIndex) => distance(firstComponents[index * 3 + pointIndex], movingComponents[index * 3 + pointIndex]) >= 1), `${theme}/${width} the moving backdrop remains visible inside the ${translucentSurfaces[index].name}`)
        for (let pointIndex = 0; pointIndex < 3; pointIndex++) for (const colors of [firstComponents, movingComponents]) {
          assert.ok(contrast(componentText[index], colors[index * 3 + pointIndex]) >= 4.5, `${theme}/${width} ${translucentSurfaces[index].name} text remains readable against the rendered translucent background`)
        }
      }
      await page.getByRole('button', { name: '히스토리', exact: true }).click()
      const history = page.getByRole('region', { name: '지난 세션', exact: true })
      await history.getByRole('button', { name: /Saved theme session/ }).waitFor()
      assert.ok(Math.abs(await backgroundAlpha(history) - .75) < .005, 'the actual history popup keeps a 75% background in every gradient theme')
      assert.deepEqual(await history.evaluate(el => {
        const style = el.ownerDocument.defaultView!.getComputedStyle(el)
        return { backdrop: style.backdropFilter, filter: style.filter, opacity: style.opacity }
      }), { backdrop: 'blur(6px)', filter: 'none', opacity: '1' }, 'only the backdrop is blurred; popup text remains sharp')
      await snapshot('history-menu')
      await history.getByRole('button', { name: /Saved theme session/ }).click()
      await page.getByText('Saved theme question', { exact: true }).waitFor()
      const restored = await snapshot('saved-history')
      assert.ok(spread(restored) >= 10, `${theme}/${width} restored history retains a visible gradient`)
      assert.equal(await conversation.evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'the actual conversation scroll surface reveals the shared backdrop')
      await page.emulateMedia({ reducedMotion: 'reduce' })
      assert.equal(await page.locator('body').evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el, '::before').animationName), 'none')
      const still = await snapshot('reduced-motion')
      await page.waitForTimeout(160)
      assert.deepEqual(await snapshot('reduced-motion-later'), still, `${theme}/${width} reduced motion preserves identical background pixels`)
      await page.evaluate("window.setFixtureTheme('dark')")
      assert.equal(await page.locator('html').evaluate(el => el.classList.contains('theme-gradient')), false)
      assert.equal(await page.locator('body').evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el, '::before').backgroundImage), 'none')
      assert.notEqual(await page.locator('[data-agent-session]').evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'solid themes restore their opaque session surface')
      assert.notEqual(await page.locator('[data-dock-workspace]').evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'solid themes restore the dock host edge surface')
      for (const surface of translucentSurfaces) assert.equal(await backgroundAlpha(surface.locator), 1, `solid themes restore an opaque ${surface.name}`)
      assert.equal(spread(await snapshot('solid')), 0, `${theme}/${width} switching back to a solid theme removes the visible gradient`)
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
