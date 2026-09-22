---
id: "mew-agents-presets"
parent: "mew-agents"
title: "에이전트셋·탭 생성"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-22"
status_hash: "3e9a3293848b77d07af2e0bbeb65a930bb54c18ce2da6a1b7543c145fb06a0b9"
files: ["src/components/AgentPanel.tsx", "src/components/AgentSetPicker.tsx", "server/agentSets.ts", "server/agentCwd.ts"]
commits: []
---

## 요구사항

반복 사용하는 런타임·모델·역할을 프리셋으로 저장해 탭을 연다.

### 범위

- 에이전트셋 생성·편집·선택과 프로젝트별 탭·탭 이름 관리를 제공한다.
- 에이전트 탭이 없으면 `+` 선택 화면으로 바로 시작한다. 기존 탭은 복원하고 런타임·셋 선택 후에만 새 탭을 만든다.
- Git의 AI Commit에서도 기존 셋을 선택하거나 새로 생성해 커밋 초안 작업에 사용한다.

### 경계와 제한

셋은 런타임·모델·역할 프리셋이며 자동 작업 원장이나 기능 분류 규칙의 소유자가 아니다. 새 탭은 cwd 검증과 사용자 선택이 끝난 뒤 생성한다. AI Commit은 셋의 스냅샷을 별도 작업으로 실행하며 기존 대화·탭에 요청을 보내지 않는다.

### 상세 계약

[터미널·에이전트 사용법](../../guides/terminal-agents.md)

상위: [분야 지도](MOC.md) · [상위 기능](../agents.md).

<!-- mew:implementation:start -->
## 구현 내용

에이전트셋 생성·편집·선택과 프로젝트별 탭·탭 이름 관리를 제공한다.
AI Commit에서도 같은 선택기와 생성 폼을 재사용하고 신규 셋 저장 후 바로 선택한다. 조작은 [Git 사용법](../../guides/projects.md#git-작업-패널)을 따른다.
생성·편집 폼은 공통 모달의 포커스·닫기 동작을 사용하고 저장 오류를 폼 안에서 표시한다. 저장 중 중복 제출을 막으며 일반 HTTP에서도 셋 ID를 생성한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다: 셋을 수정해도 이미 접수한 기능 요청의 스냅샷이 바뀌지 않고 새 탭에만 원하는 설정이 적용되는지 확인한다.

<!-- mew:validation:end -->
