---
title: "한 명령 실행과 사전 빌드 배포"
description: "루트 앱 메타데이터와 @liiiiv/mew-cli의 분리, s-saens/mew 릴리스 다운로드·체크섬·캐시, 현재 폴더·영구 데이터 분리, 첫 owner 설정과 햄버거 메뉴의 Mewlink 연결, 중복 실행·업데이트 경계를 정의한다. 구현·격리 검증을 마쳤으며 최초 GitHub·npm 발행과 플랫폼 실기 검증은 별도다."
updated: "2026-10-23"
상위파일:
  - "architecture.md"
  - "../deployment/cli-release.md"
---

## 사용자 흐름

첫 릴리스와 npm 패키지를 게시한 뒤 Node.js 24가 설치된 컴퓨터의 작업 폴더에서 `npx @liiiiv/mew-cli@latest`를 실행한다. 런처는 해당 버전·OS·아키텍처용 서버·화면·의존성을 받아 로컬 서버를 포그라운드로 실행한다. 앱 저장소 clone, 사용자 컴퓨터의 TypeScript/Vite 빌드, C/C++ 컴파일·tmux 설치는 필요하지 않다. Git 작업에는 호스트의 Git이 필요하며 외부 AI 도구의 설치·인증과 원격 데스크톱 OS 권한은 기존 절차를 따른다.

기존 owner가 없으면 이메일을 받아 임시 비밀번호를 터미널에 표시한다. 기존 계정은 재사용하고 비밀번호를 재설정하지 않는다. 로그인 후 비밀번호를 변경하고 **Mewlink → 원격 접속 → 기기 등록**으로 기존 Mewlink 등록을 진행한다. 런처는 등록 완료 링크와 온라인 접속 주소가 바뀔 때 QR을 출력한다. 신규 중앙 인증·익명 작업 권한을 추가하지 않는다. 첫 등록에는 브라우저에서의 Mewlink 로그인과 기기 이름 선택이 필요하다.

기존 등록은 다음 실행에서 재사용한다. Ctrl+C는 로컬 서버를 종료하며 영구 상태를 보존한다. 절전·중앙 단절·WebRTC 직접 연결 제한과 실제 외부망 검증 범위는 [원격 접속 계약](remote-access.md)을 따른다.

## 실행 계약

루트 `package.json`의 `mew-ide` 메타데이터와 실행 패키지 `apps/cli`는 별개다. 루트는 `main`·`bin`을 노출하지 않으며 실제 `mew` 명령은 `@liiiiv/mew-cli`의 `bin/mew.mjs`가 제공한다.

| 항목 | 경계 |
| --- | --- |
| npm 패키지 | `apps/cli/`, `@liiiiv/mew-cli`, 실행 파일 `mew`, 초기 버전 `0.1.0` |
| 지원 런타임 | Node.js 24 major 고정. Linux glibc 2.35 이상·macOS 15 이상, 각각 x64/arm64. Windows는 WSL 2의 Linux 환경 |
| 실행본 | GitHub `s-saens/mew`의 `mew-cli-v<버전>` 릴리스, `mew-runtime-<platform>-<arch>.tar.gz` |
| 기본 작업 폴더 | 실행한 현재 폴더. `--workspace`로 변경 |
| 설정 | 기존 XDG `mew/config.env`를 읽되 CLI 옵션·명시 환경변수가 우선. 작업 폴더는 과거 `MEW_WORKSPACE` 대신 이번 실행 폴더를 사용 |
| 영구 데이터 | `--data-dir` → 명시 `MEW_DATA_DIR` → 기존 config.env → XDG 데이터 `mew/` 순서. 앱 캐시 안에 저장하지 않음 |
| 실행본 캐시 | `${XDG_CACHE_HOME:-~/.cache}/mew/runtimes/<버전>-<OS>-<arch>-node24`, `--cache-dir`로 변경 |
| 로컬 접속 | loopback `127.0.0.1`, 설정 포트 또는 5000. `--port 0`은 사용 가능한 포트 선택 |
| 첫 owner | `--owner-email` 또는 대화형 이메일 입력. 비대화형에서 이메일 없으면 계정을 만들지 않고 종료 |
| 기존 여러 owner | `--owner-email`로 기존 owner 선택 가능. 지정하지 않으면 기존 계정 목록의 첫 owner |
| 브라우저 | 실제 listen 완료 후 로컬 주소 열기. `--no-open`으로 생략; 자동 열기가 불가능해도 주소는 터미널에 표시 |

