---
title: "Windows 자체 가상 디스플레이·헤드리스 GPU 캡처"
created: 2026-10-01
updated: 2026-10-01
description: "Windows 자체 UMDF·IddCx 가상 화면의 드라이버·WGC 캡처·설치·서명·수명 계약과 정식 배포·헤드리스 실기 검증의 남은 조건을 설명한다."
상위파일: "MOC.md"
---

[원격 데스크톱 계약](remote-desktop.md) · [사용법](../guides/remote-desktop.md) · [ADR 0187](../../../.mew/docs/decisions/0187-mew-independent-virtual-display.md)

## 현재 제공 범위

StarDesk 없이 사용할 자체 UMDF 2·IddCx 드라이버 소스, 패키지 빌드·서명·설치기와 호스트 연동을 제공한다. **아직 정식 서명된 배포 패키지와 설치 실기 검증은 없다.** 소스 컴파일 성공을 모니터 전원 꺼짐 상태의 동작 확인으로 취급하지 않는다. 기존 `desktop-setup`은 캡처 helper만 갱신하며 드라이버를 자동 설치하지 않는다.

드라이버 설치 후 화면 목록에 `Mew 가상 화면`(`gpu:99`)을 추가한다. 기존 물리 화면을 기본으로 유지하고, 물리 화면이 없으면 가상 화면을 선택한다. 드라이버가 없고 활성 출력도 없으면 설치 필요 오류를 표시한다. 모니터 전원을 꺼도 Windows가 물리 출력을 계속 연결된 것으로 보고할 수 있으므로, 이 경우 가상 화면을 직접 선택한다. 기존 화면 선택 설정이 다음 연결에도 적용된다.

가상 화면은 같은 Windows 로그인 데스크톱의 **별도 확장 화면**이다. 계정별 격리, 물리 화면 복제, 주 화면 변경, 기존 창 자동 이동을 제공하지 않는다. 물리 모니터가 논리적으로 제거되면 Windows 자체의 창 재배치 정책이 적용된다. 물리 화면에 남은 창은 사용자가 가상 화면으로 옮겨야 한다.

## 드라이버와 수명

- `native/remote-desktop/virtual-display-driver.cpp`가 `Root\MewVirtualDisplay` 어댑터를 제공한다. 모니터는 최대 하나, 합성 EDID의 `MEW0001`, 1920×1080·60Hz다. StarDesk·타사 드라이버 DLL과 비공개 named pipe를 사용하지 않는다.
- 초기화·유휴에는 모니터·swapchain·프레임 스레드가 없다. 인증된 세션의 화면 선택에서 생성하고, 드라이버 장치 파일 핸들 하나가 소유한다. 다른 파일 핸들의 renew/release는 거부한다.
- 로컬 IOCTL은 버전·정확한 버퍼 크기·읽기/쓰기 접근권을 검사한다. 설치 시 장치 ACL은 SYSTEM·Administrators와 지정한 Windows **사용자 SID 하나**로 제한한다. 네트워크 listener는 없다. 같은 로컬 OS 사용자의 다른 프로세스까지 앱 단위로 격리한다고 주장하지 않는다.
- 정상 종료·핸들 cleanup·전원 내려감에서 모니터를 해제한다. 활성 캡처만 약 1초마다 장치 lease를 갱신하며, 갱신이 10초간 없으면 드라이버 타이머가 해제한다. 유휴에는 타이머를 재등록하지 않는다. 호스트 중단 확인 실패 후 서버는 11.25초 동안 새 호스트 실행을 지연해 이 lease도 고려한다. 드라이버 acquire가 기존 소유자를 다시 검사한다.
- 디스플레이 도착 시 기존 활성 경로를 포함한 `SetDisplayConfig`에 자체 출력만 추가한다. 영구 레이아웃 저장이나 다른 모니터 비활성화를 요청하지 않는다. OS가 디스플레이 도착·제거에 따라 창 배치를 조정할 수 있다.

## GPU와 최초 화면

