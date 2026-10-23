---
id: "mew-agents-harness"
parent: "mew-agents"
title: "스킬·MCP 원본 관리"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-25"
status_hash: "b9b25fb50a126dd475ca2e6bae99f42419f210afd46114df41118c8d3543c502"
files: ["src/components/agent-harness-modal.tsx", "server/agent-harness.ts", "server/harness-config.ts"]
commits: []
description: "전역·프로젝트·하위 프로젝트의 스킬과 MCP 원본 설정 검색·생성·수정·이동·삭제를 다루는 기능 계약. 시스템·플러그인 캐시·심볼릭 링크의 읽기 전용 경계와 런타임 적용 한계를 설명한다."
상위파일:
  - "MOC.md"
  - "_터미널·에이전트·자동화.md"
---

## 요구사항

- 에이전트별 스킬과 MCP 설정을 소유 범위에 맞게 관리한다.

### 범위

- 전역·프로젝트·하위 프로젝트의 스킬/MCP를 조회·검색·생성·수정·이동·삭제한다.

### 경계와 제한

- 패키지·시스템·플러그인 캐시·심볼릭 링크의 읽기 전용 경계를 지킨다.
- 관리창은 MCP를 실행하거나 세션을 재시작하지 않으며 네이티브 런타임 적용을 보장하지 않는다.

### 상세 계약

- [원본 위치·충돌·적용 계약](../../configuration/agent-harness.md)

<!-- mew:implementation:start -->
## 구현 내용

- 전역·프로젝트·하위 프로젝트의 스킬/MCP를 조회·검색·생성·수정·이동·삭제한다.
- 스코프·에이전트 필터와 추가·이동 대상 선택은 공용 자체 드롭다운을 사용한다.
- Mew 전용 commit 스킬 파일을 조회·편집하며 모든 런타임의 `/commit`과 Git 자동 커밋이 공유한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

- 아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다:
  - 범위·런타임·원본 경로가 맞고 외부 수정 충돌에서 기존 내용과 사용자 초안이 보존되는지 확인한다.
- 데스크톱·모바일에서 자체 선택 목록의 키보드·터치 선택, 화면 경계, Esc 우선 닫기와 필터 변경 취소 시 초안 보존을 확인한다.

<!-- mew:validation:end -->
