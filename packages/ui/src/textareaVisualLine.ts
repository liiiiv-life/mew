export type TextareaVerticalDirection = 'up' | 'down'

type VisualLineOffsets = {
  first: number
  caret: number
  last: number
}

/** 브라우저 레이아웃에서 나온 세 위치가 같은 시각적 줄인지 판정한다. */
export function isTextareaVisualBoundary(
  direction: TextareaVerticalDirection,
  offsets: VisualLineOffsets,
  tolerance = 1,
) {
  const boundary = direction === 'up' ? offsets.first : offsets.last
  return Math.abs(offsets.caret - boundary) <= tolerance
}

function logicalLineBoundary(textarea: HTMLTextAreaElement, direction: TextareaVerticalDirection) {
  const caret = textarea.selectionStart ?? 0
  return direction === 'up'
    ? !textarea.value.slice(0, caret).includes('\n')
    : !textarea.value.slice(caret).includes('\n')
}

/**
 * textarea와 같은 폭·글꼴·줄바꿈 규칙을 가진 숨은 mirror에서 커서의 세로 위치를 잰다.
 * `\n`뿐 아니라 화면 폭 때문에 자동으로 접힌 줄도 실제 브라우저 레이아웃대로 구분한다.
 */
export function isTextareaCaretOnVisualBoundary(
  textarea: HTMLTextAreaElement,
  direction: TextareaVerticalDirection,
) {
  if (textarea.selectionStart !== textarea.selectionEnd) return false
  if (textarea.clientWidth <= 0 || !document.body) return logicalLineBoundary(textarea, direction)

  const computed = getComputedStyle(textarea)
  const mirror = document.createElement('div')
  Object.assign(mirror.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    visibility: 'hidden',
    pointerEvents: 'none',
    boxSizing: 'border-box',
    width: `${textarea.clientWidth}px`,
    height: 'auto',
    overflow: 'visible',
    whiteSpace: computed.whiteSpace || 'pre-wrap',
    overflowWrap: computed.overflowWrap || 'break-word',
    wordBreak: computed.wordBreak,
    paddingTop: computed.paddingTop,
    paddingRight: computed.paddingRight,
    paddingBottom: computed.paddingBottom,
    paddingLeft: computed.paddingLeft,
    fontFamily: computed.fontFamily,
    fontFeatureSettings: computed.fontFeatureSettings,
    fontKerning: computed.fontKerning,
    fontSize: computed.fontSize,
    fontStyle: computed.fontStyle,
    fontVariant: computed.fontVariant,
    fontVariationSettings: computed.fontVariationSettings,
    fontWeight: computed.fontWeight,
    fontStretch: computed.fontStretch,
    lineHeight: computed.lineHeight,
    lineBreak: computed.lineBreak,
    letterSpacing: computed.letterSpacing,
    wordSpacing: computed.wordSpacing,
    textAlign: computed.textAlign,
    textIndent: computed.textIndent,
    textRendering: computed.textRendering,
    textTransform: computed.textTransform,
    direction: computed.direction,
    tabSize: computed.tabSize,
  })

  const measure = (position: number) => {
    mirror.replaceChildren(document.createTextNode(textarea.value.slice(0, position)))
    const marker = document.createElement('span')
    // 뒤쪽 전문을 함께 두어, 단어 전체 길이 때문에 이 지점 앞에서 줄바꿈되는 경우까지 똑같이 재현한다.
    marker.textContent = textarea.value.slice(position) || '\u200b'
    mirror.appendChild(marker)
    return marker.getBoundingClientRect().top
  }

  document.body.appendChild(mirror)
  try {
    return isTextareaVisualBoundary(direction, {
      first: measure(0),
      caret: measure(textarea.selectionStart ?? 0),
      last: measure(textarea.value.length),
    })
  } finally {
    mirror.remove()
  }
}