`virtual-display-client.h`는 자체 장치 인터페이스만 연다. 물리 D3D11 GPU LUID를 선호 렌더 어댑터로 넘기고, OS가 swapchain에 실제 선택한 LUID를 다시 읽는다. Windows는 선호를 보장하지 않으므로 실제 GPU의 캡처·인코더를 초기화한다. 실행 중 GPU가 바뀌면 종료한다.

`gpu-windows.cpp` ABI 3은 물리·가상 출력 모두 Windows Graphics Capture `CreateForMonitor`·free-threaded 2-buffer frame pool을 사용한다. 최신 GPU 표면만 보관하고 같은 장치의 VideoProcessor로 NV12를 만들어 LUID로 제한한 Media Foundation 하드웨어 H.264 MFT에 넘긴다. 원시 픽셀 CPU Map·IPC·WASM·소프트웨어 인코더 fallback은 없다. 내부 GPU 복사가 있으므로 완전한 zero-copy라고 부르지 않는다. OS의 WGC 캡처 테두리가 보일 수 있다.

GPU 장치는 출력이 없어도 예열할 수 있다. 가상 모니터 도착·활성화는 최대 4초 안에 확인한다. 캡처 최초 표면도 4초 내에 없으면 오류로 종료한다. 캡처 스레드는 Per-Monitor DPI awareness로 실제 픽셀 좌표를 읽고, 실제 화면 좌표가 확정된 뒤 입력 어댑터를 생성한다. 뷰어의 `connected`는 두 입력 채널과 최초 `framesDecoded > 0`가 모두 충족돼야 표시한다. 영상 없는 연결은 20초 제한에서 캡처 오류로 종료한다. 검은 픽셀 자체를 오류로 판단하지 않는다.

## 빌드와 정식 서명

