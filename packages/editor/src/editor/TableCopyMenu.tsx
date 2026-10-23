import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import type { Editor } from '@tiptap/react'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { ActionMenu, ActionMenuItem, ActionMenuSeparator } from '@mew/ui'
import { Copy, MediaImage, Table2Columns, ArrowDown, ArrowRight } from 'iconoir-react'
import { convertTableToDatabase, editorDatabaseApi, isTableConversionPending } from '../database/tableConversion'

// 표 우클릭 메뉴 — 셀 다음 행·열 추가와 md(기본)·csv·이미지 복사. pos는 표 노드 시작 위치(문서 좌표),
// tableDom은 이미지 복사용 실제 렌더 엘리먼트(계산된 스타일을 그대로 베낀다).

// colspan/rowspan은 무시하고 셀 텍스트만 뽑는다 — md 표 자체가 병합을 표현하지 못한다
function toMatrix(table: PMNode): string[][] {
  const rows: string[][] = []
  table.forEach((row) => {
    const cells: string[] = []
    row.forEach((cell) => cells.push(cell.textContent))
    rows.push(cells)
  })
  return rows
}

function toCsv(matrix: string[][]): string {
  const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  return matrix.map((r) => r.map(cell).join(',')).join('\n')
}

// 뒤가 비치지 않게 표 뒤에서 처음 만나는 불투명 배경을 캔버스 바닥색으로 쓴다
function backdropColor(el: HTMLElement): string {
  for (let cur: HTMLElement | null = el; cur; cur = cur.parentElement) {
    const bg = getComputedStyle(cur).backgroundColor
    if (bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg)) return bg
  }
  return '#ffffff'
}

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result as string)
    fr.onerror = () => reject(fr.error)
    fr.readAsDataURL(b)
  })

// unicode-range 목록(U+AC00-D7A3, U+F9?? …)에 실제 쓰인 글자가 하나라도 걸리는지
function rangeHits(rangeList: string, codes: Set<number>): boolean {
  for (const part of rangeList.split(',')) {
    const m = /U\+([0-9A-Fa-f?]+)(?:-([0-9A-Fa-f]+))?/.exec(part.trim())
    if (!m) continue
    const lo = parseInt(m[1].replace(/\?/g, '0'), 16)
    const hi = m[2] ? parseInt(m[2], 16) : parseInt(m[1].replace(/\?/g, 'F'), 16)
    for (const c of codes) if (c >= lo && c <= hi) return true
  }
  return false
}

// SVG-in-img는 격리 문서라 페이지 웹폰트를 못 받는다 — 대체 글꼴로 그려지면 글자 폭·줄 높이가
// 달라져 실물과 어긋나고 아래가 잘린다. 표에 실제로 쓰인 글꼴·글자의 서브셋만 골라 데이터 URL로
// 인라인한다 (전부 인라인하면 한글 서브셋 수백 개를 받게 된다).
async function fontEmbedCss(text: string, families: Set<string>): Promise<string> {
  const link = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"][href*="fonts.googleapis.com"]')
  if (!link) return ''
  try {
    const css = await (await fetch(link.href)).text()
    const codes = new Set(Array.from(text, (c) => c.codePointAt(0)!))
    const faces = (css.match(/@font-face\s*\{[^}]*\}/g) ?? []).filter((face) => {
      const family = /font-family:\s*['"]?([^'";]+)/.exec(face)?.[1]?.trim()
      if (!family || !families.has(family)) return false
      const range = /unicode-range:\s*([^;}]+)/.exec(face)?.[1]
      return !range || rangeHits(range, codes)
    })
    const inlined = await Promise.all(
      faces.map(async (face) => {
        const url = /url\((https:[^)\s]+)\)/.exec(face)?.[1]
        if (!url) return ''
        return face.replace(url, await blobToDataUrl(await (await fetch(url)).blob()))
      }),
    )
    return inlined.join('\n')
  } catch {
    return '' // 폰트 인라인 실패는 대체 글꼴로 그릴 뿐 — 복사 자체는 계속한다
  }
}

async function renderPng(table: HTMLTableElement): Promise<Blob> {
  const rect = table.getBoundingClientRect()
  const clone = table.cloneNode(true) as HTMLTableElement
  const src = [table, ...Array.from(table.querySelectorAll<HTMLElement>('*'))]
  const dst = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>('*'))]
  const families = new Set<string>()
  // 계산된 스타일 전부를 인라인으로 베낀다 — 골라 베끼면 빠진 속성(box-sizing 등) 하나에
  // 격리된 SVG 문서의 기본값이 끼어들어 폭·여백이 실물과 어긋난다. 한 번짜리 복사라 비용 무시
  dst.forEach((el, i) => {
    const cs = getComputedStyle(src[i])
    families.add(cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim())
    for (const p of Array.from(cs)) el.style.setProperty(p, cs.getPropertyValue(p))
  })
  clone.style.margin = '0'
  const w = Math.ceil(rect.width)
  const h = Math.ceil(rect.height)
  const fontCss = await fontEmbedCss(table.textContent ?? '', families)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    (fontCss ? `<style>${fontCss}</style>` : '') +
    `<foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">` +
    new XMLSerializer().serializeToString(clone) +
    `</div></foreignObject></svg>`
  const img = new Image()
  // blob URL 대신 data URL — 일부 Chromium이 blob: SVG를 캔버스에 그릴 때 조용히 실패한다
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await img.decode()
  const scale = 2 // 레티나 배율 — 1배는 글자가 뭉개진다
  const canvas = document.createElement('canvas')
  canvas.width = w * scale
  canvas.height = h * scale
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = backdropColor(table)
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.scale(scale, scale)
  ctx.drawImage(img, 0, 0)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('toBlob failed')
  return blob
}

