---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: mew 에이전트 인증을 GUI에서 이어간다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0072 — mew 에이전트 인증을 GUI에서 이어간다"
created: 2026-08-21
updated: 2026-09-11
---

- 날짜: 2026-08-21
- 상태: 채택
- 후속 결정: [0110](0110-mew-declarative-agent-authentication-jobs.md) — 단일 terminal auth를 선언적 다중 인증 작업으로 확장
- 후속 결정: [0117](0117-mew-terminal-agent-tabs-for-claude-and-antigravity.md) — Claude·Gemini 대화형 인증 배치
- 후속 결정: [0121](0121-mew-codex-oauth-through-scoped-server-browser.md) — Codex device-code 기본값
- 후속 결정: [0128](0128-mew-browser-oauth-uses-internal-browser.md) — ACP URL 인증의 외부 탭 열기
- 부분 대체: 0044 — `clientCapabilities`를 비워 두던 범위 중 인증 capability만 연다. `fs` 미광고와 CLI 도구 동등성은 유지한다.
- 결정자: 송상훈 (지시), Codex (구현)
- 관련: [ADR 0034](0034-mew-agent-panel-acp-reintroduction.md), [ADR 0061](0061-mew-claude-acp-official-org-migration.md), [ADR 0062](0062-mew-agent-tab-runtime-gate-and-install.md)

## 배경

런타임 설치 성공은 실행 파일이 있다는 뜻일 뿐, Claude·Codex·Gemini 등 공급자 계정 인증까지 끝났다는
뜻은 아니다.
기존 에이전트 창은 ACP `initialize` 직후 `session/new`가 인증 오류를 내면 연결을 fatal로 닫아, 사용자가
Mew 밖의 서버 터미널에서 로그인한 뒤 탭을 다시 열어야 했다. 서버와 브라우저가 다른 기기일 때 서버가
직접 OAuth 브라우저를 여는 방식도 사용자 화면에 나타나지 않는다.

ACP 어댑터는 일반 인증, API 키, URL elicitation, terminal auth를 서로 다른 방법으로 광고한다. Mew는
이 차이를 보존하면서도 비밀값과 실행 명령을 브라우저에 불필요하게 노출하지 않을 경계가 필요하다.
또 Hermes·Kimi처럼 최신 terminal auth 필드를 쓰지만 Mew의 직접 SDK 0.14가 그 필드를 지우는 경우,
Cursor처럼 로그인 명령만 안내하는 경우, 인증 전에 ACP 프로세스 자체가 종료되는 경우도 있다. ACP가
정상 initialize됐다는 가정만으로는 등록된 런타임 전체를 복구할 수 없다.

## 선택지

1. 설치 뒤 별도 터미널 로그인을 안내한다 — 구현은 단순하지만 에이전트 창 안에서 흐름이 끊기고 원격 접속에서 어렵다.
2. Mew 자체 OAuth 서버와 토큰 저장소를 만든다 — UI는 일관되지만 각 공급자 인증을 중복 구현하고 장기 자격증명을 새로 소유한다.
3. ACP가 광고한 인증 방법을 에이전트 창에서 중계한다 — 어댑터가 공급자 인증을 소유하고 Mew는 상태·사용자 동작만 연결한다.
4. ACP 인증을 우선하고, 런타임 등록표의 고정 terminal auth를 공통 복구 경로로 둔다 — 표준 흐름을
   보존하면서 pre-ACP 실패와 SDK 세대 차이를 흡수한다.

## 결정

4번을 채택한다.

### 상태와 세션

- `initialize`가 반환한 `authMethods`를 세션에 보관한다. 이어지는 `session/new`가 인증 필요 오류를 내면
  프로세스와 ACP 연결을 닫지 않고 `auth` 상태로 전환한다.
- ACP 일반/API-key 로그인 성공 뒤 같은 연결에서 `session/new`를 다시 호출하고, 성공해야
  대화·히스토리·입력 UI로 넘어간다. 대화 중 자격증명이 만료돼 같은 오류가 나도 로그인 상태로 돌아간다.
- ACP가 `initialize` 전에 종료되거나 실행되지 않으면 탭 감독 프로세스와 유닉스 소켓은 살려 둔다. 감독이
  런타임 등록표의 terminal auth 하나와 시작 오류를 `auth` 상태로 보내고, 완료 확인을 받으면 ACP를 새로
  spawn·initialize한다. 자식 종료는 SDK의 stdio EOF 처리에 기대지 않고 즉시 핸드셰이크 실패로 전환한다.
- 브라우저에는 방법의 id·이름·설명·종류만 보낸다. API 키와 terminal 실행 spec은 이벤트·재생 버퍼에 넣지 않는다.

### 인증 방법

- 일반 ACP 방법은 `authenticate`로 돌린다. URL elicitation이 오면 URL 전체와 호스트를 화면에 보여 주고,
  사용자가 **로그인 페이지 열기**를 눌러야 새 탭을 연 뒤 `accept`를 응답한다. HTTPS만 허용하며 개발용
  loopback HTTP만 예외로 둔다.
- API 키는 비밀번호 입력으로 한 번 받아 ACP 요청의 `_meta["api-key"]`에만 싣는다. Mew 저장소·로그·이벤트에
  저장하지 않는다. wire shape는 런타임 등록표가 소유한다. Codex 계열은 `{apiKey: 값}`, Gemini ACP는
  문자열 자체를 요구하므로 같은 payload를 모든 런타임에 적용하지 않는다.
