/** 실제 런타임 브랜드 SVG. 빌드에 고정된 원본을 inline으로 그려 currentColor가 SVG까지 상속되게 한다. */
import claudeCodeIcon from '@lobehub/icons-static-svg/icons/claudecode.svg?raw'
import codexIcon from '@lobehub/icons-static-svg/icons/codex.svg?raw'
import cursorIcon from '@lobehub/icons-static-svg/icons/cursor.svg?raw'
import geminiCliIcon from '@lobehub/icons-static-svg/icons/geminicli.svg?raw'
import hermesAgentIcon from '@lobehub/icons-static-svg/icons/hermesagent.svg?raw'
import kimiIcon from '@lobehub/icons-static-svg/icons/kimi.svg?raw'
import openClawIcon from '@lobehub/icons-static-svg/icons/openclaw.svg?raw'
import openCodeIcon from '@lobehub/icons-static-svg/icons/opencode.svg?raw'

function BrandGlyph({ svg }: { svg: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[14px]"
      // 패키지 버전을 고정한 빌드 타임 SVG다. 외부 입력이나 런타임 HTML은 이 경로에 들어오지 않는다.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

export const ClaudeCodeGlyph = () => <BrandGlyph svg={claudeCodeIcon} />
export const CodexGlyph = () => <BrandGlyph svg={codexIcon} />
export const HermesAgentGlyph = () => <BrandGlyph svg={hermesAgentIcon} />
export const KimiGlyph = () => <BrandGlyph svg={kimiIcon} />
export const GeminiCliGlyph = () => <BrandGlyph svg={geminiCliIcon} />
export const OpenClawGlyph = () => <BrandGlyph svg={openClawIcon} />
export const OpenCodeGlyph = () => <BrandGlyph svg={openCodeIcon} />
export const CursorGlyph = () => <BrandGlyph svg={cursorIcon} />

/** Prime Agent — lobhub에 브랜드 아이콘이 없어 Prime Intellect의 삼각 프리즘 마크를 단순화해 그린다. */
export const PrimeAgentGlyph = () => (
  <span
    aria-hidden="true"
    className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[14px]"
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 22 20H2Z" />
      <path d="M12 3v17" />
    </svg>
  </span>
)
