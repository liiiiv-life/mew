import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import { build, type OutputChunk } from 'rolldown'

async function memoryChunks(input: string) {
  const result = await build({
    input,
    write: false,
    platform: 'browser',
    output: { format: 'esm' },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('production') } },
    plugins: [{
      name: 'memory-only-api-fixture',
      resolveId(id) {
        if (id.endsWith('.css')) return 'virtual:style'
        if (/\.(?:svg|png|webp|jpe?g)(?:\?url)?$/.test(id)) return 'virtual:image'
      },
      async load(id) {
        if (id === 'virtual:style') return ''
        if (id === 'virtual:image') return 'export default ""'
        if (id.endsWith('?raw')) return 'export default ' + JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8'))
      },
    }],
  })
  return result.output.filter((item): item is OutputChunk => item.type === 'chunk')
}

function rendererModules(modules: string[]) {
  return modules.filter(id =>
    /\/node_modules\/(?:@xterm|@tiptap|@codemirror)\//.test(id)
      || /\/packages\/(?:tmux-term\/src\/TmuxTerminal|editor\/src\/(?!utils\/))/.test(id),
  )
}

test('workspace API imports session filters without loading terminal or editor UI', async () => {
  const chunks = await memoryChunks(new URL('./client.ts', import.meta.url).pathname)
  const modules = chunks.flatMap(item => Object.keys(item.modules))
  assert.ok(modules.some(id => id.endsWith('/packages/tmux-term/src/commandSession.ts')))
  assert.deepEqual(rendererModules(modules), [], 'API callers must not eagerly download terminal or editor renderers')
})

test('workspace shell excludes deferred editor, replay, icon catalog and tool modules', async () => {
  const chunks = await memoryChunks(new URL('../App.tsx', import.meta.url).pathname)
  const byFile = new Map(chunks.map(chunk => [chunk.fileName, chunk]))
  const eager = new Set<string>()
  const visit = (chunk: OutputChunk) => {
    if (eager.has(chunk.fileName)) return
    eager.add(chunk.fileName)
    for (const name of chunk.imports) {
      const imported = byFile.get(name)
      if (imported) visit(imported)
    }
  }
  for (const chunk of chunks) if (chunk.isEntry) visit(chunk)
  const modules = chunks.filter(chunk => eager.has(chunk.fileName)).flatMap(chunk => Object.keys(chunk.modules))
  assert.deepEqual(rendererModules(modules), [])
  assert.deepEqual(modules.filter(id => /\/src\/(?:utils\/project-icon-catalog|components\/(?:IconPicker|EditorPane|AgentPanel|SettingsModal|remote-desktop))\.tsx?$/.test(id)), [])
  assert.ok(modules.some(id => id.endsWith('/src/components/FileTree.tsx')), 'file navigation stays in the first workspace chunk')
})

test('file explorer loads pure search helpers and defers command terminal rendering', async () => {
  const chunks = await memoryChunks(new URL('../components/FileTree.tsx', import.meta.url).pathname)
  const byFile = new Map(chunks.map(chunk => [chunk.fileName, chunk]))
  const eager = new Set<string>()
  const visit = (chunk: OutputChunk) => {
    if (eager.has(chunk.fileName)) return
    eager.add(chunk.fileName)
    for (const name of chunk.imports) {
      const imported = byFile.get(name)
      if (imported) visit(imported)
    }
  }
  for (const chunk of chunks) if (chunk.isEntry) visit(chunk)
  const modules = chunks.filter(chunk => eager.has(chunk.fileName)).flatMap(chunk => Object.keys(chunk.modules))
  assert.ok(modules.some(id => id.endsWith('/packages/editor/src/utils/fuzzy.ts')))
  assert.deepEqual(rendererModules(modules), [], 'explorer and command controls paint before terminal/editor chunks')
  assert.ok(chunks.some(chunk => !eager.has(chunk.fileName)
    && Object.keys(chunk.modules).some(id => id.includes('/node_modules/@xterm/'))), 'terminal remains available as an on-demand chunk')
})
