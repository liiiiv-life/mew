import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('Hotview gutter follows typing, trailing paragraphs and frontmatter on desktop and mobile', { skip: !domBrowserExecutable(), timeout: 45_000 }, async () => {
  const initial = '---\ntitle: test\nupdated: 2026-09-27\n---\n\n첫 문단\n\n마지막 문단'
  const codeContent = '---\ntitle: test\n---\n\n# 제목\n\n```txt\n코드\n```'
  const ruleContent = '앞 문단\n\n---\n\n뒤 문단';
  const tableContent = '앞 문단\n\n| 이름 | 설명 |\n| --- | --- |\n| 항목 | 내용 |\n\n뒤 문단'
  const listContent = '# Current\n\n기준 문단\n\n- 일반 항목\n- [설정](configuration/MOC.md)\n- [원격 데스크톱 지연·대역폭 개선 연구 — 기준 조사와 세부 구현 확인](research/remote-desktop-latency.md)\n- 상위 항목\n  - [하위](child.md)\n    - 둘째\n      - 셋째\n        - [넷째](deep.md)\n\n앞 문장 [문장 안에서 여러 줄에 걸쳐 자연스럽게 이어지는 긴 내부 파일 링크 설명과 줄바꿈 확인](long.md) 뒤 문장\n\n1. [순서 목록](ordered.md)\n2. 다음 항목\n\n[외부 링크](https://example.com)'
  const navigationContent = '[문서 규칙](./rules.md)\n\n앞 [문서 규칙](./rules.md) 뒤\n\n[첫 문서](./one.md)[둘째 문서](./two.md)'
  const linkKindsContent = '- [하위문서](./child.md)\n- [다른 내부문서](../other.md)\n- [Docs 밖 소스 파일](../../src/main.ts)\n- [웹](https://example.com)'
  const taskContent = '- [ ] 첫 항목\n- [x] 완료\n  - [ ] 하위 할 일'
  const editorPath = new URL('../packages/editor/src/Editor.tsx', import.meta.url).pathname
  const source = `
import React from ${JSON.stringify(import.meta.resolve('react'))};
import {createRoot} from ${JSON.stringify(import.meta.resolve('react-dom/client'))};
import {Editor} from ${JSON.stringify(editorPath)};
const api={db:{},fetchFile:async()=>({content:''}),fetchLinkPreview:async()=>({title:null,description:null})};
function Fixture(){
  const [value,setValue]=React.useState(${JSON.stringify(initial)});
  const [readOnly,setReadOnly]=React.useState(false);
  window.value=value;
  return <><button onClick={()=>setValue(v=>v.replace('title: test','title: test\\nextra: field'))}>Add property</button>
    <button onClick={()=>setValue(${JSON.stringify(codeContent)})}>Load code</button>
    <button onClick={()=>setValue(${JSON.stringify(tableContent)})}>Load table</button>
    <button onClick={()=>setValue(${JSON.stringify(ruleContent)})}>Load rule</button>
    <button onClick={()=>setValue(${JSON.stringify(listContent)})}>Load list</button>
    <button onClick={()=>setValue(${JSON.stringify(navigationContent)})}>Load link navigation</button>
    <button onClick={()=>setValue(${JSON.stringify(linkKindsContent)})}>Load link kinds</button>
    <button onClick={()=>setValue('- Tail item')}>Load bullet tail</button>
    <button onClick={()=>setValue('- [ ] Tail item')}>Load checkbox tail</button>
    <button onClick={()=>setValue('')}>New task document</button>
    <button onClick={()=>setValue(${JSON.stringify(taskContent)})}>Load tasks</button>
    <button onClick={()=>setReadOnly(v=>!v)}>Read-only tasks</button>
    <div style={{height:600}}><Editor readOnly={readOnly} value={value} onChange={setValue} api={api} path="fixture.md" fileLinkContext={{path:'/project/notes/guide/_guide.md',docsRoot:'/project/notes'}}/></div></>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);`
  const styles: string[] = []
  const bundle = await build({
    input: 'virtual:gutter.tsx', write: false, platform: 'browser', output: { format: 'esm' },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } },
    plugins: [{
      name: 'gutter-fixture',
      resolveId(id) { if (id === 'virtual:gutter.tsx') return id },
      async load(id) {
        if (id === 'virtual:gutter.tsx') return source
        if (id.endsWith('.css')) { styles.push(await fs.readFile(id, 'utf8')); return { code: '', moduleType: 'js' } }
      },
    }],
  })
  const root = path.resolve(import.meta.dirname, '..')
  const compiler = await compile(await fs.readFile(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} })
  const css = compiler.build([...new Set((source + await fs.readFile(editorPath, 'utf8') + await fs.readFile(path.join(root, 'packages/editor/src/editor/FrontmatterPanel.tsx'), 'utf8')).match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))]) + styles.join('\n')
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport })
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('http://mew-gutter.test/**', route => route.fulfill(route.request().url().endsWith('/app.js')
        ? { contentType: 'text/javascript', body: chunk.code }
        : { contentType: 'text/html', body: `<!doctype html><html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script type="module" src="/app.js"></script></html>` }))
      await page.goto('http://mew-gutter.test/')
      const expectNumbers = async (expected: string[]) => {
        await page.waitForFunction(`expected => JSON.stringify(Array.from(document.querySelectorAll('.tiptap [data-mew-line-numbers]'), el => el.getAttribute('data-mew-line-numbers'))) === JSON.stringify(expected)`, expected, { timeout: 5000 })
        await page.waitForFunction(`Array.from(document.querySelectorAll('.tiptap [data-mew-line-numbers]')).every(el => getComputedStyle(el, '::before').content === JSON.stringify(el.getAttribute('data-mew-line-numbers')))`, undefined, { timeout: 5000 })
        const numbers = await page.locator('.tiptap [data-mew-line-numbers]').evaluateAll(elements => elements.map(el => ({
          number: el.getAttribute('data-mew-line-numbers'), content: el.ownerDocument.defaultView!.getComputedStyle(el, '::before').content,
        })))
        assert.ok(numbers.every(({ number, content }) => content === `"${number}"`), `CSS displays the mapped Markdown numbers: ${JSON.stringify(numbers)}`)
      }
      const expectProperties = async (expected: string[]) => {
        assert.deepEqual(await page.locator('.frontmatter-line').evaluateAll(elements => elements.map(el => {
          const style = el.ownerDocument.defaultView!.getComputedStyle(el, '::before')
          return { number: el.getAttribute('data-mew-line-numbers'), content: style.content }
        })), expected.map(number => ({ number, content: `"${number}"` })))
      }
      await expectProperties(['2', '3'])
      await expectNumbers(['6', '8'])
      const fieldGeometry = await page.locator('.frontmatter-property').first().evaluate(row => {
        const win = row.ownerDocument.defaultView!
        const paragraph = row.ownerDocument.querySelector('.tiptap > p')!
        const number = win.getComputedStyle(row, '::before')
        const bodyNumber = win.getComputedStyle(paragraph, '::before')
        const numberRight = (el: typeof row, style: ReturnType<typeof win.getComputedStyle>) => el.getBoundingClientRect().left + parseFloat(style.left) + parseFloat(style.width)
        return {
          numberRight: numberRight(row, number),
          bodyNumberRight: numberRight(paragraph, bodyNumber),
          labelLeft: row.querySelector('input')!.getBoundingClientRect().left,
          bodyLeft: paragraph.getBoundingClientRect().left,
          handleLeft: row.querySelector('button')!.getBoundingClientRect().left,
          handleRight: row.querySelector('button')!.getBoundingClientRect().right,
        }
      })
      assert.ok(Math.abs(fieldGeometry.numberRight - fieldGeometry.bodyNumberRight) < 1, 'frontmatter field numbers align with body numbers')
      assert.ok(Math.abs(fieldGeometry.labelLeft - fieldGeometry.bodyLeft - 12) < 1, 'field indentation matches the 12px handle')
      assert.ok(fieldGeometry.handleLeft > fieldGeometry.numberRight, 'handle stays to the right of the number')
      assert.ok(fieldGeometry.handleRight <= fieldGeometry.labelLeft + 1, 'handle does not overlap the field')

      await page.getByRole('button', { name: 'Add property', exact: true }).click()
      await expectProperties(['2', '3', '4'])
      await expectNumbers(['7', '9'])
      const paragraphs = page.locator('.tiptap > p')
      await paragraphs.first().click()
      await page.keyboard.press('End')
      await page.keyboard.press('Enter')
      await page.keyboard.type('middle')
      await expectNumbers(['7', '9', '11'])
      await page.keyboard.press('Home')
      await page.keyboard.press('Backspace')
      await expectNumbers(['7', '9'])
      await page.keyboard.press('ControlOrMeta+z')
      await expectNumbers(['7', '9', '11'])
      await page.keyboard.press('ControlOrMeta+Shift+z')
      await expectNumbers(['7', '9'])
      await paragraphs.last().click()
      await page.keyboard.press('End')
      await page.keyboard.press('Enter')
      await expectNumbers(['7', '9', '11'])
      await page.keyboard.type('tail')
      await expectNumbers(['7', '9', '11'])
      await page.getByRole('button', { name: 'Load code', exact: true }).click()
      await expectNumbers(['5', '7', '11'])
      await paragraphs.last().click()
      await page.keyboard.type('after code')
      await expectNumbers(['5', '7', '11'])
      if (process.env.MEW_EDITOR_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.MEW_EDITOR_SCREENSHOT_DIR}/line-numbers-${viewport.width}.png` })
      await page.getByRole('button', { name: 'Load rule', exact: true }).click()
      await expectNumbers(['1', '3', '5'])
      const rule = page.locator('.tiptap > .mew-horizontal-rule')
      const ruleGeometry = await rule.evaluate(el => {
        const win = el.ownerDocument.defaultView!
        const number = win.getComputedStyle(el, '::before')
        const box = el.getBoundingClientRect()
        const paragraph = el.parentElement!.querySelector('p')!
        const paragraphNumber = win.getComputedStyle(paragraph, '::before')
        return {
          left: box.left + parseFloat(number.left),
          paragraphLeft: paragraph.getBoundingClientRect().left + parseFloat(paragraphNumber.left),
          center: box.top + parseFloat(number.top) + parseFloat(number.lineHeight) / 2,
          ruleTop: el.querySelector('hr')!.getBoundingClientRect().top,
          display: number.display,
        }
      })
      assert.ok(Math.abs(ruleGeometry.left - ruleGeometry.paragraphLeft) < 1, 'divider number aligns with the paragraph gutter')
      assert.ok(Math.abs(ruleGeometry.center - ruleGeometry.ruleTop) < 1, `divider number is centered on the line: ${JSON.stringify(ruleGeometry)}`)
      assert.notEqual(ruleGeometry.display, 'none')
      assert.equal(await page.evaluate('window.value'), ruleContent, 'display wrapper preserves Markdown source')
      await page.getByRole('button', { name: 'Load table', exact: true }).click()
      await expectNumbers(['1', '3', '7'])
      const wrapper = page.locator('.tiptap > .tableWrapper')
      const geometry = await wrapper.evaluate(el => {
        const win = el.ownerDocument.defaultView!
        const editor = el.parentElement!
        const number = win.getComputedStyle(el, '::before')
        const rect = el.getBoundingClientRect()
        return {
          left: rect.left,
          tableLeft: el.querySelector('table')!.getBoundingClientRect().left,
          textLeft: editor.querySelector('p')!.getBoundingClientRect().left,
          numberRight: editor.getBoundingClientRect().left + parseFloat(number.left) + parseFloat(number.width),
        }
      })
      assert.ok(Math.abs(geometry.left - geometry.textLeft) < 1, 'table container starts at the body column')
      assert.ok(Math.abs(geometry.tableLeft - geometry.left) < 1, 'no padding before the table')
      assert.ok(geometry.left > geometry.numberRight, 'the line number stays outside the table container')
      // Force an overflowing table even on desktop, then verify only its contents move.
      await wrapper.locator('table').evaluate(el => { el.style.minWidth = '1800px' })
      await wrapper.evaluate(el => { el.scrollLeft = 160 })
      assert.equal(await wrapper.evaluate(el => el.scrollLeft), 160)
      assert.equal((await wrapper.boundingBox())!.x, geometry.left)
      assert.ok((await wrapper.locator('table').boundingBox())!.x < geometry.left)
      await expectNumbers(['1', '3', '7'])
      assert.equal(await page.evaluate('document.documentElement.scrollWidth > window.innerWidth'), false)
      if (process.env.MEW_EDITOR_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.MEW_EDITOR_SCREENSHOT_DIR}/table-gutter-${viewport.width}.png` })
      await page.getByRole('button', { name: 'Load list', exact: true }).click()
      await page.locator('.tiptap li a[data-file-link]').first().waitFor()
      for (const theme of ['dark', 'light']) {
        await page.locator('html').evaluate((el, theme) => { el.className = theme }, theme)
        const layout = await page.locator('.tiptap').evaluate(editor => {
          const win = editor.ownerDocument.defaultView!
          const paragraph = editor.querySelector(':scope > p')!
          const numberLeft = (el: typeof paragraph) => el.getBoundingClientRect().left + parseFloat(win.getComputedStyle(el, '::before').left)
          const items: (typeof paragraph)[] = Array.from(editor.querySelectorAll('li[data-mew-line-numbers]'))
          const link = editor.querySelector('li a[data-file-link]')!
          const linkParagraph = link.closest('p')!
          const plainParagraph = items[0].querySelector('p')!
          const longLink = editor.querySelector('a[href="long.md"]')!
          const range = editor.ownerDocument.createRange()
          range.selectNodeContents(longLink)
          return {
            paragraphNumber: numberLeft(paragraph),
            listNumbers: items.map(numberLeft),
            plainHeight: plainParagraph.getBoundingClientRect().height,
            linkHeight: linkParagraph.getBoundingClientRect().height,
            linkDisplay: win.getComputedStyle(link).display,
            longLines: new Set(Array.from(range.getClientRects() as ArrayLike<{ top: number }>, rect => Math.round(rect.top))).size,
            externalDecoration: win.getComputedStyle(editor.querySelector('a[href="https://example.com"]')!).textDecorationLine,
            overflow: editor.scrollWidth > editor.clientWidth,
          }
        })
        assert.ok(layout.listNumbers.every(left => Math.abs(left - layout.paragraphNumber) < 1), 'all list depths share the paragraph gutter')
        assert.ok(Math.abs(layout.linkHeight - layout.plainHeight) < 1, 'an internal link does not enlarge a single-line list item')
        assert.equal(layout.linkDisplay, 'inline', 'file links flow within the surrounding sentence')
        if (viewport.width < 500) assert.ok(layout.longLines > 1, 'long labels wrap on mobile')
        assert.equal(layout.externalDecoration, 'underline')
        assert.equal(layout.overflow, false)
        assert.equal(await page.evaluate('window.value'), listContent, 'presentation changes preserve Markdown')
        if (process.env.MEW_EDITOR_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.MEW_EDITOR_SCREENSHOT_DIR}/list-links-${theme}-${viewport.width}.png` })
      }
      await page.getByRole('button', { name: 'Load link kinds', exact: true }).click()
      await page.locator('a[data-file-link-kind="outside-docs"]').waitFor()
      for (const theme of ['dark', 'light']) {
        await page.locator('html').evaluate((el, theme) => { el.className = theme }, theme)
        const kinds = await page.locator('.tiptap a').evaluateAll(links => links.map(link => {
          const win = link.ownerDocument.defaultView!
          return { kind: link.getAttribute('data-file-link-kind'), border: win.getComputedStyle(link).borderTopWidth,
            arrow: win.getComputedStyle(link, '::after').maskImage, decoration: win.getComputedStyle(link).textDecorationLine }
        }))
        assert.deepEqual(kinds.map(link => link.kind), ['subdocument', 'document', 'outside-docs', null])
        assert.equal(kinds[0].border, '0px')
        assert.equal(kinds[1].border, '1px')
        assert.equal(kinds[2].border, '1px')
        assert.notEqual(kinds[2].arrow, 'none')
        assert.equal(kinds[1].arrow, 'none')
        assert.equal(kinds[3].decoration, 'underline')
        await page.locator('a[data-file-link-kind="subdocument"]').hover()
        assert.equal(await page.locator('a[data-file-link-kind="subdocument"]').evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).borderTopWidth), '0px')
        assert.equal(await page.evaluate('window.value'), linkKindsContent)
        if (process.env.MEW_EDITOR_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.MEW_EDITOR_SCREENSHOT_DIR}/link-kinds-${theme}-${viewport.width}.png` })
      }
      for (const side of ['before', 'after', 'after-space']) {
        await page.getByRole('button', { name: 'Load link navigation', exact: true }).click()
        const link = page.locator('.tiptap a[data-file-link]').first()
        const box = (await link.boundingBox())!
        await page.mouse.click(side === 'before' ? box.x - 2 : box.x + box.width + (side === 'after' ? 3 : 40), box.y + box.height / 2)
        const caret = await link.evaluate(el => {
          const selection = el.ownerDocument.getSelection()!
          const node = selection.focusNode
          const parent = node?.nodeType === 3 ? node.parentElement : node as typeof el | null
          const range = selection.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null
          return { collapsed: selection.isCollapsed, insideLink: !!parent?.closest('a[data-file-link]'), height: range?.height ?? 0 }
        })
        assert.equal(caret.collapsed, true)
        assert.equal(caret.insideLink, false, `click ${side} places the caret outside the link`)
        assert.ok(caret.height > 0, `click ${side} leaves a visible caret`)
        await page.keyboard.type('Z')
        await page.waitForFunction(`side => window.value.startsWith(side === 'before' ? 'Z[문서 규칙](./rules.md)' : '[문서 규칙](./rules.md)Z')`, side)
        await page.keyboard.insertText('한')
        await page.waitForFunction(`side => window.value.startsWith(side === 'before' ? 'Z한[문서 규칙](./rules.md)' : '[문서 규칙](./rules.md)Z한')`, side)
        assert.doesNotMatch(await page.evaluate('window.value') as string, /\u200b|mew-file-link-caret/)
        assert.equal(await link.textContent(), '문서 규칙')
      }
      for (const index of [0, 1, 2, 3]) {
        for (const direction of ['left', 'right']) {
          await page.getByRole('button', { name: 'Load link navigation', exact: true }).click()
          await page.waitForFunction(`document.querySelectorAll('.tiptap a[data-file-link]').length === 4`)
          const link = page.locator('.tiptap a[data-file-link]').nth(index)
          await link.evaluate(async (el, direction) => {
            const doc = el.ownerDocument
            ;(el.closest('.tiptap') as typeof el).focus()
            const range = doc.createRange()
            if (direction === 'left') range.setStartAfter(el)
            else range.setStartBefore(el)
            range.collapse(true)
            const selection = doc.getSelection()!
            selection.removeAllRanges(); selection.addRange(range)
            await new Promise(resolve => doc.defaultView!.requestAnimationFrame(() => doc.defaultView!.requestAnimationFrame(resolve)))
          }, direction)
          await page.keyboard.press(direction === 'left' ? 'ArrowLeft' : 'ArrowRight')
          const caret = await link.evaluate(el => {
            const selection = el.ownerDocument.getSelection()!
            const node = selection.anchorNode!
            const parent = node.nodeType === 3 ? node.parentElement : node as typeof el
            return { collapsed: selection.isCollapsed, insideLink: !!parent?.closest('a[data-file-link]') }
          })
          assert.deepEqual(caret, { collapsed: true, insideLink: false }, `caret stays outside the link after Arrow${direction}`)
          const label = await link.textContent()
          await page.keyboard.type('Z')
          const href = await link.getAttribute('href')
          await page.waitForFunction(`({label, href, direction}) => window.value.includes(direction === 'left' ? 'Z['+label+']' : '['+label+']('+href+')Z')`, {label, href, direction})
          assert.equal(await link.textContent(), label, 'navigation and typing preserve the link label')
        }
      }
      for (const name of ['Load bullet tail', 'Load checkbox tail']) {
        await page.getByRole('button', { name, exact: true }).click()
        const tail = page.locator('.tiptap > p').last()
        await tail.click()
        await expectNumbers(['1', '2'])
        await page.keyboard.press('Enter')
        await page.keyboard.press('Backspace')
        await page.keyboard.press('Backspace')
        await expectNumbers(['1', '2'])
        assert.equal(await page.locator('.tiptap > p').count(), 1, 'only the final input line remains')
        const saved = await page.evaluate('window.value') as string
        assert.ok(saved.endsWith('\n') && !saved.endsWith('\n\n'), 'source has one final blank line')
        assert.doesNotMatch(saved, /<br/)
      }
      await page.getByRole('button', { name: 'New task document', exact: true }).click()
      const editable = page.locator('.tiptap')
      await page.waitForFunction(`document.querySelector('.tiptap').textContent === ''`)
      await expectNumbers(['1'])
      const placeholder = await editable.locator('p').first().evaluate(el => ({
        number: el.ownerDocument.defaultView!.getComputedStyle(el, '::before').content,
        hint: el.ownerDocument.defaultView!.getComputedStyle(el, '::after').content,
        text: el.getAttribute('data-placeholder'),
      }))
      assert.equal(placeholder.number, '"1"', 'an empty document still shows line 1')
      assert.equal(placeholder.hint, JSON.stringify(placeholder.text), 'placeholder uses a separate pseudo-element')
      for (const theme of ['dark', 'light']) {
        await page.locator('html').evaluate((el, theme) => { el.className = theme }, theme)
        const gap = await editable.locator('p').first().evaluate(el => {
          const win = el.ownerDocument.defaultView!
          const number = win.getComputedStyle(el, '::before'), hint = win.getComputedStyle(el, '::after')
          return { numberRight: parseFloat(number.left) + parseFloat(number.width), hintLeft: parseFloat(hint.left), hintTop: hint.top }
        })
        assert.ok(gap.numberRight < gap.hintLeft, 'line number and placeholder do not overlap')
        assert.equal(gap.hintTop, '0px', 'placeholder stays on the empty first line')
        if (process.env.MEW_EDITOR_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.MEW_EDITOR_SCREENSHOT_DIR}/empty-gutter-${theme}-${viewport.width}.png` })
      }
      await editable.locator('p').first().click()
      await page.keyboard.press('Enter')
      await page.keyboard.press('Enter')
      await expectNumbers(['1', '3', '5'])
      assert.equal((await page.evaluate('window.value') as string).match(/<br\/>/g)?.length, 2, 'empty paragraphs are preserved in Markdown')
      await page.keyboard.type('마지막 문단')
      await expectNumbers(['1', '3', '5'])
      await page.keyboard.press('ControlOrMeta+a')
      await page.keyboard.press('Backspace')
      await expectNumbers(['1'])
      await editable.locator('p').first().click()
      await page.keyboard.type('[] ')
      assert.equal(await editable.locator('li[data-type="taskItem"]').count(), 1, await editable.innerHTML())
      await page.keyboard.type('새 할 일')
      await page.waitForFunction(`window.value.includes('- [ ] 새 할 일')`)
      const checkbox = editable.locator('input[type="checkbox"]').first()
      await checkbox.check()
      await page.waitForFunction(`window.value.includes('- [x] 새 할 일')`)
      await editable.locator('li[data-type="taskItem"] p').first().click()
      await page.keyboard.press('End')
      await page.keyboard.press('Enter')
      await page.keyboard.type('다음 할 일')
      assert.equal(await editable.locator('input[type="checkbox"]').count(), 2)
      assert.equal(await editable.locator('input[type="checkbox"]').nth(1).isChecked(), false)
      await page.keyboard.press('Tab')
      assert.equal(await editable.locator('li[data-type="taskItem"] li[data-type="taskItem"]').count(), 1)
      await page.keyboard.press('Shift+Tab')
      assert.equal(await editable.locator('li[data-type="taskItem"] li[data-type="taskItem"]').count(), 0)
      await page.keyboard.press('Enter')
      await page.keyboard.press('Enter')
      await page.keyboard.type('일반 문단')
      assert.equal(await editable.locator(':scope > p').filter({ hasText: '일반 문단' }).count(), 1, 'empty task Enter returns to a paragraph')
      await page.getByRole('button', { name: 'Load tasks', exact: true }).click()
      await expectNumbers(['1', '2', '3'])
      for (const theme of ['dark', 'light']) {
        await page.locator('html').evaluate((el, theme) => { el.className = theme }, theme)
        const geometry = await editable.locator('li[data-type="taskItem"]').evaluateAll(items => items.map(item => {
          const win = item.ownerDocument.defaultView!
          const box = item.querySelector('input')!.getBoundingClientRect()
          const text = item.querySelector('p')!.getBoundingClientRect()
          return { gutter: item.getBoundingClientRect().left + parseFloat(win.getComputedStyle(item, '::before').left), boxRight: box.right, textLeft: text.left }
        }))
        assert.ok(geometry.every(item => Math.abs(item.gutter - geometry[0].gutter) < 1), 'task gutter stays aligned at every depth')
        assert.ok(geometry.every(item => item.boxRight <= item.textLeft), 'checkbox does not overlap the text')
        if (process.env.MEW_EDITOR_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.MEW_EDITOR_SCREENSHOT_DIR}/tasks-${theme}-${viewport.width}.png` })
      }
      await page.getByRole('button', { name: 'Read-only tasks', exact: true }).click()
      const originalTasks = await page.evaluate('window.value')
      await editable.locator('input[type="checkbox"]').first().click()
      assert.equal(await editable.locator('input[type="checkbox"]').first().isChecked(), false)
      assert.equal(await page.evaluate('window.value'), originalTasks, 'read-only checkboxes preserve content')
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
