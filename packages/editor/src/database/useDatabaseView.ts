import { uiText } from '@mew/ui/i18n-core'
// /db 뷰의 서버 연동·실시간 상태를 캡슐화한 훅 — TipTap 노드뷰(DatabaseView)와
// 독립 패널(DatabasePanel, 전체 DB 팝업용)이 같은 로직을 공유하도록 분리했다.
// 렌더는 DatabaseTable이, 순수 상태 계산은 databaseState.ts가 담당한다.
import { useCallback, useEffect, useState } from 'react'
import type { DbColumnType, DbView, EditorDbApi } from '../types'
import { applyDbEvent, setCell } from './databaseState'

// 컬럼 타입 라벨/글리프 — 헤더·열 추가 메뉴에서 공유한다
export const TYPE_LABELS: Record<DbColumnType, string> = {
  get text() { return uiText("텍스트") },
  get number() { return uiText("숫자") },
  get checkbox() { return uiText("체크박스") },
  get date() { return uiText("날짜") },
}
export const ADD_TYPES: DbColumnType[] = ['text', 'number', 'checkbox', 'date']
// 컬럼 타입을 한눈에 구분하는 글리프 (노션식)
export const TYPE_GLYPH: Record<DbColumnType, string> = { text: 'T', number: '#', checkbox: '☑', date: '📅' }

export interface DatabaseController {
  view: DbView | null
  loading: boolean
  error: string | null
  /** 참조(readonly)·external이 아니고 서버가 편집을 허용할 때만 true */
  editable: boolean
  /** 제목 입력 중간 상태(커밋 없이 로컬만) */
  setTitleDraft: (title: string) => void
  renameTitle: (title: string) => void
  addRow: () => void
  deleteRow: (rowId: string) => void
  commitCell: (rowId: string, columnId: string, value: unknown) => void
  localCell: (rowId: string, columnId: string, value: unknown) => void
  addColumn: (type: DbColumnType) => void
  renameColumn: (columnId: string, name: string) => void
  deleteColumn: (columnId: string) => void
}

export function useDatabaseView(api: EditorDbApi | null, dbId: string | null, readonly = false): DatabaseController {
  const [view, setView] = useState<DbView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 최초 로드
  useEffect(() => {
    if (!dbId || !api) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    api
      .getView(dbId)
      .then((v) => {
        if (!cancelled) {
          setView(v)
          setError(null)
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : uiText("데이터베이스를 불러오지 못했습니다"))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [dbId, api])

  // 실시간 구독 — 서버 방송을 리듀서로 접어 넣는다(자기 에코 포함)
  useEffect(() => {
    if (!dbId || !api) return
    return api.subscribe(dbId, (event) => setView((prev) => (prev ? applyDbEvent(prev, event) : prev)))
  }, [dbId, api])

  // 참조(readonly)거나 external이면 편집 UI를 전부 감춘다 — 원본은 다른 노드/패널에서 편집한다
  const editable = (view?.editable ?? false) && !readonly

  const commitCell = useCallback(
    (rowId: string, columnId: string, value: unknown) => {
      if (!api || !dbId) return
      api.updateCell(dbId, rowId, columnId, value).catch((e) => setError(e instanceof Error ? e.message : uiText("저장 실패")))
    },
    [api, dbId],
  )

  const localCell = useCallback((rowId: string, columnId: string, value: unknown) => {
    setView((prev) => (prev ? setCell(prev, rowId, columnId, value) : prev))
  }, [])

  const setTitleDraft = useCallback((title: string) => {
    setView((prev) => (prev ? { ...prev, title } : prev))
  }, [])

  const renameTitle = useCallback(
    async (title: string) => {
      if (!api || !dbId) return
      const trimmed = title.trim() || uiText("제목 없음")
      setView((prev) => (prev && prev.title !== trimmed ? { ...prev, title: trimmed } : prev))
      try {
        await api.rename(dbId, trimmed)
      } catch (e) {
        setError(e instanceof Error ? e.message : uiText("제목 변경 실패"))
      }
    },
    [api, dbId],
  )

  const addRow = useCallback(async () => {
    if (!api || !dbId) return
    try {
      const row = await api.insertRow(dbId)
      setView((prev) => (prev ? applyDbEvent(prev, { type: 'row.insert', row }) : prev))
    } catch (e) {
      setError(e instanceof Error ? e.message : uiText("행 추가 실패"))
    }
  }, [api, dbId])

  const deleteRow = useCallback(
    async (rowId: string) => {
      if (!api || !dbId) return
      try {
        await api.deleteRow(dbId, rowId)
        setView((prev) => (prev ? applyDbEvent(prev, { type: 'row.delete', rowId }) : prev))
      } catch (e) {
        setError(e instanceof Error ? e.message : uiText("행 삭제 실패"))
      }
    },
    [api, dbId],
  )

  const addColumn = useCallback(
    async (type: DbColumnType) => {
      if (!api || !dbId) return
      try {
        const col = await api.addColumn(dbId, TYPE_LABELS[type], type)
        // 서버가 addColumn 응답 전에 schema 이벤트를 방송하고 자기 자신도 그 에코를 받으므로,
        // 이미 반영됐으면 건너뛴다 — id로 중복 확인(row.insert와 동일한 에코 조정, 열 중복 방지).
        setView((prev) => {
          if (!prev) return prev
          if (prev.columns.some((c) => c.id === col.id)) return prev
          return {
            ...prev,
            columns: [...prev.columns, col],
            rows: prev.rows.map((r) => ({ ...r, cells: { ...r.cells, [col.id]: null } })),
          }
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : uiText("열 추가 실패"))
      }
    },
    [api, dbId],
  )

  const renameColumn = useCallback(
    async (columnId: string, name: string) => {
      if (!api || !dbId) return
      const trimmed = name.trim()
      if (!trimmed) return
      setView((prev) =>
        prev ? { ...prev, columns: prev.columns.map((c) => (c.id === columnId ? { ...c, name: trimmed } : c)) } : prev,
      )
      try {
        await api.renameColumn(dbId, columnId, trimmed)
      } catch (e) {
        setError(e instanceof Error ? e.message : uiText("열 이름 변경 실패"))
      }
    },
    [api, dbId],
  )

  const deleteColumn = useCallback(
    async (columnId: string) => {
      if (!api || !dbId) return
      try {
        await api.deleteColumn(dbId, columnId)
        setView((prev) => (prev ? { ...prev, columns: prev.columns.filter((c) => c.id !== columnId) } : prev))
      } catch (e) {
        setError(e instanceof Error ? e.message : uiText("열 삭제 실패"))
      }
    },
    [api, dbId],
  )

  return {
    view,
    loading,
    error,
    editable,
    setTitleDraft,
    renameTitle,
    addRow,
    deleteRow,
    commitCell,
    localCell,
    addColumn,
    renameColumn,
    deleteColumn,
  }
}
