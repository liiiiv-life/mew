---
id: "mew-editor-footnotes"
parent: "mew-editor"
title: "각주·참고문헌"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-25"
status_hash: "ab341935e2410ba0c99243d66dc3d86f79a79d87958f44d2e54bca6974166417"
files: ["packages/editor/src/editor/footnoteSync.ts", "packages/editor/src/utils/footnotes.ts"]
commits: []
---

## 요구사항

- 문서의 각주를 삽입하고 번호와 참조를 정리한다.

### 범위

- 각주 추가·자동 번호 정리·본문 마커와 References 사이 이동을 제공한다.

### 경계와 제한

- 각주 구문과 정리 규칙은 편집기의 지원 형식을 따른다.
- 인용 출처의 사실 검증을 자동 수행하지 않는다.

### 상세 계약

- [편집 사용법](../../guides/editor.md)

- 상위: [분야 지도](MOC.md) · [상위 기능](../editor.md).

<!-- mew:implementation:start -->
## 구현 내용

- 각주 추가·자동 번호 정리·본문 마커와 References 사이 이동을 제공한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

- 아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다:
  - 각주 추가·삭제·이동 뒤 마커와 참고문헌 번호가 맞는지 확인한다.

<!-- mew:validation:end -->
