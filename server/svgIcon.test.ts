import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MAX_SVG_ICON_BYTES,
  SVG_PREFIX,
  SVG_TINT_PREFIX,
  SvgIconError,
  normalizeIconValue,
  normalizeSvgIcon,
  splitSvgIcon,
} from './svgIcon.ts'

const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>'

test('normalizeSvgIcon: 멀쩡한 SVG는 그대로 통과한다', () => {
  assert.equal(normalizeSvgIcon(`  ${ICON}\n`), ICON)
})

test('normalizeSvgIcon: XML 선언과 앞쪽 주석은 떼어낸다', () => {
  const withProlog = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generator: 무언가 -->\n${ICON}`
  assert.equal(normalizeSvgIcon(withProlog), ICON)
})

test('normalizeSvgIcon: SVG가 아니면 거부한다', () => {
  assert.throws(() => normalizeSvgIcon('그냥 글자'), SvgIconError)
  assert.throws(() => normalizeSvgIcon(''), SvgIconError)
  // </svg> 뒤에 뭔가 더 붙어 있는 것도 아이콘 하나가 아니다
  assert.throws(() => normalizeSvgIcon(`${ICON}<img src=x>`), SvgIconError)
})

test('normalizeSvgIcon: 위험한 조각이 있으면 저장을 거부한다', () => {
  const bad = [
    `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0" onload="alert(1)"/></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><path d="M0 0"/></a></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/x.png"/></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(//example.com/x)"/></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>hi</div></foreignObject></svg>`,
    `<!DOCTYPE svg [<!ENTITY a "aaa">]><svg xmlns="http://www.w3.org/2000/svg"><path d="&a;"/></svg>`,
  ]
  for (const svg of bad) assert.throws(() => normalizeSvgIcon(svg), SvgIconError, svg.slice(0, 60))
})

test('normalizeSvgIcon: 로고 한 장보다 큰 SVG는 거부한다', () => {
  const huge = `<svg xmlns="http://www.w3.org/2000/svg"><path d="${'M0 0'.repeat(MAX_SVG_ICON_BYTES)}"/></svg>`
  assert.throws(() => normalizeSvgIcon(huge), /너무 큽니다/)
})

test('splitSvgIcon: 접두사로 직접 넣은 SVG를 가려낸다', () => {
  assert.deepEqual(splitSvgIcon(`${SVG_PREFIX}${ICON}`), { prefix: SVG_PREFIX, markup: ICON })
  assert.deepEqual(splitSvgIcon(`${SVG_TINT_PREFIX}${ICON}`), { prefix: SVG_TINT_PREFIX, markup: ICON })
  assert.equal(splitSvgIcon('i:book'), null)
  assert.equal(splitSvgIcon('🌱'), null)
})

test('normalizeIconValue: 아이콘 종류를 가려 검사한다 (프로젝트·터미널 버튼 공용)', () => {
  // 라인 아이콘 키와 이모지는 그대로, 앞뒤 공백만 털어낸다
  assert.equal(normalizeIconValue('  i:code-brackets '), 'i:code-brackets')
  assert.equal(normalizeIconValue('🌱'), '🌱')
  // 빈 값 = 아이콘 없음
  assert.equal(normalizeIconValue('   '), '')
  // SVG는 길이 기준이 다르다 — 접두사를 지키고 XML 선언은 떨어져 나간다
  assert.equal(normalizeIconValue(`${SVG_PREFIX}<?xml version="1.0"?>${ICON}`), `${SVG_PREFIX}${ICON}`)
  assert.equal(normalizeIconValue(`${SVG_TINT_PREFIX}${ICON}`), `${SVG_TINT_PREFIX}${ICON}`)
  // SVG가 아닌데 긴 값은 아이콘 표기가 아니다
  assert.throws(() => normalizeIconValue('가'.repeat(64)), SvgIconError)
  // 위험한 SVG는 여기서도 막힌다
  assert.throws(() => normalizeIconValue(`${SVG_PREFIX}<svg><script>alert(1)</script></svg>`), SvgIconError)
})

test('저장값 접두사가 클라이언트 표기와 같다', () => {
  // 서버와 클라이언트가 같은 문자열을 써야 저장한 아이콘이 화면에 뜬다 — 한쪽만 바꾸면 여기서 걸린다
  const client = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/utils/projectIcons.ts'),
    'utf-8',
  )
  assert.match(client, new RegExp(`SVG_PREFIX = '${SVG_PREFIX}'`))
  assert.match(client, new RegExp(`SVG_TINT_PREFIX = '${SVG_TINT_PREFIX}'`))
})
