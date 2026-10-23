import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('focused selects change closed values with arrows and preserve popup, editable and multiple navigation', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `import React,{useState} from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {SelectField} from '${root}/packages/ui/src/select-field.tsx';
import {openDropdownOnArrow} from '${root}/packages/ui/src/dropdown-keyboard.ts';
import {HeaderSelect} from '${root}/src/components/agent-header-select.tsx';
import {FrontmatterSelect} from '${root}/packages/editor/src/editor/FrontmatterSelect.tsx';
localStorage.setItem('mew:locale','ko');
const options=[{value:'a',label:'Alpha'},{value:'b',label:'Beta',disabled:true},{value:'c',label:'Charlie'},{value:'d',label:'Delta'}];
function Field({label,initial='a',...props}){
 const [value,setValue]=useState(initial),[changes,setChanges]=useState(0);
 return <><SelectField label={label} value={value} options={options} onChange={next=>{setValue(next);setChanges(n=>n+1)}} {...props}/><output data-label={label}>{JSON.stringify({value,changes})}</output></>
}
function Header({label,searchable=false,initial='a',disabled=false,options:items=options.filter(o=>!o.disabled)}){
 const [value,setValue]=useState(initial),[changes,setChanges]=useState(0);
 return <><HeaderSelect title={label} value={value} options={items.map(o=>({id:o.value,label:o.label}))} onPick={next=>{setValue(next);setChanges(n=>n+1)}} searchable={searchable} disabled={disabled}/><output data-label={label}>{JSON.stringify({value,changes})}</output></>
}
function Property(){
 const [value,setValue]=useState('Alpha');
 return <><FrontmatterSelect field={{key:'Property',type:'select',value,options:['Alpha','Beta','Charlie']}} onChange={setValue} onCreate={async()=>true}/><output data-label="Property">{value}</output></>
}
function Trigger(){
 const [open,setOpen]=useState(false);
 return <button aria-label="Menu trigger" aria-expanded={open} onKeyDown={openDropdownOnArrow} onClick={()=>setOpen(v=>!v)}>Menu</button>
}
createRoot(document.getElementById('root')).render(<><Property/><Trigger/><Header label="Model" searchable/><Header label="Effort"/><Header label="Permission"/><Header label="Unknown header" initial="custom"/><Header label="Empty header" options={[]}/><Header label="Disabled header" disabled/>
 <Field label="Single"/><Field label="Unknown" initial="custom"/>
 <Field label="Empty" options={[]}/><Field label="Unavailable" options={options.map(o=>({...o,disabled:true}))}/>
 <Field label="Disabled" disabled/><Field label="Editable" editable initial="custom"/>
 <Field label="Multiple" multiple initial={['a']}/>
</>);`
  const bundle = await build({ input: 'virtual:select.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{
    name: 'fixture', resolveId(id) { if (id === 'virtual:select.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:select.tsx') return source; if (id === 'virtual:style') return '' },
  }] })
  const chunk = bundle.output.find(item => item.type === 'chunk'); assert.ok(chunk)
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(4000)
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await page.route('http://mew-select.test/**', route => route.fulfill(new URL(route.request().url()).pathname === '/app.js'
      ? { contentType: 'text/javascript', body: chunk.code }
      : { contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/app.js"></script>' }))
    await page.goto('http://mew-select.test/')
    const field = (label: string) => page.getByRole('combobox', { name: label, exact: true })
    const state = async (label: string) => JSON.parse((await page.locator(`output[data-label="${label}"]`).textContent())!)
    const single = field('Single')
    await single.focus()
    await single.press('ArrowUp')
    assert.deepEqual(await state('Single'), { value: 'a', changes: 0 })
    await single.press('ArrowDown')
    assert.deepEqual(await state('Single'), { value: 'c', changes: 1 }, 'skip disabled options and commit immediately')
    assert.equal(await single.getAttribute('aria-expanded'), 'false')
    assert.equal(await single.evaluate(el => el.ownerDocument.activeElement === el), true)
    await single.press('ArrowDown'); await single.press('ArrowDown')
    assert.deepEqual(await state('Single'), { value: 'd', changes: 2 }, 'stop at the last option')
    await single.press('ArrowUp')
    assert.deepEqual(await state('Single'), { value: 'c', changes: 3 })
    await single.press('Enter'); await single.press('ArrowUp')
    assert.deepEqual(await state('Single'), { value: 'c', changes: 3 }, 'open navigation does not commit')
    await single.press('Enter')
    assert.deepEqual(await state('Single'), { value: 'a', changes: 4 })
    await single.press('Space'); await single.press('ArrowDown'); await single.press('Escape')
    assert.deepEqual(await state('Single'), { value: 'a', changes: 4 }, 'Escape cancels popup navigation')
    await field('Unknown').press('ArrowUp')
    assert.deepEqual(await state('Unknown'), { value: 'd', changes: 1 })
    await page.reload()
    await field('Unknown').press('ArrowDown')
    assert.deepEqual(await state('Unknown'), { value: 'a', changes: 1 })
    for (const label of ['Empty', 'Unavailable']) {
      await field(label).press('ArrowDown'); await field(label).press('ArrowUp')
      assert.deepEqual(await state(label), { value: 'a', changes: 0 })
      assert.equal(await field(label).getAttribute('aria-expanded'), 'false')
    }
    await field('Disabled').dispatchEvent('keydown', { key: 'ArrowDown' })
    assert.deepEqual(await state('Disabled'), { value: 'a', changes: 0 })
    await field('Single').dispatchEvent('keydown', { key: 'ArrowDown', isComposing: true })
    assert.deepEqual(await state('Single'), { value: 'a', changes: 0 })
    await field('Editable').press('ArrowDown')
    assert.equal(await field('Editable').getAttribute('aria-expanded'), 'true')
    assert.deepEqual(await state('Editable'), { value: 'custom', changes: 0 })
    await field('Editable').press('ArrowDown'); await field('Editable').press('Enter')
    assert.deepEqual(await state('Editable'), { value: 'a', changes: 1 })
    await field('Multiple').press('ArrowDown'); await field('Multiple').press('ArrowDown')
    assert.deepEqual(await state('Multiple'), { value: ['a'], changes: 0 })
    await field('Multiple').press('Enter')
    assert.deepEqual(await state('Multiple'), { value: ['a', 'c'], changes: 1 })
    assert.equal(await field('Multiple').getAttribute('aria-expanded'), 'true')
    for (const label of ['Model', 'Effort', 'Permission']) {
      const header = field(label)
      await header.focus(); await header.press('ArrowUp')
      assert.deepEqual(await state(label), { value: 'a', changes: 0 })
      await header.press('ArrowDown')
      assert.deepEqual(await state(label), { value: 'c', changes: 1 })
      assert.equal(await header.getAttribute('aria-expanded'), 'false')
      assert.equal(await header.evaluate(el => el.ownerDocument.activeElement === el), true)
      await header.press('ArrowDown'); await header.press('ArrowDown')
      assert.deepEqual(await state(label), { value: 'd', changes: 2 })
      await header.press('Enter')
      assert.equal(await header.getAttribute('aria-expanded'), 'true')
      const keyboard = label === 'Model' ? page.getByPlaceholder('검색', { exact: true }) : header
      await keyboard.press('ArrowUp')
      assert.deepEqual(await state(label), { value: 'd', changes: 2 }, 'open arrows only move active option')
      await keyboard.press('Enter')
      assert.deepEqual(await state(label), { value: 'c', changes: 3 })
      assert.equal(await header.evaluate(el => el.ownerDocument.activeElement === el), true)
      await header.press('Space')
      await keyboard.press('ArrowUp'); await keyboard.press('Escape')
      assert.deepEqual(await state(label), { value: 'c', changes: 3 }, 'Escape cancels navigation')
      assert.equal(await header.evaluate(el => el.ownerDocument.activeElement === el), true)
    }
    await field('Unknown header').press('ArrowUp')
    assert.deepEqual(await state('Unknown header'), { value: 'd', changes: 1 })
    await field('Empty header').press('ArrowDown')
    assert.deepEqual(await state('Empty header'), { value: 'a', changes: 0 })
    await field('Disabled header').dispatchEvent('keydown', { key: 'ArrowDown' })
    assert.deepEqual(await state('Disabled header'), { value: 'a', changes: 0 })
    await field('Model').press('Enter')
    const searchInput = page.getByPlaceholder('검색', { exact: true })
    await searchInput.fill('missing'); await searchInput.press('ArrowUp'); await searchInput.press('Enter')
    assert.equal(await field('Model').getAttribute('aria-expanded'), 'true')
    await searchInput.fill('Alpha'); await searchInput.press('Enter')
    assert.deepEqual(await state('Model'), { value: 'a', changes: 4 })
    await field('Model').dispatchEvent('keydown', { key: 'ArrowDown', isComposing: true })
    assert.deepEqual(await state('Model'), { value: 'a', changes: 4 })
    await field('Model').press('Control+ArrowDown')
    assert.deepEqual(await state('Model'), { value: 'a', changes: 4 })
    const property = field('Property')
    await property.focus(); await property.press('ArrowDown')
    assert.equal(await page.locator('output[data-label="Property"]').textContent(), 'Beta')
    assert.equal(await property.getAttribute('aria-expanded'), 'false')
    await property.press('ArrowUp'); await property.press('ArrowUp')
    assert.equal(await page.locator('output[data-label="Property"]').textContent(), 'Alpha')
    assert.equal(await property.evaluate(el => el.ownerDocument.activeElement === el), true)
    const menuTrigger = page.getByRole('button', { name: 'Menu trigger' })
    await menuTrigger.press('ArrowUp')
    assert.equal(await menuTrigger.getAttribute('aria-expanded'), 'true')
    await menuTrigger.press('ArrowDown')
    assert.equal(await menuTrigger.getAttribute('aria-expanded'), 'true', 'arrows never toggle an open menu closed')
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
