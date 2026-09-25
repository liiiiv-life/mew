---
id: "mew-database"
parent: null
title: "문서 데이터베이스"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-25"
status_hash: "f03d728f3b30313a25a90287a23c58079e6eb29523ef4c263d20e2dbe67d7d6b"
files: []
commits: []
---

## 요구사항

- 프로젝트별 표 데이터를 문서에 연결하고 공동으로 다룬다.

- 하위 기능에서 작업 범위와 관련 구현을 고른다.
- 여러 하위 기능을 바꿀 때도 각각의 상세 계약을 확인한다.

### 하위 기능

- [문서 데이터베이스·전체 목록](database/document-tables.md)
- [기존 DB·외부 Postgres 참조](database/references.md)

### 상세 계약

- [데이터베이스 사용법](../guides/database.md)

- 상위: [기능 문서 지도](MOC.md).

<!-- mew:implementation:start -->
## 구현 내용

- 현재 제공하는 하위 기능을 한 작업 영역으로 묶는다.
- 구현과 제한의 근거는 각 하위 기능에서 연결한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

- 아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다:
  - 하위 기능의 경계와 누락 여부를 검토한다.
  - 상위 상태는 자식 상태를 자동 승인하지 않는다.

<!-- mew:validation:end -->
