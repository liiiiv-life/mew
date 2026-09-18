---
id: "mew-agents-terminal"
parent: "mew-agents"
title: "tmux 셸 터미널"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-18"
status_hash: "b19a2771f0bfb2f727bc14539350c69b524d222b67a2322b322f359fefd6a804"
files: ["src/components/AgentPanel.tsx", "src/components/TermButtonBar.tsx", "server/termButtons.ts", "packages/tmux-term/src/TmuxTerminal.tsx", "packages/tmux-term/src/server/tmuxWs.ts"]
commits: []
---

## 요구사항

프로젝트 작업용 셸을 열고 연결을 이어 간다.

### 범위

- 일반 셸 탭 생성·재연결·입력·세션 종료와 터미널 명령 버튼을 제공한다.

### 경계와 제한

일반 셸과 공식 에이전트 TUI는 서로 다른 패널에 속한다. 패널을 닫는 것과 세션을 종료하는 것은 다르며 서버 OS 권한으로 실행한다.

### 상세 계약

[터미널·에이전트 사용법](../../guides/terminal-agents.md) · [명령·예약 작업](../../guides/commands.md)

상위: [분야 지도](MOC.md) · [상위 기능](../agents.md).

<!-- mew:implementation:start -->
## 구현 내용

일반 셸 탭 생성·재연결·입력·세션 종료와 터미널 명령 버튼을 제공한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다: 연결을 다시 열어도 셸이 유지되고 명령 버튼이 현재 탭에만 입력되는지 확인한다.

<!-- mew:validation:end -->
