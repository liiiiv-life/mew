---
id: "mew-editor-markdown"
parent: "mew-editor"
title: "Markdown Hotview·원문·문서 속성"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-27"
status_hash: "2741d359b18c61eecb53b8ce0ba2862f0f42c088d7d02cf55c88a23d1d44a98e"
files: ["src/hooks/useTabs.ts", "src/components/EditorPane.tsx", "src/components/markdown-error-boundary.tsx", "packages/editor/src/Editor.tsx", "src/components/TableOfContents.tsx"]
commits: []
---

## 요구사항

- Markdown을 렌더된 본문과 원문 양쪽에서 편집한다.

### 범위

- Hotview·Plain 전환과 제목·목록·체크박스·인용·코드 블록·강조를 제공한다.
- 프론트매터 속성 편집·문서 목차·목록 들여쓰기를 제공한다.

### 경계와 제한

- 지원하는 Markdown 표현과 저장 규칙은 편집 사용법·에디터 구현 계약을 따른다.
- 파일 형식 전체를 임의의 리치 텍스트로 바꾸지 않는다.

### 상세 계약

- [편집 사용법](../../guides/editor.md)

- 상위: [분야 지도](MOC.md) · [상위 기능](../editor.md).

<!-- mew:implementation:start -->
## 구현 내용

- Hotview·Plain 전환과 제목·목록·체크박스·인용·코드 블록·강조를 제공한다.

- Hotview 초기화·렌더링 오류를 문서 안에 격리하고 원문 모드 복구를 제공한다.
- 상세 동작은 [기본 편집](../../guides/editor.md#기본-편집)을 따른다.

- Hotview 줄번호는 현재 본문의 Markdown 시작 줄을 표시하며 중간 편집·마지막 빈 문단·frontmatter 변경에도 즉시 갱신한다. 계산과 갱신 계약은 [에디터 패키지](../../development/packages.md)를 따른다.

- 본문 로딩 중에는 에디터 영역에 반투명 검정 덮개와 중앙 인디케이터를 표시하고 편집을 막는다.
- 탭 전환은 유지하며 성공·실패 시 해제한다.
- 상세 계약은 [에디터 본문 로딩](../../development/ui-contracts.md#에디터-본문-로딩)을 따른다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

- 아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다:
  - Hotview와 원문 전환 뒤 본문·속성·목록 구조가 보존되는지 확인한다.

- 회귀 검증:
  - `server/editor-collab-ui.test.ts`는 실제 협업 편집기에 초기화·렌더링 오류를 주입해 데스크톱·모바일에서 앱 유지, 원문 복구, 다른 문서 열기, 본문 보존과 불필요한 저장 방지를 확인한다.
  - 특정 사용자의 원래 오류 발생 조건을 재현한 테스트는 아니다.

- `server/editor-pane-ui.test.ts`로 데스크톱·모바일 로딩 표시, 캐시 재조회, 연속 전환, 빈 문서·실패 후 해제를 검증한다.

- `packages/editor/src/editor/lineFocus.test.ts`와 `server/editor-line-numbers-ui.test.ts`로 중간 삽입·삭제, 마지막 빈 문단, 여러 줄 목록·코드·구분선, 속성 변경의 줄번호를 검증한다.

<!-- mew:validation:end -->
