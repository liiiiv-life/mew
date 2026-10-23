import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { SelectField } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { EditPencil, EyeClosed, Plus, Xmark } from 'iconoir-react'
import { KEY_CODES } from '../../native/remote-desktop/keys.mjs'
import type { DesktopInput } from '../utils/desktop-input'
import { DEFAULT_GAME_KEYS, FULL_KEY_ROWS, NAVIGATION_KEYS, NUMPAD_KEYS, isScreenModifier, saveScreenKeyboard, screenKeyboardInput, screenKeyLabel, type ScreenKeyboardSettings } from '../utils/desktop-screen-keyboard'
import './desktop-screen-keyboard.css'

export function DesktopScreenKeyboard({ input, disabled, settings, onSettings, onClose, panel }: {
  input: DesktopInput | null; disabled: boolean; settings: ScreenKeyboardSettings; onSettings: (settings: ScreenKeyboardSettings) => void
  onClose: () => void; panel: RefObject<HTMLDivElement | null>
}) {
  useUiLocale()
  const [editing, setEditing] = useState(false), [pressed, setPressed] = useState<string[]>([])
  const element = useRef<HTMLElement>(null)
  const controller = useMemo(() => screenKeyboardInput((code, down) => input?.key(code, down, 'screen'), setPressed), [input])
  const release = useCallback(() => controller.release(), [controller])
  useEffect(() => {
    const hidden = () => { if (document.hidden) release() }
    const focus = (event: FocusEvent) => { if (!element.current?.contains(event.target as Node) && !(event.target as Element)?.closest?.('.desktop-stage, .desktop-control-strip')) release() }
    const unsubscribe = input?.onRelease(() => controller.reset())
    window.addEventListener('blur', release); document.addEventListener('visibilitychange', hidden); document.addEventListener('fullscreenchange', release); document.addEventListener('focusin', focus)
    return () => { unsubscribe?.(); release(); window.removeEventListener('blur', release); document.removeEventListener('visibilitychange', hidden); document.removeEventListener('fullscreenchange', release); document.removeEventListener('focusin', focus) }
  }, [input, controller, release])
  useEffect(() => { if (disabled) release() }, [disabled, release])
  useEffect(() => {
    const target = panel.current, keyboard = element.current
    if (!target || !keyboard) return
    const measure = () => { target.style.setProperty('--desktop-keyboard-height', settings.mode === 'full' ? `${keyboard.offsetHeight}px` : '0px') }
    const observer = new ResizeObserver(measure); observer.observe(keyboard); measure()
    return () => { observer.disconnect(); target.style.removeProperty('--desktop-keyboard-height') }
  }, [panel, settings.mode])
  const update = (next: ScreenKeyboardSettings) => { release(); saveScreenKeyboard(next); onSettings(next) }
  const keyButton = (code: string) => <button key={code} type="button" className="desktop-screen-key" data-screen-key={code} data-wide={code === 'Space' ? 'space' : ['Backspace', 'Enter', 'Tab', 'CapsLock', 'ShiftLeft', 'ShiftRight'].includes(code) ? 'wide' : undefined}
    aria-label={uiText('원격 {p0}', { p0: code })} aria-pressed={pressed.includes(code)} title={code} disabled={disabled || editing}
    onContextMenu={event => event.preventDefault()}
    onPointerDown={event => {
      if (event.button !== 0 && event.pointerType === 'mouse') return
      event.preventDefault(); event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      if (settings.mode === 'full' && isScreenModifier(code)) controller.toggle(code)
      else controller.down(event.pointerId, code)
    }}
    onPointerUp={event => { controller.up(event.pointerId); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
    onPointerCancel={event => { controller.up(event.pointerId); if (settings.mode === 'full' && isScreenModifier(code)) controller.unlatch(code) }}
    onLostPointerCapture={event => controller.up(event.pointerId)}
    onClick={event => {
      if (event.detail > 0) return
      if (settings.mode === 'full' && isScreenModifier(code)) controller.toggle(code)
      else { controller.down(-1, code); controller.up(-1) }
    }}>{screenKeyLabel(code)}</button>
  const options = Object.keys(KEY_CODES).map(code => ({ value: code, label: `${screenKeyLabel(code)} · ${code}` }))
  return <section ref={element} className={`desktop-screen-keyboard is-${settings.mode}${editing ? ' is-editing' : ''}`} aria-label={uiText('화면 키보드')}>
    <div className="desktop-screen-keyboard-tools">
      {(['full', 'game'] as const).map(mode => <button key={mode} type="button" aria-pressed={settings.mode === mode} onClick={() => { update({ ...settings, mode }); setEditing(false) }}>{mode === 'full' ? uiText('풀키') : uiText('게임용')}</button>)}
      <span className="desktop-screen-keyboard-spacer" />
      <button type="button" className="desktop-screen-keyboard-icon" aria-label={uiText('키보드만 보기')} title={uiText('키보드만 보기')} aria-pressed={settings.keyboardOnly} onClick={() => update({ ...settings, keyboardOnly: !settings.keyboardOnly })}><EyeClosed /></button>
      {settings.mode === 'game' && <button type="button" className="desktop-screen-keyboard-icon" aria-label={editing ? uiText('완료') : uiText('게임 키 설정')} aria-pressed={editing} onClick={() => { release(); setEditing(value => !value) }}>{editing ? <Xmark /> : <EditPencil />}</button>}
      <button type="button" className="desktop-screen-keyboard-icon" aria-label={uiText('화면 키보드 닫기')} onClick={() => { release(); onClose() }}><Xmark /></button>
    </div>
    <div className="desktop-screen-keyboard-body">
      {editing ? <div className="desktop-game-key-editor">
        {settings.gameKeys.map((code, index) => <div className="desktop-game-key-field" key={index}>
          <span>{index + 1}</span><SelectField label={uiText('게임 키 {p0}', { p0: index + 1 })} value={code} portalContainer={panel.current}
            options={options.map(option => ({ ...option, disabled: option.value !== code && settings.gameKeys.includes(option.value) }))}
            onChange={value => update({ ...settings, gameKeys: settings.gameKeys.map((key, i) => i === index ? value : key) })} />
          <button type="button" className="desktop-screen-keyboard-icon" disabled={settings.gameKeys.length <= 1} aria-label={uiText('게임 키 {p0} 삭제', { p0: index + 1 })}
            onClick={() => update({ ...settings, gameKeys: settings.gameKeys.filter((_, i) => i !== index) })}><Xmark /></button>
        </div>)}
        <div className="desktop-game-key-actions"><button type="button" disabled={settings.gameKeys.length >= 24} onClick={() => { const code = ['KeyR', ...Object.keys(KEY_CODES)].find(code => !settings.gameKeys.includes(code)); if (code) update({ ...settings, gameKeys: [...settings.gameKeys, code] }) }}><Plus />{uiText('키 추가')}</button>
          <button type="button" onClick={() => update({ ...settings, gameKeys: [...DEFAULT_GAME_KEYS] })}>{uiText('초기화')}</button></div>
      </div> : settings.mode === 'game' ? <div className="desktop-game-key-grid">{settings.gameKeys.map(keyButton)}</div>
        : <div className="desktop-full-keyboard"><div className="desktop-keyboard-main">{FULL_KEY_ROWS.map((row, index) => <div key={index} className="desktop-keyboard-row">{row.map(keyButton)}</div>)}</div>
          <div className="desktop-keyboard-navigation">{NAVIGATION_KEYS.map(keyButton)}</div><div className="desktop-keyboard-numpad">{NUMPAD_KEYS.map(keyButton)}</div></div>}
    </div>
  </section>
}
