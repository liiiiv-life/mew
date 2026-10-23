import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium, type Page } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')
type Point = { x: number; y: number }

async function pixels(page: Page, points: Point[]) {
  const screenshot = await page.screenshot()
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

const distance = (a: number[], b: number[]) => a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0)

test('light modal scrims darken only outside translucent panels on desktop/mobile', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  const source = `import React,{useState} from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {DialogFrame} from '${root}/packages/ui/src/dialog-frame.tsx';
import {SelectField} from '${root}/packages/ui/src/select-field.tsx';
import {useOverlayDismiss} from '${root}/packages/ui/src/useOverlayDismiss.ts';
import {applyThemePalette,THEME_PRESETS} from '${root}/src/utils/theme-color.ts';
const params=new URL(location.href).searchParams;
applyThemePalette(THEME_PRESETS.find(theme=>theme.id===params.get('theme')).palette);
function Fixture(){
 const [open,setOpen]=useState(false),[value,setValue]=useState('first');
 const close=()=>setOpen(false),legacy=params.get('modal')!=='frame',nested=params.get('modal')==='nested';
 useOverlayDismiss(legacy&&open&&close);
 const content=<><h2 id="fixture-title">Light theme popup</h2><SelectField label="Theme options" value={value} onChange={setValue} options={[{value:'first',label:'First option'},{value:'second',label:'Second option'}]}/></>;
 return <><main className="mew-workspace fixed inset-0 bg-surface-deep"><button id="open" onClick={()=>setOpen(true)}>Open popup</button></main>{open&&(legacy?<>
 {nested&&<div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/50 p-4"><section className="h-48 w-full max-w-xs rounded-xl bg-surface p-4">Underlying popup</section></div>}
 <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/40 p-4" onPointerDown={event=>{if(event.target===event.currentTarget)close()}}><section className="fixture-panel h-64 w-full max-w-sm overflow-hidden rounded-xl border border-edge bg-surface-raised p-4 shadow-xl" aria-labelledby="fixture-title">{content}</section></div></>:
 <DialogFrame labelledBy="fixture-title" onClose={close} className="fixture-panel h-64 max-w-sm p-4">{content}</DialogFrame>)}</>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);`
  const bundle = await build({ input: 'virtual:light-overlay.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{
    name: 'light-overlay-fixture',
    resolveId(id) { if (id === 'virtual:light-overlay.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' },
    load(id) { if (id === 'virtual:light-overlay.tsx') return source; if (id === 'virtual:style') return '' },
  }] })
  const chunk = bundle.output.find(item => item.type === 'chunk'); assert.ok(chunk)
  const content = (await Promise.all(['packages/ui/src/dialog-frame.tsx', 'packages/ui/src/select-field.tsx'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@!&:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1100, 390]) for (const theme of ['light', 'paper', 'rose', 'ocean']) for (const modal of ['frame', 'legacy', 'nested']) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: 'reduce' })
      try {
        page.setDefaultTimeout(5000)
        const label = `${theme}/${width}/${modal}`
        const errors: string[] = []
        page.on('pageerror', error => errors.push(error.message))
        await page.route('http://mew-light-overlay.test/**', route => route.fulfill(new URL(route.request().url()).pathname === '/app.js'
          ? { contentType: 'text/javascript', body: chunk.code }
          : { contentType: 'text/html', body: `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}
            .mew-workspace{background-image:repeating-linear-gradient(90deg,transparent 0 8px,color-mix(in srgb,var(--color-accent) 30%,transparent) 8px 16px)}
            </style><div id="root"></div><script src="/app.js"></script></html>` }))
        await page.goto(`http://mew-light-overlay.test/?theme=${theme}&modal=${modal}`)
        await page.locator('#open').click()
        const panel = page.locator('.fixture-panel')
        await panel.waitFor()
        const styles = await panel.evaluate(el => {
          const view = el.ownerDocument.defaultView!, style = view.getComputedStyle(el)
          const canvas = el.ownerDocument.createElement('canvas')
          canvas.width = canvas.height = 1
          const context = canvas.getContext('2d')!
          context.fillStyle = style.backgroundColor; context.fillRect(0, 0, 1, 1)
          return { alpha: context.getImageData(0, 0, 1, 1).data[3] / 255, backdrop: style.backdropFilter, filter: style.filter,
            opacity: style.opacity, wrapper: view.getComputedStyle(el.parentElement!).backgroundColor, shadow: style.boxShadow }
        })
        assert.ok(Math.abs(styles.alpha - .75) < .005, `${label}: translucent panel`)
        assert.equal(styles.backdrop, 'blur(6px)', `${label}: blurred backdrop`)
        assert.equal(styles.filter, 'none', `${label}: sharp foreground`)
        assert.equal(styles.opacity, '1')
        assert.equal(styles.wrapper, 'rgba(0, 0, 0, 0)', `${label}: no black paint under the panel`)
        assert.match(styles.shadow, new RegExp(`rgba\\(0, 0, 0, ${modal === 'frame' ? '0.5' : '0.4'}\\)`), `${label}: original dimming strength`)
        if (modal === 'nested') assert.equal(await page.locator('.max-w-xs').evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).getPropertyValue('--mew-modal-scrim').trim()), 'transparent', `${label}: the lower modal clears its scrim`)
        const bounds = await panel.boundingBox(); assert.ok(bounds)
        const inside = [.04, .5, .96].map(x => ({ x: Math.floor(bounds.x + bounds.width * x), y: Math.floor(bounds.y + bounds.height - 45) }))
        const outside = { x: width / 2, y: 70 }
        const roundedCorner = { x: Math.ceil(bounds.x) + 1, y: Math.ceil(bounds.y) + 1 }
        const samples = [...inside, outside, roundedCorner]
        const dimmed = await pixels(page, samples)
        await panel.locator('..').evaluate(el => el.style.setProperty('--mew-modal-scrim', 'transparent'))
        const clear = await pixels(page, samples)
        for (let index = 0; index < inside.length; index++) assert.ok(distance(dimmed[index], clear[index]) <= 2, `${label}: removing the scrim leaves inside pixels unchanged`)
        assert.ok(distance(dimmed[3], clear[3]) > 100, `${label}: outside pixels are dimmed`)
        assert.ok(distance(dimmed[4], clear[4]) > 50, `${label}: rounded corner stays outside the cutout`)
        await panel.locator('..').evaluate(el => el.style.removeProperty('--mew-modal-scrim'))
        await panel.evaluate(el => el.style.backdropFilter = 'none')
        const unblurred = await pixels(page, inside)
        assert.ok(inside.some((_point, index) => distance(dimmed[index], unblurred[index]) > 2), `${label}: blur changes actual backdrop pixels`)
        await panel.evaluate(el => el.style.removeProperty('backdrop-filter'))
        const dropdown = page.getByRole('combobox', { name: 'Theme options', exact: true })
        await dropdown.click()
        const list = page.getByRole('listbox', { name: 'Theme options', exact: true })
        await list.waitFor()
        assert.equal(await list.evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).backdropFilter), 'blur(6px)')
        await page.keyboard.press('Escape')
        assert.equal(await list.count(), 0)
        assert.equal(await panel.count(), 1, `${label}: closing the dropdown keeps its modal open`)
        if (process.env.MEW_LIGHT_OVERLAY_SCREENSHOTS) {
          await fs.mkdir(process.env.MEW_LIGHT_OVERLAY_SCREENSHOTS, { recursive: true })
          await page.screenshot({ path: path.join(process.env.MEW_LIGHT_OVERLAY_SCREENSHOTS, `${theme}-${width}-${modal}.png`) })
        }
        await page.mouse.click(8, 70)
        await panel.waitFor({ state: 'detached' })
        await page.locator('#open').click()
        await page.keyboard.press('Escape')
        await panel.waitFor({ state: 'detached' })
        assert.deepEqual(errors, [], `${label}: no runtime errors`)
      } finally { await page.close() }
    }
  } finally { await browser.close() }
})
