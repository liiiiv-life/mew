---
id: "mew-agents-scheduled-jobs"
parent: "mew-agents"
title: "반복 예약 작업"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-18"
status_hash: "22df98974f68c23b059856338742901e4fe6b29962fd3ba08bfcaaee9009b0db"
files: ["src/components/ScheduleModal.tsx", "server/schedules.ts", "server/runAgentJob.ts"]
commits: []
---

## 요구사항

설정한 폴더와 런타임에서 프롬프트 작업을 주기적으로 실행한다.

### 범위

- 예약 작업 등록·수정·삭제·지금 실행과 전용 세션 출력 확인을 제공한다.

### 경계와 제한

에이전트 탭의 일회성 예약 메시지와 별개다. 실행 간격이 작업 시간보다 짧을 때 같은 세션에 입력되는 현재 제한과 로그 관리 규칙을 따른다.

### 상세 계약

[명령·예약 작업](../../guides/commands.md)

상위: [분야 지도](MOC.md) · [상위 기능](../agents.md).

<!-- mew:implementation:start -->
## 구현 내용

예약 작업 등록·수정·삭제·지금 실행과 전용 세션 출력 확인을 제공한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다: 예약과 수동 실행이 같은 설정을 사용하고 무관한 사용자 crontab 항목을 보존하는지 확인한다.

<!-- mew:validation:end -->
