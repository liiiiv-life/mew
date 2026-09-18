---
id: "mew-projects-documents"
parent: "mew-projects"
title: "Documents·문서 지도 관리"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-18"
status_hash: "67f36d128f8ff98f55ff2f44e2197710413f6968309439a998bd606dad06b477"
files: ["src/components/DocsSettingsModal.tsx", "src/components/FileTree.tsx", "server/docsRepo.ts"]
commits: []
---

## 요구사항

프로젝트의 문서 폴더와 MOC를 일반 파일 탐색과 연결한다.

### 범위

- Documents의 실제 폴더를 연결하고 폴더별 MOC 진입점을 표시한다.
- 문서 폴더 변경·가져오기·내보내기를 제공한다.

### 경계와 제한

문서 가져오기는 기존 내용을 교체하는 작업이다. Documents는 별도 프로젝트 탭이 아니며 경로 변경은 현재 프로젝트 내부에서만 허용한다.

### 상세 계약

[프로젝트·파일 사용법](../../guides/projects.md)

상위: [분야 지도](MOC.md) · [상위 기능](../projects.md).

<!-- mew:implementation:start -->
## 구현 내용

Documents의 실제 폴더를 연결하고 폴더별 MOC 진입점을 표시한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다: Documents에 연결한 실제 경로와 MOC가 맞고 루트 트리에 중복 표시되지 않는지 확인한다.

<!-- mew:validation:end -->
