---
title: "OS 실행 계층과 Windows 네이티브"
description: "공통 mew 서버·화면을 유지하며 Windows·POSIX·Linux 구현을 분리하는 설계와 psmux·Job Object·개인 ACL·상호 인증 named pipe·플랫폼별 릴리스 계약을 소유한다. 구현 및 격리 검사와 실제 Windows·외부망 발행 게이트를 구분한다."
updated: "2026-10-14"
상위파일:
  - "architecture.md"
  - "../deployment/cli-release.md"
---

## 설계

Windows에서도 기존 mew 서버·React 화면·편집·Git·계정·Mewlink를 사용한다. OS 의존 구현만 `server/platform/`의 `windows/`·`posix/`·`linux/`로 분리한다. `platform/index.ts`는 기능 코드의 진입점이며 계약은 `platform/contracts.ts`가 소유한다. 터미널 패키지는 호스트 서버를 import하지 않고 `packages/tmux-term/src/server/backends/`의 tmux·psmux 구현을 선택한다. 얇은 npm CLI의 OS 경로·브라우저 처리는 `apps/cli/src/platform/`에 둔다.

실행·종료·IPC·저장 기능은 공통 API가 구현을 선택한다. 셸 문법·공급자 설치 가능 여부 같은 기능 정책은 해당 호출부에 남긴다. Linux cgroup·systemd 메모리 제어는 Linux 구현이 소유한다. [ADR 0209](../history/decisions/0209-mew-native-windows-host-platform.md)를 따르며, mewnager 관리 앱은 [ADR 0210](../history/decisions/0210-mew-retire-mewnager.md)에 따라 폐기하고 공통 CLI로 실행 경로를 통일한다.

```text
server/platform/
  contracts.ts · index.ts          공통 진입점·계약
  process.ts · ipc.ts · storage.ts 구현 선택
  common/                         IPC 인증·파일 경계·크론 해석
  posix/                          process group·Unix socket·XDG
  linux/                          cgroup·systemd 메모리 제어
  macos/                          OS 프로세스 지표
  windows/                        Job Object 호출·pipe·ACL·PowerShell·예약·지표
native/windows/process-host.cpp   Windows 작업 트리 소유자
packages/tmux-term/src/server/backends/  tmux·psmux
apps/cli/src/platform/            OS 경로·브라우저 열기
```

## OS별 계약

| 책임 | Linux·macOS | Windows |
| --- | --- | --- |
| 터미널 | 기존 tmux·node-pty | psmux·ConPTY, 버전·해시 고정 exe |
| 에이전트 프로세스 | 기존 분리 process group | `native/windows/process-host.exe`가 suspended child를 Job Object에 넣은 뒤 실행. handle 종료 시 모든 자손 종료 |
| 내부 IPC | 기존 owner-only Unix socket | OS 사용자·상태 경로에서 해시한 named pipe, 개인 상태 키를 사용한 상호 HMAC challenge-response |
| 개인 상태 | 기존 XDG 경로·POSIX mode | `%LOCALAPPDATA%/mew/{config,data,cache,state}`, 현재 SID와 SYSTEM의 파일 ACL |
| 셸 명령 | 기존 sh/사용자 셸 | 서버 고정 호출은 argv 보존, 사용자 명령은 PowerShell wrapper |
| 앱 릴리스 | 플랫폼별 native dependency·tmux | 플랫폼별 native dependency·psmux·process host, 내부 workspace junction 메타데이터 |

## 보안과 수명

Job Object helper는 child를 일시정지 상태로 만든 뒤 작업 그룹에 연결하고 실행한다. helper가 강제 종료돼도 job handle이 닫히며 자손이 종료된다. 일반 실행은 실제 부모 process handle도 기다려 부모가 비정상 종료됐을 때 정리한다. 독립 에이전트 감독은 이 부모 감시를 해제해 서버와 수명을 분리하고, ACP 자식 그룹은 감독의 수명과 연결한다. 워크스페이스 전환은 인증된 감독 IPC로 종료를 요청한다. PID 이름만 보고 무관한 프로세스를 종료하지 않는다. 이 수명은 [Windows Job Object 계약](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)을 사용한다.

