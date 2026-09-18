---
id: "mew-git-workbench"
parent: "mew-git"
title: "현재 프로젝트 Git 작업 패널"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-18"
status_hash: "ad2d450aae96362a9d082f3989ccd04643632b17559700c16044ef32ca54d690"
files: ["src/components/GitWorkbench.tsx", "src/components/git-panel.tsx", "server/gitWorkbench.ts"]
commits: []
---

## 요구사항

현재 프로젝트 저장소의 변경과 커밋을 검토하고 Git 작업을 수행한다.

### 범위

- 커밋 그래프·변경 파일·diff, 작업트리 전체 stage·커밋을 제공한다.
- 브랜치·태그 생성·detached checkout·cherry-pick·revert를 제공한다.

### 경계와 제한

하위 저장소 목록은 표시하지 않는다. 하위 프로젝트의 Git은 해당 프로젝트 탭에서 연다. AI Commit은 안내만 제공하며 자동 메시지를 생성하지 않는다.

### 상세 계약

[프로젝트·파일 사용법](../../guides/projects.md)

상위: [분야 지도](MOC.md) · [상위 기능](../git.md).

<!-- mew:implementation:start -->
## 구현 내용

커밋 그래프·변경 파일·diff, 작업트리 전체 stage·커밋을 제공한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다: 현재 탭 저장소만 표시되고 커밋 전 작업트리 전체 변경 범위와 위험 작업 확인이 정확한지 확인한다.

<!-- mew:validation:end -->
