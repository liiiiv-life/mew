---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: Claude Code와 Antigravity는 에이전트 탭에서 tmux TUI로 실행한다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0117 — Claude Code와 Antigravity는 에이전트 탭에서 tmux TUI로 실행한다"
created: 2026-09-07
updated: 2026-09-11
---

- 날짜: 2026-09-07
- 상태: 채택
- 후속 결정: [0119](0119-mew-unified-terminal-agent-panel.md) — 별도 터미널 패널·일반 셸 탭 배치
- 후속 결정: [0142](0142-mew-claude-acp-and-cli-authentication.md) — Claude 대화형 ACP 복원·공식 CLI 인증; Antigravity·Gemini 범위 유지
- 후속 결정: [0143](0143-mew-antigravity-official-acp.md) — Antigravity 공식 ACP 전환; Gemini 제거 경계 유지
- 부분 대체: [0034](0034-mew-agent-panel-acp-reintroduction.md) — 모든 에이전트 창이 ACP 채팅 UI여야 한다는 범위에서 Claude Code·Antigravity를 제외
- 부분 대체: [0060](0060-mew-shared-agent-runtime-registry.md) — 대화형 에이전트 탭의 실행 표면을 ACP 하나에서 `acp | terminal`로 확장
- 부분 대체: [0061](0061-mew-claude-acp-official-org-migration.md) — Claude Code의 대화형 탭은 ACP 어댑터 대신 공식 CLI를 직접 실행; 예약 작업의 ACP 실행은 유지
- 부분 대체: [0116](0116-mew-oauth-agent-logins-use-external-browser.md) — Claude의 별도 브라우저 인증 작업을 없애고 공식 TUI 안 인증으로 귀속; Gemini 개인 OAuth 경로는 런타임과 함께 제거
- 결정자: 송상훈 (지시), Codex (설계·구현)

## 배경

Google은 2026-06-18부터 Gemini CLI의 개인·AI Pro·Ultra 계정 요청을 중단하고 개인용 터미널 경험을
Antigravity CLI로 이전했다. Mew의 Gemini 런타임은 중단된 `oauth-personal` 경로를 기본 로그인으로
제공해, 브라우저 승인이 성공해도 지원 종료 오류로 끝났다. Enterprise·Google Cloud·API key 사용은
남았지만 현재 Mew의 개인용 운영 범위에는 구체적인 수요가 없다.

Claude Code와 Antigravity는 공식 제품 자체가 대화형 TUI다. 이를 제3자 ACP 채팅 화면으로 다시 그리면
공식 CLI의 세션·슬래시 명령·인증·새 기능을 계속 번역해야 한다. Antigravity의 제3자 ACP 연결은 현재
제품 경계로 채택하지 않으며, 공식 `agy` TUI를 터미널에서 직접 쓰는 경로만 지원한다.

공식 근거는 [Gemini CLI 개인 계정 종료](https://github.com/google-gemini/gemini-cli/discussions/28017)와
[Antigravity CLI](https://github.com/google-antigravity/antigravity-cli)의 설치·실행 계약이다.

## 선택지

1. Gemini를 Enterprise/API key 전용으로 남기고 Claude·Antigravity도 ACP로 연결 — 현재 개인 사용자는 죽은 Gemini 경로를 계속 보고, 공식 TUI 기능을 별도 UI가 뒤쫓아야 한다.
2. Claude·Antigravity를 일반 터미널 패널에서만 수동 실행 — 정책은 안전하지만 에이전트 선택·탭 복원과 분리된다.
3. 에이전트 탭의 실행 표면을 런타임별로 나누고 두 공식 CLI를 전용 tmux에 직접 실행 — 에이전트 진입점은 유지하면서 TUI를 변형하지 않는다.

## 결정

3번을 채택한다.

- Gemini CLI는 서버·클라이언트 런타임 등록표, 설치·인증 UI와 문서에서 제거한다. 전역에 이미 설치된
  `gemini` 바이너리나 사용자 자격증명은 Mew가 임의 삭제하지 않는다. Enterprise/API key 지원 요구가
  실제로 생기기 전에는 재추가하지 않는다.
- `claude`와 새 `antigravity` 런타임의 대화형 표면은 `terminal`이다. 에이전트 탭을 열면 탭별 전용 tmux
  세션을 cwd에서 만들고 각각 공식 `claude`, `agy` 명령을 실행한다.
- terminal 런타임의 탭 본문은 기존 `@mew/tmux-term`의 `TmuxTerminal`을 그대로 쓴다. 별도 채팅 도구줄,
  메시지 버블, 모델·권한 선택기, 인증 센터를 겹쳐 그리지 않는다. 따라서 화면·입력·모바일 키·스크롤·
  재접속 동작은 일반 터미널 탭과 같다.
- 에이전트 탭을 닫으면 해당 tmux 세션과 CLI를 종료한다. 에이전트 패널만 닫거나 브라우저가 끊기면
  tmux는 남아 있고 같은 저장 탭을 다시 열 때 재접속한다.
- 전용 세션 이름은 서버가 runtime·tab id로 만들며 일반 터미널 탭 목록에서는 숨긴다. 브라우저가 실행
  명령이나 세션 이름을 정하지 않으며, 시작 API는 등록표의 고정 명령과 검증된 cwd만 사용한다.
- Antigravity는 공식 설치 스크립트와 `agy`만 등록한다. ACP spawn spec·에이전트셋·예약 실행 대상으로
  광고하지 않는다.
- Claude의 대화형 탭에서는 공식 TUI를 쓰지만, 이미 존재하는 예약 작업의 일회성 ACP runner는 유지한다.
  이는 사람이 조작하는 탭 표면을 바꾸는 결정이며 무인 작업 프로토콜을 함께 교체하는 결정은 아니다.
- 기존에 계정/브라우저에 저장된 Gemini 탭은 복원 시 제거한다. 그 탭의 과거 ACP 세션 파일은 자동
  삭제하지 않는다.

## 근거

tmux는 두 공식 CLI가 가정하는 실제 TTY, 지속 세션, 키 입력을 그대로 제공한다. 기존 터미널 렌더러를
재사용하면 CLI의 새 모델·명령·로그인 흐름이 바뀌어도 Mew가 프로토콜과 화면을 다시 구현하지 않는다.
동시에 전용 세션 생성은 런타임 id 외의 명령을 HTTP로 받지 않는 기존 보안 경계를 유지한다.

Gemini의 전역 제거까지 Mew가 수행하지 않는 이유는 사용자가 별도로 Enterprise/API key 용도로 설치했을
수 있고, Mew 런타임 제거가 사용자 홈의 도구·자격증명을 삭제할 권한은 아니기 때문이다.

## 결과

- Claude·Antigravity 탭은 ACP 히스토리·예약 메시지·에이전트셋 프리셋을 제공하지 않는다. 각 공식 TUI의
  자체 세션·명령을 사용한다.
- Claude의 런타임 설정에서 실행 파일·추가 인자는 대화형 CLI에 적용한다. 예약 작업용 ACP 어댑터의
  고정 실행 계약은 별도로 유지한다.
- terminal 전용 런타임을 무인 예약 대상으로 확장하려면 공식 headless 계약과 인증·종료 조건을 검토한
  후 별도 결정을 쓴다.
