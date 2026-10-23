import assert from 'node:assert/strict'
import test from 'node:test'
import { appResourceUrl, configureAppRuntime } from './app-runtime.ts'
import { detectInitialProject, WORKSPACE_PROJECT } from '../utils/active-project.ts'

test('an entrypoint base is independent of project names and DOM resource URLs', t => {
  t.after(() => configureAppRuntime({}))
  configureAppRuntime({ basePath: '/demo/', resourceUrl: path => `blob:${path}` })
  assert.equal(detectInitialProject('/demo/', WORKSPACE_PROJECT), WORKSPACE_PROJECT)
  assert.equal(detectInitialProject('/demo', WORKSPACE_PROJECT), WORKSPACE_PROJECT)
  assert.equal(detectInitialProject('/demo/notes', WORKSPACE_PROJECT), 'notes')
  assert.equal(appResourceUrl('/api/raw?path=notes.md'), 'blob:/api/raw?path=notes.md')
  configureAppRuntime({})
  assert.equal(detectInitialProject('/notes', WORKSPACE_PROJECT), 'notes')
  assert.equal(appResourceUrl('/api/raw?path=notes.md'), '/api/raw?path=notes.md')
})
