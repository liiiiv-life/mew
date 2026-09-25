---
id: "mew-git"
parent: null
title: "Git·변경 이력"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-25"
status_hash: "be98a5da301e8a6d4a72e5909779ab2d912575aeb6bbb60a258035c4ed2aee21"
files: []
commits: []
---

## 요구사항

- 파일 단위 기록과 현재 프로젝트 저장소 작업을 구분해 제공한다.

- 하위 기능에서 작업 범위와 관련 구현을 고른다.
- 여러 하위 기능을 바꿀 때도 각각의 상세 계약을 확인한다.

### 하위 기능

- [현재 프로젝트 Git 작업 패널](git/workbench.md)
- [현재 파일 커밋·이력 복원](git/file-history.md)

### 상세 계약

- [프로젝트·파일 사용법](../guides/projects.md) · [편집 사용법](../guides/editor.md)

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
