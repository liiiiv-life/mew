---
id: "mew-shared-memo"
parent: "mew-collaboration"
title: "공통 메모"
status: "changed"
created: "2026-09-26"
updated: "2026-09-29"
files: ["src/components/shared-memo.tsx", "src/components/mobile-dock.tsx", "src/App.tsx", "server/shared-memo.ts", "server/collab.ts"]
commits: []
---

## 요구사항

- 서버 공통 Markdown 메모 하나를 실시간으로 함께 편집한다.
- PC·모바일 하단 독의 메모 아이콘으로 같은 팝업을 열고, 기존 독 재정렬·권한 표시를 따른다.
- `Ctrl/Cmd+M`은 닫혀 있으면 열고, 외부에 포커스가 있으면 메모로 이동하고, 내부에 포커스가 있으면 닫는다.
- 둥근 팝업에는 메모 제목·참여자 색 점·닫기 버튼과 Hotview 입력칸만 둔다. 글자 수는 표시하지 않는다.
- 제목을 잡아 움직이고 바깥 클릭에도 유지한다. 제목 옆 색으로 현재 열어 둔 사람 수를 확인한다.
- 네 변과 네 모서리를 끌어 8방향으로 크기를 조절한다. 최소 크기와 화면 경계를 지키며 같은 페이지에서 닫았다 열어도 조절한 크기를 유지한다.

- 모바일 키보드에 팝업이 가려지면 위로 이동한다. 공간이 부족해도 팝업 상단이 화면 밖으로 나가지 않는 것을 우선하며 키보드가 닫히면 원래 위치로 돌아온다.

- 모바일 보조키는 소프트 키보드가 열린 동안에만 표시하며, 본문 포커스가 남아 있어도 키보드를 내리면 숨긴다.

### 상세 계약

- [사용법](../../guides/collaboration.md#공통-메모) · [구현·저장·권한](../../development/collaboration.md#공통-메모)
- 상위: [분야 지도](MOC.md) · [협업](../collaboration.md)

## 구현 내용

- Hotview·Yjs·PresenceDots를 재사용하며 서버 예약 방과 원자 저장 파일로 프로젝트 밖의 공통 메모를 유지한다.
- 로그인 및 협업 권한이 필요하다. 메모를 닫으면 참여자 표시에서 빠지고 현재 페이지의 문서·미전송 변경은 유지한다.
- 팝업 가장자리의 pointer capture로 마우스·터치 크기 조절을 처리하며, 초점을 둔 조절 영역에서 방향키도 지원한다.

- 첫 팝업 마운트부터 visual viewport의 크기·스크롤 변화를 감지하며, 사용자가 정한 위치와 화면에 맞춘 임시 위치를 분리한다.

- 하단 독과 같은 `useMobileKeyboard` 감지 결과를 에디터의 `showMobileKeyBar`에 전달한다. 숨길 때 Ctrl·Shift 토글을 해제한다.

## 검증

- `server/shared-memo.test.ts`: 동시 편집 병합·삭제·영속화·저장 실패·손상 보존·인증/권한 경계.
- `server/shared-memo-ui.test.ts`: 두 브라우저 Hotview 공동 편집·포커스·참여자·이동·8방향 크기 조절·반대쪽 변 고정·최소 크기·화면 경계·키보드·모바일 터치·닫기·재접속.
- 2026-09-27: UI 테스트의 서버 타입 검사 오류를 수정하고 `npx tsc -b`와 해당 Chromium 테스트를 통과했다.
- 2026-09-28: 8방향 크기 조절을 포함한 Chromium UI 테스트·앱 타입 검사·변경 코드 lint·문서 경계/링크 검사를 통과했다. 전체 타입 검사는 수정 범위 밖 `server/git-panel-ui.test.ts:262`의 TS2349 오류로 통과하지 못했다.
- 2026-09-29: 기존 크기 조절 구현을 재검증해 Chromium UI 테스트·전체 타입 검사(`npx tsc -b`)·변경 코드 lint를 통과하고 PC 다크·모바일 라이트 화면을 확인했다.
- 모바일 키보드 모의 viewport 검사: 최초 열기 직후 감지·가려지지 않을 때 위치 유지·겹친 만큼 상승·공간 부족 시 상단 우선·화면 스크롤 보정·키보드 닫힘 후 원위치 복원을 확인한다.
- 실제 배포 화면은 사용자 빌드·재시작 후 확인한다.

- `server/shared-memo-ui.test.ts`: 키보드가 없는 최초 상태·포커스를 유지한 키보드 닫기·다시 열기·Ctrl/Shift 초기화·visual viewport만 축소되거나 창 높이까지 축소되는 환경에서 보조키 표시를 검사한다.
