---
id: "mew-editor-markdown"
parent: "mew-editor"
title: "Markdown Hotview·원문·문서 속성"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-18"
status_hash: "2741d359b18c61eecb53b8ce0ba2862f0f42c088d7d02cf55c88a23d1d44a98e"
files: ["src/components/EditorPane.tsx", "packages/editor/src/Editor.tsx", "src/components/TableOfContents.tsx"]
commits: []
---

## 요구사항

Markdown을 렌더된 본문과 원문 양쪽에서 편집한다.

### 범위

- Hotview·Plain 전환과 제목·목록·체크박스·인용·코드 블록·강조를 제공한다.
- 프론트매터 속성 편집·문서 목차·목록 들여쓰기를 제공한다.

### 경계와 제한

지원하는 Markdown 표현과 저장 규칙은 편집 사용법·에디터 구현 계약을 따른다. 파일 형식 전체를 임의의 리치 텍스트로 바꾸지 않는다.

### 상세 계약

[편집 사용법](../../guides/editor.md)

상위: [분야 지도](MOC.md) · [상위 기능](../editor.md).

<!-- mew:implementation:start -->
## 구현 내용

Hotview·Plain 전환과 제목·목록·체크박스·인용·코드 블록·강조를 제공한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다: Hotview와 원문 전환 뒤 본문·속성·목록 구조가 보존되는지 확인한다.

<!-- mew:validation:end -->
