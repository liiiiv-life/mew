import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse, stringify } from 'yaml'
import { workspaceContext, pathsForWorkspace, resolveProjectPath } from '../paths.ts'
import { projectSchema, quoteIdent } from './identifiers.ts'
import { closePool, exec } from './pool.ts'
import * as svc from './databaseService.ts'
import { saveDatabaseRowPage, refreshDatabaseRowPages, remapDatabaseRowPages } from './rowPageIntegration.ts'
import { RowPageError } from './rowPages.ts'
import { joinFrontmatter, splitFrontmatter } from '../../packages/editor/src/utils/frontmatter.ts'

test('database row pages preserve autosaves, permissions and file moves', { skip: !process.env.MEW_DB_TEST_DATABASE_URL }, async t => {
  process.env.DATABASE_URL = process.env.MEW_DB_TEST_DATABASE_URL!
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-row-pages-'))
  const project = `pages_${Math.random().toString(36).slice(2, 10)}`
  fs.mkdirSync(path.join(root, project))
  fs.writeFileSync(path.join(root, project, '사람.md'), '# 사람\n')
  await workspaceContext.run(pathsForWorkspace(root, null), async () => {
    let dbId = ''
    try {
      const db = await svc.createDatabase(project, '사람', 'test@example.com', '사람.md')
      dbId = db.id
      const title = db.columns[0]
      const age = await svc.addColumn(project, dbId, '나이', 'number')
      const tags = await svc.addColumn(project, dbId, '분류', 'multi_select')
      const checked = await svc.addColumn(project, dbId, '확인', 'checkbox')
      const row = db.rows[0]
      await svc.updateCell(project, dbId, row.id, title.id, '송상훈')
      await svc.updateCell(project, dbId, row.id, age.id, 27)
      await svc.updateCell(project, dbId, row.id, tags.id, ['친구', '동료'])
      await svc.updateColumn(project, dbId, title.id, { type: 'page' })
      let current = await svc.getView(project, dbId)
      const relative = current.rows[0].pagePath!
      const file = resolveProjectPath(project, relative)
      const fields = (content: string) => parse(/^---\n([\s\S]*?)\n---/.exec(content)![1]) as Record<string, unknown>
      const contents = (values: Record<string, unknown>, body = '\n') => `---\n${stringify(values)}---\n${body}`

      await t.test('typed row fields become YAML fields without automatic timestamps', () => {
        const value = fields(fs.readFileSync(file, 'utf8'))
        assert.equal(value.title, '송상훈')
        assert.equal(value.나이, 27)
        assert.deepEqual(value.분류, ['친구', '동료'])
        assert.equal(Object.hasOwn(value, 'created'), false)
        assert.equal(Object.hasOwn(value, 'updated'), false)
        assert.equal(value.확인, null)
      })

      await t.test('body-only stale autosave retains newer DB fields and returns canonical content', async () => {
        const baseline = fs.readFileSync(file, 'utf8')
        await svc.updateCell(project, dbId, row.id, age.id, 28)
        const result = await saveDatabaseRowPage(project, relative, `${baseline}\n본문을 작성합니다.\n`, baseline)
        assert.equal(fields(result!).나이, 28)
        assert.match(result!, /본문을 작성합니다/)
        assert.equal((await svc.getView(project, dbId)).rows[0].cells[age.id], 28)
      })

      await t.test('conflicting shared-field autosave is rejected without overwriting file or DB', async () => {
        const baseline = fs.readFileSync(file, 'utf8')
        await svc.updateCell(project, dbId, row.id, age.id, 29)
        const before = fs.readFileSync(file, 'utf8')
        await assert.rejects(saveDatabaseRowPage(project, relative, contents({ ...fields(baseline), 나이: 30 }), baseline), RowPageError)
        assert.equal(fs.readFileSync(file, 'utf8'), before)
        assert.equal((await svc.getView(project, dbId)).rows[0].cells[age.id], 29)
      })

      await t.test('shared-page write requires database permission', async () => {
        const before = fs.readFileSync(file, 'utf8')
        await assert.rejects(saveDatabaseRowPage(project, relative, contents({ ...fields(before), 나이: 31 }), before, false), (error: unknown) => error instanceof RowPageError && error.status === 403)
        assert.equal(fs.readFileSync(file, 'utf8'), before)
      })

      await t.test('typed edits import as one change and preserve custom frontmatter and body', async () => {
        const before = fs.readFileSync(file, 'utf8')
        const result = await saveDatabaseRowPage(project, relative, contents({ ...fields(before), 나이: 32, 분류: ['동료'], 메모: '유지' }, '\n# 메모\n본문\n'), before)
        assert.equal(fields(result!).나이, 32)
        assert.equal(fields(result!).메모, '유지')
        assert.match(result!, /# 메모\n본문/)
        current = await svc.getView(project, dbId)
        assert.deepEqual(current.rows[0].cells[tags.id], ['동료'])
      })

      await t.test('Hotview edits share native numeric and multiple-choice fields with the DB', async () => {
        await svc.updateCell(project, dbId, row.id, checked.id, false)
        const before = fs.readFileSync(file, 'utf8')
        const data = splitFrontmatter(before).frontmatter!
        assert.equal(data.fields.find(field => field.key === '분류')?.type, 'multi-select')
        assert.deepEqual(data.fields.find(field => field.key === '분류')?.options, ['친구', '동료'])
        const submitted = joinFrontmatter({ ...data, fields: data.fields.map(field => field.key === '나이' ? { ...field, value: '32' }
          : field.key === '분류' ? { ...field, value: JSON.stringify(['친구', '새 선택']) } : field) }, 'Hotview 본문')
        assert.equal(fields(submitted).나이, 32)
        assert.deepEqual(fields(submitted).분류, ['친구', '새 선택'])
        const result = await saveDatabaseRowPage(project, relative, submitted, before)
        assert.deepEqual(fields(result!).분류, ['친구', '새 선택'])
        assert.equal(fields(result!).확인, false)
        assert.match(result!, /Hotview 본문/)
      })

      await t.test('external edits refresh the shared row without a DB editor action', async () => {
        const before = fs.readFileSync(file, 'utf8')
        fs.writeFileSync(file, contents({ ...fields(before), 나이: 33 }, '\n외부 본문\n'))
        await refreshDatabaseRowPages(project, [relative])
        assert.equal((await svc.getView(project, dbId)).rows[0].cells[age.id], 33)
        assert.match(fs.readFileSync(file, 'utf8'), /외부 본문/)
      })

      await t.test('moved page rebinds by immutable IDs when its mapping was not updated', async () => {
        const next = '이동한 사람.md'
        fs.renameSync(file, resolveProjectPath(project, next))
        const movedContent = fs.readFileSync(resolveProjectPath(project, next), 'utf8')
        fs.writeFileSync(resolveProjectPath(project, next), contents({ ...fields(movedContent), 나이: 34 }, '\n이동한 본문\n'))
        current = await svc.getView(project, dbId)
        assert.equal(current.rows[0].pagePath, next)
        assert.equal(current.rows[0].cells[age.id], 34)
        assert.equal(fs.existsSync(file), false)
        assert.match(fs.readFileSync(resolveProjectPath(project, next), 'utf8'), /이동한 본문/)
        await svc.updateColumn(project, dbId, title.id, { type: 'text' })
        await svc.updateColumn(project, dbId, title.id, { type: 'page' })
        assert.equal((await svc.getView(project, dbId)).rows[0].pagePath, next)
        assert.match(fs.readFileSync(resolveProjectPath(project, next), 'utf8'), /이동한 본문/)
        const before = fs.readFileSync(resolveProjectPath(project, next), 'utf8')
        const withoutBinding = before.replace(/^_mew_(database|row):.*\n/gm, '')
        await assert.rejects(saveDatabaseRowPage(project, `./${next}`, withoutBinding, undefined, false), (error: unknown) => error instanceof RowPageError && error.status === 403)
        assert.equal(fs.readFileSync(resolveProjectPath(project, next), 'utf8'), before)
        fs.renameSync(resolveProjectPath(project, next), file)
        await remapDatabaseRowPages(project, [{ from: next, to: relative }])
      })
    } finally {
      if (dbId) await svc.deleteDatabase(project, dbId)
      await exec(`DROP SCHEMA IF EXISTS ${quoteIdent(projectSchema(project))} CASCADE`)
      await closePool()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
