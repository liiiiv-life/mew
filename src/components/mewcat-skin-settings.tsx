import { useEffect, useRef, useState } from 'react'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { Download, EditPencil, Plus, Refresh, Trash, Upload, Xmark } from 'iconoir-react'
import { useI18n } from '../i18n'
import { useCustomSpriteSkins, useMewcatSpriteSkin } from '../hooks/use-mewcat-sprite-skins'
import { MEWCAT_SKINS, type MewcatSkin, type MewcatSkinSelection } from '../utils/mewcatSkin'
import { MEWCAT_CYCLE_MS, MEWCAT_SPRITE_ACTIONS, MAX_SPRITE_FRAMES, validSpriteDimensions, type MewcatSpriteAction, type SavedSpriteSkin, type SpriteImage, type SpriteSkin, type SpriteStrip } from '../utils/mewcat-sprites'
import { deleteSpriteSkin, loadSpriteSkins, prepareSpriteStrip, readSpriteImage, saveSpriteSkin } from '../utils/mewcat-sprite-storage'
import { MewcatSprite } from './mewcat-sprite'
import { uuid } from '../utils/uuid'

const actionNames = { idle: '가만히 있기', walk: '걷기', run: '뛰기', jump: '공중 상승', fall: '공중 하강', love: '쓰다듬기', struggle: '목덜미 잡기' } as const
const iconButton = 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 [&_svg]:h-4 [&_svg]:w-4'
const inputClass = 'h-9 min-w-0 rounded border border-edge-strong bg-surface-deep px-2 text-sm text-ink focus:outline-2 focus:outline-accent'
type DraftAction = { image: SpriteImage | null; frames: string; fileName: string }
type Draft = { id?: string; name: string; actions: Record<MewcatSpriteAction, DraftAction> }

function createDraft(skin?: SpriteSkin): Draft {
  return { id: skin?.id, name: skin?.name ?? '', actions: Object.fromEntries(MEWCAT_SPRITE_ACTIONS.map(action => [action, {
    image: skin?.sprites[action] ?? null, frames: String(skin?.sprites[action].frames ?? 8), fileName: skin ? `${action}.png` : '',
  }])) as Draft['actions'] }
}

