import test from 'node:test'
import assert from 'node:assert/strict'

const store = new Map<string, string>()
;(globalThis as Record<string, unknown>).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
}

const {
  childrenForOpenDirs,
  loadDirectoryChildren,
  normalizeDirectoryChildren,
  saveDirectoryChildren,
  treeChildrenKey,
} = await import('./treePersistence.ts')

const cache = {
  src: [
    { name: 'components', path: 'src/components', type: 'dir' as const },
    { name: 'App.tsx', path: 'src/App.tsx', type: 'file' as const },
  ],
  'src/components': [
    { name: 'FileTree.tsx', path: 'src/components/FileTree.tsx', type: 'file' as const },
  ],
  closed: [{ name: 'old.txt', path: 'closed/old.txt', type: 'file' as const }],
}

test('열린 폴더의 자식 폴더와 파일 스냅샷을 저장하고 복원한다', () => {
  const open = childrenForOpenDirs(['src', 'src/components'], cache)
  saveDirectoryChildren('root:/work/one', open)

  assert.deepEqual(loadDirectoryChildren('root:/work/one'), {
    src: cache.src,
    'src/components': cache['src/components'],
  })
  assert.equal(treeChildrenKey('root:/work/one'), 'mew:tree-children:root:/work/one')
})

test('손상된 노드와 닫힌 폴더 캐시는 복원 상태에서 제외한다', () => {
  assert.deepEqual(normalizeDirectoryChildren({
    src: [cache.src[0], null, { name: 'broken' }],
    nope: 'not-an-array',
  }), { src: [cache.src[0]] })
  assert.deepEqual(childrenForOpenDirs(['src'], cache), { src: cache.src })

  store.set(treeChildrenKey('broken'), '{')
  assert.deepEqual(loadDirectoryChildren('broken'), {})
})

test('접힌 조상 아래의 저장된 펼침 경로는 읽지 않는다', async () => {
  const { visibleOpenDirectories } = await import('./treePersistence.ts')
  const tree = [{ name: 'src', path: 'src', type: 'dir' as const }, { name: 'closed', path: 'closed', type: 'dir' as const }]
  assert.deepEqual(visibleOpenDirectories(tree, new Set(['src/components']), cache), [])
  assert.deepEqual(visibleOpenDirectories(tree, new Set(['src', 'src/components', 'closed/deep']), cache), ['src', 'src/components'])
  assert.deepEqual(visibleOpenDirectories(tree, new Set(['src', 'src/components']), {}), ['src'])
})

test('중앙 앵커는 손상값을 거르고 옛 픽셀 저장값과 공존한다', async () => {
  const { normalizeTreeCenterAnchor } = await import('./treePersistence.ts')
  assert.equal(normalizeTreeCenterAnchor(undefined), undefined)
  assert.equal(normalizeTreeCenterAnchor({ tree: 'root', path: 'a', fraction: NaN }), undefined)
  assert.deepEqual(normalizeTreeCenterAnchor({ tree: 'docs', path: 'a', fraction: 2 }), { tree: 'docs', path: 'a', fraction: 1 })
})

test('같은 경로의 Docs·하위 프로젝트를 구별하고 높이·늦은 행 추가 뒤에도 중앙을 복원한다', async () => {
  const { Window } = await import('happy-dom')
  const { readTreeCenter, restoreTreeCenter } = await import('./treePersistence.ts')
  const window = new Window()
  const list = window.document.createElement('div')
  list.innerHTML = '<div data-tree-key="docs"><button data-path="README.md"></button></div><div data-tree-key="project"><button data-path="README.md"></button></div>'
  let height = 400
  let rowPosition = 290
  Object.defineProperty(list, 'clientHeight', { get: () => height })
  list.getBoundingClientRect = () => ({ top: 100, height, bottom: 100 + height }) as DOMRect
  const rows = list.querySelectorAll('button')
  rows[0].getBoundingClientRect = () => ({ top: 120 - list.scrollTop, bottom: 140 - list.scrollTop, height: 20 }) as DOMRect
  rows[1].getBoundingClientRect = () => ({ top: rowPosition - list.scrollTop, bottom: rowPosition + 20 - list.scrollTop, height: 20 }) as DOMRect
  const element = list as unknown as HTMLElement
  const anchor = readTreeCenter(element)!
  assert.deepEqual(anchor, { tree: 'project', path: 'README.md', fraction: 0.5 })
  height = 200
  rowPosition += 160
  assert.equal(restoreTreeCenter(element, anchor), true)
  assert.equal(list.scrollTop, 260)
  assert.deepEqual(readTreeCenter(element), anchor)
  rows[1].remove()
  assert.equal(restoreTreeCenter(element, anchor), false)
  await window.happyDOM.close()
})


test('project navigation stops restored loading at direct and nested project boundaries', async () => {
  const { visibleOpenDirectories } = await import('./treePersistence.ts')
  const tree = [
    { name: 'direct', path: 'direct', type: 'dir' as const, project: true },
    { name: 'plain', path: 'plain', type: 'dir' as const },
  ]
  const children = {
    direct: [{ name: 'src', path: 'direct/src', type: 'dir' as const }],
    plain: [{ name: 'nested', path: 'plain/nested', type: 'dir' as const, project: true }],
    'plain/nested': [{ name: 'src', path: 'plain/nested/src', type: 'dir' as const }],
  }
  const open = new Set(['direct', 'direct/src', 'plain', 'plain/nested', 'plain/nested/src'])
  assert.deepEqual(visibleOpenDirectories(tree, open, children, true), ['plain'])
  assert.deepEqual(visibleOpenDirectories(tree, open, children), [...open])
})
