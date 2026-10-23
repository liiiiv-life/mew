import snapshot from './repository-snapshot.json' with { type: 'json' }

/** A bounded starting set; the repository index supplies the remaining files on demand. */
export const DEMO_WORKSPACE_PATH = '/demo/mew-playground'
export const DEMO_FILE_PATH = 'docs/welcome.md'
export const DEMO_CODE_PATH = 'src/main.tsx'
export const DEMO_SOURCE_REVISION = snapshot.revision
export const DEMO_USER = { accountId: 'demo-visitor', email: 'visitor@example.test', displayName: 'Demo visitor', avatarDataUrl: null }

export const DEMO_FILES: Readonly<Record<string, string>> = {
  ...snapshot.files,
  [DEMO_FILE_PATH]: `---
title: "Mew 데모에 오신 것을 환영합니다"
description: "Mew 자체의 코드·문서·기능·태스크와 가상 호스트 기능을 체험하는 데모이며 수정·실행 결과는 현재 탭에만 유지된다는 안내."
tags: [mew, demo]
---

# Mew를 Mew 안에서 둘러보세요

이 작업 공간에는 **Mew 자체의 실제 코드와 문서**가 들어 있습니다. 파일을 열고 문서를 고치고 기능·태스크를 정리하며 사용해 보세요.

> **이 프로젝트는 데모입니다.**
>
> 수정은 현재 브라우저 탭의 메모리에서만 유지됩니다. 실제 Mew 프로젝트나 서버 파일에 반영되지 않으며 영구 저장되지 않습니다. 새로고침·초기화·탭 종료 시 처음 상태로 돌아갑니다.

## 어디부터 볼까요?

| 관심 있는 내용 | 시작할 파일 |
| --- | --- |
| Mew 소개 | [README](../README.md) |
| 처음 사용하기 | [첫 작업 안내](guides/first-steps.md) |
| 문서와 코드 편집 | [편집기 사용법](guides/editor.md) |
| 앱의 실제 진입 코드 | [main.tsx](../src/main.tsx) |
| 공통 기능 데이터 | [features.ts](../shared/features.ts) |
| 태스크 처리 규칙 | [task-list.ts](../shared/task-list.ts) |
| 문서 탐색·작성 방식 | [문서 규칙](README.md) |

## 작업 브랜치와 태스크도 확인할 수 있어요

**기능** 패널은 브랜치별 작업 내용·작업 폴더·미리보기 포트·검증 기록을 보여줍니다. 데모의 검색·테마 작업에서 이름과 확인 상태를 바꿔 보세요. 실제 개발 서버는 실행하지 않으므로 미리보기는 열리지 않습니다. 기존 [기능 문서](${encodeURI('features/문서·코드·미디어 편집/_문서·코드·미디어 편집.md')})는 Documents에서 열 수 있습니다.

**태스크** 패널도 [실제 작업 문서](${encodeURI('tasks/디버거 만들기.md')})를 읽습니다. 완료·태그·날짜를 바꾸거나 새 작업을 추가해 보세요. 변경된 문서를 열거나 Git에서 차이를 확인할 수 있습니다.

## 자유롭게 바꿔보세요

- 이 문서에 메모를 적고 다른 파일을 열었다가 돌아와 보세요.
- 기능 패널에서 브랜치별 작업 기록을 바꾸거나, 태스크 상태를 바꾼 뒤 연결된 문서를 확인해 보세요.
- 에이전트에게 데모 문서 정리를 부탁하고 Git에서 변경을 비교해 보세요.
- 처음 상태로 돌아가려면 상단의 초기화 버튼을 사용하세요.

에이전트와 터미널의 실행 결과는 체험용입니다. 실제 AI 모델·OS 셸·외부 서비스에 연결하거나 명령을 실행하지 않습니다. Git 커밋도 이 탭 안의 가상 이력입니다.

## 다른 기능도 둘러보세요

햄버거 메뉴에서 **원격 데스크톱·시스템 자원·예약 작업·Android·업데이트·계정 관리·Mewlink**를 열 수 있습니다. 독의 디버거에서도 가상 스택·변수·단계 실행을 체험해 보세요.

호스트 기능의 화면·수치·버전·실행 기록은 **더미 데이터**입니다. 원격 화면에서 메모를 입력하거나 Android의 메모 앱을 눌러 보세요. 예약·업데이트·권한을 바꿔도 실제 장치·계정·서버에는 반영되지 않습니다. 실제 서버 브라우저 로그인·포트 서비스 실행과 일부 고급 디버그 요청은 데모에서 실행할 수 없습니다.

## Mew 저장소 전체 둘러보기

기준은 Mew 커밋 **${snapshot.revision.slice(0, 7)}**입니다. 공개 커밋의 코드·문서·이미지와 이력·연구 자료를 탐색할 수 있습니다. 처음에는 작은 예제 사본과 파일 목록을 준비하고, 나머지 내용은 열 때 불러옵니다. 로컬 비밀 설정·실행 데이터·의존성과 빌드 산출물은 제외하며 태스크의 실제 계정 담당자 정보도 제거했습니다.
`,
}
