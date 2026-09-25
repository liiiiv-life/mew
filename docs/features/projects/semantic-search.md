---
id: "mew-projects-semantic-search"
parent: "mew-projects"
title: "로컬 의미 검색·RAG"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-25"
status_hash: "834df5b74f90a8f7d616052f4adefcaf6f580bb94d9a5703cbf2c39ef63a0fe1"
files: ["src/components/rag-panel.tsx", "server/rag/settings.ts", "server/rag/guidance.ts", "server/rag/cli.ts", "server/rag/index.ts", "server/rag/embeddings.ts", "server/rag/chunking.ts"]
commits: []
---

## 요구사항

- 문서 문맥을 로컬 의미 색인으로 찾는다.

### 범위

- 색인된 청크가 없으면 **색인 시작**, 있으면 **재색인**을 표시한다.
- 별도 범위 선택은 없다.
- 하단 독 맨 오른쪽 RAG 패널에서 서버 공통 사용·에이전트 안내 설정, 현재 프로젝트의 Docs로 고정된 의미 검색·벡터 DB 상태·색인 파일 목록·재색인을 제공한다.

### 경계와 제한

- 공통 설정은 프로젝트 데이터를 합치지 않는다.
- 에이전트에는 실제 로컬 검색 명령을 안내하며 매 작업의 강제 검색은 아니다.
- 모델 준비·자원·권한과 색인 정책은 검색 설정을 따른다.
- 정확 검색을 대체하지 않는다.

### 상세 계약

- [검색 설정·계약](../../configuration/search.md)

- 상위: [분야 지도](MOC.md) · [상위 기능](../projects.md).

<!-- mew:implementation:start -->
## 구현 내용

- 하단 독 맨 오른쪽 RAG 패널에서 서버 공통 사용·에이전트 안내 설정, 현재 프로젝트의 Docs로 고정된 의미 검색·벡터 DB 상태·색인 파일 목록·재색인을 제공한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

- 아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다:
  - 독의 끝에서 RAG를 열고 공통 설정 변경이 다른 프로젝트의 다음 ACP 안내에 반영되는지, 프로젝트별 검색·색인 목록·파일 열기·권한·오류 재시도가 동작하는지 확인한다.

<!-- mew:validation:end -->
