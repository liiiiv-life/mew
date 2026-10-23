import assert from 'node:assert/strict'
import { createRequire, registerHooks } from 'node:module'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadConfigFromFile, type MinimalPluginContextWithoutEnvironment, type Plugin, type ViteDevServer } from 'vite'

test('Vite config loads without native server dependencies and defers API setup until configureServer', async t => {
  const runtimeUrl = new URL('./plugin.ts', import.meta.url).href
  const ptyUrl = pathToFileURL(createRequire(import.meta.url).resolve('node-pty')).href
  let runtimeLoads = 0
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      if (url === ptyUrl) throw new Error('Vite config must not load the native PTY')
      if (url === runtimeUrl) {
        runtimeLoads++
        return { format: 'module', shortCircuit: true, source: 'export function configureDocsServer(server) { server.middlewares.use("fixture-api") }' }
      }
      return nextLoad(url, context)
    },
  })
  t.after(() => hooks.deregister())

  for (const command of ['build', 'serve'] as const) {
    const resolved = await loadConfigFromFile({ command, mode: command === 'build' ? 'production' : 'development' }, fileURLToPath(new URL('../vite.config.ts', import.meta.url)))
    assert.ok(resolved)
    assert.equal(resolved.config.base, './')
    assert.equal(resolved.config.server?.port, 4999)
    assert.equal(runtimeLoads, 0, `${command} config loading must leave the server runtime untouched`)

    if (command === 'serve') {
      const plugin = resolved.config.plugins?.find((plugin): plugin is Plugin => !!plugin && typeof plugin === 'object' && 'name' in plugin && plugin.name === 'docs-api')
      assert.ok(plugin && typeof plugin.configureServer === 'function')
      const middleware: unknown[] = []
      const server = { middlewares: { use(value: unknown) { middleware.push(value) } } } as unknown as ViteDevServer
      await plugin.configureServer.call({} as MinimalPluginContextWithoutEnvironment, server)
      assert.equal(runtimeLoads, 1)
      assert.deepEqual(middleware, ['fixture-api'])
    }
  }
})
