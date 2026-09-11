---
title: "mew 5000번 포트 터널 노출 보안 검토 (2026-07-21)"
desc: "팀 서버를 공개 터널에 노출할 때의 인증·인가·경계 검토 결과 스냅샷."
created: 2026-07-27
updated: 2026-07-27
---

**2026-07-21 시점의 검토 스냅샷**이다. 코드 위치 참조(`파일:줄`)는 그날의 것이라 현재와 다를 수 있다. 현재의 접근 모델은 [access-model.md](../operations/access-model.md)를 본다.

- 검토 범위: 5000(팀)·5001(게스트) 두 서버의 인증·인가·네트워크 경계
- ⚠️ **이후 변경**: 5001 게스트 서버는 이후 단일 포트(5000) 모델로 통합됐다. §4의 "AI 에이전트도 동일 범위" 항목은 [ADR 0014](../../../.mew/docs/decisions/0014-mew-agent-panel-removal.md)로 **해소됐다**(에이전트 창 전면 제거).
- ✅ **2026-07-28 재확인 — §1·§2·§3 모두 해소됐다.** presence는 수신자별 권한 필터를 거치고, tmux·collab WS 인가가 `mustChangePassword`를 확인하며, `clientIp`는 소켓이 loopback일 때만(=cloudflared 경유) 헤더를 신뢰한다. 아래 본문과 우선순위 표는 2026-07-21 당시 기록이니 **그대로 두고 다시 고치지 않는다.** 현재 상태는 [access-model.md](../operations/access-model.md).

## 결론 먼저

로그인 자체(비밀번호 해시, 세션, CSRF, 레이트리밋)는 잘 만들어져 있어 **"승인 안 된 사람이 로그인한다"** 시나리오는 안심해도 된다. 문제는 그게 아니라 **"승인된 이메일 하나 = 정확히 무엇에 대한 권한인가"** 쪽이다. 5000번은 문서 편집기가 아니라 `~/dev/liiiiv` 전체에 대한 셸 접근을 포함한, 사실상 SSH에 준하는 개발 환경 접근권을 내주는 서버다. 계정 하나가 털리면 blast radius는 "docs 프로젝트"가 아니라 "이 워크스페이스의 모든 프로젝트"다.

## 1. [High] Presence 정보가 팀·게스트 경계를 넘어 공유됨

`presence.ts`가 `wss`와 `clientState`를 **모듈 전역 싱글턴**으로 선언한다. `attachPresenceWebSocket()`이 팀 서버와 게스트 서버 양쪽에서 호출되지만 실제 브로드캐스트 대상은 두 서버 모두 **같은 클라이언트 집합**이다.

즉 인증 없이 게스트로 접속한 익명 사용자도 팀원이 지금 포커스한 문서 **경로**와 커서 **색**을 실시간으로 받는다. 게스트 콘텐츠 API는 `docs` 프로젝트로 제한돼 있지만 presence 브로드캐스트는 그 필터를 거치지 않으므로, 팀원이 `docs`가 아닌 프로젝트(소스코드·내부 기획 문서)를 열면 그 경로 문자열이 그대로 공개 인터넷에 노출된다.

"문서를 몇 명이 보고 있는지 게스트에게도 보여준다"는 것 자체는 의도된 설계지만, 팀/게스트를 구분하지 않고 완전히 동일한 채널을 쓰는 건 의도한 범위를 넘는다.

**영향**: 내부 프로젝트 구조, 팀 활동 패턴(누가 언제 무엇을 보는지)이 익명 사용자에게 노출.
**조치**: `attachPresenceWebSocket`에 서버 구분자(scope)를 넘겨 브로드캐스트를 분리하거나, 최소한 `docs` 밖 경로를 게스트 브로드캐스트에서 필터링.

## 2. [Medium] WebSocket authorize가 `mustChangePassword`를 확인하지 않음

HTTP API를 지키는 `requireAuth`는 `session.user.mustChangePassword`까지 확인해 임시 비밀번호 사용자를 막는다. 그런데 WebSocket 업그레이드의 `authorize`는 세션 존재 여부만 본다:

```ts
const authorize = (req: IncomingMessage) => sessionFromRequest(req) !== null
```

임시 비밀번호만 가진 계정도 **tmux로 셸을 붙잡을 수 있다** — HTTP 가드를 WS 경로로 우회하는 셈이다.

**조치**: `(req) => { const s = sessionFromRequest(req); return s !== null && !s.user.mustChangePassword }`

## 3. [Medium] `clientIp()`가 헤더를 무조건 신뢰

`cf-connecting-ip` → `x-forwarded-for` → `socket.remoteAddress` 순으로 신뢰한다. 이는 트래픽이 **오직 cloudflared 경유로만** 들어온다는 가정인데, 실제로는 tailnet 직접 접속 경로도 있다. 그 경로로 오면 클라이언트가 헤더를 임의로 붙일 수 있고 서버는 그대로 믿는다.

