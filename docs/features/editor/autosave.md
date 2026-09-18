---
id: "mew-editor-autosave"
parent: "mew-editor"
title: "자동저장·실행 취소"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-18"
status_hash: "49e8886c9db372cf3f0f2fde067a315ec7873a16ef66013708de4d051926c0d4"
files: ["src/components/EditorPane.tsx", "src/components/CodePane.tsx", "server/collab.ts"]
commits: []
---

## 요구사항

편집한 내용을 파일에 저장하고 편집 실수를 되돌린다.

### 범위

- 본문 변경을 자동저장하고 실행 취소·다시 실행을 제공한다.

### 경계와 제한

자동저장과 Git 커밋은 별개다. 외부에서 수정한 파일과 열려 있는 편집기의 저장이 충돌할 수 있으므로 파일 이력·Revert File 경로를 구분한다.

### 상세 계약

[편집 사용법](../../guides/editor.md)

상위: [분야 지도](MOC.md) · [상위 기능](../editor.md).

<!-- mew:implementation:start -->
## 구현 내용

본문 변경을 자동저장하고 실행 취소·다시 실행을 제공한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다: 저장 후 재열기와 실행 취소가 맞고 자동저장을 Git 커밋으로 표시하지 않는지 확인한다.

<!-- mew:validation:end -->