export function MewcatSkinSettings({ skin, onChange }: { skin: MewcatSkinSelection; onChange: (skin: MewcatSkinSelection) => void }) {
  const { t } = useI18n()
  useUiLocale()
  const custom = useCustomSpriteSkins()
  const silhouette = useMewcatSpriteSkin('mew')
  const kitten = useMewcatSpriteSkin('kitten')
  const [draft, setDraft] = useState<Draft>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const options: { id: MewcatSkinSelection; name: string; sprite?: SpriteStrip }[] = [
    { id: null, name: t('settings.mewcatNone') },
    ...MEWCAT_SKINS.map(item => ({ ...item, sprite: (item.id === 'kitten' ? kitten : silhouette)?.sprites.idle })),
    ...custom.skins.map(item => ({ id: item.id as MewcatSkin, name: item.name, sprite: item.sprites.idle })),
  ]
  const save = async () => {
    if (!draft || busy) return
    setError('')
    if (!draft.name.trim() || MEWCAT_SPRITE_ACTIONS.some(action => !draft.actions[action].image)) {
      setError(uiText('스킨 이름과 일곱 동작의 이미지를 입력하세요.')); return
    }
    const sprites = {} as SavedSpriteSkin['sprites']
    for (const action of MEWCAT_SPRITE_ACTIONS) {
      const { image, frames } = draft.actions[action]
      if (!validSpriteDimensions(image!.width, image!.height, Number(frames))) {
        setError(`${uiText(actionNames[action])}: ${uiText('프레임 수는 1~256이며 이미지 너비를 균등하게 나눌 수 있어야 합니다.')}`); return
      }
      sprites[action] = { blob: image!.blob, width: image!.width, height: image!.height, frames: Number(frames) }
    }
    setBusy(true)
    try {
      const saved = await saveSpriteSkin({ id: draft.id ?? `custom:${uuid()}`, name: draft.name.trim(), sprites })
      onChange(saved.id as MewcatSkin)
      setDraft(undefined)
    } catch (error) { setError(error instanceof Error ? error.message : uiText('저장 실패')) }
    finally { setBusy(false) }
  }
  const remove = async (id: string) => {
    setBusy(true); setError('')
    try {
      await deleteSpriteSkin(id)
      if (skin === id) onChange('mew')
      if (draft?.id === id) setDraft(undefined)
    } catch (error) { setError(error instanceof Error ? error.message : uiText('스킨을 삭제하지 못했습니다.')) }
    finally { setBusy(false) }
  }
  return <div className="mewcat-skin-settings">
    <div className="flex items-center justify-between gap-2">
      <div className="text-sm font-medium text-ink">{t('settings.mewcat')}</div>
      <button type="button" className="inline-flex min-h-9 items-center gap-1 rounded px-2 text-sm text-ink hover:bg-surface-hover disabled:opacity-40" disabled={busy || !!draft} onClick={() => { setDraft(createDraft()); setError('') }}><Plus className="h-4 w-4" />{uiText('스킨 추가')}</button>
    </div>
    <div className="mt-2 grid grid-cols-3 gap-2">
      {options.map(option => <div key={option.id ?? 'none'} className="min-w-0">
        <button type="button" disabled={busy} onClick={() => onChange(option.id)} aria-pressed={skin === option.id}
          className={`w-full min-w-0 rounded border p-2 text-left disabled:opacity-40 ${skin === option.id ? 'border-accent bg-accent/10 text-ink' : 'border-edge-strong bg-surface text-ink-secondary hover:bg-surface-raised'}`}>
          <span className="flex h-14 items-end justify-center rounded bg-surface-deep">
            {option.sprite ? <span className="h-12 w-12"><MewcatSprite strip={option.sprite} /></span> : <span className="self-center text-sm text-ink-muted">—</span>}
          </span>
          <span className="mt-1 block truncate text-sm font-medium" title={option.name}>{option.name}</span>
        </button>
        {option.id?.startsWith('custom:') && <div className="flex justify-end">
          <button type="button" className={iconButton} disabled={busy} title={uiText('스킨 수정')} aria-label={`${uiText('스킨 수정')}: ${option.name}`} onClick={() => { setDraft(createDraft(custom.skins.find(item => item.id === option.id))); setError('') }}><EditPencil /></button>
          <button type="button" className={iconButton} disabled={busy} title={uiText('스킨 삭제')} aria-label={`${uiText('스킨 삭제')}: ${option.name}`} onClick={() => void remove(option.id!)}><Trash /></button>
        </div>}
      </div>)}
    </div>
    {custom.failed && <div className="mt-2 flex items-center gap-1 text-sm text-ink-muted">{uiText('일부 스킨을 불러오지 못했습니다.')}<button type="button" className={iconButton} title={t('common.refresh')} aria-label={t('common.refresh')} onClick={() => void loadSpriteSkins()}><Refresh /></button></div>}
    {draft && <div className="mt-3 border-t border-edge pt-3">
      <div className="flex items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-ink">{uiText('스킨 이름')}<input className={`${inputClass} flex-1`} value={draft.name} maxLength={40} disabled={busy} onChange={event => { setError(''); setDraft({ ...draft, name: event.target.value }) }} /></label>
        <button type="button" className={iconButton} disabled={busy} title={t('common.cancel')} aria-label={t('common.cancel')} onClick={() => { setDraft(undefined); setError('') }}><Xmark /></button>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-ink-muted">{uiText('같은 크기의 프레임을 가로 한 줄로 나열한 PNG·WebP를 넣으세요. 착지는 공중 하강 이미지의 후반 프레임을 사용합니다.')}</p>
      <div className="mt-2 divide-y divide-edge">
        {MEWCAT_SPRITE_ACTIONS.map(action => <SpriteEditorRow key={action} action={action} sampleFolder={skin === 'kitten' ? 'kitten' : 'silhouette'} value={draft.actions[action]} disabled={busy} onError={setError}
          onAttach={(image, fileName) => setDraft(current => current ? { ...current, actions: { ...current.actions, [action]: { ...current.actions[action], image, fileName } } } : current)}
          onChange={value => { setError(''); setDraft(current => current ? { ...current, actions: { ...current.actions, [action]: value } } : current) }} />)}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-ink-muted">{uiText('이 브라우저에 저장')}</span>
        <button type="button" disabled={busy} onClick={() => void save()} className="min-h-9 rounded bg-accent px-3 text-sm font-medium text-white disabled:opacity-40">{busy ? uiText('저장 중…') : uiText('저장')}</button>
      </div>
    </div>}
    {error && <p className="mt-2 text-sm text-danger" role="alert">{error}</p>}
  </div>
}

