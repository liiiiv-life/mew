import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium, type Locator, type Page } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import { installLiveFixture } from './live-ui-fixture.ts'

const root = path.resolve(import.meta.dirname, '..')
type Point = { x: number; y: number }
const distance = (a: number[], b: number[]) => a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0)
const spread = (colors: number[][]) => Math.max(...colors.flatMap(first => colors.map(second => distance(first, second))))

async function alpha(locator: Locator, property: 'backgroundColor' | 'fill' = 'backgroundColor'): Promise<number> {
  return locator.evaluate((el, property) => {
    const canvas = el.ownerDocument.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')!
    context.fillStyle = el.ownerDocument.defaultView!.getComputedStyle(el)[property]
    context.fillRect(0, 0, 1, 1)
    return context.getImageData(0, 0, 1, 1).data[3] / 255
  }, property)
}

async function pixels(page: Page, screenshot: Buffer, points: Point[]): Promise<number[][]> {
  return page.locator('body').evaluate(async (el, { image, points }) => {
    const doc = el.ownerDocument, view = doc.defaultView!
    const bytes = Uint8Array.from(view.atob(image), value => String(value).charCodeAt(0))
    const bitmap = await view.createImageBitmap(new view.Blob([bytes], { type: 'image/png' }))
    const canvas = doc.createElement('canvas')
    canvas.width = bitmap.width; canvas.height = bitmap.height
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0)
    return points.map(({ x, y }) => [...context.getImageData(x, y, 1, 1).data].slice(0, 3))
  }, { image: screenshot.toString('base64'), points })
}

async function frame(page: Page, time: number) {
  const count = await page.locator('body').evaluate((el, time) => {
    const animations = el.ownerDocument.getAnimations().filter((animation: { animationName?: string }) => String(animation.animationName).startsWith('theme-background-'))
    for (const animation of animations) { animation.pause(); animation.currentTime = time }
    return animations.length
  }, time)
  assert.ok(count > 0, 'the real theme backdrop is animated')
  await page.locator('body').evaluate(el => new Promise(resolve => {
    const view = el.ownerDocument.defaultView!
    view.requestAnimationFrame(() => view.requestAnimationFrame(resolve))
  }))
}

