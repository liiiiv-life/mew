---
id: "mew-agents-presets"
parent: "mew-agents"
title: "에이전트셋·탭 생성"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-18"
status_hash: "3e9a3293848b77d07af2e0bbeb65a930bb54c18ce2da6a1b7543c145fb06a0b9"
files: ["src/components/AgentSetPicker.tsx", "server/agentSets.ts", "server/agentCwd.ts"]
commits: []
---

## 요구사항

반복 사용하는 런타임·모델·역할을 프리셋으로 저장해 탭을 연다.

### 범위

- 에이전트셋 생성·편집·선택과 프로젝트별 탭·탭 이름 관리를 제공한다.

### 경계와 제한

셋은 탭 시작 프리셋이며 자동 작업 원장이나 기능 분류 규칙의 소유자가 아니다. 새 탭은 cwd 검증과 사용자 선택이 끝난 뒤 생성한다.

### 상세 계약

[터미널·에이전트 사용법](../../guides/terminal-agents.md)

상위: [분야 지도](MOC.md) · [상위 기능](../agents.md).

<!-- mew:implementation:start -->
## 구현 내용

에이전트셋 생성·편집·선택과 프로젝트별 탭·탭 이름 관리를 제공한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다: 셋을 수정해도 이미 접수한 기능 요청의 스냅샷이 바뀌지 않고 새 탭에만 원하는 설정이 적용되는지 확인한다.

<!-- mew:validation:end -->
