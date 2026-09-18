---
id: "mew-database-document-tables"
parent: "mew-database"
title: "문서 데이터베이스·전체 목록"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-18"
status_hash: "ea759314baf1dca2105e78500c7277302e925451b58b01f45479cf00db9e02ad"
files: ["src/components/DatabaseListModal.tsx", "packages/editor/src/database/DatabaseTable.tsx", "server/db/databaseService.ts", "server/db/routes.ts"]
commits: []
---

## 요구사항

문서 안에 표 데이터베이스를 넣고 프로젝트의 데이터를 편집한다.

### 범위

- 문서 DB 삽입, 제목·텍스트/숫자/체크박스/날짜 열과 행·셀 편집, 실시간 갱신을 제공한다.
- 메뉴의 데이터베이스 목록에서 현재 프로젝트 DB를 열람·편집한다.

### 경계와 제한

Markdown에는 참조 ID를 저장하고 실제 데이터는 Postgres가 소유한다. Postgres 연결이 없으면 DB API를 사용할 수 없다. DB 기능·프로젝트 전체 접근 권한을 확인한다.

### 상세 계약

[데이터베이스 사용·저장 계약](../../guides/database.md)

상위: [분야 지도](MOC.md) · [상위 기능](../database.md).

<!-- mew:implementation:start -->
## 구현 내용

문서 DB 삽입, 제목·텍스트/숫자/체크박스/날짜 열과 행·셀 편집, 실시간 갱신을 제공한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다: 두 세션에서 셀·열 변경이 전달되고 다른 프로젝트의 DB ID로 접근할 수 없는지 확인한다.

<!-- mew:validation:end -->