Windows Job Object 메모리 한도는 시작 시 가용 물리 메모리의 90%를 해당 작업 트리에 적용한다. 호스트 가용 메모리 감시·대기열 중단/재개는 공통 로직을 사용한다. Linux의 동적 합산 slice 한도와 적용 단위가 다르며 `MEW_AGENT_MEMORY_SCOPE=off`는 명시적으로 메모리 한도만 해제한다. 자손 종료·부모 감시는 유지한다.

Windows의 `chmod 600/700`은 다른 사용자의 읽기를 막는 계약으로 사용하지 않는다. 상태 폴더는 inherited ACE를 제거하고 현재 OS 사용자와 SYSTEM의 접근으로 제한한다. ACL 준비가 실패하거나 상태 루트가 reparse point면 실행을 거절한다. 보호된 상태 폴더의 IPC 키는 argv·환경·로그·HTTP에 보내지 않는다.

named pipe를 연결했다고 바로 작업을 허용하지 않는다. 서버가 난수 challenge와 자기 증명을 보내고, 클라이언트가 서버 증명을 확인한 뒤 자기 증명을 돌려준다. 양쪽 증명은 endpoint·역할·난수에 묶인다. 인증 전에는 프레임 크기·시간·대기 연결 수를 제한한다. 기존 계정·프로젝트·권한 검사는 인증 뒤에도 유지한다. POSIX wire 형식은 기존 연결과 호환된다.

명령 wrapper는 사용자 텍스트를 저장된 실행 레코드에서 읽고 서버가 소유한 파일 경로만 wrapper 문법에 넣는다. 사용자 `exit`가 완료 처리를 건너뛰지 않도록 내부 PowerShell을 별도로 실행한다. ConPTY가 임의 OSC 완료 marker를 소비할 수 있어 Windows는 완료 파일과 마지막 출력 후 150ms의 유휴 시간을 확인해 콘솔을 닫는다. 실제 대량 출력·취소·Unicode·resize 검증은 Windows CI fixture의 책임이며 임의의 지연 출력을 완전히 보장하는 프로토콜로 표현하지 않는다.

Windows 파일 경계는 `path.win32.relative`에 따라 드라이브·대소문자를 정규화한다. 상대 파일 경로의 ADS·예약 장치 이름·trailing dot/space는 거절하며 실제 symlink/junction 경계는 기존 파일 권한 검사와 함께 확인한다.

## 실행·업데이트와 예약

Windows 사전 빌드 대상은 Node.js 24의 x64/arm64와 Windows 10 1809 이상·Windows 11이다. Git 기능에는 PATH의 Git for Windows가 필요하다. 사용자 작업 폴더, `%LOCALAPPDATA%/mew/data`의 계정·대화·기기 등록과 `%LOCALAPPDATA%/mew/cache/runtimes`의 실행본을 분리한다. CLI 옵션·`MEW_DATA_DIR`로 지정한 위치를 우선한다.

첫 공개 발행 후 PowerShell에서 다음과 같이 실행한다. 현재 작업에서는 npm·GitHub 실행본을 발행하지 않았다.

```powershell
cd C:\work\project
npx @liiiiv/mew-cli@latest
```

첫 실행은 기존 owner 설정 흐름과 loopback 서버·브라우저 열기·Mewlink 기기 등록을 사용한다. 업데이트는 CLI를 종료한 뒤 같은 명령을 다시 실행한다. Windows 종료는 IPC로 정상 종료를 요청하고 제한 시간이 지나면 강제 종료한다. 캐시를 설치본으로 사용하는 동안 CLI가 clone·pull·재빌드를 수행하지 않는다. 소스 개발은 MSVC 환경의 별도 Windows 릴리스 빌드가 process host를 준비해야 한다.

