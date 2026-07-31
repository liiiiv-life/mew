import test from 'node:test'
import assert from 'node:assert/strict'
import { isSvgMarkup, svgFileName } from './svgPaste.ts'

const SVG = '<svg width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18"/></svg>'

test('isSvgMarkup은 통짜 SVG 문서를 통과시킨다', () => {
  assert.equal(isSvgMarkup(SVG), true)
  assert.equal(isSvgMarkup(`\n  ${SVG}\n`), true)
  assert.equal(isSvgMarkup(`<?xml version="1.0" encoding="UTF-8"?>\n${SVG}`), true)
  assert.equal(isSvgMarkup(`<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN">\n${SVG}`), true)
  assert.equal(isSvgMarkup(`<!-- Generator: Figma -->\n${SVG}`), true)
  assert.equal(isSvgMarkup('<SVG><g/></SVG>'), true)
})

test('isSvgMarkup은 SVG가 아닌 붙여넣기를 건드리지 않는다', () => {
  assert.equal(isSvgMarkup(''), false)
  assert.equal(isSvgMarkup('그냥 텍스트'), false)
  assert.equal(isSvgMarkup(`아이콘: ${SVG}`), false)
  assert.equal(isSvgMarkup(`${SVG} 이 아이콘을 참고`), false)
  assert.equal(isSvgMarkup('<div><span>x</span></div>'), false)
  // 여는 태그만 있고 닫히지 않은 조각
  assert.equal(isSvgMarkup('<svg width="40">'), false)
  // svg를 언급만 하는 문장
  assert.equal(isSvgMarkup('<svgfoo></svgfoo>'), false)
})

test('svgFileName은 <title>을 파일명으로 쓴다', () => {
  assert.equal(svgFileName('<svg><title>로고 마크</title></svg>'), '로고-마크.svg')
  assert.equal(svgFileName('<svg><title>a/b:c*d</title></svg>'), 'abcd.svg')
  assert.equal(svgFileName(SVG), 'svg-image.svg')
  assert.equal(svgFileName('<svg><title>   </title></svg>'), 'svg-image.svg')
  assert.equal(svgFileName(`<svg><title>${'가'.repeat(80)}</title></svg>`), `${'가'.repeat(60)}.svg`)
})
