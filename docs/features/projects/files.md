---
id: "mew-projects-files"
parent: "mew-projects"
title: "파일·폴더 탐색과 조작"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-18"
status_hash: "67a95247d8f805106459a6f3cc3fd61abca57f6504dbe508c57550c824406a0a"
files: ["src/components/FileTree.tsx", "src/components/ServerFileExplorer.tsx", "server/api.ts", "server/fileCatalog.ts"]
commits: []
---

## 요구사항

파일을 탐색하고 생성·이동·업로드·다운로드한다.

### 범위

- 사이드바에서 생성·개명·복제·복사·잘라내기·붙여넣기·삭제와 드래그 이동을 제공한다.
- 권한이 있는 계정은 서버 전체 파일 탐색기에서 프로젝트 밖 경로를 다룰 수 있다.
- 숨김 목록과 파일 권한을 트리·검색에 적용한다.

### 경계와 제한

확장자를 생략해도 .md를 자동 추가하지 않는다. 서버 전체 탐색기는 OS 권한의 서버 제어 기능이며 일반 파일 권한의 샌드박스가 아니다.

### 상세 계약

[프로젝트·파일 사용법](../../guides/projects.md) · [파일 권한](../../development/access-control.md)

상위: [분야 지도](MOC.md) · [상위 기능](../projects.md).

<!-- mew:implementation:start -->
## 구현 내용

사이드바에서 생성·개명·복제·복사·잘라내기·붙여넣기·삭제와 드래그 이동을 제공한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다: 파일명이 그대로 생성되고 이동·업로드 목적지와 읽기 전용·차단 항목이 정확한지 확인한다.

<!-- mew:validation:end -->
