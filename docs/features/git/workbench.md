---
id: "mew-git-workbench"
parent: "mew-git"
title: "현재 프로젝트 Git 작업 패널"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-28"
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
- 타이틀바의 아래 화살표 Pull·위 화살표 Push로 현재 브랜치와 upstream을 동기화한다.
- GitHub 로그인·연결 계정 표시·승인 코드 복사·내부 브라우저 승인·취소·재시도를 제공한다.

### 경계와 제한

- 하위 저장소 목록은 표시하지 않는다.
- 하위 프로젝트의 Git은 해당 프로젝트 탭에서 연다.
- AI 자동 커밋 실행은 선택 파일의 실제 분할 커밋을 승인하는 동작이다.
- AI 자동 커밋은 선택 범위 밖 변경을 포함하거나 push하지 않는다.
- AI 자동 커밋은 Git과 에이전트 기능 권한이 모두 필요하다.
- Pull/Push는 Git 권한과 프로젝트 전체 파일 접근, 원격 추적 브랜치가 필요하다. Pull은 fast-forward만 허용하며 Push는 현재 브랜치만 강제 덮어쓰기 없이 보낸다.

### 상세 계약

- [프로젝트·파일 사용법](../../guides/projects.md)

- 상위: [분야 지도](MOC.md) · [상위 기능](../git.md).

<!-- mew:implementation:start -->
## 구현 내용

