---
id: "mew-projects-search"
parent: "mew-projects"
title: "파일명·내용 검색과 치환"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-25"
status_hash: "79a1e8766564a2bf356422b60d751638dcc7b3a1ae78f96ce4deb3c240d57085"
files: ["src/components/SearchPanel.tsx", "server/fileNameSearch.ts", "server/search.ts", "server/searchCatalog.ts"]
commits: []
---

## 요구사항

- 프로젝트 파일을 이름이나 본문으로 찾고 필요한 내용을 바꾼다.

### 범위

- 파일명·본문 검색을 별도 사이드바 모드로 제공하고 @ 범위·대소문자·정규식을 지원한다.
- 본문 결과의 해당 줄로 이동하고 파일별·전체 치환을 제공한다.

### 경계와 제한

- 파일명 검색은 후보 수에 상한이 있다.
- 본문 색인은 후보를 좁히는 수단이며 원문 대조·장애 시 scanner 경로를 유지한다.
- 의미 검색은 별도 기능이다.

### 상세 계약

- [검색 표시 명세](../../specs/file-search.md) · [검색 설정·계약](../../configuration/search.md)

- 상위: [분야 지도](MOC.md) · [상위 기능](../projects.md).

<!-- mew:implementation:start -->
## 구현 내용

- 파일명·본문 검색을 별도 사이드바 모드로 제공하고 @ 범위·대소문자·정규식을 지원한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

- 아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다:
  - 같은 질의의 정확 검색 결과·범위 태그·정규식과 치환 전후 원문을 확인한다.

<!-- mew:validation:end -->
