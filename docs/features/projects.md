---
id: "mew-projects"
parent: null
title: "프로젝트·파일·검색"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-18"
status_hash: "9d42c3f85dd684af076ce22b3d7c3a6e79602ce5c77e72784345380a970e31d4"
files: []
commits: []
---

## 요구사항

프로젝트 경계 안에서 문서와 파일을 찾고 작업 위치를 관리한다.

하위 기능에서 작업 범위와 관련 구현을 고른다. 여러 하위 기능을 바꿀 때도 각각의 상세 계약을 확인한다.

### 하위 기능

- [프로젝트 열기·탭·그룹](projects/tabs.md)
- [하위 프로젝트 탭](projects/subprojects.md)
- [Documents·문서 지도 관리](projects/documents.md)
- [프로젝트 문서 안내·초기화](projects/agent-context.md)
- [파일·폴더 탐색과 조작](projects/files.md)
- [파일명·내용 검색과 치환](projects/search.md)
- [로컬 의미 검색·RAG](projects/semantic-search.md)

### 상세 계약

[프로젝트·파일 사용법](../guides/projects.md) · [검색 설정·계약](../configuration/search.md)

상위: [기능 문서 지도](MOC.md).

<!-- mew:implementation:start -->
## 구현 내용

현재 제공하는 하위 기능을 한 작업 영역으로 묶는다. 구현과 제한의 근거는 각 하위 기능에서 연결한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다: 하위 기능의 경계와 누락 여부를 검토한다. 상위 상태는 자식 상태를 자동 승인하지 않는다.

<!-- mew:validation:end -->