- 다른 패널 탭 바와 같은 36px 상단 바에 Git 아이콘·제목·닫기 버튼을 표시하며 데스크톱에는 공통 이동 손잡이를 둔다.
- 상단 바는 상세·diff·로딩·저장소 없음 상태에서도 유지하며, 본문은 그 아래에서 시작한다.
- GitHub 로그인 버튼·연결 계정 정보는 패널 헤더의 닫기 버튼 왼쪽에서 제공하고 하위 저장소 선택은 제공하지 않는다.
- GitHub 계정 왼쪽에 Pull·Push 아이콘 버튼을 순서대로 표시한다. 실행 중 중복 요청을 막고 완료 후 목록을 갱신하며 커밋 초안과 파일 선택을 유지한다. 실패는 패널의 기존 오류 영역에 표시한다.
- 기본 화면은 위에서부터 한 줄 커밋 그래프·체크박스가 있는 변경 파일·작성 영역을 약 20:50:30으로 표시한다.
- 제목 오른쪽에 커밋·AI 자동 커밋 버튼을 순서대로 두고 작성 영역 위쪽 경계선을 마우스·터치로 끌어 높이를 조절한다. 에이전트 입력창과 같은 경계선 강조와 12px 조작 영역을 사용하며 방향키·Home/End도 지원한다.
- 선택 파일 수는 전체 선택 체크박스 오른쪽·변경사항 제목 왼쪽에 숫자만 표시한다. 커밋 작성란 아래의 선택 개수 표시는 제거한다.
- 각 목록은 따로 스크롤하며 경계 드래그·키보드로 높이 비율을 조절한다.
- 커밋 시간은 분·시간·일 중 가장 큰 단위 하나로 표시한다.
- 중복된 프로젝트 루트 문구·빈 상단 바는 제거했다.
- 기본 목록에서 변경 파일 diff로 바로 이동하고 복귀할 수 있으며 선택 파일 커밋은 기본 작성 영역에서 실행한다.
- 체크하지 않은 파일의 stage 상태는 보존한다.
- AI 자동 커밋은 선택 파일만 분석하며 에이전트셋의 런타임·모델·역할을 작업에 고정하고 전용 tmux·ACP 세션에서 작업 단위 계획을 만들고 Mew가 여러 커밋을 실행한다.
- 이전 Codex 셋의 모델 ID 형식을 현재 연결기와 호환하며, 실패 시 단계와 상세 오류를 상태·진행 로그에 남긴다.
- [실행·저장 계약](../../development/agent-sessions.md#git-ai-commit-작업)을 따른다.
- GitHub 버튼에서 공식 `gh` 기기 코드 로그인을 시작한다.
- 인증은 서버 OS 계정의 기존 Git 작업과 공유하며, 승인 브라우저와 진행 코드는 요청한 Mew 계정에 귀속한다.
- 사용·권한·설치·제한은 [GitHub 로그인](../../guides/projects.md#github-로그인)을 따른다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

- 로컬 bare 저장소를 사용해 Pull fast-forward·분기된 이력 거부·현재 브랜치 Push·강제 덮어쓰기 금지·upstream 미설정·detached·중복 실행을 확인한다. Chromium에서는 헤더 배치·실행 중 비활성화·오류·초안 보존·저장소 없음 상태를 확인한다.
- 2026-09-28: Pull/Push 추가 후 `server/gitWorkbench.test.ts`·`server/git-panel-ui.test.ts`·`server/git-ai-commit-ui.test.ts`·`server/access-policy.test.ts`, TypeScript·대상 파일 lint·문서 검사를 통과했다. 데스크톱·모바일 캡처에서 헤더 아이콘 배치를 확인했으며 원격 전송은 임시 로컬 bare 저장소로만 검증했다.
- 전체·개별 선택을 바꾸면 변경사항 헤더의 선택 개수가 갱신되고, 0개일 때도 숫자를 표시하는지 확인한다.
- 2026-09-28: 선택 개수 위치 변경 후 기존 `server/git-panel-ui.test.ts` Chromium 검사, TypeScript·대상 파일 lint, 문서 경계·링크 검사를 통과했다.
- 2026-09-28: GitHub 로그인 정보를 패널 헤더로 옮긴 뒤 `server/git-panel-ui.test.ts`·`server/github-auth-ui.test.ts`, TypeScript·대상 파일 lint를 통과했다. 데스크톱·모바일 캡처에서 닫기 버튼 왼쪽 배치를 확인했다.
- 2026-09-28: AI 자동 커밋 버튼을 일반 커밋 오른쪽으로 옮긴 뒤 `server/git-panel-ui.test.ts`·`server/git-ai-commit-ui.test.ts`, TypeScript·대상 파일 lint를 통과했다. 데스크톱·모바일 캡처에서 두 버튼의 같은 줄 배치를 확인했다.
- 2026-09-28: 작성 영역 상단 경계선의 마우스 양방향 드래그·터치 드래그/취소·놓기 종료·하단 고정·키보드 12px 조절/Home/End·diff/닫기 후 높이 보존·기존 모서리 핸들 제거를 `server/git-panel-ui.test.ts`에서 검증했다. AI 자동 커밋 UI 회귀·TypeScript·대상 파일 lint·문서 검사도 통과했다.
- 아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다:
  - 현재 탭 저장소만 표시되고 커밋 전 선택 파일 범위와 위험 작업 확인이 정확한지 확인한다.
- 36px 상단 바·Git 아이콘/제목·GitHub/닫기 접근·상단 손잡이 도킹 이동·20:50:30 초기 비율·작성 영역 높이 조절·전체/개별 선택·선택하지 않은 staged 파일 보존·기본 변경 파일 노출·독립 스크롤·경계 드래그/키보드·모바일 한 줄 커밋·diff 복귀를 확인한다.
- AI 자동 커밋의 셋 선택·신규 생성, 여러 실제 커밋·해시·포함 파일, 중단·실패·재접속과 분석 이후 변경 감지를 확인한다.
- 부분 성공의 커밋과 선택 밖 stage·수동 초안을 보존해야 한다.
- `server/agentAcp.test.ts`와 `server/git-ai-commit.test.ts`에서 이전 모델 ID의 ACP 적용, 명시한 모델·추론 강도 유지, 구조화된 오류 보존과 실패 시 커밋·stage 미변경을 검증한다. 격리 tmux 작업도 이전 모델 ID를 사용해 실제 테스트 커밋을 생성한다.
- GitHub 미로그인/연결 계정·CLI 미설치·코드 복사·내부 승인·취소·만료·재시도·새로고침 후 재접속·동시 사용자와 부분 파일 권한 차단을 확인한다.
- 실 GitHub 승인은 사용자가 직접 확인한다.
- 2026-09-26: `server/git-panel-ui.test.ts`의 Chromium 검사로 상단 바 36px·본문 위치·데스크톱 핸들 도킹·모바일 핸들 숨김·닫기/재열기 시 초안과 diff 유지·저장소 없음 상태의 닫기를 확인했다. 데스크톱/모바일의 밝은·어두운 테마 화면도 캡처했다.

<!-- mew:validation:end -->
