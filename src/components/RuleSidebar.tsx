import type { DocRules } from '../api/client'

export function RuleSidebar({ rules }: { rules: DocRules | null }) {
  if (!rules) {
    return (
      <div className="h-full overflow-y-auto border-l border-edge bg-surface-deep p-4 text-sm text-ink-secondary">
        규칙 검사 대기 중…
      </div>
    )
  }

  const mocOk = !rules.mocApplicable || rules.mocRegistered
  const linksOk = rules.brokenLinks.length === 0

  return (
    <div className="h-full overflow-y-auto border-l border-edge bg-surface-deep p-4 text-sm">
      <div className="mb-4 font-semibold text-ink-muted">규칙 검사</div>

      {rules.archived && (
        <div className="mb-3 rounded bg-warning-surface px-3 py-2 text-warning-ink">
          archives/ 문서 — 편집 불가 (불변)
        </div>
      )}

      <div className={`mb-3 rounded px-3 py-2 ${mocOk ? 'bg-success-surface text-success-ink' : 'bg-danger-surface text-danger-ink'}`}>
        {rules.mocApplicable ? (mocOk ? 'MOC 체인에 등록됨' : 'MOC 체인에 미등록 — MOC.md 갱신 필요') : 'MOC 등록 대상 아님(허브 문서)'}
      </div>

      <div className={`rounded px-3 py-2 ${linksOk ? 'bg-success-surface text-success-ink' : 'bg-danger-surface text-danger-ink'}`}>
        {linksOk ? (
          '내부 링크 이상 없음'
        ) : (
          <>
            <div className="mb-1">깨진 링크 {rules.brokenLinks.length}건:</div>
            <ul className="list-inside list-disc space-y-0.5">
              {rules.brokenLinks.map((link) => (
                <li key={link} className="truncate">{link}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