반복 작업은 상태 경로 해시로 식별하는 현재 사용자·일반 권한의 작업 스케줄러 항목 하나가 매분 실행한다. private `windows-schedules.cron`은 숫자·범위·목록·step·월/요일 별칭의 5필드 크론식과 PowerShell 명령을 사용하며 OS 로컬 시각으로 판단한다. 같은 분은 파일 stamp로 중복을 막고, 빈 설정 저장 시 mew의 task만 제거한다. 새 실행본의 서버 시작 시 저장된 예약의 runner 경로를 갱신한다. 기존 Windows 작업 스케줄러 항목은 수정하지 않는다. task는 1분, 각 제어 호출은 30초 제한이며 장기 에이전트 작업은 별도 psmux 세션에서 실행한다. 로그온 중 실행하며 로그아웃·절전 동안 놓친 작업을 소급 실행하는 계약은 없다.

일반 명령과 프로젝트 버튼도 PowerShell 문법을 사용한다. 기존 Bash 명령은 실행 환경에 맞게 바꿔야 한다. Cursor·Prime의 Unix 자동 설치와 현재 등록된 Antigravity 배포에는 Windows 자동 설치를 제공하지 않는다. 공급자 실행 파일·로그인·DAP 엔진은 각 공급자의 Windows 지원을 확인한다. 선택적인 원격 데스크톱·OS 권한 준비는 기존 해당 계약을 따른다.

## 재배포 고지

[psmux의 MIT 원문](https://github.com/psmux/psmux/blob/v3.4.0/LICENSE)과 수정된 portable-pty·vt100 고지를 포함한다. 바이너리와 원문 자료의 SHA-256을 고정하고 Cargo.lock의 registry 의존성 247개도 다운로드 체크섬을 확인한다. 전체 `.crate` 소스 압축본을 포함해 license·copyright·NOTICE를 보존하며 `dependencies.json`에 원래 선언과 배포에 선택한 라이선스를 적는다. OR의 허용 선택지와 AND의 모든 조건을 구분하고, 검토 목록에 없는 단독 조건·source·누락된 라이선스는 발행 패키징을 중단한다. 세부 발행 절차는 [CLI 릴리스](../deployment/cli-release.md)를 따른다.

## 구현·검증·적용

2026-10-14에 공통/OS 실행 계층·Windows CLI·릴리스·예약·상호 인증 IPC·정상 종료와 CI 검증 경로를 구현했다. 이 작업에서 확인한 범위는 다음과 같다.

- 타입 검사와 대상 린트(오류 없음, 기존 `primeAdapter.ts` 경고 1개), Linux의 CLI 격리 검사 12개를 통과했다.
- 기존 에이전트·독립 감독·명령 큐/출력 회귀 44개, 운영·로그인·Git·MCP·메모리·예약·릴리스 검사 75개 중 73개를 통과했다. Linux systemd 환경이 필요한 2개는 skip했다.
- 실제 Windows Node.js 24.21.0·PowerShell에서 CLI와 OS fixture 18개 중 17개를 통과했다. Unix legacy PID 검사 1개는 skip했다. named pipe의 올바른 키·잘못된 키·역할 replay, 현재 SID/SYSTEM ACL, 관리자 권한 없는 junction, 한글/이모지와 명시적 exit code를 확인했다. 실제 mew 서버·사용자 workspace는 실행하지 않았다.
- psmux registry 의존성 247개의 원문 `.crate` 체크섬과 라이선스 선택 가능 여부를 확인했다. 발행 패키징 자체는 실행하지 않았다.

`server/windows-native.test.ts`의 Job Object 자손/부모 종료·CMD argv·실제 psmux 생성/입력/capture/attach·ConPTY resize·명령 archive/exit/취소는 Windows x64/arm64 CI에 연결했다. 아직 MSVC 컴파일·전체 네이티브 fixture·컴파일된 mew host 시작을 실행한 결과는 없다. 작업 스케줄러의 실제 등록/권한·로그온/절전/DST, 두 아키텍처의 native dependency 설치, 공급자 실제 인증·Git credential·DAP와 외부망/휴대폰 접속도 공개 지원 전 실기 게이트다.

첫 npm·GitHub 발행과 실제 외부망·원격 데스크톱 검증은 기존 계약을 따른다. 구현·부분 실환경 검증을 이미 발행된 실행본이나 모든 공급자의 완전 호환으로 표현하지 않는다. 운영 앱 빌드·서버 실행/재시작은 에이전트가 수행하지 않는다.