Windows 10 2004 이상, 로그인 사용자, GPU 드라이버와 하드웨어 H.264가 필요하다. 드라이버 빌드는 MSVC C++ Build Tools·Windows SDK·WDK를 사용한다. 기본 도구 버전은 SDK/WDK `10.0.26100.0`, UMDF 2.25, IddCx 1.4이며 x64·arm64 소스 경로를 제공한다. 실기 컴파일은 x64만 확인했다. [Microsoft WDK NuGet](https://learn.microsoft.com/en-us/windows-hardware/drivers/install-the-wdk-using-nuget)의 풀어 놓은 `c` 디렉터리도 `-Wdk`로 지정할 수 있다. 에이전트가 시스템 WDK를 설치하지 않는다.

저장소의 `native/remote-desktop`을 Windows PowerShell에서 작업 경로로 사용한다. 아직 없는 출력 디렉터리를 지정한다.

```powershell
.\build-virtual-display.ps1 -Output C:\mew-display-release
# WDK NuGet를 사용한다면 -Wdk C:\wdk-package\c
```

빌드기는 DLL·INF·카탈로그·라이선스를 만들고 Inf2Cat 검사를 수행한다. 장치 등록·인증서 설치·Secure Boot 변경은 하지 않는다. 카탈로그에는 DLL과 INF의 해시가 들어 있으므로 **생성 후 INF/DLL을 수정하지 않는다.**

기존에 발급받은 신뢰되는 코드 서명 인증서·개인 키가 `Cert:\CurrentUser\My`에 있어야 다음 단계를 실행할 수 있다. 해당 발급기관의 HTTPS RFC 3161 timestamp 주소를 지정한다.

```powershell
.\sign-virtual-display.ps1 -Package C:\mew-display-release `
  -CertificateThumbprint <발급받은_코드서명_인증서_thumbprint> `
  -TimestampUrl <발급기관의_HTTPS_timestamp_URL>
```

서명기는 현재 유효 기간·Code Signing EKU·개인 키·인증서 체인을 검사하고 카탈로그를 SHA-256으로 서명한 뒤 멤버 검증을 수행한다. 인증서를 발급하거나 자체 신뢰 루트를 설치하지 않는다. 인증서 확보·기관별 서명 서비스/정책·관리 환경의 추가 드라이버 정책은 별도 배포 조건이다. 일반 UMDF와 커널 드라이버의 서명 조건을 동일하다고 단정하지 않는다([Microsoft 서명 안내](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/windows-driver-signing-tutorial)).

현재 개발 Windows의 CurrentUser/LocalMachine `My` 저장소에는 유효한 개인 키가 있는 Code Signing 인증서가 없었다. 이 확인에서 인증서·키 원문을 출력하거나 변경하지 않았다. 따라서 이번 작업에서는 release 서명·운영 설치를 수행할 수 없었다.

## 일회성 설치와 제거

서명된 패키지를 마련한 후 **관리자 Windows PowerShell**에서 실행한다. 대상 로그인 사용자의 SID는 그 사용자로 연 Windows PowerShell의 `whoami /user`에서 확인한다. 다른 관리자 계정으로 설치할 때도 mew를 실행할 사용자의 SID를 명시한다.

```powershell
.\install-virtual-display.ps1 -Package C:\mew-display-release `
  -UserSid <mew를_실행하는_Windows_사용자_SID> `
  -SignerThumbprint <신뢰하는_릴리스_서명자_thumbprint>
```

설치기는 신뢰되는 카탈로그의 서명자와 SignTool의 INF/DLL 멤버 해시를 확인한 뒤 자체 root 장치만 등록·갱신한다. unsigned·서명자 불일치·변조 패키지를 거부한다. 그룹 SID는 거부한다. 호스트·브라우저를 관리자로 실행하지 않는다. 드라이버는 연결 전까지 화면을 추가하지 않는다. Windows가 재부팅을 요청하면 출력에 따라 사용자가 재부팅한다.

```powershell
# 장치 변경 없이 패키지 서명만 확인
.\install-virtual-display.ps1 -Package C:\mew-display-release `
  -SignerThumbprint <신뢰하는_릴리스_서명자_thumbprint> -CheckOnly
# 자체 어댑터 제거. Driver Store의 패키지와 다른 공급자 장치는 보존
.\install-virtual-display.ps1 -Remove
```

설치 후 사용자가 `./mew desktop-setup`으로 ABI 3 helper를 적용한다. 실행 중인 앱 변경은 [실행 규칙](getting-started.md)에 따라 사용자가 빌드·적용한다. 가상 화면을 선택해 실제 표시·창 이동·포인터 좌표·종료 후 화면 해제를 확인하고, 모니터 전원을 끈 상태로 재연결한다. 이 확인 전 StarDesk 제거를 지원 검증 완료로 취급하지 않는다.

## 확인한 것과 남은 검증

2026-10-01 격리된 Windows 임시 경로에서 자체 드라이버 DLL·설치 EXE·WGC GPU DLL을 MSVC로 컴파일했다. Inf2Cat signability·카탈로그 생성과 InfVerif `/u`가 오류 없이 통과했다. 서명되지 않은 패키지의 `-CheckOnly` 거부도 실제 PowerShell로 검사했다. 인증서·드라이버·디스플레이 설정·운영 helper를 설치하거나 수정하지 않았다.

기존 물리 출력에서 실제 Windows 로그인 세션 → WGC GPU 표면 → 하드웨어 H.264 → Windows Chrome 직접 전송의 반복 두 세션이 통과했다. 예열된 호스트의 로컬 첫 표시 약 297–372ms·다음 연결 135–230ms였으며, 호스트 시작·설치 시간과 인터넷 경로는 제외한다. 이 값은 **가상 모니터 성능 검증이 아니다.**

자동 검사는 파일 소유권·잘못된 renew/release·만료 후 갱신 거부·정상 cleanup·첫 디코드/입력 채널 순서·영상 없는 timeout을 확인한다. 기존 합성 WebRTC UI·보안·수명 검사도 통과했다. 정식 서명자 확보, 설치된 자체 UMDF 드라이버의 DDI/ACL/lease 실기, 모니터 전원 꺼짐·완전 headless·재부팅·화면 핫플러그·장시간 부하·소비전력은 미검증이다.
