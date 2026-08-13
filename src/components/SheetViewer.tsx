import { useEffect, useState } from 'react'
import { downloadUrl, rawUrl } from '../api/client'
import { parseCsv } from '../utils/csv'
import { parseXlsx, type SheetData } from '../utils/xlsx'

/** 표 탭 본문(xlsx·csv·tsv) — 바이트는 /api/raw에서 받아 브라우저에서 직접 푼다. 읽기 전용이다(편집·수식·서식 없음) */
export function SheetViewer({ path }: { path: string }) {
  const [sheets, setSheets] = useState<SheetData[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const name = path.split('/').pop() ?? path

  useEffect(() => {
    let alive = true
    setSheets(null)
    setError(null)
    setActive(0)
    fetch(rawUrl(path))
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`파일을 불러오지 못했습니다 (${res.status})`))))
      // xlsx는 ZIP이라 풀어야 하고(비동기), csv·tsv는 글자라 그 자리에서 갈라 놓는다
      .then((buf) => (path.toLowerCase().endsWith('.xlsx') ? parseXlsx(buf) : parseCsv(buf, path)))
      .then((parsed) => {
        if (alive) setSheets(parsed)
      })
      .catch((err: Error) => {
        if (alive) setError(err.message)
      })
    return () => {
      alive = false
    }
  }, [path])

  if (error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-surface p-6 text-center">
        <span className="max-w-md truncate text-sm text-ink-muted">{name}</span>
        <span className="text-sm text-danger">{error}</span>
        <a href={downloadUrl(path)} download={name} className="text-xs text-accent hover:underline">
          다운로드
        </a>
      </div>
    )
  }

  if (!sheets) {
    return <div className="flex h-full w-full items-center justify-center bg-surface text-sm text-ink-muted">여는 중…</div>
  }

  const sheet = sheets[active]
  const [head, ...body] = sheet?.rows ?? []

  return (
    <div className="flex h-full w-full flex-col bg-surface">
      <div className="flex shrink-0 items-center gap-2 overflow-x-auto px-3 py-1.5 text-xs">
        {sheets.map((s, i) => (
          <button
            key={s.name}
            type="button"
            onClick={() => setActive(i)}
            className={`shrink-0 rounded px-2 py-1 ${i === active ? 'bg-surface-raised text-ink' : 'text-ink-muted hover:text-ink'}`}
          >
            {s.name}
          </button>
        ))}
        <a href={downloadUrl(path)} download={name} className="ml-auto shrink-0 text-accent hover:underline">
          다운로드
        </a>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {head ? (
          <table className="border-collapse text-xs text-ink">
            <thead>
              <tr>
                {head.map((cell, i) => (
                  // 셀 값은 중복될 수 있어 키는 위치로 잡는다
                  <th key={i} className="sticky top-0 z-10 whitespace-nowrap border border-edge-strong bg-surface-raised px-2 py-1 text-left font-medium">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className="whitespace-pre border border-edge-strong px-2 py-1 align-top">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-6 text-sm text-ink-muted">빈 시트</div>
        )}
      </div>
    </div>
  )
}
