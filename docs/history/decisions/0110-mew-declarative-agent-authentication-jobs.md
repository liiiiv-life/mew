---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: mew 에이전트 인증을 등록표의 선언적 작업으로 통합한다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0110 — mew 에이전트 인증을 등록표의 선언적 작업으로 통합한다"
created: 2026-09-04
updated: 2026-09-11
---

- 날짜: 2026-09-04
- 상태: 채택
- 후속 결정: [0116](0116-mew-oauth-agent-logins-use-external-browser.md) — Claude·Gemini 인증 배치
- 후속 결정: [0117](0117-mew-terminal-agent-tabs-for-claude-and-antigravity.md) — Claude 별도 인증·Gemini 런타임
- 후속 결정: [0121](0121-mew-codex-oauth-through-scoped-server-browser.md) — Codex device-code 명령
- 후속 결정: [0128](0128-mew-browser-oauth-uses-internal-browser.md) — browser 인증의 외부 탭 예약
- 부분 대체: [0072](0072-mew-agent-gui-authentication.md) — 런타임당 terminal auth 하나를 여러 고정 방법과 실행 표면을 가진 인증 작업으로 확장
- 부분 대체: [0109](0109-mew-agent-authentication-and-loopback-browser.md) — Gemini headless 인증을 기기 코드로 일반화한 부분을 정정하고, 자동 브라우저 전달은 직접 URL을 출력하는 CLI로 제한
- 결정자: 송상훈 (지시), Codex (설계·구현)

## 배경

Kimi Code의 device-code URL을 Mew가 외부 브라우저로 연결하는 경로가 생겼지만, 표면 선택과 URL
allowlist가 `kimi` 분기와 단일 `browserLogin`에 박혀 있었다. 같은 형태의 Codex·Cursor를 추가하려면 UI,
API, 런타임 표를 매번 같이 고쳐야 하고, Kimi의 `.com`·`.ai` 대안처럼 한 런타임의 여러 로그인 방법도
별도 UI로 만들어야 했다. 실패 시 exit code만 보여, 공급자가 출력한 재시도 가능한 이유도 사라졌다.

반면 런타임의 인증 계약은 실제로 두 종류다.

- Codex·Kimi·Cursor: 고정 CLI가 HTTPS URL을 출력하고 브라우저 승인을 polling한다.
- Claude·Hermes·Gemini·OpenClaw·OpenCode·Prime: 계정/공급자/키/모델 선택 또는 코드 붙여넣기가 먼저인
  대화형 흐름이므로 완전한 터미널이 필요하다. Gemini 공식 문서는 headless 초기 인증에 API key 또는
  Vertex AI 환경 자격증명을 사용하라고 한다.

## 선택지

1. 런타임 이름으로 클라이언에서 계속 분기한다 — 빠르지만 추가 방법과 출력 변경이 모두 UI 수정이 된다.
2. Mew가 공급자 OAuth client와 token store를 구현한다 — 토큰 소유·갱신·회수 책임을 불필요하게 가져온다.
3. 런타임 등록표가 고정 명령과 `browser | terminal` 표면을 선언하고, 공통 인증 작업이 상태를 중계한다.

## 결정

3번을 채택한다.

### 선언적 인증 방법

- `RuntimeAuthentication.methods()`는 한 런타임의 여러 고정 방법을 돌려준다. 각 방법은 id·이름·설명,
  서버 전용 spawn spec, `browser | terminal` 표면, browser일 때의 HTTPS host allowlist를 가진다.
- 브라우저에는 id·이름·설명·표면만 보낸다. 명령·인자·환경 변수·host allowlist는 서버에 남기고,
  HTTP요청으로 임의 명령이나 URL을 받지 않는다.
- ACP가 initialize된 경우에는 광고한 agent/API-key/terminal 방법을 우선한다. terminal 정보가 사라졌거나
  ACP 자체가 인증 전에 종료되면 등록표 방법 전체를 복구 경로로 보여 준다.
- 같은 인증을 ACP와 별도 CLI가 중복 광고하거나 구형 SDK가 실행 정보를 잃는 메서드는 `replaceMethodIds`로
  등록표 작업 하나로 치환한다. Codex `chat-gpt-device-code`, Kimi `login`, Cursor `cursor_login`,
  Hermes `hermes-setup`이 이 경로를 쓴다.

### 공통 인증 작업

- 작업 키는 runtime·tab·method id의 hash이며 tmux 세션과 0600 상태 파일을 쓴다. 완료된 세션을
  재시도할 때는 기존 pane과 만료 URL을 폐기하고 새 작업을 만든다.
- browser 표면은 클릭 즉시 빈 top-level 탭을 예약하고, CLI 출력에서 allowlist를 통과한 URL이 보이면
  그 탭을 이동시킨다. 일회용 코드가 별도면 Mew에 같이 표시하되 디스크·이벤트·전사에 저장하지 않는다.
- terminal 표면은 기존 Mew tmux 팝업을 열어 공급자 선택·비밀 입력·수동 코드 붙여넣기를 그대로 보존한다.
- 실패하면 exit code와 CLI의 마지막 오류 한 줄을 보여 준다. URL·token/key/secret/code 형태·일회용 코드를
  제거하고 길이를 제한한 뒤에만 HTTP로 보낸다.
- exit 0이면 tmux를 닫고 ACP를 재초기화한다. 실패·중단은 자동 재시작하지 않는다.

### 런타임 배치

| 런타임 | Mew 표면 | 공식 CLI 계약 |
| --- | --- | --- |
| Codex | browser | `codex login --device-auth`, `auth.openai.com` |
| Kimi Code | browser 2개 | `kimi login` (`.com`), `kimi login --region global` (`.ai`) |
| Cursor CLI | browser | `agent login` + `NO_OPEN_BROWSER=1`, `cursor.com` |
| Claude Code | terminal | ACP adapter `--cli`; subscription/Console 선택과 manual code를 보존 |
| Hermes | terminal | `hermes acp --setup`; 공급자·OAuth·API key·모델 선택 |
| Gemini CLI | terminal | `gemini --skip-trust`; Google/API key/Vertex 선택, headless 초기 인증은 env 계약 |
| OpenClaw | terminal | `openclaw onboard --tui`; 공급자 인증과 live completion 검증 |
| OpenCode | terminal | `opencode auth login`; 공급자 선택형 |
| Prime Agent | terminal | TUI `/login`; 공급자 선택형 |

## 근거

공급자 CLI가 토큰 발급·갱신·저장을 계속 소유하면 Mew는 상태 오케스트레이션만 담당한다.
표면을 런타임 이름이 아니라 메서드 메타데이터로 고르면 새 런타임·리전·인증 방법은 등록표에만 추가한다.
보안 경계는 기존처럼 owner/manager, 고정 명령, HTTPS host allowlist, 비밀값 비영속으로 유지된다.

## 결과

- 화면은 런타임 이름을 모르고 `surface` 하나로 외부 브라우저 또는 Mew 터미널을 연다.
- Codex·Kimi·Cursor는 링크 준비, 외부 브라우저 이동, 완료 감지, ACP 재연결이 한 흐름으로 된다.
- 대화형 런타임도 같은 인증 작업 상태를 쓰되 공식 선택·입력 UX를 손실하지 않는다.
- 새 브라우저형 인증은 고정 명령과 최소 host allowlist를 등록하고 출력 parser 회귀 테스트를 추가해야 한다.
