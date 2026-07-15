import { useState } from 'react'
import { createNewDocument, type TreeNode } from '../api/client'

type Scope = 'events' | 'products' | 'programs' | 'platform' | 'company' | 'ops' | 'resources'

const SCOPE_OPTIONS: { value: Scope; label: string; hint: string }[] = [
  { value: 'events', label: 'events/', hint: '멘토링·내부 회의·외부 컨퍼런스 등 날짜 기준 참석 기록' },
  { value: 'products', label: 'products/<제품>/', hint: '특정 제품·사업 라인에 관한 것' },
  { value: 'programs', label: 'programs/<프로그램>/', hint: '지원사업·공모전 등 사업 자체의 신청·수행 기록' },
  { value: 'platform', label: 'platform/', hint: '여러 제품이 공유하는 기술' },
  { value: 'company', label: 'company/', hint: '회사 정체성·전략·조직' },
  { value: 'ops', label: 'ops/', hint: '일하는 방식·반복 절차' },
  { value: 'resources', label: 'resources/', hint: '외부·범교차 참고 자료, 또는 확신이 없을 때' },
]

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function childNames(tree: TreeNode[], dirName: string): string[] {
  const dir = tree.find((n) => n.type === 'dir' && n.name === dirName)
  return (dir?.children ?? []).filter((c) => c.type === 'dir' && c.name !== '_template').map((c) => c.name)
}

export function NewDocumentModal({
  tree,
  onClose,
  onCreated,
}: {
  tree: TreeNode[]
  onClose: () => void
  onCreated: (relPath: string) => void
}) {
  const [scope, setScope] = useState<Scope | null>(null)
  const [productSlug, setProductSlug] = useState('')
  const [isWork, setIsWork] = useState(false)
  const [workSlug, setWorkSlug] = useState('')
  const [programSlug, setProgramSlug] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [title, setTitle] = useState('')
  const [fileSlug, setFileSlug] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const products = childNames(tree, 'products')
  const programs = childNames(tree, 'programs')

  function relPath(): string | null {
    const slug = fileSlug || slugify(title)
    if (!slug) return null
    if (scope === 'events') return `events/${date}-${slug}.md`
    if (scope === 'products') {
      if (!productSlug) return null
      return isWork ? `products/${productSlug}/work/${workSlug || slug}/${slug}.md` : `products/${productSlug}/${slug}.md`
    }
    if (scope === 'programs') {
      if (!programSlug) return null
      return `programs/${programSlug}/${slug}.md`
    }
    if (scope) return `${scope}/${slug}.md`
    return null
  }

  const preview = relPath()

  async function handleCreate() {
    if (!preview || !title.trim()) return
    setCreating(true)
    setError(null)
    try {
      const { relPath: created } = await createNewDocument(preview, title.trim())
      onCreated(created)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="max-h-[80vh] w-[32rem] overflow-y-auto rounded-lg bg-surface p-5 text-sm shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 text-base font-semibold">새 문서</div>

        {!scope ? (
          <div className="space-y-1">
            <div className="mb-2 text-ink-muted">어디에 관한 문서인가요?</div>
            {SCOPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setScope(opt.value)}
                className="block w-full rounded px-3 py-2 text-left hover:bg-surface-raised text-ink"
              >
                <div className="font-medium">{opt.label}</div>
                <div className="text-xs text-ink-muted">{opt.hint}</div>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <button type="button" onClick={() => setScope(null)} className="text-xs text-ink-secondary hover:underline">
              ← {SCOPE_OPTIONS.find((o) => o.value === scope)?.label} 다시 선택
            </button>

            {scope === 'products' && (
              <div>
                <label className="mb-1 block text-ink-muted">제품</label>
                <input
                  list="product-options"
                  value={productSlug}
                  onChange={(e) => setProductSlug(slugify(e.target.value))}
                  placeholder="sleeeep"
                  className="w-full rounded border border-edge-strong bg-surface-raised px-2 py-1 text-ink"
                  />
                  <datalist id="product-options">
                  {products.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
                <label className="mt-2 flex items-center gap-2">
                  <input type="checkbox" checked={isWork} onChange={(e) => setIsWork(e.target.checked)} />
                  진행 중인 작업 (work/)
                </label>
                {isWork && (
                  <input
                    value={workSlug}
                    onChange={(e) => setWorkSlug(slugify(e.target.value))}
                    placeholder="작업 슬러그 (비우면 파일명과 동일)"
                    className="mt-1 w-full rounded border border-edge-strong bg-surface-raised px-2 py-1 text-ink"
                  />
                )}
              </div>
            )}

            {scope === 'programs' && (
              <div>
                <label className="mb-1 block text-ink-muted">프로그램</label>
                <input
                  list="program-options"
                  value={programSlug}
                  onChange={(e) => setProgramSlug(slugify(e.target.value))}
                  placeholder="modoo-2026"
                  className="w-full rounded border border-edge-strong bg-surface-raised px-2 py-1 text-ink"
                  />
                  <datalist id="program-options">
                  {programs.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </div>
            )}

            {scope === 'events' && (
              <div>
                <label className="mb-1 block text-ink-muted">날짜</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full rounded border border-edge-strong bg-surface-raised px-2 py-1 text-ink"
                />
              </div>
            )}

            <div>
              <label className="mb-1 block text-ink-muted">제목</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="문서 제목"
                autoFocus
                className="w-full rounded border border-edge-strong bg-surface-raised px-2 py-1 text-ink"
              />
            </div>

            <div>
              <label className="mb-1 block text-ink-muted">파일명 슬러그 (비우면 제목에서 자동 생성)</label>
              <input
                value={fileSlug}
                onChange={(e) => setFileSlug(slugify(e.target.value))}
                placeholder={slugify(title) || 'file-name'}
                className="w-full rounded border border-edge-strong bg-surface-raised px-2 py-1 text-ink"
              />
            </div>

            {preview && <div className="rounded bg-surface-raised px-2 py-1 font-mono text-xs text-ink-secondary">{preview}</div>}

            {error && <div className="text-danger">{error}</div>}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="rounded px-3 py-1 text-ink-secondary hover:bg-surface-raised">
                취소
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={!preview || !title.trim() || creating}
                className="rounded bg-surface-inverse px-3 py-1 text-ink-inverse disabled:opacity-40"
              >
                {creating ? '생성 중…' : '생성'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
