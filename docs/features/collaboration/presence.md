---
id: "mew-collaboration-presence"
parent: "mew-collaboration"
title: "참여자·활성 세션 보기"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-18"
status_hash: "64bc964f2ebbcdcec2bc83390c7f91ba8bb519df4201a59f54d46848f619d368"
files: ["src/components/active-sessions-button.tsx", "src/components/PresenceDots.tsx", "server/presence.ts"]
commits: []
---

## 요구사항

현재 접속과 각 사용자의 작업 위치를 확인한다.

### 범위

- 접속 수·사용자별 기기·프로젝트·현재 파일과 작업 참여자를 표시한다.

### 경계와 제한

보는 계정이 열람할 수 없는 프로젝트·파일 경로는 노출하지 않는다. 세션 목록은 실행 중인 에이전트 작업 목록과 다르다.

### 상세 계약

[협업 사용법](../../guides/collaboration.md)

상위: [분야 지도](MOC.md) · [상위 기능](../collaboration.md).

<!-- mew:implementation:start -->
## 구현 내용

접속 수·사용자별 기기·프로젝트·현재 파일과 작업 참여자를 표시한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다: 여러 기기 접속·종료가 반영되고 제한 경로가 다른 사용자에게 노출되지 않는지 확인한다.

<!-- mew:validation:end -->