test('Git, tasks and features reveal the shared gradient through real dock bodies and tabs on desktop/mobile', { skip: !domBrowserExecutable(), timeout: 90_000 }, async () => {
  const source = `import React,{useState} from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {DockWorkspace,DockPanel} from '${root}/src/components/DockWorkspace.tsx';
import {GitPanel} from '${root}/src/components/git-panel.tsx';
import {TaskPanel} from '${root}/src/components/task-panel.tsx';
import {FeatureDevelopment} from '${root}/src/components/feature-development.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {applyThemePalette,THEME_PRESETS} from '${root}/src/utils/theme-color.ts';
localStorage.setItem('mew:locale','ko');
window.setFixtureTheme=id=>applyThemePalette(THEME_PRESETS.find(theme=>theme.id===id).palette);
window.setFixtureTheme(new URL(location.href).searchParams.get('theme'));
const noop=()=>{};
function Fixture(){
 const [layout,setLayout]=useState({version:1,groups:[{id:'git',kind:'git'},{id:'tasks',kind:'tasks'},{id:'features',kind:'features'}],tabs:{},active:{},tree:{axis:'row',ratio:.34,first:{id:'git'},second:{axis:'row',ratio:.5,first:{id:'tasks'},second:{id:'features'}}}});
 const [foreground,setForeground]=useState('git');window.showFixturePanel=setForeground;
 const [tasks,setTasks]=useState([{id:'theme-task',text:'Theme task',done:false,path:'docs/tasks/theme.md'}]);
 const [draft,setDraft]=useState(''),[draftTags,setDraftTags]=useState([]),[draftAssignees,setDraftAssignees]=useState([]);
 const session={tasks,canEdit:true,draft,draftTags,draftAssignees,setDraft,setDraftTags,setDraftAssignees,edit:setTasks,flush:async()=>{},retry:async()=>{}};
 return <main className="mew-workspace flex h-full flex-col bg-surface-deep"><div className="mew-workspace-content flex min-h-0 flex-1"><DockWorkspace value={layout} onChange={setLayout} foreground={foreground} apiRef={null} onEditorDrop={()=>'main'}>
   <GitPanel visible initialState={null} onChange={noop} onNotice={noop} onClose={noop} onPanelFocus={()=>setForeground('git')}/>
   <DockPanel id="tasks" kind="tasks" tabs={['tasks']} mobileSelected onFocus={()=>setForeground('tasks')}><TaskPanel workspace="/workspace" session={session} onClose={noop} onOpenFile={noop}/></DockPanel>
   <DockPanel id="features" kind="features" mobileSelected onFocus={()=>setForeground('features')}><FeatureDevelopment workspace="/workspace" onClose={noop} onOpenFile={noop} onOpenAgent={noop}/></DockPanel>
 </DockWorkspace></div></main>;
}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:theme-panels.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{
    name: 'theme-panels-fixture',
    resolveId(id) { if (id === 'virtual:theme-panels.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' },
    async load(id) {
      if (id === 'virtual:theme-panels.tsx') return source
      if (id === 'virtual:style') return ''
      if (id.endsWith('?raw')) return `export default ${JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8'))}`
    },
  }] })
  const chunk = bundle.output.find(item => item.type === 'chunk'); assert.ok(chunk)
  const files = ['src/components/DockWorkspace.tsx', 'src/components/git-panel.tsx', 'src/components/GitWorkbench.tsx', 'src/components/git-branch-picker.tsx', 'src/components/github-account.tsx', 'src/components/task-panel.tsx', 'src/components/task-gantt.tsx', 'src/components/task-tag-filter.tsx', 'src/components/task-sort-picker.tsx', 'src/components/feature-development.tsx', 'packages/ui/src/select-field.tsx']
  const content = (await Promise.all(files.map(file => fs.readFile(`${root}/${file}`, 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@!&:/.[\]()%,-]+/g))]) + (await Promise.all(['src/components/task-panel.css', 'src/components/feature-development.css'].map(file => fs.readFile(`${root}/${file}`, 'utf8')))).join('\n')
  const repository = { repository: true, workspace: '/workspace', remotes: [], branch: 'main', ahead: 0, behind: 0 }
  const commits = [{ hash: 'abcdef123456', parents: [], subject: 'Theme commit', author: 'Theme fixture', date: '2026-10-01T00:00:00Z', refs: ['main'] }]
  const workingTree = { files: [{ path: 'theme.ts', status: 'M' }] }
  const features = { workspace: '/workspace', isGitRepository: true, baseBranch: 'main', currentBranch: 'main', canEdit: true, canPreview: false, branches: [{ branch: 'feat/theme', title: 'Theme feature', notes: '', validation: '', review: 'pending', revision: 'a'.repeat(64), previewPort: null, previewPath: '/', previewStatus: 'unconfigured', current: false, isBase: false, worktreePath: null, worktreePaths: [], dirty: null, commit: null, updatedAt: null }] }
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  const failures: string[] = []
  const check = (condition: boolean, message: string) => { if (!condition) failures.push(message) }
  try {
    for (const width of [1440, 390]) for (const theme of ['midnight', 'rose', 'ocean']) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: 'no-preference' })
      try {
        page.setDefaultTimeout(5000)
        const errors: string[] = []
        page.on('pageerror', error => errors.push(error.message))
        await installLiveFixture(page, resource => resource.kind === 'features' ? features : { info: repository, commits, workingTree })
        await page.route('http://mew-theme-panels.test/**', route => {
          const pathname = new URL(route.request().url()).pathname
          if (pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: chunk.code })
          if (pathname.startsWith('/api/')) {
            const payload = pathname === '/api/features/branches' ? features
              : pathname === '/api/git/repository' ? repository
                : pathname === '/api/git/log' ? { commits }
                  : pathname === '/api/git/working-tree' ? workingTree
                    : pathname === '/api/git-connections/github' ? { available: true, login: null, environmentToken: false, busy: false, job: null }
                      : pathname === '/api/member-profiles' ? { members: [] } : { settings: null, files: [], members: [] }
            return route.fulfill({ json: payload })
          }
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}html,body,#root{height:100%;margin:0}</style><div id="root"></div><script src="/app.js"></script></html>` })
        })
        await page.goto(`http://mew-theme-panels.test/?theme=${theme}`)
        for (const kind of ['git', 'tasks', 'features']) {
          const label = `${theme}/${width}/${kind}`
          await page.evaluate(`window.showFixturePanel(${JSON.stringify(kind)})`)
          const panel = page.locator(`[data-dock-panel="${kind}"]`)
          const surface = kind === 'git' ? page.locator('[data-dock-body="git"] > div > div').first() : kind === 'tasks' ? page.getByRole('region', { name: '태스크', exact: true }) : page.locator('[data-feature-panel]')
          const body = kind === 'git' ? page.locator('[data-git-scroll="changes"]') : kind === 'tasks' ? panel.getByRole('tabpanel') : panel.locator('[data-feature-list]')
          await body.waitFor()
          if (kind === 'git') await body.getByText('theme.ts', { exact: true }).waitFor()
          if (kind === 'features') await panel.getByRole('button', { name: 'Theme feature 작업 설정', exact: true }).waitFor()
          const bodyPoints = await body.evaluate(el => {
            const bounds = el.getBoundingClientRect()
            return [.2, .55, .95].flatMap(y => [.1, .5, .9].map(x => ({ x: Math.floor(bounds.x + bounds.width * x), y: Math.floor(bounds.y + bounds.height * y) })))
          })
          const snapshot = async (name: string) => {
            const screenshot = await page.screenshot()
            if (process.env.MEW_THEME_PANELS_SCREENSHOTS) {
              await fs.mkdir(process.env.MEW_THEME_PANELS_SCREENSHOTS, { recursive: true })
              await fs.writeFile(path.join(process.env.MEW_THEME_PANELS_SCREENSHOTS, `${theme}-${width}-${kind}-${name}.png`), screenshot)
            }
            return pixels(page, screenshot, bodyPoints)
          }
          await frame(page, 0)
          const first = await snapshot('gradient')
          check(await alpha(surface) === 0, `${label}: the actual panel body must be transparent (alpha ${await alpha(surface)})`)
          check(await alpha(panel.locator('[data-dock-tab-bar]')) === 0, `${label}: the actual tab bar must reveal the shared backdrop`)
          check(spread(first) >= 10, `${label}: the rendered body must show a visible gradient (${JSON.stringify(first)})`)
          await frame(page, 12_000)
          const moving = await snapshot('motion')
          check(first.some((color, index) => distance(color, moving[index]) >= 2), `${label}: backdrop motion must remain visible through every nested body surface`)
          if (kind === 'tasks') {
            const selected = panel.getByRole('tab', { name: '목록', exact: true })
            const selectedAlpha = await alpha(selected)
            check(selectedAlpha > .2 && selectedAlpha < .95, `${label}: active neutral tabs retain a translucent tint (${selectedAlpha})`)
            await panel.locator('[data-task-id="theme-task"]').click({ button: 'right' })
          } else if (kind === 'features') {
            await panel.getByRole('button', { name: 'Theme feature 작업 설정', exact: true }).click()
            await panel.getByRole('combobox', { name: '사용자 확인', exact: true }).click()
          }
          if (kind !== 'git') {
            const popup = kind === 'tasks' ? page.getByRole('menu', { name: '태스크', exact: true }) : page.getByRole('listbox', { name: '사용자 확인', exact: true })
            await popup.waitFor()
            check(Math.abs(await alpha(popup) - .75) < .005, `${label}: menus keep their 75% background in every gradient theme`)
            const style = await popup.evaluate(el => {
              const computed = el.ownerDocument.defaultView!.getComputedStyle(el)
              return { backdrop: computed.backdropFilter, filter: computed.filter, opacity: computed.opacity }
            })
            assert.deepEqual(style, { backdrop: 'blur(6px)', filter: 'none', opacity: '1' }, `${label}: popup foreground stays sharp and opaque above its blurred background`)
            await snapshot('menu')
            await page.keyboard.press('Escape')
            if (kind === 'features') await panel.getByRole('button', { name: 'Theme feature 작업 설정', exact: true }).click()
          } else assert.equal(await alpha(page.getByRole('button', { name: '커밋', exact: true })), 1, 'primary semantic actions remain solid')
          const gantt = panel.locator('svg[aria-label="태스크 간트"]')
          if (kind === 'tasks') {
            await panel.getByRole('tab', { name: '간트', exact: true }).click()
            await gantt.waitFor()
            check(await alpha(gantt.locator(':scope > rect').first(), 'fill') === 0, `${label}: the large SVG plot background must reveal the shared backdrop`)
            const weekendAlpha = await alpha(gantt.locator(':scope > rect').nth(1), 'fill')
            check(weekendAlpha > .3 && weekendAlpha < .34, `${label}: weekend columns retain a translucent shade (${weekendAlpha})`)
            await snapshot('gantt')
          }
          await page.evaluate("window.setFixtureTheme('dark')")
          check(await alpha(surface) === 1, `${label}: solid themes restore the actual panel surface`)
          check(await alpha(panel.locator('[data-dock-tab-bar]')) === 1, `${label}: solid themes restore tab bar backgrounds`)
          if (kind === 'tasks') {
            assert.equal(await alpha(panel.getByRole('tab', { name: '간트', exact: true })), 1, 'solid themes restore opaque selected tabs')
            assert.equal(await alpha(gantt.locator(':scope > rect').first(), 'fill'), 1, 'solid themes restore the opaque SVG plot background')
            assert.equal(await alpha(gantt.locator(':scope > rect').nth(1), 'fill'), 1, 'solid themes restore opaque weekend columns')
            await panel.getByRole('tab', { name: '목록', exact: true }).click()
          }
          check(spread(await snapshot('solid')) === 0, `${label}: solid themes remove the rendered body gradient`)
          await page.evaluate(`window.setFixtureTheme(${JSON.stringify(theme)})`)
        }
        assert.deepEqual(errors, [])
      } finally { await page.close() }
    }
    assert.deepEqual(failures, [], failures.join('\n'))
  } finally { await browser.close() }
})
