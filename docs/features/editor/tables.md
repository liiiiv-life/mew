---
id: "mew-editor-tables"
parent: "mew-editor"
title: "Markdown 표 편집·복사"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-25"
status_hash: "a4d3adb2072291555b6bd681a8a5b7e3b9de108e056a15951673f169dd30caf7"
files: ["packages/editor/src/editor/TableTooltip.tsx", "packages/editor/src/editor/TableCopyMenu.tsx", "server/tableLayout.ts"]
commits: []
---

## 요구사항

- 문서의 표를 편집하고 다른 형식으로 복사한다.

### 범위

- 행·열 조작·열 너비 조절과 Markdown·CSV·이미지 복사를 제공한다.

### 경계와 제한

- Markdown 표와 Postgres 문서 데이터베이스는 별개다.
- 열 너비 보조 저장 형식은 편집 사용법을 따른다.

### 상세 계약

- [편집 사용법](../../guides/editor.md)

- 상위: [분야 지도](MOC.md) · [상위 기능](../editor.md).

<!-- mew:implementation:start -->
## 구현 내용

- 행·열 조작·열 너비 조절과 Markdown·CSV·이미지 복사를 제공한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

- 아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다:
  - 행·열 수정과 너비가 재열기 후 유지되고 복사 결과가 표 내용과 일치하는지 확인한다.

<!-- mew:validation:end -->
