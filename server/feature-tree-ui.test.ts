import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import type { Feature } from '../shared/features.ts'

const root = path.resolve(import.meta.dirname, '..')

test('feature tree stacks ancestors without gaps, preserves guides and marks leaves', { skip: !domBrowserExecutable(), timeout: 30_000 }, async t => {
  const features: Feature[] = []
  const add = (id: string, parentId: string | null) => {
    const stamp = new Date(Date.UTC(2020, 0, 1, 0, 0, features.length)).toISOString()
    features.push({ id, parentId, title: id, content: '', version: 1, status: 'implemented', createdAt: stamp, updatedAt: stamp, documentPath: `docs/features/${id}.md` })
  }
  const leaves = (prefix: string, parentId: string | null, count: number) => {
    for (let index = 0; index < count; index++) add(`${prefix}-${index}`, parentId)
  }
  const branch = (id: string, parentId: string | null, depth: number) => {
    add(id, parentId)
    if (depth < 2) {
      leaves(`${id}-before`, id, 12)
      branch(`${id}-child`, id, depth + 1)
      leaves(`${id}-after`, id, 12)
    } else leaves(`${id}-note`, id, 40)
  }
  leaves('prefix', null, 12)
  branch('parent', null, 0)
  leaves('outside', null, 20)
  const source = `import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {FeatureDevelopment} from '${root}/src/components/feature-development.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
localStorage.setItem('mew:locale','ko'); window.files=[];
createRoot(document.getElementById('root')).render(<I18nProvider><div style={{height:400,width:320}}>
  <FeatureDevelopment workspace="/project" initialState={{sort:'created',expandedFeatures:['parent','parent-child','parent-child-child']}}
    onClose={()=>{}} onOpenFile={path=>window.files.push(path)} onOpenAgent={()=>{}} />
</div></I18nProvider>);`
  const bundle = await build({ input: 'virtual:feature-tree.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:feature-tree.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:feature-tree.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const content = (await Promise.all(['src/components/feature-development.tsx', 'packages/ui/src/select-field.tsx'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))]) + await fs.readFile(`${root}/src/components/feature-development.css`, 'utf8')
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } })
  page.setDefaultTimeout(3000)
  await page.addInitScript(() => localStorage.setItem('mew:locale', 'ko'))
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('http://feature-tree.test/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/api/features')) {
      if (route.request().method() === 'PATCH') return route.fulfill({ status: 409, json: { error: 'Save rejected' } })
      return route.fulfill({ json: { version: 1, revision: 1, workspace: '/project', features, runs: [], canEdit: true } })
    }
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>${bundle.output.find(item => item.type === 'chunk')!.code}</script></html>` })
  })
  const list = page.locator('[data-feature-list]')
  const row = (id: string) => page.locator(`[data-feature-id="${id}"]`)
  const header = (depth: number) => page.locator(`[data-feature-sticky-depth="${depth}"]`)
  const scrollTo = async (id: string, offset: number) => {
    await row(id).evaluate((el, offset) => {
      const list = el.closest('[data-feature-list]')!
      list.scrollTop += el.getBoundingClientRect().top - list.getBoundingClientRect().top - offset
    }, offset)
    await page.waitForTimeout(80)
  }
  for (const mobile of [false, true]) {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1100, height: 700 })
    await page.goto('http://feature-tree.test/')
    await row('parent-child-child-note-20').waitFor()
    assert.equal(await page.locator('[data-feature-node="outside-0"] [data-feature-leaf]').getAttribute('aria-hidden'), 'true')
    assert.equal(await page.locator('[data-feature-node="outside-0"] button[aria-expanded]').count(), 0)
    await scrollTo('parent-child-child-note-20', 110)
    const box = await list.boundingBox(); assert.ok(box)
    for (let depth = 0; depth < 3; depth++) {
      const rect = await header(depth).boundingBox(); assert.ok(rect)
      assert.equal(rect.y, box.y + depth * 32, 'sticky rows meet the scroll edge and each other without gaps')
      assert.equal(rect.height, 32)
    }
    for (const theme of ['dark', 'light']) {
      await page.locator('html').evaluate((el, theme) => { el.className = theme }, theme)
      await page.screenshot({ path: `/tmp/mew-feature-tree-${mobile ? 'mobile' : 'desktop'}-${theme}.png` })
      const shot = await page.screenshot({ clip: box })
      const expected = await page.locator('[data-feature-children]').first().evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el, '::before').backgroundColor)
      const pixels = await list.evaluate(async (el, data) => {
        const doc = el.ownerDocument, img = doc.createElement('img'), canvas = doc.createElement('canvas')
        img.src = 'data:image/png;base64,' + data; await img.decode()
        canvas.width = img.width; canvas.height = img.height
        const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0)
        return [[20, 48], [20, 80], [34, 80], [20, 126], [34, 126], [48, 126]].map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3))
      }, shot.toString('base64'))
      for (const pixel of pixels) assert.deepEqual(pixel, expected.match(/\d+/g)!.slice(0, 3).map(Number), 'all ancestor guides stay visible across pinned and child rows')
    }
    const title = row('parent').getByRole('textbox')
    await title.fill('Failed title'); await title.press('Enter')
    await row('parent').getByRole('alert').waitFor()
    await page.waitForTimeout(80)
    const parentBox = await header(0).boundingBox(), childBox = await header(1).boundingBox(), grandchildBox = await header(2).boundingBox()
    assert.ok(parentBox && childBox && grandchildBox)
    assert.ok(parentBox.height > 32, 'save error expands the parent header')
    assert.equal(childBox.y, parentBox.y + parentBox.height, 'measured header heights keep expanded errors gap-free')
    assert.equal(grandchildBox.y, childBox.y + childBox.height)
    await title.press('Escape'); await page.waitForTimeout(80)
    await scrollTo('parent-child-child-note-20', 110)
    await page.getByRole('button', { name: '문서 열기: docs/features/parent-child-child-note-20.md', exact: true }).click()
    assert.deepEqual(await page.evaluate('window.files'), ['docs/features/parent-child-child-note-20.md'])
    await scrollTo('parent-child-after-2', 96)
    const third = await header(2).boundingBox(); assert.ok(third)
    assert.ok(third.y + third.height <= box.y + 64, 'third ancestor stops at its own subtree end')
    await scrollTo('parent-after-2', 64)
    const second = await header(1).boundingBox(); assert.ok(second)
    assert.ok(second.y + second.height <= box.y + 32)
    await scrollTo('outside-2', 0)
    const first = await header(0).boundingBox(); assert.ok(first)
    assert.ok(first.y + first.height <= box.y, 'root does not follow outside its subtree')
    await scrollTo('parent-child-child-note-20', 110)
    await page.getByRole('button', { name: 'parent-child 접기', exact: true }).click()
    assert.equal(await page.locator('[data-feature-sticky-depth]').count(), 1)
    assert.equal(await row('parent-child-child-note-20').count(), 0)
  }
  assert.deepEqual(errors, [])
})
