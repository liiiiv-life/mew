---
title: "Mew 기능 문서 정리 계획"
created: 2026-09-18
updated: 2026-10-06
description: "Mew 기능을 Documents/features의 고정 ID·계층으로 정리하고 기존 명세를 통합한 계획·소유권·이전 대응·검증 기록을 남긴다."
상위파일: "_work.md"
---

요청: Mew 자체의 기능들을 기능 GUI에서 탐색·수정·재위임할 수 있도록 단계적으로 정리한다. 저장 계약은 [기능 기반 개발](../features/%ED%84%B0%EB%AF%B8%EB%84%90%C2%B7%EC%97%90%EC%9D%B4%EC%A0%84%ED%8A%B8%C2%B7%EC%9E%90%EB%8F%99%ED%99%94/%EA%B8%B0%EB%8A%A5%20%EA%B8%B0%EB%B0%98%20%EA%B0%9C%EB%B0%9C%C2%B7Markdown%20%EB%AC%B8%EC%84%9C.md), 문서 소유권은 [공통 규칙](../../../.mew/docs/README.md)을 따른다.

## 범위와 소유권

- Mew 프로젝트의 Documents인 `mew/docs/features/`에 기능별 Markdown과 고정 ID·부모 ID를 둔다. 워크스페이스 공통 `.mew/docs/features/`에 Mew 기능을 섞지 않는다.
- 기능 문서는 제품 기능의 작업 단위·범위·관련 구현 진입점과 검토 기준을 소유한다. 기존 사용법·설정·개발 계약의 상세는 링크하며 복제하지 않는다.
- 기존 기능 전용 명세는 내용·들어오는 링크를 확인한 후 기능 문서로 통합할 수 있다. 안전하게 옮기기 어려운 상세 계약은 원래 소유 위치에 유지하고 기능에서 연결한다.
- 운영·배포·보안·중앙 ADR·과거 계획·history는 원위치에 유지한다. 빌드·배포·기능 실행·서버 원장 변경·자동 커밋은 하지 않는다.
- 구현 상태는 현재 문서·코드에 근거한다. `implemented`는 현재 구현의 목록화이며 실기기·실서비스 검증이나 사용자의 승인(`verified`)을 뜻하지 않는다. 제한·미지원 범위는 각 기능에 명시한다. 관련 커밋은 근거를 개별 검증하지 않으면 비워 둔다.

## 단계

- [x] 1. 현재 README·분야별 문서 지도·기능 저장 형식과 작업 트리 확인
- [x] 2. 프로젝트·편집·Git·협업 기능 정리
- [x] 3. 에이전트·원격 도구·데이터베이스·설정 기능 정리
- [x] 4. 기존 명세 연결·README/MOC 탐색 경로와 write-back 안내 정리
- [x] 5. 실제 기능 파서·관련 파일·문서 링크·문서 배치 검사

## 원본과 대상

| 현재 기준본 | 역할 | 기능 묶음 | 처리 |
| --- | --- | --- | --- |
| README 기능별 안내, guides/projects, configuration/search | 진입·사용법·검색 계약 | 프로젝트·파일·검색 | 작업 단위로 기능화, 상세는 원본 연결 |
| guides/editor, development/pdf-viewer | 편집 사용법·PDF 구현 계약 | 편집 | 기능별 범위·관련 파일 연결 |
| guides/projects의 Git, guides/editor의 파일 이력 | 저장소·파일 작업 계약 | Git | 서로 다른 커밋 범위를 구분 |
| guides/collaboration, development/collaboration | 협업 사용법·방/저장 계약 | 협업 | 공유 범위·권한 연결 |
| guides/terminal-agents, configuration/agent-runtimes·agent-harness, specs | 실행·설정·기능 명세 | 터미널·에이전트·자동화 | 기능별 명세와 실행 경계를 연결 |
| guides/browser·remote-desktop, development/remote-desktop | 원격 도구·지원 환경 | 브라우저·원격 도구 | 현재 제공 범위만 등록 |
| guides/database | DB 사용법·연결 | 데이터베이스 | 문서 DB와 외부 참조 구분 |
| configuration/environment, development/access-control, specs/mewcat, deployment/native | 개인 설정·권한·운영 | 설정·계정·운영 | 사용자 기능과 운영 절차를 분리 |

