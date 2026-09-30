---
id: "mew-collaboration-presence"
parent: "mew-collaboration"
title: "참여자·활성 세션 보기"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-30"
status_hash: "64bc964f2ebbcdcec2bc83390c7f91ba8bb519df4201a59f54d46848f619d368"
files: ["src/components/active-sessions-button.tsx", "src/components/PresenceDots.tsx", "server/presence.ts", "server/presence-history.ts", "src/components/session-history.tsx"]
commits: []
---

## 요구사항

- 현재 접속과 각 사용자의 작업 위치를 확인하고 날짜별 접속 기록을 조회·내보낸다.

### 범위

- 접속 수·사용자별 기기·프로젝트·현재 파일과 작업 참여자를 표시한다.

- 접속 기록을 DB에 저장하고 날짜·사람·시간 필터, 시간대별 그래프·사람별 타임라인·엑셀 다운로드를 제공한다.

### 경계와 제한

- 보는 계정이 열람할 수 없는 프로젝트·파일 경로는 노출하지 않는다.
- 세션 목록은 실행 중인 에이전트 작업 목록과 다르다.

### 상세 계약

- [협업 사용법](../../guides/collaboration.md)

- 상위: [분야 지도](MOC.md) · [상위 기능](../collaboration.md).

<!-- mew:implementation:start -->
## 구현 내용

- 접속 수·사용자별 기기·프로젝트·현재 파일과 작업 참여자를 표시한다.

- SQLite에 접속과 관측 상태 구간을 영구 저장하고 재시작 시 미종료 구간을 마지막 관측 시각으로 닫는다.
- 기록 탭에서 현지 날짜·사람·시간으로 조회하고 같은 권한·필터로 실제 `.xlsx`를 내려받는다.
- 시간대별 접속 탭 그래프·사람별 기기 타임라인·전경 구분·상세 목록을 제공한다.
- 헤더의 모니터 화면 안에 활성 세션 수를 표시하고 버튼을 누르면 목록을 연다.
- 각 접속 탭이 보고한 작업 중 에이전트 수를 표시한다.
- 대기·일반 터미널을 제외하며 미보고·오래된 값은 `—`로 표시한다.
- 작업 현황을 보여 주기 위해 JS 메모리 표시·수집을 제거했고 사용자 요청 전 재도입하지 않는다.
- 보고 주기와 범위는 [협업 사용법](../../guides/collaboration.md#접속-중인-mew-세션)을 따른다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

- 자동 검증: `presence-history.test.ts`(저장·복구·필터·권한·XLSX), `presence-sessions.test.ts`(실제 WebSocket), `active-sessions-ui.test.ts`(테마·모바일·필터·내보내기·오류/빈 상태).
- 사용자 확인 기준:
  - 모바일·데스크톱에서 모니터 내부 숫자와 연결 중 `—` 표시를 확인한다.
  - 날짜·사람·시간 필터와 다운로드 결과의 범위가 같고 서버 재시작 후에도 기록이 남는지 확인한다.
  - 여러 기기 접속·종료가 반영되고 제한 경로가 다른 사용자에게 노출되지 않는지 확인한다.

<!-- mew:validation:end -->
