---
id: "mew-projects-files"
parent: "mew-projects"
title: "파일·폴더 탐색과 조작"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-25"
status_hash: "67a95247d8f805106459a6f3cc3fd61abca57f6504dbe508c57550c824406a0a"
files: ["src/components/file-action-menu.tsx", "src/hooks/use-external-file-actions.tsx", "src/components/file-browser-favorites.tsx", "server/file-favorites.ts", "src/components/file-browser.tsx", "src/components/FileTree.tsx", "src/components/ServerFileExplorer.tsx", "server/api.ts", "server/fileCatalog.ts"]
commits: []
---

## 요구사항

- 파일을 탐색하고 생성·이동·업로드·다운로드한다.

### 범위

- 프로젝트 추가·서버 파일 탐색기의 맨 위에 OS/클라우드 기본 폴더와 계정별 즐겨찾기를 제공한다.
- 사이드바에서 생성·개명·복제·복사·잘라내기·붙여넣기·삭제와 드래그 이동을 제공한다.
- 권한이 있는 계정은 서버 전체 파일 탐색기에서 프로젝트 밖 경로를 다룰 수 있다.
- 숨김 목록과 파일 권한을 트리·검색에 적용한다.

### 경계와 제한

- 확장자를 생략해도 .md를 자동 추가하지 않는다.
- 서버 전체 탐색기는 OS 권한의 서버 제어 기능이며 일반 파일 권한의 샌드박스가 아니다.

### 상세 계약

- [프로젝트·파일 사용법](../../guides/projects.md) · [파일 권한](../../development/access-control.md)

- 상위: [분야 지도](MOC.md) · [상위 기능](../projects.md).

<!-- mew:implementation:start -->
## 구현 내용

- 두 탐색기의 항목 우클릭은 사이드바와 같은 메뉴 컴포넌트로 복사·잘라내기·붙여넣기·이름 변경·삭제를 제공하고 폴더에 즐겨찾기 추가를 표시한다.
- 모바일 길게 누르기도 지원한다.
- 모바일 메뉴는 하단 독 위로 위치를 보정하며, 높이가 부족하면 메뉴 안에서 스크롤해 마지막 항목까지 선택할 수 있다.

- 두 탐색기 맨 위의 즐겨찾기는 접힌 자체 드롭다운이며, 펼쳐서 폴더 이동·제거를 실행한다.
- 키보드·터치·Esc·뒤로가기를 지원한다.
- 목록은 서버 OS 기본 폴더·감지된 클라우드 폴더와 직접 추가한 경로를 제공한다.
- 추가·제거는 계정별로 저장한다.

- 프로젝트 추가와 서버 파일 탐색기는 프로젝트 추가 창의 디자인을 기준으로 공통 탐색 컴포넌트를 사용한다.
- 주소창·필터·목록 행·하단 경로를 공유하고 각 화면의 기존 작업을 유지한다.

- 사이드바에서 생성·개명·복제·복사·잘라내기·붙여넣기·삭제와 드래그 이동을 제공한다.

- 사이드바 파일 목록 끝에 300px의 스크롤 여백을 제공한다.
- PC·모바일에 동일하게 적용하며 Documents 내부에는 중복 추가하지 않는다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

- 아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다:
  - 파일명이 그대로 생성되고 이동·업로드 목적지와 읽기 전용·차단 항목이 정확한지 확인한다.

- 2026-09-24:
  - 격리 Chromium에서 데스크톱·모바일 양 테마의 즐겨찾기 드롭다운, 키보드·터치 이동/제거, Esc·뒤로가기·바깥 누름과 기존 파일 조작을 검증했다.

<!-- mew:validation:end -->
