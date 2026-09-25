---
id: "mew-git-workbench"
parent: "mew-git"
title: "현재 프로젝트 Git 작업 패널"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-25"
status_hash: "ad2d450aae96362a9d082f3989ccd04643632b17559700c16044ef32ca54d690"
files: ["src/components/GitWorkbench.tsx", "src/components/git-panel.tsx", "src/components/github-account.tsx", "server/github-auth.ts", "server/github-auth-routes.ts", "src/components/git-ai-commit-dialog.tsx", "server/gitWorkbench.ts", "server/git-ai-commit.ts", "server/git-ai-commit-runner.ts", "server/git-ai-commit-routes.ts"]
commits: []
---

## 요구사항

- 현재 프로젝트 저장소의 변경과 커밋을 검토하고 Git 작업을 수행한다.

### 범위

- 커밋 그래프·변경 파일·diff, 체크한 파일의 작업트리 내용 커밋을 제공한다.
- AI 자동 커밋에서 기존 에이전트셋을 선택하거나 새로 만들고 Mew 커밋 스킬을 사용하는 전용 작업으로 선택 변경을 작업 단위로 나눠 실제 커밋한다.
- 진행 로그·취소·재접속을 제공한다.
- 브랜치·태그 생성·detached checkout·cherry-pick·revert를 제공한다.
- GitHub 로그인·연결 계정 표시·승인 코드 복사·내부 브라우저 승인·취소·재시도를 제공한다.

### 경계와 제한

- 하위 저장소 목록은 표시하지 않는다.
- 하위 프로젝트의 Git은 해당 프로젝트 탭에서 연다.
- AI 자동 커밋 실행은 선택 파일의 실제 분할 커밋을 승인하는 동작이다.
- 선택 범위 밖 변경을 포함하거나 push하지 않는다.
- Git과 에이전트 기능 권한이 모두 필요하다.

### 상세 계약

- [프로젝트·파일 사용법](../../guides/projects.md)

- 상위: [분야 지도](MOC.md) · [상위 기능](../git.md).

<!-- mew:implementation:start -->
## 구현 내용

- 단일 프로젝트 탭과 탭 바를 제거하고 커밋 기록부터 바로 표시한다.
- GitHub 로그인·닫기·이동 손잡이는 기존 본문 조작 줄에 합쳤다.
- 하위 저장소 선택은 제공하지 않으며 탭 바는 사용자 요청 전 재도입하지 않는다.
- 기본 화면은 위에서부터 한 줄 커밋 그래프·체크박스가 있는 변경 파일·작성 영역을 약 20:50:30으로 표시한다.
- 제목 옆에 커밋 버튼을 두고 아래 설명 영역의 높이를 조절할 수 있다.
- 각 목록은 따로 스크롤하며 경계 드래그·키보드로 높이 비율을 조절한다.
- 커밋 시간은 분·시간·일 중 가장 큰 단위 하나로 표시한다.
- 중복된 프로젝트 루트 문구·빈 상단 바는 제거했다.
- 기본 목록에서 변경 파일 diff로 바로 이동하고 복귀할 수 있으며 선택 파일 커밋은 기본 작성 영역에서 실행한다.
- 체크하지 않은 파일의 stage 상태는 보존한다.
- AI 자동 커밋은 선택 파일만 분석하며 에이전트셋의 런타임·모델·역할을 작업에 고정하고 전용 tmux·ACP 세션에서 작업 단위 계획을 만들고 Mew가 여러 커밋을 실행한다.
- [실행·저장 계약](../../development/agent-sessions.md#git-ai-commit-작업)을 따른다.
- GitHub 버튼에서 공식 `gh` 기기 코드 로그인을 시작한다.
- 인증은 서버 OS 계정의 기존 Git 작업과 공유하며, 승인 브라우저와 진행 코드는 요청한 Mew 계정에 귀속한다.
- 사용·권한·설치·제한은 [GitHub 로그인](../../guides/projects.md#github-로그인)을 따른다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

- 아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다:
  - 현재 탭 저장소만 표시되고 커밋 전 선택 파일 범위와 위험 작업 확인이 정확한지 확인한다.
- 탭 바·상단 예약 공간 없음·GitHub/닫기 접근·손잡이 도킹 이동·30:50:20 초기 비율·작성 영역 높이 조절·전체/개별 선택·선택하지 않은 staged 파일 보존·기본 변경 파일 노출·독립 스크롤·경계 드래그/키보드·모바일 한 줄 커밋·diff 복귀를 확인한다.
- AI 자동 커밋의 셋 선택·신규 생성, 여러 실제 커밋·해시·포함 파일, 중단·실패·재접속과 분석 이후 변경 감지를 확인한다.
- 부분 성공의 커밋과 선택 밖 stage·수동 초안을 보존해야 한다.
- GitHub 미로그인/연결 계정·CLI 미설치·코드 복사·내부 승인·취소·만료·재시도·새로고침 후 재접속·동시 사용자와 부분 파일 권한 차단을 확인한다.
- 실 GitHub 승인은 사용자가 직접 확인한다.

<!-- mew:validation:end -->
