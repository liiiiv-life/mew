---
title: "Mew ADR — 프로젝트·Documents·Git"
created: 2026-09-11
updated: 2026-10-07
description: "독립 전 Mew ADR의 주제별 분류를 보존한 이력 지도. 현재 계약은 Mew 자체 문서와 후속 결정을 따른다."
---

상위: [Mew ADR 지도](../MOC.md). 상태가 `채택`이어도 상단의 **후속 결정**이 있으면 변경 범위를 함께 확인한다.

## History / raw — 당시 분류

- [0202 — 계정별 에이전트 설정](../../0202-mew-account-agent-settings.md)

- [0200 — 계정별 활성 프로젝트와 요청 경로](../../0200-mew-account-active-workspace.md) — 0086·0093의 전역 루트·전환 알림 변경

- [0198 — 기능 제목 인라인 수정](../../0198-mew-inline-feature-title.md)

- [0196 — 기능 파일명·문서 계층과 단순 패널](../../0196-mew-file-backed-feature-tree.md)

- [0191 — Documents 상위·하위 문서와 대표 파일](../../0191-mew-documents-parent-and-child-pages.md)

- [0190 — 탐색기 상단 전환과 문서 폴더 진입점](../../0190-mew-explorer-top-toggle-and-docs-entry.md)

- [0180 — 탐색기 Documents·Files 하단 전환](../../0180-mew-explorer-documents-files-toggle.md)

- [0179 — Mew 계정별 Git 제공자 연결](../../0179-mew-account-git-connections.md)

- [0177 — 프로젝트가 소유하는 공통 아이콘](../../0177-mew-project-owned-icons.md)

- [0172 — Git 패널 GitHub CLI 로그인](../../0172-mew-github-cli-login.md)

- [0171 — 에이전트 기본 지침 설정과 Markdown 기준본](../../0171-mew-agent-guidance-settings.md)

- [0170 — Git 선택 파일 커밋과 기본 작성 영역](../../0170-mew-git-selected-files-and-composer.md)

- [0168 — Git 변경사항·커밋 기록 분할](../../0168-mew-git-changes-history-split.md)

- [0165 — 공통 에이전트 안내 파일](../../0165-mew-common-agent-guidance-file.md)

- [0166 — Git AI Commit 전용 tmux·ACP 초안 생성](../../0166-mew-git-ai-commit-drafts.md)
- [0174 — Mew 커밋 스킬과 작업 단위 자동 커밋](../../0174-mew-commit-skill-and-automatic-commits.md) — 0166·0170의 AI 초안 경계 변경
- [0175 — Git 기록·변경·입력 순서](../../0175-mew-git-history-changes-composer-order.md) — 0170의 기본 세로 배치 변경

- [0160 — Git 패널은 현재 프로젝트만 열기](../../0160-mew-git-current-project-only.md)
- [0158 — 하위 프로젝트는 프로젝트 탭으로 열기](../../0158-mew-subprojects-open-root-tabs.md)
- [0155 — 프로젝트 컨텍스트 자동 전달과 문서 초기화](../../0155-mew-project-agent-context.md)

- [0151 — 중첩 하위 프로젝트](../../0151-mew-nested-subprojects.md) — 모든 깊이의 .mew 판별·우클릭 생성

- [0135 — Git 저장소 탭과 공통 작업 패널](../../0135-mew-git-workspace-panel.md)
- [0134 — 작업 패널 분리와 공통 도킹](../../0134-mew-dockable-workspace-panels.md)
- [0133 — 브라우저 캐시 공통 예산·자동 정리](../../0133-mew-browser-cache-budget-and-retention.md)

- [0115 — Git은 헤더 메뉴에서 저장소를 골라 연다](../../0115-mew-git-menu-and-repository-picker.md)
- [0114 — Git 워크벤치는 사이드바 팝업으로 연다](../../0114-mew-git-workbench-popup.md) — 그래프·상세·diff 계층; 패널 수명주기는 0135
- [0113 — 프로젝트 브라우저와 Git 워크벤치는 파일 탭 모델을 공유한다](../../0113-mew-project-browser-and-git-workbench-tab.md) — 프로젝트 탐색·Git API 경계; 파일 탭은 0114에서 제거
- [0094 — 작업 화면 상태는 계정에 귀속한다](../../0094-mew-account-synced-workspace-ui-state.md) — 계정 UI 원장; 통합 패널·트리 앵커는 0119·0125
- [0086 — 루트 프로젝트 전환은 SPA 안에서 캐시를 교체한다](../../0086-mew-root-project-spa-handoff-and-cache.md)
- [0085 — 탐색기는 루트 내용과 하위 프로젝트를 분리해 보인다](../../0085-mew-explorer-root-and-subproject-sections.md)
- [0083 — 탐색기 Documents와 .mew 하위 프로젝트](../../0083-mew-explorer-documents-and-mew-subprojects.md) — .mew 표식; 트리 배치는 0085, 중첩 판별은 0151
- [0081 — 루트 프로젝트 탭과 Git 하위 프로젝트](../../0081-mew-root-project-tabs-and-git-subprojects.md) — 루트 프로젝트 경계; 트리·전환·탭 저장은 후속 결정 적용
- [0080 — 서버 파일 탐색기는 프로젝트와 분리된 셸 권한 도구](../../0080-mew-server-file-explorer.md)
- [0068 — 모바일 프로젝트 탭은 한 번에 연다](../../0068-mew-mobile-project-tabs-open-directly.md)
- [0053 — docs 폴더는 워크스페이스 루트에서 선택](../../0053-mew-docs-folder-chosen-in-workspace-root.md)
- [0042 — 홈 탭과 런타임 워크스페이스 전환](../../0042-mew-home-tab-and-workspace-switch.md) — 홈 위젯 기반; 할 일 원장·고정 홈 탭은 후속 결정 적용
- [0041 — docs는 워크스페이스의 특별 레포](../../0041-mew-docs-as-workspace-special-repo.md) — docs 특별 식별자; 위치·헤더 배치는 후속 결정 적용
- [0018 — 프로젝트 전환은 URL 대신 탭](../../0018-mew-project-tabs-replace-routes.md)
