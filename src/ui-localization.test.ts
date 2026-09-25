import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { setUiLocale } from '@mew/ui/i18n-core'
import { renderMarkdown } from './utils/agentMarkdown.ts'
import { describeSchedule } from './utils/cron.ts'
import { relativeCommitTime } from './utils/git-time.ts'

const root = path.resolve(import.meta.dirname, '..')
const filesUnder = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(dir, entry.name)
  return entry.isDirectory() ? filesUnder(file) : /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file) ? [file] : []
})

test('UI Korean literals stay in translation calls, dictionaries or explicit data contracts', () => {
  const failures: string[] = []
  for (const file of [...filesUnder(path.join(root, 'src')), ...filesUnder(path.join(root, 'packages'))]) {
    const relative = path.relative(root, file)
    if (/\/server\//.test(relative) || /(?:^|\/)(?:i18n[^/]*|ui-messages|.*-copy)\.tsx?$/.test(relative)) continue
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    const visit = (node: ts.Node): void => {
      // Locale-indexed dictionaries are already translated; review their Korean branch as data.
      if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'ko') return
      if (ts.isCallExpression(node) && ['uiText', 'translateUi'].includes(node.expression.getText(source))) {
        for (const argument of node.arguments.slice(1)) visit(argument)
        return
      }
      // Korean slash-command aliases and old persisted tab labels are compatibility data.
      if (relative === 'packages/editor/src/Editor.tsx' && ts.isPropertyAssignment(node) && node.name.getText(source) === 'keywords') return
      if (relative === 'src/components/AgentPanel.tsx' && ts.isVariableDeclaration(node) && node.name.getText(source) === 'LEGACY_PENDING_TAB_LABEL') return
      // Markdown heading aliases parse existing user documents in every UI language.
      if (relative === 'src/components/feature-development.tsx' && ts.isStringLiteralLike(node) && ['요구사항', '구현 내용', '검증', '하위 기능', '하위기능'].includes(node.text)) return
      if (ts.isStringLiteralLike(node) || ts.isJsxText(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        if (/[가-힣]/.test(node.text)) failures.push(`${relative}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1} ${node.text}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  assert.deepEqual(failures, [])
})

test('cached Markdown controls and derived times follow the selected language without translating content', () => {
  const text = '사용자가 쓴 본문\n\n```js\nconsole.log("안녕")\n```'
  try {
    setUiLocale('ko')
    assert.match(renderMarkdown(text), /코드 복사/)
    setUiLocale('en')
    const english = renderMarkdown(text)
    assert.match(english, /Copy code/)
    assert.doesNotMatch(english, /코드 복사/)
    assert.match(english, /사용자가 쓴 본문/)
    assert.equal(describeSchedule('30 9 * * 1,3'), 'Weekly on Mon·Wed at 09:30')
    assert.equal(relativeCommitTime('2026-09-25T00:00:00Z', Date.parse('2026-09-25T02:00:00Z')), '2 hours ago')
    setUiLocale('ja')
    assert.match(renderMarkdown(text), /コードをコピー/)
    assert.equal(describeSchedule('30 9 * * 1,3'), '毎週 月·水 09:30')
  } finally { setUiLocale('ko') }
})
