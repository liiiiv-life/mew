---
id: "mew-projects-tabs"
parent: "mew-projects"
title: "프로젝트 열기·탭·그룹"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-18"
status_hash: "03b352e53f93242f9efdfd05c5bd632f9bf92dd1a456279d6b0eb0efd066cd3f"
files: ["src/components/OpenProjectDialog.tsx", "src/components/RootProjectTabs.tsx", "server/projects.ts", "server/cloud-storage.ts"]
commits: []
---

## 요구사항

서버의 폴더를 프로젝트 탭으로 열고 여러 작업 공간을 오간다.

### 범위

- 폴더 탐색·클라우드 바로가기·새 폴더·Git clone·Git 초기화를 프로젝트 선택 창에서 제공한다.
- 탭 전환·닫기·아이콘·순서·그룹과 계정별 화면 복원을 제공한다.

### 경계와 제한

프로젝트 전환은 owner 전용이다. 탭 그룹은 화면 구성일 뿐 폴더를 옮기지 않는다. 실행 중 에이전트의 기존 작업 경로는 유지한다.

### 상세 계약

[프로젝트·파일 사용법](../../guides/projects.md) · [전환·복원 계약](../../development/ui-contracts.md)

상위: [분야 지도](MOC.md) · [상위 기능](../projects.md).

<!-- mew:implementation:start -->
## 구현 내용

폴더 탐색·클라우드 바로가기·새 폴더·Git clone·Git 초기화를 프로젝트 선택 창에서 제공한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다: 다른 프로젝트로 갔다 돌아올 때 문서·배치가 복원되고 탭 닫기가 파일을 삭제하지 않는지 확인한다.

<!-- mew:validation:end -->
