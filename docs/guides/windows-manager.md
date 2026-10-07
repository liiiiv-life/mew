---
title: "Windows 관리 앱 사용법"
created: 2026-10-07
updated: 2026-10-07
description: "mew Manager exe의 실행 조건, 전용 WSL 설치와 재부팅 재개, 첫 로그인, 서버·업데이트·로그 사용 및 데이터 보존·복구를 안내한다."
---

# Windows 관리 앱

`mew Manager`를 실행하면 Windows·WSL·mew 상태를 확인하고 설치와 서버 실행을 관리할 수 있다. 현재 x64 개발 실행 파일이며 실제 Windows에서 실행·WSL 상태 조회를 확인했으며, 새 배포판의 전체 설치 검증과 코드 서명은 아직 완료하지 않았다. 구현·지원 범위는 [기능 문서](../features/화면·계정·운영/Windows%20설치·관리%20앱.md)가 소유한다.

## 처음 실행

Windows 10 빌드 19041 이상 또는 Windows 11의 64비트 환경, CPU 가상화, 인터넷 연결, [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)이 필요하다. Windows 11에는 보통 WebView2가 포함된다. 관리 앱 exe 자체는 별도 설치 없이 실행한다. WSL·Ubuntu·mew는 PC에 설치되고 데이터는 별도로 남는다.

1. 실행 파일을 일반 사용자로 연다. **설정**에서 첫 관리자 이메일을 입력한다. 전용 배포판 기본 이름은 `Mew`다. 같은 이름의 기존 환경이 있으면 다른 이름을 선택한다.
2. **저장하고 설치**를 누른다. WSL 준비가 필요한 경우 Windows 권한 승인 창에서 허용한다. BIOS/UEFI 가상화가 꺼져 있으면 먼저 해당 설정을 켠다.
3. **재부팅 필요**가 나오면 Windows를 다시 시작하고 같은 exe를 열어 **설치 시작**을 누른다. 다시 상태를 검사하고 이어 간다. 앱이 PC를 자동 재부팅하지 않는다.
4. 다운로드·Linux 도구·mew 빌드 단계는 **작업 로그**에서 확인한다. 실패하면 로그와 현재 상태를 확인한 뒤 다시 설치를 요청한다.
5. 준비되면 **첫 로그인 정보**의 이메일·임시 비밀번호를 확인하고 **mew 열기**로 접속한다. 첫 로그인에서 비밀번호를 바꾼다. 임시 비밀번호는 관리 앱에 영구 저장되지 않는다.

작업 폴더 기본값은 `/home/mew/workspace`다. mew에서 사용할 프로젝트를 이 폴더 아래에 둔다. Windows 탐색기에서 `\\wsl.localhost\Mew\home\mew\workspace`로 열 수 있다(배포판 이름을 변경했다면 그 이름을 사용한다). 기존 Ubuntu를 자동 수정하거나 프로젝트를 이동하지 않는다.

## 실행과 업데이트

- **개요**의 시작·중지·재시작으로 서버를 조작한다. 앱을 닫아도 실행 중인 서버는 유지된다. Windows를 재부팅한 다음에는 앱에서 다시 시작한다.
- **환경과 설치**에서 WSL와 설치 도구 버전, 실제 데이터 위치, 설치 복구를 확인한다.
- **업데이트 → 확인**은 GitHub main의 새 커밋을 확인한다. 작업 트리가 깨끗하고 로컬 커밋이 앞서지 않을 때만 **업데이트 적용**을 제공한다. 실패 출력은 **작업 로그**에서 확인하고 **업데이트 다시 시도**를 누른다. 앱을 다시 열어도 실패한 빌드의 재시도를 제공한다.
- Manager 자체는 새 exe로 교체한다. mew 데이터와 WSL은 유지된다. 진행 중인 작업이 있으면 완료 후 창을 닫는다.

원격 데스크톱 준비 버튼은 WSL 서버의 보조 구성 요소를 준비한다. Windows 바탕 화면을 공유하는 버튼은 아니다. Windows 화면 공유는 [원격 데스크톱 사용법](remote-desktop.md)을 따른다.

## 파일과 복구

| 항목 | 기본 위치 |
| --- | --- |
| 관리 앱 설정·원장·로그·배포판 | `%LOCALAPPDATA%\Mew\Manager` |
| 앱 소스 | `/home/mew/apps/mew` |
| 프로젝트 | `/home/mew/workspace` |
| 서버 설정 | `/home/mew/.config/mew/config.env` |
| 계정·세션 | `/home/mew/.local/share/mew` |
| 서버 로그 | `/home/mew/.local/state/mew/mew.log` |

GUI의 **관리 폴더 열기**는 Windows 설정·작업 로그를 연다. 서버 출력은 Windows PowerShell에서 아래 명령으로 확인할 수 있다. 기본 배포판 이름을 바꿨다면 `Mew`를 바꾼다.

```powershell
wsl -d Mew -u mew -- tail -n 80 /home/mew/.local/state/mew/mew.log
```

첫 임시 비밀번호를 잃었다면 기존 계정을 삭제하지 말고 mew CLI의 사용자 비밀번호 초기화를 사용한다. [계정 관리](getting-started-ko.md)의 명령을 따른다. 접속 불가이면 서버 로그와 WSL 네트워크를 확인하고 **재시작**한다. 외부 접속을 위한 방화벽·portproxy는 자동 설정하지 않는다.

exe만 지워도 프로젝트·계정은 남는다. `distros` 또는 WSL 배포판을 삭제하면 그 안의 프로젝트와 계정도 사라질 수 있으므로 데이터 백업 없이 삭제하지 않는다. 운영 백업은 [네이티브 배포](../deployment/native.md)의 데이터·설정·작업물 구분을 따른다.

개발·exe 생성·CI 아티팩트는 [빌드 문서](../development/windows-manager.md)에 정리한다.
