---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: mew의 OAuth 에이전트 로그인은 외부 브라우저를 우선한다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0116 — mew의 OAuth 에이전트 로그인은 외부 브라우저를 우선한다"
created: 2026-09-05
updated: 2026-09-11
---

- 날짜: 2026-09-05
- 상태: 채택
- 후속 결정: [0117](0117-mew-terminal-agent-tabs-for-claude-and-antigravity.md) — Claude 별도 browser 인증·Gemini 런타임
- 후속 결정: [0128](0128-mew-browser-oauth-uses-internal-browser.md) — OAuth 외부 기기 탭; CLI의 토큰 소유·비밀 비저장은 유지
- 부분 대체: [0110](0110-mew-declarative-agent-authentication-jobs.md) — Claude Code·Gemini CLI를 terminal 표면으로 고정한 배치를 외부 브라우저 + 일회용 코드 반환 흐름으로 바꾼다.
- 결정자: 송상훈 (지시), Codex (설계·구현)

## 배경

[ADR 0110](0110-mew-declarative-agent-authentication-jobs.md)은 URL을 바로 출력하는 Codex·Kimi·Cursor만
브라우저형으로 두고 Claude Code와 Gemini CLI는 터미널형으로 남겼다. 그러나 현재 Claude Code는
`claude auth login --claudeai|--console`로 계정 종류를 명령에서 고를 수 있고, Gemini CLI는
`NO_BROWSER=true`에서 Google OAuth URL과 수동 승인 코드 입력을 제공한다. 두 흐름 모두 공급자 선택용
TUI를 생략할 수 있으므로 로그인 때문에 Mew 터미널 전체를 노출할 필요가 없다.

Gemini CLI의 수동 OAuth는 인증 완료 뒤 일반 TUI로 진입해 프로세스가 끝나지 않는다. 따라서 명령의 exit
code만 기다리면 인증이 끝났어도 에이전트 연결을 재개하지 못한다.

## 선택지

1. Claude·Gemini를 계속 terminal로 둔다 — 구현은 유지되지만 같은 OAuth 작업의 UX가 런타임마다 갈린다.
2. Mew가 공급자 OAuth client와 토큰 교환을 직접 구현한다 — 공급자 CLI의 토큰 책임과 보안 경계를 복제한다.
3. 공급자 CLI를 고정 browser 작업으로 실행하고, 필요할 때만 승인 코드를 실행 중인 TTY에 돌려준다.

## 결정

3번을 채택한다.

- Claude 구독, Anthropic Console, Codex, Gemini Google, Kimi `.com`·`.ai`, Cursor OAuth를 browser 표면으로
  선언한다. 클릭하면 접속 중인 기기의 일반 top-level 브라우저를 열며 Mew 내부 브라우저와 iframe은 쓰지 않는다.
- Claude는 어댑터가 번들한 공식 CLI를 `--cli auth login --claudeai` 또는 `--cli auth login --console`로
  직접 실행한다. Gemini는 별도 system settings 파일로 `oauth-personal`만 선택하고 `NO_BROWSER=true`의
  manual authorization을 실행한다.
- 공급자 페이지가 승인 코드를 표시하는 Claude·Gemini에는 인증 센터의 비밀번호형 입력란을 제공한다.
  서버는 owner·manager 요청인지, 등록표의 browser 작업인지, 해당 방법이 코드 입력을 선언했는지 확인한 뒤
  최대 4096자의 제어 문자 없는 한 줄을 tmux pane에 literal input으로 전달하고 Enter를 보낸다.
- 승인 코드는 상태 파일·로그·에이전트 이벤트·전사에 저장하지 않는다. 브라우저에는 고정 method id와 입력 필요
  여부만 보내며 실행 명령·allowlist·완료 파일 경로는 계속 서버에 둔다.
- Gemini는 기본 자격증명 파일 `~/.gemini/oauth_creds.json`의 인증 작업 시작 전후 변경을 완료 신호로 쓴다.
  파일 내용은 읽지 않는다. 변경을 확인하면 남은 TUI tmux를 닫고, 이미 떠 있는 ACP에 등록표가 고정한
  `oauth-personal` authenticate를 호출한다. ACP가 캐시된 자격증명을 확인하고 사용자 설정에 선택 방식을 기록한
  뒤 같은 연결에서 세션을 만든다. 브라우저가 보낸 method id를 ACP id로 직접 쓰지 않는다.
- 런타임 로그인 하나가 특정 OAuth로 고정되지 않고 공급자·키·모델 선택이 먼저인
  Hermes·OpenClaw·OpenCode·Prime의 공통 설정 진입점은 terminal 표면을 유지한다. API key·Vertex·gateway처럼
  OAuth가 아닌 방법도 기존 ACP/UI 경로를 유지한다.
- browser URL은 런타임별 최소 HTTPS host allowlist를 통과해야 한다. Claude는 `claude.com`과
  `platform.claude.com`, Gemini는 `accounts.google.com`만 허용한다.

공식 계약은 [Claude Code 인증](https://docs.anthropic.com/en/docs/claude-code/getting-started),
[Gemini CLI 인증](https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/authentication.mdx),
[Codex 인증](https://learn.chatgpt.com/docs/auth)을 기준으로 한다.

## 근거

Mew는 OAuth client·refresh token 교환을 소유하지 않고 공급자 CLI의 인증 구현을 그대로 쓴다. 동시에 사용자는
에이전트 대화 화면에서 벗어나 터미널 TUI를 조작하지 않아도 된다. 코드 반환 API는 임의 명령을 받지 않고 이미
실행 중인 고정 인증 작업에만 한 줄을 전달하므로 기존 owner·manager 셸 경계를 넓히지 않는다.

## 결과

- OAuth 종류를 명령에서 확정할 수 있는 등록 런타임은 모두 같은 외부 브라우저 UX를 쓴다.
- Gemini 인증 완료는 CLI 종료가 아니라 자격증명 파일 변경으로도 감지한다. encrypted credential storage처럼
  기본 파일을 쓰지 않는 별도 운영 설정에서는 CLI가 스스로 종료하지 않으므로 terminal 대체 경로가 필요할 수 있다.
- Gemini의 ACP 인증 확정 단계가 사용자 설정까지 갱신하므로, 다음 세션도 Google OAuth를 선택하면서 ACP의
  API key·Vertex·gateway 방법은 별도 선택지로 남는다.
