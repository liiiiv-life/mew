---
id: "mew-editor-code"
parent: "mew-editor"
title: "코드·텍스트 편집과 문서 내 검색"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-18"
status_hash: "4d8fe6026b3341576de674bb4b2ae85cd1124f3eb3638b2e33e15d8697ed1fc1"
files: ["src/components/CodePane.tsx", "packages/editor/src/editor/EditorSearchBar.tsx"]
commits: []
---

## 요구사항

코드와 일반 텍스트를 편집하고 열린 문서 안을 탐색한다.

### 범위

- 줄 번호·구문 강조·지원 형식의 진단을 표시한다.
- 문서 안 찾기·바꾸기와 실행 취소·다시 실행을 제공한다.

### 경계와 제한

언어별 지원은 실제 등록된 확장에 한정한다. 프로젝트 전체 검색은 프로젝트·검색 기능에서 다룬다.

### 상세 계약

[편집 사용법](../../guides/editor.md)

상위: [분야 지도](MOC.md) · [상위 기능](../editor.md).

<!-- mew:implementation:start -->
## 구현 내용

줄 번호·구문 강조·지원 형식의 진단을 표시한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다: 지원 파일의 강조·진단·찾기 위치와 수정 후 실행 취소를 확인한다.

<!-- mew:validation:end -->
