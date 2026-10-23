import { setBrowserStorageScope } from '@mew/ui/browser-storage-scope'
import { configureAppRuntime } from '../runtime/app-runtime.ts'
import { createMemoryStorage } from './memory-storage.ts'
import { DemoWorkspaceStore } from './workspace-store.ts'
import { createDemoTransport } from './transport.ts'
import { createDemoCollaboration } from './collaboration.ts'
import { createDemoSocketFactory } from './socket.ts'
import { createDemoResources } from './resources.ts'
import { createDemoDesktop } from './desktop.ts'
import repositoryIndex from './repository-index.json' with { type: 'json' }
import { DemoRepository, createDemoRepositoryLoader } from './repository.ts'

/** Initialize before importing App: several shared modules restore state on import. */
export async function initializeDemo() {
  const storage = createMemoryStorage()
  const sessionStorage = createMemoryStorage()
  setBrowserStorageScope('demo', 'playground-v1', { storage, sessionStorage, persistentCaches: false })
  const repository = new DemoRepository(repositoryIndex, createDemoRepositoryLoader('/demo'))
  const store = new DemoWorkspaceStore(repository)
  const sockets = createDemoSocketFactory(store)
  const transport = createDemoTransport(store, sockets)
  const collaboration = createDemoCollaboration(store)
  const resources = createDemoResources(store)
  const desktop = createDemoDesktop(store)
  const onPageHide = (event: PageTransitionEvent) => { if (!event.persisted) dispose() }
  const dispose = () => {
    window.removeEventListener('pagehide', onPageHide)
    desktop.close(); collaboration.close(); resources.close(); transport.close(); sockets.close(); storage.clear(); sessionStorage.clear()
  }
  const restart = () => { dispose(); location.reload() }
  configureAppRuntime({
    kind: 'demo',
    transport,
    collaboration,
    initialAuth: store.authStatus(),
    basePath: '/demo/',
    controls: { label: 'Demo', reset: restart },
    onLoggedOut: restart,
    resourceUrl: resources.url,
    prepareResourceUrl: resources.prepare,
    releaseResourceUrl: resources.release,
    desktopConnection: desktop.connect,
  })
  window.addEventListener('pagehide', onPageHide)
  if (import.meta.hot) import.meta.hot.dispose(dispose)
  return { store, dispose }
}
