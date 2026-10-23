---
title: "문제 해결 (Troubleshooting)"
description: "로그인·서버 접속·편집·Git·에이전트·DB·원격 화면의 증상별 확인 위치를 안내하고, Windows WSL 멈춤과 WSLg 반복 충돌을 구분해 진단·우회·복구한다."
created: 2026-10-11
updated: "2026-10-15"
상위파일: "MOC.md"
---

증상이 생긴 기능부터 확인한다. 서버를 다시 시작하기 전에는 저장 상태와 진행 중인 에이전트·터미널 작업을 확인한다.

| 증상 | 먼저 확인할 것 | 자세한 안내 |
| --- | --- | --- |
| 주소가 열리지 않음·접속 끊김 | 서버 컴퓨터가 켜져 있는지, 로컬 주소도 열리지 않는지, 서버 상태·로그 | [실행과 업데이트](getting-started-ko.md#실행과-업데이트) |
| Mewlink는 로그인했지만 Mew에 들어가지 못함 | 기기 등록용 Mewlink 계정과 접속할 Mew 서버의 로컬 계정을 구분 | [외부 접속](getting-started-ko.md#외부에서-접속하기) |
| 폴더·버튼·파일이 안 보이거나 읽기 전용 | 기능 권한·파일 규칙과 **설정 → Dock** 표시 설정 | [계정과 권한](../configuration/accounts.md#내-계정과-계정-관리) |
| Markdown 화면 오류 | 오류 안내의 **원문 모드로 열기**로 현재 내용을 확인 | [기본 편집](editor.md#기본-편집) |
| 외부에서 고친 파일이 이전 내용으로 돌아옴 | 같은 파일을 연 Mew 편집기가 오래된 내용을 저장했는지 확인하고 편집기를 닫거나 **Revert File** 사용 | [실행·검증 규칙](../development/getting-started.md) |
| Git 저장소가 없다고 나옴 | 현재 프로젝트 폴더 자체가 Git 저장소인지 확인. 상위·하위 저장소는 자동으로 대신 열지 않음 | [Git 패널](projects.md#git-작업-패널) |
| 에이전트가 열리지 않거나 인증 실패 | 선택한 런타임의 설치·로그인·모델 설정과 패널 오류 | [런타임 설정](../configuration/agent-runtimes.md) |
| 데이터베이스가 구성되지 않았다고 나옴 | 서버의 `DATABASE_URL`과 Postgres 실행 상태 | [DB 준비](database.md#postgres만-docker-compose로-띄우기-선택) |
| 원격 데스크톱만 연결 실패 | 서버 OS의 화면·입력 권한, 로그인 데스크톱과 UDP 직접 연결 상태 | [설치와 연결](remote-desktop.md#처음-연결) · [네트워크](remote-desktop.md#네트워크와-설정) |

## WSL이 멈추거나 접속이 끊길 때

먼저 Windows는 정상인지, WSL 터미널도 응답하지 않는지, mew 접속만 끊겼는지 구분한다. mew를 켜 둔 동안 발생했다는 이유만으로 mew가 WSL을 종료시켰다고 판단하지 않는다. mew 접속만 끊겼다면 [서버 상태와 로그](getting-started-ko.md#실행과-업데이트)를 확인하고, WSL 전체가 응답하지 않으면 Windows의 WSL·VM 이벤트도 확인한다.

### WSLg의 반복 충돌

WSLg는 Linux GUI 앱을 Windows에 표시하는 WSL 구성 요소로, mew와 별개의 구성 요소다. `weston`과 `rdp-backend.so`의 반복 충돌은 WSLg 쪽 오류이며 mew와의 충돌을 의미하지 않는다. 이 로그만으로 WSL 전체 멈춤의 원인까지 확정할 수는 없다. 브라우저에서 사용하는 mew 서버·터미널·에이전트의 일반 동작에는 WSLg가 필요하지 않다.

Ubuntu 등 WSL 터미널에서 최근 GUI 충돌과 메모리 부족 종료를 따로 확인한다.

```bash
journalctl -k -b --no-pager --grep='weston|rdp-backend'
journalctl -k -b -1 --no-pager --grep='oom-kill|Out of memory|Killed process'
tail -n 40 /mnt/wslg/stderr.log
```

`weston`이 `signal 11` 또는 `segfault`로 짧은 주기에 반복 종료·재시작된다면 WSLg 문제를 의심한다. WSLg 1.0.73.2의 유사 증상은 [Microsoft WSL 이슈 #41552](https://github.com/microsoft/WSL/issues/41552)에 보고되어 있다. 메모리 부족 기록이 있다면 [에이전트 메모리 보호](../operations/agent-memory.md)도 확인한다. 이전 부팅 journal이 보존되지 않거나 WSLg를 끈 환경에서는 해당 로그가 없을 수 있다.

### Linux GUI를 쓰지 않을 때의 우회

Linux GUI 앱이 필요 없다면 WSLg를 끄고 같은 장애가 재발하는지 비교한다. Windows 브라우저에서 mew를 사용하는 방식은 유지할 수 있지만, WSLg로 표시하던 Linux GUI 앱은 사용할 수 없게 된다. 이 설정은 **모든 WSL 2 배포판에 적용**된다.

1. Windows PowerShell에서 다음 명령으로 사용자 설정을 연다.

   ```powershell
   notepad "$env:USERPROFILE\.wslconfig"
   ```

2. 기존 파일을 백업하고, 기존 `[wsl2]` 섹션에 `guiApplications=false`를 추가한다. 이미 같은 키가 있으면 값을 바꾼다. 메모리·스왑·네트워크 등 다른 설정은 유지하며 `[wsl2]` 섹션을 중복 생성하지 않는다.

   ```ini
   [wsl2]
   guiApplications=false
   ```

3. 작업을 저장하고 에이전트·터미널·Docker 등 진행 작업을 정리한 뒤, **사용자가** PowerShell에서 WSL을 종료한다. 아래 명령은 모든 실행 중인 WSL 배포판을 종료한다.

   ```powershell
   wsl --shutdown
   ```

4. Ubuntu 등 사용하는 배포판을 다시 열고, 기존 실행 방식으로 mew를 시작한다. 설정 파일을 저장하는 것만으로 현재 실행 중인 WSLg가 즉시 종료되지는 않는다.

재시작 후 같은 조건에서 장애가 재발하는지 확인한다. 계속 멈추면 WSLg를 원인으로 확정하지 말고 [Microsoft의 WSL 진단 절차](https://learn.microsoft.com/en-us/windows/wsl/troubleshooting-guide)에 따라 Windows·VM 로그를 수집한다.

GUI 지원을 복구하려면 같은 키를 `guiApplications=true`로 바꾸거나 추가한 키를 제거한 뒤 사용자가 WSL을 다시 시작한다. 설정의 의미·적용 범위·재시작 조건은 [Microsoft WSL 설정 문서](https://learn.microsoft.com/en-us/windows/wsl/wsl-config)를 따른다.
