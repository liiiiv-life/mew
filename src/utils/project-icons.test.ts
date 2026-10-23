import assert from 'node:assert/strict'
import test from 'node:test'
import { hasIcon, iconValue, lookupIcon, splitSvgIcon, svgDataUrl, svgIconValue } from './projectIcons.ts'
import { ICON_GROUPS, lookupCatalogIcon } from './project-icon-catalog.ts'

test('stored project icons retain every catalog key, stable components and unknown-key fallbacks', () => {
  for (const group of ICON_GROUPS) {
    assert.ok(group.label)
    for (const [key, component] of Object.entries(group.icons)) {
      assert.ok(component, `${key} resolves to an icon component`)
      assert.equal(lookupCatalogIcon(key), component)
      assert.equal(hasIcon(iconValue(key)), true)
      assert.ok(lookupIcon(iconValue(key)))
      assert.equal(lookupIcon(iconValue(key)), lookupIcon(iconValue(key)), `${key} preserves component identity across renders`)
    }
  }
  for (const value of [null, undefined, '', 'i:missing-icon', 'i:toString', 'i:__proto__', 'svg: ', 'svgt:']) {
    assert.equal(hasIcon(value), false)
    if (typeof value === 'string') assert.equal(lookupIcon(value), undefined)
  }
  assert.equal(hasIcon('📚'), true)
  assert.equal(lookupIcon('📚'), undefined)
})

test('custom SVG prefixes and CSS mask data preserve their existing format', () => {
  const markup = '<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>'
  assert.equal(svgIconValue(markup), `svg:${markup}`)
  for (const prefix of ['svg:', 'svgt:']) {
    assert.equal(hasIcon(`${prefix}${markup}`), true)
    assert.deepEqual(splitSvgIcon(`${prefix}${markup}`), { markup })
  }
  assert.equal(svgDataUrl(markup), `data:image/svg+xml;utf8,${encodeURIComponent(markup)}`)
})