function copyAsImage(table: HTMLTableElement): Promise<void> {
  if (typeof ClipboardItem === 'undefined') return Promise.reject(new Error(uiText("ClipboardItem 미지원 브라우저")))
  // clipboard.write는 클릭 핸들러 안에서 동기로 시작해야 한다 — PNG 렌더를 await한 뒤에 부르면
  // 사용자 제스처 창이 닫혀 NotAllowedError가 난다(Safari는 항상, Chromium도 상황 따라).
  // 브라우저가 Promise<Blob>을 대신 기다리도록 ClipboardItem에 프로미스를 넘긴다.
  return navigator.clipboard.write([new ClipboardItem({ 'image/png': renderPng(table) })])
}

export function TableCopyMenu({
  editor,
  pos,
  tableDom,
  cellDom,
  readOnly,
  position,
  onClose,
  onError,
  inline = false,
}: {
  editor: Editor
  pos: number
  tableDom: HTMLTableElement
  cellDom: HTMLTableCellElement | null
  readOnly?: boolean
  position: { top: number; left: number }
  onClose: () => void
  onError: (message: string | null) => void
  inline?: boolean
}) {
  useUiLocale()

  const addAfter = (axis: 'row' | 'column') => {
    if (readOnly || !editor.isEditable || !cellDom || !editor.view.dom.contains(cellDom)) return
    // 메뉴가 열린 동안 문서 위치가 바뀌어도 우클릭한 셀의 현재 위치를 사용한다.
    const pos = editor.view.posAtDOM(cellDom, 0)
    const selection = TextSelection.near(editor.state.doc.resolve(pos))
    const chain = editor.chain().focus().setTextSelection(selection.from)
    if (axis === 'row') chain.addRowAfter().run()
    else chain.addColumnAfter().run()
  }

  const run = (fn: () => Promise<void>) => {
    // 실패 원인(NotAllowedError 등)을 그대로 보여준다 — "권한 확인" 같은 추측 문구는 디버깅을 막는다
    fn().catch((e) => onError(uiText("복사 실패 — {p0}", { p0: e instanceof Error ? `${e.name}: ${e.message}` : String(e) })))
    onClose()
  }

  const tableNode = editor.state.doc.nodeAt(pos)
  const databaseApi = editorDatabaseApi(editor)
  const convert = () => {
    if (readOnly || !editor.isEditable || !databaseApi?.create || !editor.view.dom.contains(tableDom)) return
    onError(null)
    const $pos = editor.state.doc.resolve(editor.view.posAtDOM(tableDom, 0))
    for (let depth = $pos.depth; depth > 0; depth--) if ($pos.node(depth).type.name === 'table') {
      void convertTableToDatabase(editor, $pos.before(depth), databaseApi).catch(error => onError(error instanceof Error ? error.message : uiText('데이터베이스 생성 실패')))
      break
    }
  }

  const copyMd = () => {
    const current = currentTable()
    if (!current) return Promise.resolve()
    // 표만 담은 임시 doc으로 감싼다 — 셀 안 굵게·링크 같은 마크까지 tiptap-markdown이 그대로 살린다
    const doc = editor.state.doc.type.create(null, current)
    const md = (editor.storage as unknown as { markdown: { serializer: { serialize: (n: PMNode) => string } } })
      .markdown.serializer.serialize(doc)
    return navigator.clipboard.writeText(md.trim())
  }

  const copyCsv = () => {
    const current = currentTable()
    if (!current) return Promise.resolve()
    return navigator.clipboard.writeText(toCsv(toMatrix(current)))
  }

  const currentTable = (): PMNode | null => {
    if (editor.isDestroyed || !editor.view.dom.contains(tableDom)) return null
    const $pos = editor.state.doc.resolve(editor.view.posAtDOM(tableDom, 0))
    for (let depth = $pos.depth; depth > 0; depth--) if ($pos.node(depth).type.name === 'table') return $pos.node(depth)
    return null
  }

  const items: Array<[label: string, action: () => Promise<void>]> = [
    [uiText("md로 복사"), copyMd],
    [uiText("csv로 복사"), copyCsv],
    [uiText("이미지로 복사"), () => copyAsImage(tableDom)],
  ]

  const icons = [Copy, Table2Columns, MediaImage]
  const content = <>
    {!readOnly && editor.isEditable && cellDom && <>
      <ActionMenuItem icon={<ArrowDown />} onClick={() => addAfter('row')}>{uiText('행 추가')}</ActionMenuItem>
      <ActionMenuItem icon={<ArrowRight />} onClick={() => addAfter('column')}>{uiText('열 추가')}</ActionMenuItem>
      <ActionMenuSeparator />
    </>}
    {!readOnly && editor.isEditable && databaseApi?.create && <>
      <ActionMenuItem icon={<Table2Columns />} disabled={!!tableNode && isTableConversionPending(editor, tableNode)} onClick={convert}>{uiText('데이터베이스로 전환')}</ActionMenuItem>
      <ActionMenuSeparator />
    </>}
    {items.map(([label, action], i) => { const Icon = icons[i]; return <ActionMenuItem key={label} icon={<Icon />} hint={i === 0 ? uiText('기본') : undefined} onClick={() => run(action)}>{label}</ActionMenuItem> })}
  </>
  return inline ? content : <ActionMenu x={position.left} y={position.top} onClose={onClose}>{content}</ActionMenu>
}
