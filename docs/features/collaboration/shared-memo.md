---
id: "mew-shared-memo"
parent: "mew-collaboration"
title: "공통 메모"
status: "changed"
created: "2026-09-26"
updated: "2026-09-26"
files: ["src/components/shared-memo.tsx", "src/components/mobile-dock.tsx", "src/App.tsx", "server/shared-memo.ts", "server/collab.ts"]
commits: []
---

## 요구사항

- 서버 공통 Markdown 메모 하나를 실시간으로 함께 편집한다.
- PC·모바일 하단 독의 메모 아이콘으로 같은 팝업을 열고, 기존 독 재정렬·권한 표시를 따른다.
- `Ctrl/Cmd+M`은 닫혀 있으면 열고, 외부에 포커스가 있으면 메모로 이동하고, 내부에 포커스가 있으면 닫는다.
- 둥근 팝업에는 메모 제목·참여자 색 점·닫기 버튼과 Hotview 입력칸만 둔다. 글자 수는 표시하지 않는다.
- 제목을 잡아 움직이고 바깥 클릭에도 유지한다. 제목 옆 색으로 현재 열어 둔 사람 수를 확인한다.

### 상세 계약

- [사용법](../../guides/collaboration.md#공통-메모) · [구현·저장·권한](../../development/collaboration.md#공통-메모)
- 상위: [분야 지도](MOC.md) · [협업](../collaboration.md)

## 구현 내용

- Hotview·Yjs·PresenceDots를 재사용하며 서버 예약 방과 원자 저장 파일로 프로젝트 밖의 공통 메모를 유지한다.
- 로그인 및 협업 권한이 필요하다. 메모를 닫으면 참여자 표시에서 빠지고 현재 페이지의 문서·미전송 변경은 유지한다.

## 검증

- `server/shared-memo.test.ts`: 동시 편집 병합·삭제·영속화·저장 실패·손상 보존·인증/권한 경계.
- `server/shared-memo-ui.test.ts`: 두 브라우저 Hotview 공동 편집·포커스·참여자·드래그·화면 경계·닫기·재접속.
- 실제 배포 화면은 사용자 빌드·재시작 후 확인한다.
