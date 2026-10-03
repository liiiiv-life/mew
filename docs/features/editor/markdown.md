---
id: "mew-editor-markdown"
parent: "mew-editor"
title: "Markdown Hotview·원문·문서 속성"
status: "implemented"
created: "2026-09-18"
updated: "2026-10-02"
status_hash: "2741d359b18c61eecb53b8ce0ba2862f0f42c088d7d02cf55c88a23d1d44a98e"
files: ["src/hooks/useTabs.ts", "src/components/EditorPane.tsx", "src/components/markdown-error-boundary.tsx", "packages/editor/src/Editor.tsx", "packages/editor/src/editor/FrontmatterPanel.tsx", "src/components/TableOfContents.tsx"]
commits: []
---

## 요구사항

- Markdown을 렌더된 본문과 원문 양쪽에서 편집한다.

### 범위

- Hotview·Plain 전환과 제목·목록·체크박스·인용·코드 블록·강조를 제공한다.
- 프론트매터 속성 편집·문서 목차·목록 들여쓰기를 제공한다.
- 프론트매터 제목과 각 속성 행에도 Markdown 원문의 줄번호를 표시한다.
- 속성 왼쪽 핸들로 순서를 바꾸고 타입 메뉴에서 글 링크·단일선택·다중선택·날짜·텍스트·숫자를 지정한다. 각 타입 항목은 이름 왼쪽에 타입 아이콘을 표시한다.
- Hotview·Plain 전환 시 화면에 보이는 커서 줄 또는 읽던 본문 줄을 유지한다.

- 모바일 키보드가 열릴 때 편집기 높이를 줄여 터치한 커서 줄과 선택 글자 수·파일 크기 상태줄을 키보드 위에 유지한다.

### 경계와 제한

- 지원하는 Markdown 표현과 저장 규칙은 편집 사용법·에디터 구현 계약을 따른다.
- 파일 형식 전체를 임의의 리치 텍스트로 바꾸지 않는다.

### 상세 계약

- [편집 사용법](../../guides/editor.md)

- 상위: [분야 지도](MOC.md) · [상위 기능](../editor.md).

<!-- mew:implementation:start -->
## 구현 내용

- 모바일 viewport·편집기 높이 변경 뒤 포커스된 커서를 다시 맞추고 키보드를 닫으면 높이를 복원한다. 상세 계약은 [모바일 에디터와 키보드](../../development/ui-contracts.md#모바일-에디터와-키보드)를 따른다.

- Hotview·Plain 전환과 제목·목록·체크박스·인용·코드 블록·강조를 제공한다.
- 슬래시 삽입 메뉴는 모바일 키보드를 제외한 화면 공간에 따라 입력 위치 위·아래로 배치한다. 상세 동작은 [기본 편집](../../guides/editor.md#기본-편집)을 따른다.

- Hotview 초기화·렌더링 오류를 문서 안에 격리하고 원문 모드 복구를 제공한다.
- 보기 전환은 원문 줄번호와 화면 내 높이를 전달하고, 편집기 초기화·지연 렌더 중에는 기존 복원 관찰자로 위치를 유지한다. 사용자 입력 시 복원을 해제한다.
- 상세 동작은 [기본 편집](../../guides/editor.md#기본-편집)을 따른다.

- 목록 줄번호는 중첩 깊이와 관계없이 일반 문단과 같은 왼쪽 거터에 정렬한다. 내부 파일 링크를 포함한 목록도 본문 줄 높이를 유지한다.
- 속성 줄번호는 제목·본문 줄번호와 같은 x좌표에 맞추고, 핸들과 필드 내용은 오른쪽으로 옮겨 겹치지 않게 한다. 마우스·터치 재정렬, 우클릭·클릭·키보드 타입 메뉴와 메뉴 맨 아래의 필드 삭제, 선택 항목 추가·삭제와 문서 재열기 후 타입·항목 복원을 제공한다. 저장 형식은 [에디터 패키지](../../development/packages.md)를 따른다.
- 구분선에도 본문과 같은 왼쪽 거터에 원문 줄번호를 표시한다.
- Hotview 줄번호는 현재 본문의 Markdown 시작 줄을 표시하며 중간 편집·마지막 빈 문단·frontmatter 변경에도 즉시 갱신한다. 계산과 갱신 계약은 [에디터 패키지](../../development/packages.md)를 따른다.

- 본문 로딩 중에는 에디터 영역에 반투명 검정 덮개와 중앙 인디케이터를 표시하고 편집을 막는다.
- 탭 전환은 유지하며 성공·실패 시 해제한다.
- 상세 계약은 [에디터 본문 로딩](../../development/ui-contracts.md#에디터-본문-로딩)을 따른다.

- `/diagram`으로 Mermaid 흐름도를 삽입하고 Hotview에서 실제 다이어그램·원문 전환을 제공한다. 표준 `mermaid` 코드 펜스를 유지한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

- `server/editor-keyboard-ui.test.ts`에서 키보드로 줄어든 화면의 28번 줄 유지·반복 크기 변경·상태줄과 보조키의 비겹침·입력·높이 복원·데스크톱과 읽기 스크롤 보존을 확인한다. OS 키보드 자체는 실기기 확인 대상이다.

- 아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다:
  - Hotview와 원문 전환 뒤 본문·속성·목록 구조가 보존되는지 확인한다.

- 회귀 검증:
  - `server/editor-collab-ui.test.ts`는 실제 협업 편집기에 초기화·렌더링 오류를 주입해 데스크톱·모바일에서 앱 유지, 원문 복구, 다른 문서 열기, 본문 보존과 불필요한 저장 방지를 확인한다.
  - 특정 사용자의 원래 오류 발생 조건을 재현한 테스트는 아니다.

- `server/editor-pane-ui.test.ts`로 데스크톱·모바일 로딩 표시, 캐시 재조회, 연속 전환, 빈 문서·실패 후 해제를 검증한다.

- `server/frontmatter-ui.test.ts`와 `packages/editor/src/utils/frontmatter.test.ts`로 PC·터치 재정렬, 타입 전환과 값 보존, 선택 항목·단일/다중선택의 저장·재열기, 내부 링크 열기, 외부 링크 표시, Esc·뒤로가기·바깥 누름, 양 테마 메뉴 경계와 읽기 전용을 검증한다.
- `packages/editor/src/editor/lineFocus.test.ts`와 `server/editor-line-numbers-ui.test.ts`로 중간 삽입·삭제, 마지막 빈 문단, 여러 줄 목록·코드·구분선, 속성 변경의 줄번호를 검증한다.
- `server/editor-view-switch-ui.test.ts`로 PC·모바일의 반복 보기 전환, 원문 180번 줄 유지, 커서가 화면 밖인 읽기 위치와 원문 보존을 검증한다.

- `server/editor-diagram-ui.test.ts`에서 데스크톱·모바일의 실제 원격 데스크톱 흐름도 렌더링, 코드 전환, 문법 오류·복구를 검증한다. `packages/editor/src/serverExtensions.test.ts`는 Mermaid 펜스의 협업 스키마 왕복 보존을 검증한다.

- `packages/editor/src/editor/slashMenuPosition.test.ts`로 아래 배치, 키보드로 줄어든 화면의 위 배치, viewport 이동·좁은 화면의 높이/너비 제한과 검색 결과 축소를 검증한다. 실기기 키보드 애니메이션은 사용자 확인 대상이다.

<!-- mew:validation:end -->
