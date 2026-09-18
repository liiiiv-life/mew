---
id: "mew-agents-input"
parent: "mew-agents"
title: "에이전트 입력·멘션·스킬·첨부"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-18"
status_hash: "a10e27bcc06cebe98975858548ff907b5953bfbcf197fe2ef971d9294144858f"
files: ["src/components/AgentPanel.tsx", "src/components/MentionTextarea.tsx", "server/skills.ts"]
commits: []
---

## 요구사항

작업에 필요한 파일·폴더·스킬과 내용을 에이전트 입력에 모은다.

### 범위

- @ 프로젝트/파일/폴더 멘션, / 스킬 선택, 첨부·미리보기·입력 기록과 입력칸 높이 조절을 제공한다.

### 경계와 제한

후보 범위·우선순위·첨부 저장은 입력 명세를 따른다. 스킬 관리창의 전체 발견 목록과 현재 입력에 사용할 후보 목록은 같지 않다.

### 상세 계약

[입력 명세](../../specs/agent-input-mentions.md) · [스킬 후보 계약](../../configuration/agent-harness.md)

상위: [분야 지도](MOC.md) · [상위 기능](../agents.md).

<!-- mew:implementation:start -->
## 구현 내용

@ 프로젝트/파일/폴더 멘션, / 스킬 선택, 첨부·미리보기·입력 기록과 입력칸 높이 조절을 제공한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다: 멘션 대상·스킬 범위·첨부 완료 전 전송 차단과 모바일 키보드 위 입력 위치를 확인한다.

<!-- mew:validation:end -->
