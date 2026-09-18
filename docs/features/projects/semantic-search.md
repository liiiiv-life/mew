---
id: "mew-projects-semantic-search"
parent: "mew-projects"
title: "로컬 의미 검색·RAG"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-18"
status_hash: "834df5b74f90a8f7d616052f4adefcaf6f580bb94d9a5703cbf2c39ef63a0fe1"
files: ["server/rag/index.ts", "server/rag/embeddings.ts", "server/rag/chunking.ts"]
commits: []
---

## 요구사항

문서 문맥을 로컬 의미 색인으로 찾는다.

### 범위

- 서버 API에서 의미 검색·색인 상태 조회·재색인을 제공한다.

### 경계와 제한

현재 사이드바에 의미 검색 버튼은 없다. 모델 준비·자원·권한과 색인 정책은 검색 설정을 따른다. 정확 검색을 대체하지 않는다.

### 상세 계약

[검색 설정·계약](../../configuration/search.md)

상위: [분야 지도](MOC.md) · [상위 기능](../projects.md).

<!-- mew:implementation:start -->
## 구현 내용

서버 API에서 의미 검색·색인 상태 조회·재색인을 제공한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다: API가 색인 상태와 문맥 결과를 반환하고 정확 검색 기능과 혼동되지 않는지 확인한다.

<!-- mew:validation:end -->
