---
id: "mew-collaboration-editing"
parent: "mew-collaboration"
title: "실시간 공동 편집"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-25"
status_hash: "81a72649dbeb8cd93209d368fdf5395c34899f4c259ba1ccce2b9ccdbd5eb7b4"
files: ["server/collab.ts", "src/components/EditorPane.tsx", "src/hooks/usePresence.ts"]
commits: []
---

## 요구사항

- 로그인한 여러 사용자가 같은 파일을 함께 편집한다.

### 범위

- 공동 편집 상태와 참여자 커서를 동기화한다.

### 경계와 제한

- 공동 편집 기능과 대상 파일 권한을 함께 검사한다.
- guest의 허용된 본문 편집은 로그인 사용자 공동 편집과 다른 경로다.

### 상세 계약

- [협업 사용법](../../guides/collaboration.md) · [협업 방 계약](../../development/collaboration.md)

- 상위: [분야 지도](MOC.md) · [상위 기능](../collaboration.md).

<!-- mew:implementation:start -->
## 구현 내용

- 공동 편집 상태와 참여자 커서를 동기화한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

- 아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다:
  - 두 로그인 세션에서 변경·커서가 전달되고 파일 전환·권한 회수 뒤 잘못된 방에 남지 않는지 확인한다.

<!-- mew:validation:end -->