## 완료 기준

모든 기능이 MOC에서 도달 가능하고 GUI 파서에서 읽혀야 한다. ID 중복·없는 부모·순환·잘못된 해시·없는 관련 파일·깨진 링크가 없어야 한다. 기존 README의 현재 기능은 기능 문서 또는 명시적인 제외 범위로 추적된다. 사용자 판정이나 실행 이력을 만들어 내지 않는다.

## 정리 결과와 선택

8개 상위 기능·44개 하위 기능을 [기능 지도](../features/MOC.md)에 등록했다. 기존 `specs/`는 UI·실행·저장 세부 계약이 섞여 있어 일괄 이동하지 않았다. 기능 문서는 위임할 작업 단위와 범위만 소유하고, 기존 명세의 상세 본문은 링크로 연결했다. 원본마다 해당 기능으로 돌아가는 링크를 추가했다.

현재 소스와 대조해 발견한 과거 설명 세 곳도 갱신했다: 하위 프로젝트를 펼치는 탐색기 설명, 상위 탭에서 하위 프로젝트 명령을 여는 설명, DB 목록의 옛 헤더 아이콘 진입. 소스·실행 상태·서버 기능 원장은 변경하지 않았다. 이전 인라인 요청 UI 작업의 미커밋 변경은 보존했다.

## README 기능 대응표

현재 README 기능 안내 69행과 표 밖 스킬·MCP 안내를 아래 작업 단위로 연결했다. 설치·서버 설정·백업의 실제 절차는 기존 운영 문서를 따른다.

