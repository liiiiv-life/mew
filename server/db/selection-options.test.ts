import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse } from 'yaml'
import { workspaceContext, pathsForWorkspace, resolveProjectPath } from '../paths.ts'
import { quoteIdent, projectSchema } from './identifiers.ts'
import { closePool, exec } from './pool.ts'
import * as svc from './databaseService.ts'
import { splitFrontmatter } from '../../packages/editor/src/utils/frontmatter.ts'

test('selection option edits persist colors and migrate every row and shared page atomically', { skip: !process.env.MEW_DB_TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.MEW_DB_TEST_DATABASE_URL!
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-option-edits-'))
  const project = `options_${Math.random().toString(36).slice(2, 10)}`
  fs.mkdirSync(path.join(root, project))
  await workspaceContext.run(pathsForWorkspace(root, null), async () => {
    let id = ''
    try {
      const db = await svc.createDatabase(project, '선택값', null)
      id = db.id
      const single = await svc.addColumn(project, id, '상태', 'select')
      const multi = await svc.addColumn(project, id, '분류', 'multi_select')
      const [first, second] = db.rows
      for (const row of [first, second]) {
        await svc.updateCell(project, id, row.id, single.id, '진행')
        await svc.updateCell(project, id, row.id, multi.id, ['개발', '문서'])
      }
      await svc.updateColumn(project, id, db.columns[0].id, { type: 'page' })
      await svc.editColumnOption(project, id, single.id, '진행', { hue: 210 })
      await svc.editColumnOption(project, id, single.id, '진행', { name: '진행 중' })
      await svc.editColumnOption(project, id, multi.id, '개발', { name: '구현', hue: 130 })
      let view = await svc.getView(project, id)
      assert.equal(view.columns.find(col => col.id === single.id)?.optionColors?.['진행 중'], 210)
      assert.equal(view.columns.find(col => col.id === multi.id)?.optionColors?.구현, 130)
      for (const row of view.rows) {
        assert.equal(row.cells[single.id], '진행 중')
        assert.deepEqual(row.cells[multi.id], ['구현', '문서'])
        const content = fs.readFileSync(resolveProjectPath(project, row.pagePath!), 'utf8')
        const fields = parse(/^---\n([\s\S]*?)\n---/.exec(content)![1])
        assert.equal(fields.상태, '진행 중')
        assert.deepEqual(fields.분류, ['구현', '문서'])
        assert.equal(splitFrontmatter(content).frontmatter!.fields.find(field => field.key === '분류')?.optionColors?.구현, 130)
      }
      const snapshot = JSON.stringify(view)
      await assert.rejects(svc.editColumnOption(project, id, multi.id, '구현', { name: '문서' }), svc.DbValidationError)
      await assert.rejects(svc.editColumnOption(project, id, multi.id, '구현', { hue: 999 }), svc.DbValidationError)
      assert.equal(JSON.stringify(await svc.getView(project, id)), snapshot)
      await svc.editColumnOption(project, id, single.id, '진행 중', { remove: true })
      await svc.editColumnOption(project, id, multi.id, '구현', { remove: true })
      view = await svc.getView(project, id)
      assert.deepEqual(view.columns.find(col => col.id === single.id)?.options, [])
      assert.deepEqual(view.columns.find(col => col.id === multi.id)?.optionColors, {})
      for (const row of view.rows) {
        assert.equal(row.cells[single.id], null)
        assert.deepEqual(row.cells[multi.id], ['문서'])
        const content = fs.readFileSync(resolveProjectPath(project, row.pagePath!), 'utf8')
        const fields = parse(/^---\n([\s\S]*?)\n---/.exec(content)![1])
        assert.equal(fields.상태, null)
        assert.deepEqual(fields.분류, ['문서'])
      }
    } finally {
      if (id) await svc.deleteDatabase(project, id)
      await exec(`DROP SCHEMA IF EXISTS ${quoteIdent(projectSchema(project))} CASCADE`)
      await closePool()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
