import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('textarea history preserves blank lines and wrapped-line arrow navigation', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const bundle = await build({
    input: new URL('../packages/ui/src/textareaVisualLine.ts', import.meta.url).pathname,
    write: false,
    platform: 'browser',
    output: { format: 'iife', name: 'textareaBoundary' },
  })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage()
    await page.setContent('<textarea style="width:120px;height:180px;font:16px/24px monospace;padding:8px;white-space:pre-wrap;overflow-wrap:break-word"></textarea>')
    await page.addScriptTag({ content: chunk.code })
    await page.addScriptTag({ content: `
      document.querySelector('textarea').addEventListener('keydown', event => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        if (textareaBoundary.isTextareaCaretOnVisualBoundary(event.target, event.key === 'ArrowUp' ? 'up' : 'down')) {
          event.preventDefault();
          event.target.value = 'history';
        }
      });
    ` })
    const input = page.locator('textarea')
    const setInput = async (value: string, start: number, end = start) => {
      await input.fill(value)
      await input.evaluate((element, selection) => element.setSelectionRange(...selection), [start, end] as [number, number])
    }

    for (const value of ['\n하이', '\n\n하이', ' \n하이']) {
      for (let caret = value.lastIndexOf('\n') + 1; caret <= value.length; caret++) {
        await setInput(value, caret)
        await input.press('ArrowUp')
        assert.equal(await input.inputValue(), value, 'move up through blank lines before recalling history')
        assert.ok(await input.evaluate(element => element.selectionStart) < caret)
      }
    }
    await setInput('\n하이', 0)
    await input.press('ArrowUp')
    assert.equal(await input.inputValue(), 'history', 'the empty first line still permits history')

    await setInput('하이\n', 0)
    await input.press('ArrowDown')
    assert.equal(await input.inputValue(), '하이\n', 'move into a trailing blank line')
    await input.press('ArrowDown')
    assert.equal(await input.inputValue(), 'history')

    const wrapped = '가'.repeat(30)
    await setInput(wrapped, wrapped.length)
    await input.press('ArrowUp')
    assert.equal(await input.inputValue(), wrapped, 'soft-wrapped lines retain cursor movement')
    await setInput(wrapped, 0)
    await input.press('ArrowDown')
    assert.equal(await input.inputValue(), wrapped)

    await setInput('하이', 0, 2)
    await input.press('ArrowUp')
    assert.equal(await input.inputValue(), '하이', 'selection must not recall history')
    await setInput('하이', 1)
    await input.press('ArrowUp')
    assert.equal(await input.inputValue(), 'history', 'single-line history remains available')
  } finally {
    await browser.close()
  }
})
