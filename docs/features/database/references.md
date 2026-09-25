---
id: "mew-database-references"
parent: "mew-database"
title: "기존 DB·외부 Postgres 참조"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-25"
status_hash: "0f0b4f100693e9172887fe664580e4df69853a9da651461c3a04302ef8bdf3ed"
files: ["packages/editor/src/database/DbReferencePicker.tsx", "packages/editor/src/database/DatabaseView.tsx", "server/db/catalog.ts"]
commits: []
---

## 요구사항

- 기존 데이터베이스와 외부 Postgres 테이블을 읽기 전용으로 참조한다.

### 범위

- 문서 DB 참조와 외부 테이블 선택·열람을 제공한다.

### 경계와 제한

- 참조 뷰는 원본을 수정하지 않는다.
- 연결·카탈로그·프로젝트 경계를 유지하며 임의 외부 DB 전체 접근을 뜻하지 않는다.

### 상세 계약

- [참조·프로젝트 격리](../../guides/database.md)

- 상위: [분야 지도](MOC.md) · [상위 기능](../database.md).

<!-- mew:implementation:start -->
## 구현 내용

- 문서 DB 참조와 외부 테이블 선택·열람을 제공한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

- 아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다:
  - 참조 노드에서 원본 편집이 막히고 권한·프로젝트 범위 안의 테이블만 선택되는지 확인한다.

<!-- mew:validation:end -->
