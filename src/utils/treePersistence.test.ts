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
