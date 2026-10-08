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
description: "파일별 커밋·과거 내용 복원과 현재 프로젝트 Git 작업 패널을 묶는 상위 기능 문서. 하위 기능의 범위와 상세 계약 링크를 안내하며 개별 구현·검증의 소유권을 구분한다."
상위파일: "../MOC.md"
---

## 요구사항

- 파일 단위 기록과 현재 프로젝트 저장소 작업을 구분해 제공한다.

- 하위 기능에서 작업 범위와 관련 구현을 고른다.
- 여러 하위 기능을 바꿀 때도 각각의 상세 계약을 확인한다.

### 하위 기능

- [현재 프로젝트 Git 작업 패널](%ED%98%84%EC%9E%AC%20%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8%20Git%20%EC%9E%91%EC%97%85%20%ED%8C%A8%EB%84%90.md)
- [현재 파일 커밋·이력 복원](%ED%98%84%EC%9E%AC%20%ED%8C%8C%EC%9D%BC%20%EC%BB%A4%EB%B0%8B%C2%B7%EC%9D%B4%EB%A0%A5%20%EB%B3%B5%EC%9B%90.md)

### 상세 계약

- [프로젝트·파일 사용법](../../guides/projects.md) · [편집 사용법](../../guides/editor.md)

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
