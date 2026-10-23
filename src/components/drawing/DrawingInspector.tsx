import { ColorPicker, SelectField, useOverlayDismiss } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { useRef, useState } from 'react'
import { DRAWING_PALETTE, type Bounds, type DrawingObject } from './model'

export type PaintTarget = 'fill' | 'stroke'
export function DrawingPalette({ target, value, onChange, custom = false }: { target: PaintTarget; value: string; onChange: (color: string) => void; custom?: boolean }) {
  const [showCustom, setShowCustom] = useState(custom)
  return <div className="drawing-palette" onKeyDown={event => {
    if ((event.target as HTMLElement).matches('input')) return
    if (/^[0-9]$/.test(event.key)) {
      event.preventDefault(); event.stopPropagation()
      if (event.key === '9') setShowCustom(true)
      else onChange(event.key === '0' ? 'none' : DRAWING_PALETTE[Number(event.key) - 1])
    }
  }}>
    <div className="drawing-swatches" role="group" aria-label={uiText('기본 색상')}>
      {DRAWING_PALETTE.map((color, index) => <button key={color} type="button" className="drawing-swatch" style={{ backgroundColor: color }} aria-label={`${index + 1} · ${color}`} aria-pressed={value === color} data-tip={`${index + 1} · ${color}`} onClick={() => onChange(color)} />)}
      <button type="button" className="drawing-swatch drawing-transparent" aria-label={uiText('투명')} aria-pressed={value === 'none'} data-tip={uiText('투명') + ' · 0'} onClick={() => onChange('none')} />
      <button type="button" className="drawing-swatch drawing-custom" aria-label={uiText('사용자 색상')} data-tip={uiText('사용자 색상') + ' · 9'} onClick={() => setShowCustom(!showCustom)}><span /></button>
    </div>
    {showCustom && <ColorPicker value={/^#[\da-f]{6}$/i.test(value) ? value : '#3b82f6'} defaultValue="#3b82f6" onChange={onChange}
      labels={{ color: uiText(target === 'fill' ? '채우기 색상' : '선 색상'), hex: uiText('HEX 색상'), hue: uiText('색조'), saturation: uiText('채도'), brightness: uiText('밝기'), reset: uiText('초기화'), close: uiText('닫기') }} />}
  </div>
}

export function PaintButtons({ fill, stroke, active, onActive }: { fill: string; stroke: string; active: PaintTarget | null; onActive: (target: PaintTarget) => void }) {
  return <div className="drawing-paint-buttons">
    <button type="button" aria-label={uiText('채우기 색상')} aria-expanded={active === 'fill'} data-tip={uiText('채우기 색상') + ' · F'} onClick={() => onActive('fill')}>
      <span className={`drawing-fill-icon ${fill === 'none' ? 'drawing-transparent' : ''}`} style={{ backgroundColor: fill === 'none' ? undefined : fill }} />
    </button>
    <button type="button" aria-label={uiText('선 색상')} aria-expanded={active === 'stroke'} data-tip={uiText('선 색상') + ' · X'} onClick={() => onActive('stroke')}>
      <span className={`drawing-stroke-icon ${stroke === 'none' ? 'drawing-transparent' : ''}`} style={{ backgroundColor: stroke === 'none' ? undefined : stroke }} />
    </button>
  </div>
}

export function DrawingPaintPopover({ target, value, onChange, onClose, custom }: { target: PaintTarget; value: string; onChange: (color: string) => void; onClose: () => void; custom?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useOverlayDismiss(onClose, { outside: () => ref.current })
  return <div ref={ref} className="drawing-paint-popover mew-overlay-surface bg-surface" role="group" aria-label={uiText(target === 'fill' ? '채우기 색상' : '선 색상')}><DrawingPalette target={target} value={value} onChange={onChange} custom={custom} /></div>
}

export function NumberField({ label, value, onChange, min, max, suffix }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; suffix?: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    const number = Number(draft)
    if (draft !== null && draft.trim() && Number.isFinite(number)) onChange(Math.max(min ?? -1e7, Math.min(max ?? 1e7, number)))
    setDraft(null)
  }
  return <label className="drawing-number"><span>{label}</span><input type="number" aria-label={label} min={min} max={max} value={draft ?? Math.round(value * 100) / 100}
    onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => {
      event.stopPropagation()
      if (event.key === 'Enter') event.currentTarget.blur()
      if (event.key === 'Escape') { setDraft(null); event.currentTarget.blur() }
    }} />{suffix && <span>{suffix}</span>}</label>
}