| README 항목 | 기능 문서 |
| --- | --- |
| 프로젝트 탭 / 클라우드 폴더 바로가기 / 새 프로젝트·Git clone | [프로젝트 열기·탭·그룹](../features/%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8%C2%B7%ED%8C%8C%EC%9D%BC%C2%B7%EA%B2%80%EC%83%89/%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8%20%EC%97%B4%EA%B8%B0%C2%B7%ED%83%AD%C2%B7%EA%B7%B8%EB%A3%B9.md) |
| Documents·하위 프로젝트·MOC | [하위 프로젝트 탭](../features/%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8%C2%B7%ED%8C%8C%EC%9D%BC%C2%B7%EA%B2%80%EC%83%89/%ED%95%98%EC%9C%84%20%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8%20%ED%83%AD.md) |
| 에이전트 문서 안내·프로젝트 초기화 | [프로젝트 문서 안내·초기화](../features/%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8%C2%B7%ED%8C%8C%EC%9D%BC%C2%B7%EA%B2%80%EC%83%89/%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8%20%EB%AC%B8%EC%84%9C%20%EC%95%88%EB%82%B4%C2%B7%EC%B4%88%EA%B8%B0%ED%99%94.md) |
| Documents 관리 | [Documents·문서 지도 관리](../features/%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8%C2%B7%ED%8C%8C%EC%9D%BC%C2%B7%EA%B2%80%EC%83%89/Documents%C2%B7%EB%AC%B8%EC%84%9C%20%EC%A7%80%EB%8F%84%20%EA%B4%80%EB%A6%AC.md) |
| 파일·폴더 관리 / 서버 전체 파일 탐색 / 숨김 목록 | [파일·폴더 탐색과 조작](../features/%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8%C2%B7%ED%8C%8C%EC%9D%BC%C2%B7%EA%B2%80%EC%83%89/%ED%8C%8C%EC%9D%BC%C2%B7%ED%8F%B4%EB%8D%94%20%ED%83%90%EC%83%89%EA%B3%BC%20%EC%A1%B0%EC%9E%91.md) |
| 파일명 검색 / 내용 검색·일괄 치환 | [파일명·내용 검색과 치환](../features/%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8%C2%B7%ED%8C%8C%EC%9D%BC%C2%B7%EA%B2%80%EC%83%89/%ED%8C%8C%EC%9D%BC%EB%AA%85%C2%B7%EB%82%B4%EC%9A%A9%20%EA%B2%80%EC%83%89%EA%B3%BC%20%EC%B9%98%ED%99%98.md) |
| 로컬 의미 검색(RAG) | [당시 RAG 기능 — 2026-09-28 제거](../history/rag-feature.md) |
| Markdown Hotview·Plain / 문서 속성·목차 / 목록 들여쓰기 | [Markdown Hotview·원문·문서 속성](../features/%EB%AC%B8%EC%84%9C%C2%B7%EC%BD%94%EB%93%9C%C2%B7%EB%AF%B8%EB%94%94%EC%96%B4%20%ED%8E%B8%EC%A7%91/Markdown%20Hotview%C2%B7%EC%9B%90%EB%AC%B8%C2%B7%EB%AC%B8%EC%84%9C%20%EC%86%8D%EC%84%B1.md) |
| 코드·텍스트 편집 | [코드·텍스트 편집과 문서 내 검색](../features/%EB%AC%B8%EC%84%9C%C2%B7%EC%BD%94%EB%93%9C%C2%B7%EB%AF%B8%EB%94%94%EC%96%B4%20%ED%8E%B8%EC%A7%91/%EC%BD%94%EB%93%9C%C2%B7%ED%85%8D%EC%8A%A4%ED%8A%B8%20%ED%8E%B8%EC%A7%91%EA%B3%BC%20%EB%AC%B8%EC%84%9C%20%EB%82%B4%20%EA%B2%80%EC%83%89.md) |
| 링크·파일 참조 / 첨부·이미지 / 선택 위치 전달 | [링크·파일 참조·첨부](../features/%EB%AC%B8%EC%84%9C%C2%B7%EC%BD%94%EB%93%9C%C2%B7%EB%AF%B8%EB%94%94%EC%96%B4%20%ED%8E%B8%EC%A7%91/%EB%A7%81%ED%81%AC%C2%B7%ED%8C%8C%EC%9D%BC%20%EC%B0%B8%EC%A1%B0%C2%B7%EC%B2%A8%EB%B6%80.md) |
| Markdown 표 | [Markdown 표 편집·복사](../features/%EB%AC%B8%EC%84%9C%C2%B7%EC%BD%94%EB%93%9C%C2%B7%EB%AF%B8%EB%94%94%EC%96%B4%20%ED%8E%B8%EC%A7%91/Markdown%20%ED%91%9C%20%ED%8E%B8%EC%A7%91%C2%B7%EB%B3%B5%EC%82%AC.md) |
| 각주·참고문헌 | [각주·참고문헌](../features/%EB%AC%B8%EC%84%9C%C2%B7%EC%BD%94%EB%93%9C%C2%B7%EB%AF%B8%EB%94%94%EC%96%B4%20%ED%8E%B8%EC%A7%91/%EA%B0%81%EC%A3%BC%C2%B7%EC%B0%B8%EA%B3%A0%EB%AC%B8%ED%97%8C.md) |
| 미디어·시트 보기 | [미디어·시트 미리보기](../features/%EB%AC%B8%EC%84%9C%C2%B7%EC%BD%94%EB%93%9C%C2%B7%EB%AF%B8%EB%94%94%EC%96%B4%20%ED%8E%B8%EC%A7%91/%EB%AF%B8%EB%94%94%EC%96%B4%C2%B7%EC%8B%9C%ED%8A%B8%20%EB%AF%B8%EB%A6%AC%EB%B3%B4%EA%B8%B0.md) |
| PDF 읽기·필기 | [PDF 읽기·필기·저장](../features/%EB%AC%B8%EC%84%9C%C2%B7%EC%BD%94%EB%93%9C%C2%B7%EB%AF%B8%EB%94%94%EC%96%B4%20%ED%8E%B8%EC%A7%91/PDF%20%EC%9D%BD%EA%B8%B0%C2%B7%ED%95%84%EA%B8%B0%C2%B7%EC%A0%80%EC%9E%A5.md) |
| 자동저장·실행 취소 | [자동저장·실행 취소](../features/%EB%AC%B8%EC%84%9C%C2%B7%EC%BD%94%EB%93%9C%C2%B7%EB%AF%B8%EB%94%94%EC%96%B4%20%ED%8E%B8%EC%A7%91/%EC%9E%90%EB%8F%99%EC%A0%80%EC%9E%A5%C2%B7%EC%8B%A4%ED%96%89%20%EC%B7%A8%EC%86%8C.md) |
| 문서 탭·분할 편집 / 패널 배치·상태 복원 / 모바일·전체화면·빠른 조작 | [패널 배치·모바일·상태 복원](../features/%ED%99%94%EB%A9%B4%C2%B7%EA%B3%84%EC%A0%95%C2%B7%EC%9A%B4%EC%98%81/%ED%8C%A8%EB%84%90%20%EB%B0%B0%EC%B9%98%C2%B7%EB%AA%A8%EB%B0%94%EC%9D%BC%C2%B7%EC%83%81%ED%83%9C%20%EB%B3%B5%EC%9B%90.md) |
| 현재 파일 커밋·이력 복원 | [현재 파일 커밋·이력 복원](../features/Git%C2%B7%EB%B3%80%EA%B2%BD%20%EC%9D%B4%EB%A0%A5/%ED%98%84%EC%9E%AC%20%ED%8C%8C%EC%9D%BC%20%EC%BB%A4%EB%B0%8B%C2%B7%EC%9D%B4%EB%A0%A5%20%EB%B3%B5%EC%9B%90.md) |
| 저장소 탐색·그래프·diff / 작업트리 전체 커밋 / 브랜치·태그·과거 커밋 작업 / 프로젝트 Git 패널 | [현재 프로젝트 Git 작업 패널](../features/Git%C2%B7%EB%B3%80%EA%B2%BD%20%EC%9D%B4%EB%A0%A5/%ED%98%84%EC%9E%AC%20%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8%20Git%20%EC%9E%91%EC%97%85%20%ED%8C%A8%EB%84%90.md) |
| 실시간 공동 편집·참여자 | [실시간 공동 편집](../features/%ED%98%91%EC%97%85%C2%B7%EB%8C%93%EA%B8%80%C2%B7%EC%B1%84%ED%8C%85/%EC%8B%A4%EC%8B%9C%EA%B0%84%20%EA%B3%B5%EB%8F%99%20%ED%8E%B8%EC%A7%91.md) |
| 활성 mew 세션 | [참여자·활성 세션 보기](../features/%ED%98%91%EC%97%85%C2%B7%EB%8C%93%EA%B8%80%C2%B7%EC%B1%84%ED%8C%85/%EC%B0%B8%EC%97%AC%EC%9E%90%C2%B7%ED%99%9C%EC%84%B1%20%EC%84%B8%EC%85%98%20%EB%B3%B4%EA%B8%B0.md) |
| 댓글·답글·멤버 멘션 | [댓글·답글·멤버 멘션](../features/%ED%98%91%EC%97%85%C2%B7%EB%8C%93%EA%B8%80%C2%B7%EC%B1%84%ED%8C%85/%EB%8C%93%EA%B8%80%C2%B7%EB%8B%B5%EA%B8%80%C2%B7%EB%A9%A4%EB%B2%84%20%EB%A9%98%EC%85%98.md) |
| 단체 채팅·DM·읽음 확인 | [단체 채팅·DM·읽음 확인](../features/%ED%98%91%EC%97%85%C2%B7%EB%8C%93%EA%B8%80%C2%B7%EC%B1%84%ED%8C%85/%EB%8B%A8%EC%B2%B4%20%EC%B1%84%ED%8C%85%C2%B7DM%C2%B7%EC%9D%BD%EC%9D%8C%20%ED%99%95%EC%9D%B8.md) |
| 게스트 열람·편집 공유 / 내 계정 / 사용자·역할 관리 | [계정·역할·기능 권한·게스트 공유](../features/%ED%99%94%EB%A9%B4%C2%B7%EA%B3%84%EC%A0%95%C2%B7%EC%9A%B4%EC%98%81/%EA%B3%84%EC%A0%95%C2%B7%EC%97%AD%ED%95%A0%C2%B7%EA%B8%B0%EB%8A%A5%20%EA%B6%8C%ED%95%9C%C2%B7%EA%B2%8C%EC%8A%A4%ED%8A%B8%20%EA%B3%B5%EC%9C%A0.md) |
| tmux 터미널 / 터미널 명령 버튼 | [tmux 셸 터미널](../features/%ED%84%B0%EB%AF%B8%EB%84%90%C2%B7%EC%97%90%EC%9D%B4%EC%A0%84%ED%8A%B8%C2%B7%EC%9E%90%EB%8F%99%ED%99%94/tmux%20%EC%85%B8%20%ED%84%B0%EB%AF%B8%EB%84%90.md) |
| AI 런타임 선택 / 런타임 설치·인증·설정 / 모델·추론·권한·기본값 | [AI 런타임 설치·인증·실행 설정](../features/%ED%84%B0%EB%AF%B8%EB%84%90%C2%B7%EC%97%90%EC%9D%B4%EC%A0%84%ED%8A%B8%C2%B7%EC%9E%90%EB%8F%99%ED%99%94/AI%20%EB%9F%B0%ED%83%80%EC%9E%84%20%EC%84%A4%EC%B9%98%C2%B7%EC%9D%B8%EC%A6%9D%C2%B7%EC%8B%A4%ED%96%89%20%EC%84%A4%EC%A0%95.md) |
| 에이전트셋·탭 관리 | [에이전트셋·탭 생성](../features/%ED%84%B0%EB%AF%B8%EB%84%90%C2%B7%EC%97%90%EC%9D%B4%EC%A0%84%ED%8A%B8%C2%B7%EC%9E%90%EB%8F%99%ED%99%94/%EC%97%90%EC%9D%B4%EC%A0%84%ED%8A%B8%EC%85%8B%C2%B7%ED%83%AD%20%EC%83%9D%EC%84%B1.md) |
| 프롬프트·스킬·파일 첨부 | [에이전트 입력·멘션·스킬·첨부](../features/%ED%84%B0%EB%AF%B8%EB%84%90%C2%B7%EC%97%90%EC%9D%B4%EC%A0%84%ED%8A%B8%C2%B7%EC%9E%90%EB%8F%99%ED%99%94/%EC%97%90%EC%9D%B4%EC%A0%84%ED%8A%B8%20%EC%9E%85%EB%A0%A5%C2%B7%EB%A9%98%EC%85%98%C2%B7%EC%8A%A4%ED%82%AC%C2%B7%EC%B2%A8%EB%B6%80.md) |
| 대화·작업 기록·메시지 큐 / 히스토리·외부 CLI 이어쓰기 | [에이전트 대화·큐·복원](../features/%ED%84%B0%EB%AF%B8%EB%84%90%C2%B7%EC%97%90%EC%9D%B4%EC%A0%84%ED%8A%B8%C2%B7%EC%9E%90%EB%8F%99%ED%99%94/%EC%97%90%EC%9D%B4%EC%A0%84%ED%8A%B8%20%EB%8C%80%ED%99%94%C2%B7%ED%81%90%C2%B7%EB%B3%B5%EC%9B%90.md) |
| 대화의 CLI 명령 | [대화에서 CLI 명령 실행](../features/%ED%84%B0%EB%AF%B8%EB%84%90%C2%B7%EC%97%90%EC%9D%B4%EC%A0%84%ED%8A%B8%C2%B7%EC%9E%90%EB%8F%99%ED%99%94/%EB%8C%80%ED%99%94%EC%97%90%EC%84%9C%20CLI%20%EB%AA%85%EB%A0%B9%20%EC%8B%A4%ED%96%89.md) |
| 계정·구독·토큰·비용 | [연결 계정·구독·사용량 보기](../features/%ED%84%B0%EB%AF%B8%EB%84%90%C2%B7%EC%97%90%EC%9D%B4%EC%A0%84%ED%8A%B8%C2%B7%EC%9E%90%EB%8F%99%ED%99%94/%EC%97%B0%EA%B2%B0%20%EA%B3%84%EC%A0%95%C2%B7%EA%B5%AC%EB%8F%85%C2%B7%EC%82%AC%EC%9A%A9%EB%9F%89%20%EB%B3%B4%EA%B8%B0.md) |
| 예약 메시지 | [에이전트 예약 메시지](../features/%ED%84%B0%EB%AF%B8%EB%84%90%C2%B7%EC%97%90%EC%9D%B4%EC%A0%84%ED%8A%B8%C2%B7%EC%9E%90%EB%8F%99%ED%99%94/%EC%97%90%EC%9D%B4%EC%A0%84%ED%8A%B8%20%EC%98%88%EC%95%BD%20%EB%A9%94%EC%8B%9C%EC%A7%80.md) |
| 기능 기반 개발 | [기능 기반 개발·Markdown 문서](../features/%ED%84%B0%EB%AF%B8%EB%84%90%C2%B7%EC%97%90%EC%9D%B4%EC%A0%84%ED%8A%B8%C2%B7%EC%9E%90%EB%8F%99%ED%99%94/%EA%B8%B0%EB%8A%A5%20%EA%B8%B0%EB%B0%98%20%EA%B0%9C%EB%B0%9C%C2%B7Markdown%20%EB%AC%B8%EC%84%9C.md) |
| 프로젝트 명령 버튼 | [프로젝트 명령 버튼](../features/%ED%84%B0%EB%AF%B8%EB%84%90%C2%B7%EC%97%90%EC%9D%B4%EC%A0%84%ED%8A%B8%C2%B7%EC%9E%90%EB%8F%99%ED%99%94/%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8%20%EB%AA%85%EB%A0%B9%20%EB%B2%84%ED%8A%BC.md) |
| 반복 예약 작업 | [반복 예약 작업](../features/%ED%84%B0%EB%AF%B8%EB%84%90%C2%B7%EC%97%90%EC%9D%B4%EC%A0%84%ED%8A%B8%C2%B7%EC%9E%90%EB%8F%99%ED%99%94/%EB%B0%98%EB%B3%B5%20%EC%98%88%EC%95%BD%20%EC%9E%91%EC%97%85.md) |
| 서버 웹 브라우저 / 브라우저 로그인·팝업 | [서버 브라우저·로그인·팝업](../features/%EB%B8%8C%EB%9D%BC%EC%9A%B0%EC%A0%80%C2%B7Android%C2%B7%EC%9B%90%EA%B2%A9%20%EB%8D%B0%EC%8A%A4%ED%81%AC%ED%86%B1/%EC%84%9C%EB%B2%84%20%EB%B8%8C%EB%9D%BC%EC%9A%B0%EC%A0%80%C2%B7%EB%A1%9C%EA%B7%B8%EC%9D%B8%C2%B7%ED%8C%9D%EC%97%85.md) |
| Android | [Android 환경 점검·화면 연결](../features/%EB%B8%8C%EB%9D%BC%EC%9A%B0%EC%A0%80%C2%B7Android%C2%B7%EC%9B%90%EA%B2%A9%20%EB%8D%B0%EC%8A%A4%ED%81%AC%ED%86%B1/Android%20%ED%99%98%EA%B2%BD%20%EC%A0%90%EA%B2%80%C2%B7%ED%99%94%EB%A9%B4%20%EC%97%B0%EA%B2%B0.md) |
| 원격 데스크톱 / 원격 입력·모바일 조이스틱 | [원격 데스크톱·터치 입력](../features/%EB%B8%8C%EB%9D%BC%EC%9A%B0%EC%A0%80%C2%B7Android%C2%B7%EC%9B%90%EA%B2%A9%20%EB%8D%B0%EC%8A%A4%ED%81%AC%ED%86%B1/%EC%9B%90%EA%B2%A9%20%EB%8D%B0%EC%8A%A4%ED%81%AC%ED%86%B1%C2%B7%ED%84%B0%EC%B9%98%20%EC%9E%85%EB%A0%A5.md) |
| 문서 안 표 DB / 프로젝트 DB 목록 / Postgres 연결 | [문서 데이터베이스·전체 목록](../features/%EB%AC%B8%EC%84%9C%20%EB%8D%B0%EC%9D%B4%ED%84%B0%EB%B2%A0%EC%9D%B4%EC%8A%A4/%EB%AC%B8%EC%84%9C%20%EB%8D%B0%EC%9D%B4%ED%84%B0%EB%B2%A0%EC%9D%B4%EC%8A%A4%C2%B7%EC%A0%84%EC%B2%B4%20%EB%AA%A9%EB%A1%9D.md) |
| DB 참조·외부 테이블 | [기존 DB·외부 Postgres 참조](../features/%EB%AC%B8%EC%84%9C%20%EB%8D%B0%EC%9D%B4%ED%84%B0%EB%B2%A0%EC%9D%B4%EC%8A%A4/%EA%B8%B0%EC%A1%B4%20DB%C2%B7%EC%99%B8%EB%B6%80%20Postgres%20%EC%B0%B8%EC%A1%B0.md) |
| 테마·언어·강조색·글꼴 / 단축키 맞춤 설정 | [화면·언어·글꼴·단축키 설정](../features/%ED%99%94%EB%A9%B4%C2%B7%EA%B3%84%EC%A0%95%C2%B7%EC%9A%B4%EC%98%81/%ED%99%94%EB%A9%B4%C2%B7%EC%96%B8%EC%96%B4%C2%B7%EA%B8%80%EA%BC%B4%C2%B7%EB%8B%A8%EC%B6%95%ED%82%A4%20%EC%84%A4%EC%A0%95.md) |
| Mewcat | [Mewcat 마스코트](../features/%ED%99%94%EB%A9%B4%C2%B7%EA%B3%84%EC%A0%95%C2%B7%EC%9A%B4%EC%98%81/Mewcat%20%EB%A7%88%EC%8A%A4%EC%BD%94%ED%8A%B8%C2%B7%EC%95%8C%EB%A6%BC%C2%B7%ED%9C%B4%EC%8B%9D.md) |
| 시스템 자원 | [시스템 자원·프로세스 보기](../features/%ED%99%94%EB%A9%B4%C2%B7%EA%B3%84%EC%A0%95%C2%B7%EC%9A%B4%EC%98%81/%EC%8B%9C%EC%8A%A4%ED%85%9C%20%EC%9E%90%EC%9B%90%C2%B7%ED%94%84%EB%A1%9C%EC%84%B8%EC%8A%A4%20%EB%B3%B4%EA%B8%B0.md) |
| 서버 설정·시작·중지·로그 / 앱 업데이트·HTTPS·백업 | [앱 업데이트·운영 진입](../features/%ED%99%94%EB%A9%B4%C2%B7%EA%B3%84%EC%A0%95%C2%B7%EC%9A%B4%EC%98%81/%EC%95%B1%20%EC%97%85%EB%8D%B0%EC%9D%B4%ED%8A%B8%C2%B7%EC%9A%B4%EC%98%81%20%EC%A7%84%EC%9E%85.md) |
| 스킬·MCP 관리(README 표 밖 안내) | [스킬·MCP 원본 관리](../features/%ED%84%B0%EB%AF%B8%EB%84%90%C2%B7%EC%97%90%EC%9D%B4%EC%A0%84%ED%8A%B8%C2%B7%EC%9E%90%EB%8F%99%ED%99%94/%EC%8A%A4%ED%82%AC%C2%B7MCP%20%EC%9B%90%EB%B3%B8%20%EA%B4%80%EB%A6%AC.md) |