- terminal auth는 어댑터의 `_meta["terminal-auth"]`가 광고한 고정 명령을 서버 세션에만 보관한다.
  manager·owner가 Mew의 tmux 팝업에서 실행하면 실제 명령의 exit code만 `<DATA_DIR>/agent-auth`에
  원자적으로 기록한다. GUI는 팝업을 닫아도 상태를 감시하고 `0`일 때만 기존 ACP를 버리고 새로 initialize한다.
  실패·취소·강제 종료는 재시작하지 않고 터미널과 오류 상태를 남긴다. 사용자의 수동 완료 버튼이 아직
  polling 중인 device-code 명령을 죽이는 경합을 만들지 않는다. 별도 terminal 프로세스 종료 뒤 연결을 다시
  세우라는 ACP 계약을 따르고, 살아 있는 어댑터가 설정을 캐시해 로그인 결과를 놓치는 경우도 막는다.
  HTTP 요청은 runtime·tab·method id만 받고 임의 명령이나 인자는 받지 않는다.
- Codex 자식에는 기본 `NO_BROWSER=1`을 주어 서버 쪽 localhost 브라우저 로그인을 감추고 ACP URL
  elicitation 기반 device-code 방법을 사용한다. 운영자가 이미 `NO_BROWSER`를 지정했다면 그 값을 존중한다.

### 런타임 등록표의 복구 명령

| 런타임 | terminal auth | 비고 |
| --- | --- | --- |
| Claude Code | 어댑터 `--cli` | 어댑터가 더 구체적인 terminal 방법을 광고하면 그것을 우선한다 |
| Codex | 번들 `codex login --device-auth` | API key·ACP device-code도 계속 제공한다 |
| Hermes | `hermes acp --setup` | SDK에서 사라진 `hermes-setup` terminal 방법을 치환한다 |
| Kimi Code | `kimi login` | RFC 8628 device-code 흐름 |
| Gemini CLI | `gemini --skip-trust` + `NO_BROWSER=true` | Google/Vertex/gateway 선택은 터미널, Gemini API key는 GUI 입력 |
| OpenClaw | `openclaw onboard --tui` | 공급자 인증과 게이트웨이 설정을 함께 검증한다 |
| OpenCode | `opencode auth login` | 공급자 선택형 로그인 |
| Cursor CLI | `agent login` + `NO_OPEN_BROWSER=1` | `cursor_login` 안내 방법을 terminal로 치환한다 |

### capability와 호환 경계

- 클라이언트는 `auth.terminal`, `elicitation.url`, 호환용 `_meta["terminal-auth"]`만 광고한다. `fs`는 계속
  광고하지 않아 ADR 0044의 CLI Read·Write·Edit 동등성을 유지한다.
- 현재 직접 SDK 0.14가 모르는 URL elicitation 메서드는 ACP 확장 메서드 통로로 받는다. SDK 전체를 올리며
  모델·모드 계약까지 동시에 이관하지 않는다. 이후 SDK 이관은 별도 결정과 회귀 검증으로 다룬다.
- SDK 0.14가 modern terminal auth의 `type`·`args`를 보존하지 못하는 런타임은 등록표에서 해당 method id를
  치환한다. 어떤 ACP 방법도 terminal로 정규화되지 않으면 공통 복구 방법을 하나 덧붙인다.

### 확인한 upstream 계약

- ACP terminal auth는 클라이언트가 별도 대화형 프로세스를 실행하고 종료 뒤 ACP 연결을 다시 초기화한다:
  [ACP Authentication](https://agentclientprotocol.com/protocol/v1/authentication)
- Gemini의 정식 ACP 진입점은 `gemini --acp`이며 인증은 Google 로그인·Gemini API key·Vertex AI 등을
  지원한다: [ACP mode](https://geminicli.com/docs/cli/acp-mode/),
  [Authentication](https://geminicli.com/docs/get-started/authentication/)
- 각 CLI의 로그인 진입점은 공급자 문서를 따른다:
  [Codex authentication](https://learn.chatgpt.com/docs/auth),
  [Kimi CLI](https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/reference/kimi-command.md),
  [OpenCode CLI](https://opencode.ai/docs/cli/),
  [OpenClaw onboard](https://docs.openclaw.ai/cli/onboard),
  [Cursor authentication](https://docs.cursor.com/en/cli/reference/authentication)

## 근거

- 인증 토큰의 발급·갱신·저장 책임이 각 CLI/ACP 어댑터에 남아 공급자별 구현이 Mew에 복제되지 않는다.
- 서버 브라우저 자동 실행 대신 접속한 사용자의 명시적 클릭을 요구해 원격 배포에서도 로그인 위치가 분명하다.
- terminal 명령을 서버가 광고되었거나 등록표에 선언된 spec으로 고정하면 기존 owner/manager 셸 경계를
  유지하면서 HTTP 명령 주입 표면을 만들지 않는다.

## 결과

- 설치 직후 인증되지 않은 등록 런타임 8개 모두 에이전트 탭 안에서 로그인/초기 설정하고 새 세션을 시작할
  수 있다. ACP가 인증 전에 뜨지 않아도 별도 서버 터미널로 나가지 않는다.
- 장기 자격증명은 각 CLI의 기존 저장소에 남는다. Mew는 입력받은 API 키를 영속화하지 않는다.
