---
id: "mew-editor"
parent: null
title: "문서·코드·미디어 편집"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-25"
status_hash: "5405e740d54631862951e658052a02f4a4136a8ef96ba7298acb03a646db3588"
files: []
commits: []
---

## 요구사항

- 파일 형식에 맞는 편집과 읽기 경험을 제공한다.

- 하위 기능에서 작업 범위와 관련 구현을 고른다.
- 여러 하위 기능을 바꿀 때도 각각의 상세 계약을 확인한다.

### 하위 기능

- [Markdown Hotview·원문·문서 속성](editor/markdown.md)
- [코드·텍스트 편집과 문서 내 검색](editor/code.md)
- [링크·파일 참조·첨부](editor/references.md)
- [Markdown 표 편집·복사](editor/tables.md)
- [각주·참고문헌](editor/footnotes.md)
- [미디어·시트 미리보기](editor/media.md)
- [PDF 읽기·필기·저장](editor/pdf.md)
- [자동저장·실행 취소](editor/autosave.md)

### 상세 계약

- [편집 사용법](../guides/editor.md)

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