선택한 owner의 `user-ui-state.json` 작업 폴더를 서버 시작 전에 이번 폴더로 저장한다. 다른 계정의 폴더·계정·대화·권한은 보존한다. 기존 clone이 레포 내부 `.data/`를 사용했다면 `--data-dir /절대/기존/mew/.data`를 명시한다. 작업 폴더에서 발견한 임의 `.data/`를 자동으로 계정 저장소로 취급하지 않는다.

`apps/cli/src/lock.mjs`는 런처의 동일 데이터 중복 실행을 막고, `server/instance-lock.ts`는 source 서버·CLI host가 공통 `DATA_DIR/server.lock`을 소유하게 한다. 살아 있는 PID의 잠금을 빼앗지 않으며 죽은 PID의 잠금은 별도 회수 잠금 아래에서 복구한다. 종료 시 자기 token에 해당하는 잠금만 삭제한다. 이전 버전 `./mew`의 XDG `mew.pid`가 살아 있으면 CLI를 시작하지 않는다. pidfile이 없는 구버전 수동 실행은 자동 탐지 범위 밖이므로 사용자 종료 후 전환한다. 기존 서버를 런처가 강제로 종료하지 않는다.

## 다운로드와 패키지 경계

`SHA256SUMS`의 대상 파일 체크섬과 실제 바이트를 대조한 후 사용자 캐시의 임시 폴더에서 압축을 해제한다. 절대 경로·상위 탈출·패키지 밖 링크·장치 파일·과도한 용량을 거절하고, 내부 npm 실행 파일 및 workspace 상대 링크는 보존한다. manifest의 버전·플랫폼·아키텍처·Node major·진입점과 필수 파일을 확인한 뒤 디렉터리를 원자적으로 공개한다. 동시 다운로드는 완성된 캐시 하나를 재사용한다. 실패한 다운로드는 임시 폴더를 정리한다.

이미 확인된 버전의 캐시는 네트워크 없이 재사용한다. 캐시가 손상되면 해당 실행본 폴더만 삭제하도록 안내하며 계정 데이터나 사용자 프로젝트를 삭제하지 않는다. 체크섬은 릴리스 전송 무결성 검사이며 공급자 계정의 침해를 독립적으로 증명하는 서명은 아니다.

런타임은 `server/cli-host.js`를 별도 프로세스로 시작한다. `cli-host.ts`의 IPC는 계정 준비 요청·임시 비밀번호·실제 listener 주소·공개 원격 상태만 전달하며 등록 키·세션 token을 보내지 않는다. 부모 종료·IPC 단절·SIGINT/SIGTERM은 host 종료로 이어진다.

`MEW_DISTRIBUTION=release`는 런처가 설정한다. 이 배포형의 앱 업데이트 상태 조회는 Git을 호출하지 않는다. source 빌드·재시작·pull 작업과 번들 tmux 개별 업데이트를 거절하고 `npx @liiiiv/mew-cli@latest` 재실행을 안내한다. 외부 에이전트의 기존 업데이트 경계는 유지한다. 실행 중 앱 자동 교체는 제공하지 않으며, 최신 npm 버전 조회도 npx가 담당한다.

## 검증과 적용

CLI 다운로드·캐시·탈출 링크·중복 실행, owner 생성·충돌·취소·작업 폴더·실제 readiness 이벤트·원격 상태 필터, 런타임 소스 변환·worker/import/export·개인 파일 제외와 release 운영 작업 차단을 격리 fixture로 검사한다. [릴리스 절차](../deployment/cli-release.md)의 네이티브 로드·지원 플랫폼·실제 외부 접속 확인은 별도 게이트다.

앱 빌드·현재 서버 실행/재시작·GitHub Release 생성·npm 발행은 이 구현 작업에서 실행하지 않았다. 따라서 게시 전의 npm 명령을 이미 사용 가능한 설치 경로로 안내하지 않는다.
