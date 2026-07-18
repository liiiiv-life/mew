import { nextFieldKey, type FrontmatterData } from '../../utils/frontmatter'

// frontmatter는 본문(tiptap) 밖에서 다룬다 — 편집 가능한 리치텍스트 흐름에 섞이면 사용자가
// 실수로 YAML 구조를 깨뜨릴 수 있다. title 외 모든 필드(desc/created/updated 포함)는 동일하게
// 취급하는 자유 key-value 목록 — 여기서 추가·수정·삭제한다. 값에 :이 있어도 되지만 키에는 안 됨.
export function FrontmatterPanel({
  data,
  onChange,
  readOnly,
}: {
  data: FrontmatterData
  onChange: (next: FrontmatterData) => void
  readOnly?: boolean
}) {
  function setTitle(title: string) {
    onChange({ ...data, title })
  }
  function setFieldKey(index: number, key: string) {
    onChange({ ...data, fields: data.fields.map((f, i) => (i === index ? { ...f, key } : f)) })
  }
  function setFieldValue(index: number, value: string) {
    onChange({ ...data, fields: data.fields.map((f, i) => (i === index ? { ...f, value } : f)) })
  }
  function removeField(index: number) {
    onChange({ ...data, fields: data.fields.filter((_, i) => i !== index) })
  }
  function addField() {
    onChange({ ...data, fields: [...data.fields, { key: nextFieldKey(data.fields), value: '' }] })
  }

  return (
    // mt-12: App.tsx가 우측 상단(top-3/right-3)에 Hotview/Plain 토글을 겹쳐 띄우므로 그 아래로 여유를 둔다.
    // 본문 H1과 같은 역할을 대신하는 자리라 제목만 그만큼 크게 — border-b로 아래 본문과 구분한다.
    <div className="mx-8 mt-12 mb-2 border-b border-edge pb-3">
      <input
        value={data.title}
        onChange={(e) => setTitle(e.target.value)}
        readOnly={readOnly}
        placeholder="제목"
        className="w-full border-none bg-transparent text-3xl leading-tight font-bold text-ink-bright outline-none placeholder:text-ink-faint"
      />
      <div className="mt-3 flex flex-col gap-1">
        {data.fields.map((field, i) => (
          <div key={i} className="group flex items-center gap-2">
            <input
              value={field.key}
              onChange={(e) => setFieldKey(i, e.target.value)}
              readOnly={readOnly}
              placeholder="필드명"
              className="w-24 shrink-0 truncate rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-ink-muted outline-none hover:border-edge focus:border-edge-bright"
            />
            <input
              value={field.value}
              onChange={(e) => setFieldValue(i, e.target.value)}
              readOnly={readOnly}
              placeholder="값"
              className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-ink-secondary outline-none hover:border-edge focus:border-edge-bright"
            />
            {!readOnly && (
              <button
                type="button"
                onClick={() => removeField(i)}
                aria-label="필드 삭제"
                className="shrink-0 rounded px-1.5 py-0.5 text-xs text-ink-faint opacity-0 hover:bg-surface-hover hover:text-ink group-hover:opacity-100"
              >
                ×
              </button>
            )}
          </div>
        ))}
        {!readOnly && (
          <button
            type="button"
            onClick={addField}
            className="mt-1 self-start rounded px-1.5 py-1 text-xs text-ink-muted hover:bg-surface-hover hover:text-ink"
          >
            + 필드 추가
          </button>
        )}
      </div>
    </div>
  )
}
