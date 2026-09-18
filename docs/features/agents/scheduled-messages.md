---
id: "mew-agents-scheduled-messages"
parent: "mew-agents"
title: "에이전트 예약 메시지"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-18"
status_hash: "333669f522d259fe25acbfd4326c1e55deca98f9f89df6cb5443d61057d19e0a"
files: ["src/components/AgentPanel.tsx", "server/agentScheduledPrompts.ts"]
commits: []
---

## 요구사항

현재 에이전트 세션에 나중에 한 번 보낼 메시지를 등록한다.

### 범위

- 예약 시각·메시지 등록과 내용/시각 수정·삭제, 원래 세션의 큐 실행을 제공한다.

### 경계와 제한

독립 작업을 반복 실행하는 cron 예약 작업과 다르다. 실행 시 원래 세션을 복원하고 바쁘면 큐 뒤에 들어간다.

### 상세 계약

[예약 메시지 명세](../../specs/agent-scheduled-prompts.md) · [터미널·에이전트 사용법](../../guides/terminal-agents.md)

상위: [분야 지도](MOC.md) · [상위 기능](../agents.md).

<!-- mew:implementation:start -->
## 구현 내용

예약 시각·메시지 등록과 내용/시각 수정·삭제, 원래 세션의 큐 실행을 제공한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다: 브라우저를 닫았다 돌아와도 예약이 남고 수정·취소가 반영되며 원래 세션으로 전달되는지 확인한다.

<!-- mew:validation:end -->
