---
id: "mew-agents-conversations"
parent: "mew-agents"
title: "에이전트 대화·큐·복원"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-18"
status_hash: "b325d279cf16e291b2bcddda7cc0d70268647e336403acba780cb1081da44668"
files: ["src/components/AgentPanel.tsx", "server/agentHost.ts", "server/agentWs.ts", "server/agentTranscript.ts"]
commits: []
---

## 요구사항

작업을 보내고 진행·중단·대기열·이전 대화를 관리한다.

### 범위

- 메시지 전송·중단·작업 기록·대기 메시지 편집/순서 변경·/clear와 히스토리 복원을 제공한다.
- 독립 감독과 전사를 통해 브라우저·프로젝트 전환 뒤 대화를 이어 간다.

### 경계와 제한

패널 닫기와 탭 세션 종료를 구분한다. 히스토리·외부 CLI 이어쓰기와 런타임별 복원 지원은 세션 계약을 따른다.

### 상세 계약

[터미널·에이전트 사용법](../../guides/terminal-agents.md) · [감독·큐·복원 계약](../../development/agent-sessions.md) · [대화 표시 명세](../../specs/agent-panel.md)

상위: [분야 지도](MOC.md) · [상위 기능](../agents.md).

<!-- mew:implementation:start -->
## 구현 내용

메시지 전송·중단·작업 기록·대기 메시지 편집/순서 변경·/clear와 히스토리 복원을 제공한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다: 작업 중 화면 전환·재접속 시 중복 전송 없이 전사와 대기 순서가 보존되는지 확인한다.

<!-- mew:validation:end -->