function SpriteEditorRow({ action, sampleFolder, value, disabled, onAttach, onChange, onError }: { action: MewcatSpriteAction; sampleFolder: 'kitten' | 'silhouette'; value: DraftAction; disabled: boolean; onAttach: (image: SpriteImage, fileName: string) => void; onChange: (value: DraftAction) => void; onError: (error: string) => void }) {
  const [preview, setPreview] = useState<SpriteStrip>()
  const [reading, setReading] = useState(false)
  const uploadGeneration = useRef(0)
  useEffect(() => () => { uploadGeneration.current++ }, [])
  const name = uiText(actionNames[action])
  const invalid = !!value.image && !validSpriteDimensions(value.image.width, value.image.height, Number(value.frames))
  useEffect(() => {
    let active = true
    let strip: SpriteStrip | undefined
    setPreview(undefined)
    if (value.image && !invalid) void prepareSpriteStrip({ ...value.image, frames: Number(value.frames) }).then(result => {
      strip = result
      if (active) setPreview(result)
      else URL.revokeObjectURL(result.src)
    }).catch(() => {})
    return () => { active = false; if (strip) URL.revokeObjectURL(strip.src) }
  }, [value.image, value.frames, invalid])
  const attach = async (file?: File) => {
    if (!file) return
    const generation = ++uploadGeneration.current
    setReading(true)
    try {
      const image = await readSpriteImage(file, Number(value.frames))
      if (generation !== uploadGeneration.current) return
      onAttach(image, file.name)
      onError('')
    } catch (error) { if (generation === uploadGeneration.current) onError(error instanceof Error ? error.message : uiText('이미지를 읽을 수 없습니다.')) }
    finally { if (generation === uploadGeneration.current) setReading(false) }
  }
  return <div className="py-2">
    <div className="flex items-center gap-2">
      <span className="h-12 w-12 shrink-0 rounded bg-surface-deep">{preview && <MewcatSprite strip={preview} action={action} playing />}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink">{name}</div>
        <div className="text-xs text-ink-muted">{uiText('한 바퀴 {seconds}초', { seconds: MEWCAT_CYCLE_MS[action] / 1000 })}</div>
        <div className="truncate text-xs text-ink-muted" title={value.fileName}>{value.fileName || 'PNG · WebP'}</div>
      </div>
      <label className="flex shrink-0 flex-col gap-0.5 text-xs text-ink-muted">{uiText('프레임 수')}
        <input type="number" inputMode="numeric" min={1} max={MAX_SPRITE_FRAMES} step={1} value={value.frames} disabled={disabled} aria-label={uiText('{action} 프레임 수', { action: name })} aria-invalid={invalid || undefined} className={`${inputClass} w-16`} onChange={event => onChange({ ...value, frames: event.target.value })} />
      </label>
      <label className={`${iconButton} relative overflow-hidden ${disabled || reading ? 'pointer-events-none opacity-40' : ''}`} title={uiText('이미지 첨부')}>
        <Upload /><input type="file" accept="image/png,image/webp" disabled={disabled || reading} aria-label={uiText('{action} 스프라이트', { action: name })} className="absolute inset-0 cursor-pointer opacity-0" onChange={event => { void attach(event.target.files?.[0]); event.target.value = '' }} />
      </label>
      <a href={`/mewcat/${sampleFolder}/${action}.png`} download={`mewcat-${action}.png`} className={iconButton} title={uiText('예제 이미지 다운로드')} aria-label={`${name}: ${uiText('예제 이미지 다운로드')}`}><Download /></a>
    </div>
    {invalid && <p className="mt-1 text-xs text-danger">{uiText('프레임 수는 1~256이며 이미지 너비를 균등하게 나눌 수 있어야 합니다.')}</p>}
  </div>
}
