---
id: "mew-git-file-history"
parent: "mew-git"
title: "현재 파일 커밋·이력 복원"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-25"
status_hash: "af3b61583146b091429eb1e20b1bc1caa7ab169eb0d3c7e973c6e30f216d7a1d"
files: ["src/components/FileHistoryModal.tsx", "src/components/GitButton.tsx", "server/git.ts"]
commits: []
---

## 요구사항

- 열린 파일의 변경을 커밋하고 과거 내용을 확인·복원한다.

### 범위

- 현재 파일 Commit과 파일별 Git 이력 조회·되돌리기를 제공한다.

### 경계와 제한

- 현재 파일 커밋과 Git 패널의 선택 파일 커밋은 범위가 다르다.
- 자동저장만으로 Git 이력이 생긴다고 가정하지 않는다.

### 상세 계약

- [편집 사용법](../../guides/editor.md)

- 상위: [분야 지도](MOC.md) · [상위 기능](../git.md).

<!-- mew:implementation:start -->
## 구현 내용

- 현재 파일 Commit과 파일별 Git 이력 조회·되돌리기를 제공한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

- 아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다:
  - 선택 파일의 커밋·이력·복원이 다른 파일의 미커밋 변경을 의도 없이 포함하지 않는지 확인한다.

<!-- mew:validation:end -->
