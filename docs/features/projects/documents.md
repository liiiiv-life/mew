---
id: "mew-projects-documents"
parent: "mew-projects"
title: "Documents·문서 지도 관리"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-29"
status_hash: "67f36d128f8ff98f55ff2f44e2197710413f6968309439a998bd606dad06b477"
files: ["src/components/DocsSettingsModal.tsx", "src/components/FileTree.tsx", "server/docsRepo.ts"]
commits: []
---

## 요구사항

- 프로젝트의 문서 폴더와 MOC를 일반 파일 탐색과 연결한다.

### 범위

- Documents의 실제 폴더를 연결하고 폴더별 MOC 진입점을 표시한다.
- 탐색기 하단 문서/Documents 토글에서 문서 목록만 표시한다. 파일 보기와 전환해도 열린 에디터 탭은 유지한다.
- 문서 폴더 변경·가져오기·내보내기를 제공한다.
- Documents와 일반 파일은 현재 루트 프로젝트의 같은 에디터 탭·분할 배치를 사용한다. 파일을 번갈아 열어도 기존 탭과 옮긴 패널 위치를 유지한다.

### 경계와 제한

- 문서 가져오기는 기존 내용을 교체하는 작업이다.
- Documents는 별도 프로젝트 탭이 아니며 경로 변경은 현재 프로젝트 내부에서만 허용한다.

### 상세 계약

- [프로젝트·파일 사용법](../../guides/projects.md)

- 상위: [분야 지도](MOC.md) · [상위 기능](../projects.md).

<!-- mew:implementation:start -->
## 구현 내용

- 하단 문서/파일 토글은 반투명 배경을 사용한다. 버튼 높이 28px, 좌우 패딩 10px, 바깥 패딩·버튼 간격 2px로 줄이고 하단 간격은 8px로 유지한다. 텍스트 자체의 투명도와 기존 키보드 전환은 유지한다.

- Documents는 일반 파일 트리에 중첩하지 않고 독립 목록으로 표시한다. 펼침·스크롤과 새 파일 목적지는 보기별로 유지하며 owner의 문서 토글 우클릭으로 기존 폴더 설정을 연다. [ADR 0180](../../../../.mew/docs/decisions/0180-mew-explorer-documents-files-toggle.md)을 따른다.

- `useTabs`는 Documents 파일을 원래 API 스코프와 상대경로를 포함한 탭 식별자로 구분해 일반 파일과 함께 관리한다. 저장·협업·댓글·첨부·문서 DB는 각 파일의 기존 스코프를 유지한다.
- 기존 Documents·일반 파일의 저장된 탭은 한 번 합치며, 같은 이름의 파일과 편집 칸 ID를 보존한다. 통합 후 닫은 탭을 옛 Documents 저장분에서 다시 복원하지 않는다.

- Documents의 실제 폴더를 연결하고 폴더별 MOC 진입점을 표시한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

- 2026-09-29: 실제 App을 사용하는 `workspace-switch-ui.test.ts`에서 문서/파일 단독 표시, 방향키·Home 전환, 현재 보기의 새 파일 입력, 파일 탭 선택 시 보기 전환, 프로젝트 복원·모바일 하단 배치를 확인했다. 펼침/스크롤·생성 회귀와 저장 형식·번역 테스트, TypeScript·대상 lint·문서 검사를 통과했다. 데스크톱 다크·모바일 라이트 캡처를 확인했으며 빌드·재시작은 수행하지 않았다.

- 같은 이름의 Documents·일반 파일이 탭바에 함께 표시되고 각각 올바른 본문을 열고 저장하는지 확인한다. 패널 이동 뒤 파일 전환·새로고침에도 탭과 배치를 유지해야 한다.
- 2026-09-29: `editor-files.test.ts`·`unified-editor-ui.test.ts`·`workspace-switch-ui.test.ts`에서 동명 파일의 탭·저장 분리, 기존 탭 통합, 패널 이동 후 위치 유지, 새로고침·루트 전환 복원을 확인했다. 편집기·보기 전환·사이드바 회귀를 포함해 10개 테스트가 통과했다.

- 아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다:
  - Documents에 연결한 실제 경로와 MOC가 맞고 루트 트리에 중복 표시되지 않는지 확인한다.

<!-- mew:validation:end -->