const FONT_OPTIONS = ['Arial', 'Inter', 'Noto Sans KR', 'IBM Plex Sans KR', 'Roboto', 'Noto Serif KR', 'Roboto Mono', 'Caveat', 'Nanum Pen Script'].map(value => ({ value, label: value }))
export function DrawingInspector({ objects, bounds, onPatch, onGeometry, onFont, paint, setPaint }: {
  objects: DrawingObject[]; bounds: Bounds; onPatch: (patch: Partial<DrawingObject>) => void
  onGeometry: (field: 'x' | 'y' | 'width' | 'height' | 'rotation', value: number) => void
  onFont: (family: string) => void; paint: PaintTarget | null; setPaint: (target: PaintTarget | null) => void
}) {
  const object = objects[0], allText = objects.every(item => item.type === 'text')
  const mixed = !allText && objects.some(item => item.type === 'text')
  const [custom, setCustom] = useState(false)
  const [portal, setPortal] = useState<HTMLDivElement | null>(null)
  return <div ref={setPortal} className="drawing-inspector" onKeyDown={event => {
    if ((event.target as HTMLElement).closest('input, textarea')) { event.stopPropagation(); return }
    if (paint && !event.ctrlKey && !event.metaKey && /^[0-9]$/.test(event.key)) {
      event.preventDefault(); event.stopPropagation()
      if (event.key === '9') setCustom(true)
      else onPatch({ [paint]: event.key === '0' ? 'none' : DRAWING_PALETTE[Number(event.key) - 1] })
    }
  }}>
    {!mixed && <div className="drawing-properties">
      <NumberField label="X" value={bounds.x + bounds.width / 2} onChange={value => onGeometry('x', value)} suffix="px" />
      <NumberField label="Y" value={bounds.y + bounds.height / 2} onChange={value => onGeometry('y', value)} suffix="px" />
      <NumberField label={uiText('너비')} value={objects.length === 1 ? object.width : bounds.width} min={1} onChange={value => onGeometry('width', value)} />
      <NumberField label={uiText('높이')} value={objects.length === 1 ? object.height : bounds.height} min={1} onChange={value => onGeometry('height', value)} />
      <NumberField label={uiText('회전')} value={objects.length === 1 ? object.rotation : 0} onChange={value => onGeometry('rotation', value)} suffix="°" />
      {!allText && <NumberField label={uiText('선 두께')} value={object.strokeWidth} min={0} max={1000} onChange={strokeWidth => onPatch({ strokeWidth })} />}
    </div>}
    <div className="drawing-inspector-colors"><PaintButtons fill={object.fill} stroke={object.stroke} active={paint} onActive={target => setPaint(paint === target ? null : target)} /></div>
    {paint && <DrawingPalette key={`${paint}-${custom}`} custom={custom} target={paint} value={object[paint]} onChange={color => onPatch({ [paint]: color })} />}
    {allText && <div className="drawing-font-properties">
      <SelectField label={uiText('글꼴')} compact editable portalContainer={portal} value={object.fontFamily ?? 'Arial'} options={FONT_OPTIONS} onChange={onFont} />
      <NumberField label={uiText('글자 크기')} value={object.fontSize ?? 24} min={1} max={2000} onChange={fontSize => onPatch({ fontSize })} />
      <SelectField label={uiText('글자 두께')} compact portalContainer={portal} value={String(object.fontWeight ?? 400)} options={[{ value: '400', label: uiText('보통') }, { value: '700', label: uiText('굵게') }]} onChange={weight => onPatch({ fontWeight: Number(weight) })} />
    </div>}
  </div>
}