**영향**: 로그인 실패 레이트리밋(IP+이메일, 10회/15분)이 매 요청 다른 `x-forwarded-for`로 무력화돼 무차별 대입이 가능해진다.
**조치**: 신뢰 가능한 경로(cloudflared)와 아닌 경로(tailnet 직결)를 구분해, 신뢰 불가 경로에서는 `socket.remoteAddress`만 쓴다. 가장 간단한 방법은 tailnet 직결을 막고 cloudflared 전용으로 강제하는 것.

## 4. 구조적 한계 — "승인된 이메일만"의 실질적 의미

버그가 아니라 설계의 귀결이다. 요약은 [access-model.md](../operations/access-model.md) "이 경계가 의미하는 것"에 옮겨 뒀다.

- **워크스페이스 전체 접근** — `WORKSPACE_ROOT`가 `~/dev/liiiiv`이고 그 아래 모든 최상위 폴더가 프로젝트로 취급된다. 팀 서버 로그인 사용자는 mew 자체 소스와 옆 프로젝트들을 API로 열람·수정할 수 있다.
- **완전한 셸 접근** — tmux WebSocket이 `cwd: WORKSPACE_ROOT`로 pty를 스폰한다. API 레벨 경로 검증(`.git`·`node_modules`·`.data`·`.env*` 차단)은 "우발적 UI 노출"만 막을 뿐, 셸을 가진 사용자에게는 경계가 아니다. `.env`·`.data/`의 세션·비밀번호 해시·다른 프로젝트 시크릿이 전부 `cat` 한 줄로 읽힌다.
- ~~**AI 에이전트도 동일 범위**~~ — `server/agent.ts`가 `bypassPermissions`로 워크스페이스 루트에서 Claude Code를 헤드리스 실행했다. **해소됨** — [ADR 0014](../../../.mew/docs/decisions/0014-mew-agent-panel-removal.md)로 전면 제거.

**권장**: 계정 발급을 신뢰하는 소수에게만. 공개 인터넷 터널보다 tailnet이 훨씬 안전한 경계다. 세션 TTL 단축 검토.

## 5. [Low] ~~`/upload`에 사용자별 쿼터 없음~~ — 쿼터를 두지 않기로 결정(2026-07-28)

> 이 지적을 받아 계정당 일일 200MB 쿼터를 넣었다가 **2026-07-28 다시 제거했다.** 발급 계정이 owner·manager 둘뿐이고 전원 셸을 가진 상황에서 "비용성 DoS"는 실질 위협이 아니라 정상 사용(대용량 자산 업로드)을 막는 마찰이었다. **재추가 금지** — 계정을 외부에 넓게 발급하는 모델로 바뀌면 그때 다시 판단한다. 아래는 2026-07-21 당시 기록이다.

파일당 500MB까지 허용되고 R2 업로드에 사용자별·기간별 쿼터가 없다. 인증 사용자만 가능하지만 반복 업로드로 스토리지 비용을 늘릴 수 있다 — 계정 하나가 털리면 비용성 DoS 벡터.

## 6. [Low] Yjs collab room이 인증만 되면 무제한 생성 가능

`roomKey`가 클라이언트 쿼리 파라미터 그대로다. 검증·소유권 확인이 없어 임의 room 키로 계속 접속하면 메모리에 `Y.Doc`이 쌓인다. 클라이언트 0이 되면 정리되지만 동시 연결을 유지하면 무한정 늘어난다. 디스크에 쓰지 않고 인증이 필요해 우선순위는 낮다.

## 7. 잘 되어 있는 것

- 비밀번호: scrypt + 사용자별 salt, 타이밍 세이프 비교, 미등록 이메일에도 더미 해시로 응답해 존재 여부 타이밍 공격 방지
- 셀프 등록·비밀번호 재설정 HTTP 엔드포인트가 **아예 없음** — 계정 발급은 호스트 로컬 CLI 전용이라 원격 계정 생성 공격면이 없다
- 세션 토큰은 원문이 아니라 sha256 해시로 저장 — 저장소가 유출돼도 세션 재사용 불가
- 비밀번호 변경 시 다른 기기 세션 전부 무효화
- 로그인 레이트리밋, CSRF 방어(SameSite=Lax + Origin 검증), HttpOnly + 조건부 Secure 쿠키
- 게스트는 tmux에 절대 못 붙게 코드·주석 양쪽에서 경계가 명확함, 쓰기 라우트 전부 차단
- `/link-preview`는 SSRF 우려로 게스트 화이트리스트에서 의도적으로 제외
- 보안 헤더(nosniff, `X-Frame-Options: DENY`, Referrer-Policy) 양쪽 적용

## 우선순위 요약

| 순위 | 항목 | 조치 난이도 |
| --- | --- | --- |
| 1 | Presence 팀/게스트 채널 분리 (§1) | 낮음 — scope 파라미터 추가 |
| 2 | WS authorize에 `mustChangePassword` 체크 (§2) | 매우 낮음 — 한 줄 |
| 3 | `clientIp` 신뢰 경로 재검토 / tailnet 직결 차단 (§3) | 중간 — 네트워크 구성 확인 필요 |
| 4 | "승인 이메일 = 워크스페이스 전체 권한" 전제하에 계정 발급 최소화 (§4) | 정책적 결정 |
| 5 | 업로드 쿼터, collab room 정리 (§5·§6) | 낮음, 급하지 않음 |