## 검증 결과

- 실제 `readFeatureDocuments`와 새 임시 `FeatureStore`로 52개 항목(상위 8·하위 44)을 읽었다. 모든 항목의 ID·부모 관계·상태 해시와 직렬화 후 재읽기가 유효하고, 실행 이력은 0개다.
- 관련 소스 파일 참조 142개가 실제 파일임을 확인했다. 문서·구현 진입점 대조이며 기능 전체의 런타임 테스트를 수행했다는 뜻은 아니다.
- 프로젝트의 `check_repo_docs.py`와 `check_doc_links.py --workspace`를 통과했다.
- 스킬의 일반 `validate_ssot.py docs`는 통과하지 않는다. 이 검사기는 문서 루트 내부에 `AGENT.md`·`README.md`·ADR 지도/템플릿·작성 규칙을 모두 요구하고 문서 루트 밖 링크를 거부한다. 중앙 규칙·ADR을 링크하는 이 워크스페이스 구조 및 기존 프로젝트 문서의 프론트매터 선택 규칙과 맞지 않는다. 이를 맞추기 위해 공통 기준본을 복제하거나 기존 history를 고치지 않았으며, 프로젝트 전용 검사와 실제 기능 파서를 적용했다.

## 후속 정리 — 2026-10-06

기능 전용 Specs 7개의 상세 본문을 해당 기능 문서에 통합했다. 위 최초 정리 기록은 당시 선택의 근거로 보존한다. 현재 내용 소유권과 write-back은 [기능 문서 관리 기준](../features/README.md)을 따르며, Specs의 옛 경로는 이동 안내만 제공한다.
