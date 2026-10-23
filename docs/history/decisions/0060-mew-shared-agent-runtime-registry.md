---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: mew 에이전트 런타임은 창·셋·예약 작업이 공유하는 등록표다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0060 — mew 에이전트 런타임은 창·셋·예약 작업이 공유하는 등록표다"
created: 2026-08-20
updated: 2026-09-11
---

- 날짜: 2026-08-20
- 상태: 채택
- 후속 결정: [0117](0117-mew-terminal-agent-tabs-for-claude-and-antigravity.md) — ACP 전용 표면·Gemini 등록
- 후속 결정: [0123](0123-mew-codex-acp-uses-host-cli.md) — Codex 어댑터 엔진 선택
- 결정자: 송상훈 (지시)

## 배경

[ADR 0043](0043-mew-agent-workspace-scope-and-runtimes.md)은 에이전트 창의 런타임 축을 `claude`·`codex`·`hermes`
등록표로 열었다. [ADR 0052](0052-mew-agent-sets-router-dispatch.md)은 에이전트셋도 같은 세션/런타임 경로를
쓴다고 했다.

하지만 예약 작업(`schedules.ts`)은 별도 구현이었다. `claude`·`hermes`만 하드코딩했고, 무인 실행 명령도
각 CLI별 문자열 템플릿이었다. 그래서 에이전트 창에서는 Codex를 고를 수 있는데 크론탭에서는 고를 수 없는
상태가 됐다. 런타임이 화면별로 갈라진 신호다.

## 선택지

1. 예약 작업에 `codex` 명령만 추가 — 빠르지만 다음 런타임마다 같은 문제가 반복된다.
2. 런타임별 headless CLI 템플릿 registry — 크론은 좋아지지만 에이전트 창/셋의 ACP 경로와 여전히 갈라진다.
3. 공통 ACP 런타임 registry + 예약 작업도 일회성 ACP runner 사용 — 모든 표면이 같은 런타임 정의를 본다.

## 결정

3번 채택. mew의 에이전트 런타임 정의는 `server/agentRuntimes.ts` 하나다. 에이전트 창, 에이전트셋,
예약 작업은 모두 이 등록표의 ACP spawn spec을 쓴다.

예약 작업은 더 이상 런타임별 CLI 템플릿을 직접 만들지 않는다. 크론 줄은 잡 전용 tmux 세션을 띄운 뒤
`server/runAgentJob.ts`를 실행한다. 이 runner가 `--runtime`·`--prompt-file`·`--log-file`·`--cwd`를 받아
ACP 세션을 일회성으로 만들고 프롬프트 한 턴을 끝까지 실행한다.

초기 등록 런타임은 `claude`·`codex`·`hermes`·`kimi`·`gemini`·`openclaw`·`opencode`·`cursor`다. 공식 ACP
진입점이나 실제 설치 경로가 다른 경우에는 `MEW_AGENT_<ID>_CMD`·`MEW_AGENT_<ID>_ARGS`로 덮어쓴다.

## 근거

- 예약 작업도 결국 “정해진 시각에 ACP 에이전트에게 프롬프트를 보낸다”는 일이다. UI별로 다른 실행 경로를 두면
  지원 런타임과 권한 모드가 다시 어긋난다.
- ACP를 공통 경계로 유지하면 세션 생성, 모드 적용, permission 처리, 로그 스트리밍, 런타임 검증이 한 코드 경로에
  모인다.
- 크론은 여전히 tmux 세션을 만든다. 따라서 무인 실행 화면을 나중에 터미널 팝업으로 들여다보는 기존 운영 방식은
  유지된다.

## 결과

- 런타임을 추가할 때 서버는 `agentRuntimes.ts`, 클라이언트는 아이콘용 `src/components/agentRuntimes.tsx`만
  바꾸면 된다.
- ACP를 말하지 않는 런타임은 목록에 있어도 실행 시 핸드셰이크 실패로 드러난다. 감추려면 매번 실행해 봐야 하므로
  감추지 않는다.
- 예약 작업의 “프로젝트” 필드는 runner의 ACP `cwd`가 된다. 빈 값이면 워크스페이스 루트다.
