---
id: "mew-projects-subprojects"
parent: "mew-projects"
title: "하위 프로젝트 탭"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-29"
status_hash: "f8e5ccb90cec46b682b7f74bf0a0ce3972a30581008397911e415e198d12da6a"
files: ["src/components/subproject-link.tsx", "src/components/FileTree.tsx", "server/subprojects.ts"]
commits: []
---

## 요구사항

- 폴더 안의 프로젝트를 독립 프로젝트 탭에서 작업한다.

### 범위

- 프로젝트의 `.mew/project-icon.json` 하나를 사이드바·프로젝트탭의 공통 아이콘으로 사용한다.

- 실제 .mew 디렉터리를 가진 하위 프로젝트는 펼침 폴더 대신 탭 열기 항목으로 표시한다.
- 폴더를 하위 프로젝트로 지정하고 이미 열린 경로는 기존 탭을 재사용한다.

### 경계와 제한

- 일반 폴더·Documents는 계속 펼쳐 탐색한다.
- 지정은 Git 초기화나 자동 루트 전환을 하지 않으며 프로젝트 탭 열기는 owner 권한을 따른다.

### 상세 계약

- [프로젝트·파일 사용법](../../guides/projects.md)

- 상위: [분야 지도](MOC.md) · [상위 기능](../projects.md).

<!-- mew:implementation:start -->
## 구현 내용

- `server/projectIcons.ts`가 프로젝트별 아이콘 읽기·저장·기존 값 이관을 맡는다. 직계·중첩 트리와 루트 탭은 같은 값을 표시하고, 탭에서 변경하면 프로젝트 파일을 갱신한다.

- 실제 .mew 디렉터리를 가진 하위 프로젝트는 펼침 폴더 대신 탭 열기 항목으로 표시한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

- `projectIcons.test.ts`·`project-icons-api.test.ts`: 공통 SVG·중첩 아이콘·이관 우선순위·초기화·이름 변경·손상/링크 보호·owner 권한·계정 사본 배제를 검증한다.

- 아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다:
  - 직계·중첩 프로젝트를 열 때 상위 탭이 남고 내부 탐색은 새 탭에서 이루어지는지 확인한다.

<!-- mew:validation:end -->
