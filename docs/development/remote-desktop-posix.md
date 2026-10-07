---
title: "Mac/Linux 상주 네이티브 GPU 호스트"
created: 2026-10-01
updated: 2026-10-07
description: "Mac/Linux 상주 Node 호스트의 하드웨어 H.264 High/Baseline·4K와 고주사율 요청, 직접 입력·압축 프레임 제한, OS별 권한·설치·세션 수명과 실제 검증 범위를 정의한다."
---

# Mac/Linux 상주 네이티브 GPU 호스트

[개발 지도](MOC.md) · [공통 전송·입력 계약](remote-desktop.md) · [ADR 0188](../../../.mew/docs/decisions/0188-mew-posix-native-desktop.md)

## 공통 아키텍처

`desktop-resident-host.ts`는 지원 OS 모두에서 서버 시작 시 준비된 전용 Node 호스트를 예열한다. `native-host.mjs`·`native-direct.mjs`의 libdatachannel H.264·직접 입력 채널·인증 lease·session ID를 공유한다. TURN과 WebSocket 영상 중계는 거부한다. 대기 중 모듈·장치 객체는 유지하지만 캡처·인코딩·프레임 polling·입력 주입은 멈춘다. 접속마다 최신 화면을 조회하며 새 세션은 캡처 종료 확인 뒤에만 시작한다.

Electron renderer·canvas·비압축 화면 JS IPC를 영상 경로에서 제거한다. 작업자 스레드와 Node 사이에는 압축된 Annex-B H.264만 전달한다. native queue는 제한되며 원본 surface 단계에서 오래된 프레임을 버린다. 전송할 압축 프레임은 한 개의 ACK로 제한한다. 예측 프레임을 무작위로 버리거나 하드웨어 실패 시 소프트웨어 인코더로 폴백하지 않는다.

## 영상 경로

Mac은 `gpu-macos.m`의 ScreenCaptureKit NV12 CVPixelBuffer를 VideoToolbox에 직접 전달한다. 하드웨어·실시간·저지연 인코딩을 요구하고 B-frame을 사용하지 않는다. Metal 장치를 예열하며 원본 픽셀을 CPU로 읽지 않는다. 최신 surface를 유지해 정지 화면에서도 WebRTC 트랙이 열린 뒤 요청한 키프레임을 만들 수 있다. GPU 내부 변환·인코더 내부 복사는 남으므로 완전한 zero-copy라고 보장하지 않는다. [Apple 저지연 인코딩](https://developer.apple.com/videos/play/wwdc2021/10158/).

Linux는 `gpu-linux.cpp`의 GStreamer 파이프라인을 사용한다. VA-API `vah264enc` 또는 NVENC `nvh264enc`를 요구하며 B-frame·lookahead를 끈다. X11의 `ximagesrc`는 CPU 읽기와 GPU 업로드가 남는다. Wayland는 portal의 PipeWire FD를 캡처 파이프라인에 전달한다. VA 경로는 GPU 업로드·변환, NVENC Wayland 경로는 GL 가져오기·CUDA interop을 사용한다. compositor·플러그인의 실제 협상에 따라 복사가 달라지므로 Linux 전체를 zero-copy라고 부르지 않는다. [VA 인코더](https://gstreamer.freedesktop.org/documentation/va/vah264enc.html) · [NVENC 인코더](https://gstreamer.freedesktop.org/documentation/nvcodec/nvh264enc.html).

최대 3840×2160·240FPS·50Mbps를 요청할 수 있고 기본은 1080p·60FPS·균형(6Mbps)이다. 실제 모드는 브라우저 수신 레벨과 하드웨어 초기화 결과에 맞춘다. [공통 협상·전송 제어](remote-desktop.md#전송과-지연)가 High/Baseline 선택·level 5.2 대체 payload·유한 RTP pacing·수신 feedback·적응 bitrate를 소유한다. 압축 access unit은 최대 4MiB이며 worker에서 같은 버퍼를 transfer한다. POSIX ABI는 2로 올렸으며 기존 설치본은 새 모듈로 준비해야 한다.

Mac은 협상한 FPS를 ScreenCaptureKit 최소 간격·VideoToolbox ExpectedFrameRate·프레임 duration에 적용하고 High 또는 Baseline AutoLevel을 선택한다. 실제 SPS는 공통 sender에서 확인한다. Linux X11은 캡처 caps의 framerate를 적용하고, Wayland는 compositor가 제공하는 PipeWire 빈도에 제한된다. Linux는 선택한 profile·level을 출력 caps에 고정하고 VA의 CABAC/8×8 transform을 High에서 허용한다. NVENC의 ultra-low-latency tune과 두 프레임 VBV는 해당 속성이 있을 때만 설정한다. GOP 목표 간격은 5초이며 즉시 IDR 요청은 유지한다. 설정은 물리 화면의 주사율이나 Wayland compositor의 소스 빈도를 바꾸지 않는다. 활성 worker만 120FPS 이상에서 1ms, 그 외에는 2ms polling하며 이는 이벤트 기반 wake-up 구현이 아니다.

첫 영상과 reliable/unreliable 입력 채널이 준비되면 한 번 연결 알림을 요청한다. Mac은 UserNotifications, Linux는 D-Bus Notifications다. OS 알림 거부·서비스 부재는 전송 실패로 처리하지 않는다. 현재 POSIX는 영상에 실제 커서를 포함하며 Windows의 독립 로컬 커서와 동일한 지연 특성을 주장하지 않는다.

## 설치와 권한

`install-native-runtime.mjs`가 현재 지원 Node를 원자적으로 전용 경로에 복사하고 해당 버전의 LICENSE를 보존한다. binding import 검사만 수행하며 화면 캡처·GUI·입력을 시작하지 않는다. `install-posix-video.mjs`의 컴파일·Mac 서명까지 성공한 뒤에만 helper 준비 마커를 기록한다. 설치와 운영 서버 적용은 사용자 명령으로 수행한다.

| OS | 필수 준비 |
| --- | --- |
| macOS 13+, arm64/x64 | Apple Command Line Tools·macOS 13 이상 SDK·VideoToolbox 하드웨어 H.264·로그인 데스크톱 |
| Linux X11, arm64/x64 | C++17 compiler·pkg-config·GStreamer 1.24 이상 개발 라이브러리(app/video)·X11/Xrandr 개발 라이브러리·XTest 런타임·VA 또는 NVENC 플러그인·그래픽 드라이버 |
| Linux Wayland, arm64/x64 | Linux 공통 컴파일·GPU 준비와 PipeWire source·GL/CUDA 또는 VA 변환 플러그인·ScreenCast/RemoteDesktop portal·dbus-next Unix FD 전달용 usocket 빌드(Python/C++ 도구) |

Linux는 로그인 사용자의 DISPLAY/Xauthority 또는 Wayland·D-Bus 환경에서 실행한다. 화면 잠금을 확인할 `org.freedesktop.ScreenSaver` 또는 `org.gnome.ScreenSaver` 서비스가 없으면 제어를 거부한다. 해당 서비스가 없는 compositor에 대해서는 잠금 안전성을 검증한 별도 어댑터가 필요하다.

Mac은 자체 `MewDesktop.app`·고정 식별자 `dev.liiiiv.mew.desktop`와 같은 실행 파일로 화면 기록·손쉬운 사용 권한을 확인한다. `permissions-native.mjs`는 CoreGraphics·Accessibility API만 호출하며 캡처·입력을 시작하지 않는다. 누락된 권한만 손쉬운 사용 → 화면 기록 순으로 한 번 요청하고 새 프로세스로 재확인한다. 기존 Electron 권한은 새 앱에 승계됐다고 간주하지 않는다. 설치 시 ad-hoc 서명하며 배포용 notarization·정식 서명 패키지는 제공하지 않는다. 실제 TCC 유지 동작은 Mac 실기로 확인해야 한다.

## 외부 직결과 네트워크 승인

Mac/Linux도 공통 네이티브 STUN 재시도·활성 ICE UDP 포트의 PCP/NAT-PMP/UPnP 임시 매핑을 사용한다. Linux는 제한된 서비스 PATH를 대신해 표준 절대 경로의 `iproute2`를 사용하고 커널이 선택한 인터페이스·preferred source를 따른다. Mac은 고정 `route` 도구로 IPv4 경로를 조회한다. VPN·IPv6-only·게이트웨이 없는 경로에서 임의 LAN 공유기로 우회하지 않는다. 도구 부재·경로 조회 실패도 진단 상태로 전달한다. [외부 직결 계약](remote-desktop-connectivity.md)이 OS별 조회·lease·취소·검증을 소유한다.

Mac 앱에는 `NSLocalNetworkUsageDescription`을 제공한다. macOS 15 이상에서는 화면 기록·손쉬운 사용과 별개로 로컬 네트워크 권한이 필요할 수 있다. 시스템이 표시한 책임 앱의 승인을 따르며 Terminal/SSH 등의 예외를 앱의 영구 승계로 간주하지 않는다. Mac 방화벽 수신·Local Network, Linux의 활성 UFW/firewalld UDP 정책을 실패 복구 안내에 전달한다. 읽기 전용 조회는 예열·연결을 막지 않는다. POSIX 정책이나 전역 포트 허용을 자동 변경하지 않으며 사용자의 네트워크 승인을 대신하지 않는다.

## 안전한 수명

Mac은 로그인 console UID·화면 기록·손쉬운 사용·세션 잠금·디스플레이 상태를 검사한다. Linux는 잠금 D-Bus 신호와 bus 오류에서 입력·캡처를 중단한다. Wayland는 같은 RemoteDesktop 세션에서 ScreenCast 소스와 입력을 승인한다. PipeWire 소켓 FD는 실제 SCM_RIGHTS로 전달받아 소켓 여부를 확인하며 표준 입출력 FD를 소유하지 않는다. portal 종료·취소·D-Bus 오류는 추가 입력 없이 watchdog에서 종료한다. [Portal 계약](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.RemoteDesktop.html).

권한 회수·닫기는 승인 대기열을 우회해 즉시 abort하고 키·버튼과 WebRTC를 해제한다. native 캡처 정지와 encoder 정리가 성공해야 stop ACK를 보낸다. Mac의 비동기 ScreenCaptureKit stop 완료를 기다리며 확인 실패 시 호스트를 재사용하지 않는다. 작업자 오류에도 portal·FD를 정리한다. 각 네이티브 WebRTC attempt는 수신 전용 motion/control 채널 wrapper를 세션 종료까지 소유하고 명시적으로 닫는다. JS GC가 채널을 먼저 닫아 연결이 끊기던 공통 문제를 수정했다. 이전 세션의 알림·입력·프레임·clipboard 완료가 새 세션에 적용되지 않도록 session ID로 제한한다.

부모 종료·SIGTERM에서는 승인 회수 후 native capture와 NAT 정리를 최대 3.5초 기다리고 worker·OS 어댑터·RTC를 닫는다. 완료된 race 타이머는 제거한다. 부모의 강제 종료는 SIGTERM 이후 4초로 맞춰 이전 500ms 종료 경로에서 공유기 정리를 먼저 끊던 문제를 방지한다. 제한 시간 경과는 호스트 재사용의 성공으로 처리하지 않는다.

붙여넣기는 제출한 최대 4096자만 사용한다. Mac은 NSPasteboard, Linux는 고정 xclip/wl-copy 실행 파일을 사용한다. clipboard 자식은 세션 종료 시 정리하며 완료 뒤 현재 세션·권한을 재검사하고 Ctrl+V/Cmd+V를 주입한다. 양방향 동기화는 없다.

## 검증

2026-10-07 영상 설정·pacing·능력 협상 검증에서 Linux 운영/테스트 C++ 모듈을 별도로 경고 없이 컴파일했다. 격리 Xvfb에서 144FPS 목표의 H.264 영상·입력·권한 회수·같은 PID 재접속을 확인했고, 240FPS 요청이 현재 Chromium의 level 5.2 대체 payload에서 165FPS 목표로 연결되는 것도 확인했다. 이는 설정과 실제 네이티브 전송의 통합 검사이며 물리 GPU의 초당 144/165개 표시·입력 후 표시 지연 측정은 아니다. 해당 변경의 Mac SDK·실기 실행은 수행하지 않았다.

2026-10-01 설치·Mac 권한 모사·상주 수명·OS 경로·알림·직접 전송 검사 51개와 합성 브라우저 검사 2개를 통과했다. 격리 Linux X11 통합 검사 1개와 실제 Unix FD 전달 검사 1개도 통과했다. TypeScript(app/node)·lint·문서 링크·diff 검사를 통과했으며 lint에는 기존 경고 12개가 남아 있다. Linux 운영 및 테스트 전용 모듈은 분리해 경고를 오류로 처리하여 컴파일한다. Mac은 macOS 13.3 SDK로 Intel·Apple Silicon 소스를 문법 검사한다. Mac 실제 링크·TCC·VideoToolbox 실행과 Linux 물리 GPU 성능은 이 환경에서 확인하지 못했다.

`server/remote-desktop-linux.test.ts`는 전용 Xvfb·D-Bus에서 실제 네이티브 X11 캡처·H.264 WebRTC 첫 화면·XTest 입력·알림 요청·인증 회수·OS 잠금 시 입력 없이 종료·같은 PID 재접속·정상 종료를 검사한다. 별도 `MEW_GPU_TEST` 빌드에서만 소프트웨어 x264 인코더를 허용한다. 운영 빌드는 하드웨어 인코더만 허용하며 이 테스트로 초저지연 실측을 주장하지 않는다.

고주사율 협상 검사는 `MEW_DESKTOP_TEST_VIDEO_FPS=144`로 요청한다. 브라우저의 협상 상한과 요청이 다르면 `MEW_DESKTOP_TEST_VIDEO_EXPECTED_FPS`로 예상 적용값을 지정한다(현재 Chromium의 FHD 240 요청은 165). 이 변수는 격리 테스트의 기대값이며 운영 설정이 아니다.

`server/remote-desktop-portal.test.ts`는 격리 D-Bus portal 모사 서비스와 실제 usocket SCM_RIGHTS를 사용한다. 같은 session의 승인·소스 크기·FD 복제·소유 FD 해제를 검사한다. 실제 Wayland compositor의 승인·DMABuf 협상·GPU 입력과 같지는 않다.

2026-10-02 외부 직결 검토에서 Linux 네이티브 libdatachannel·Chromium·실제 커널 경로 조회와 격리 UDP NAT를 사용한 연결·합성 입력·재접속·두 매핑의 삭제를 통과했다. 실행 환경은 WSL의 Linux 프로세스이며 Windows 호스트나 Linux 실제 GPU 캡처를 실행한 검사가 아니다. Mac/Linux 경로·권한 설명·방화벽 진단과 종료 수명의 모사 검사도 통과했다. 관련 자동 검사 65개를 통과했으며 Windows 규칙/UAC opt-in 1개는 이 실행에서 건너뛰었다. Windows/Linux 네이티브 NAT 검사는 활성 연결의 GC 이후 새 입력 전달까지 검사했다. Windows 하드웨어 H.264 재접속 회귀 검사도 통과했다(해당 PC의 첫 표시 약 730ms, 같은 프로세스 재접속 약 163ms). 이 수치는 인터넷 지연·입력 후 표시 지연의 보장값이 아니다. 실제 Mac 네트워크 권한·방화벽·하드웨어 실행과 LTE/5G 폰 검증은 남아 있다.

```bash
env -u WAYLAND_DISPLAY -u ELECTRON_RUN_AS_NODE \
  MEW_DESKTOP_TEST_LINUX_HELPER=/absolute/path/to/isolated-helper \
  MEW_DESKTOP_TEST_LINUX_ISOLATED=1 \
  dbus-run-session -- xvfb-run -a -s '-screen 0 1280x720x24 -nolisten tcp' \
  node --test server/remote-desktop-linux.test.ts
```

실제 Mac·Linux GPU에서는 첫 표시 시간·재접속·입력 후 표시 지연·잠금/권한 회수·정지 화면 키프레임·화면 회전/분리·알림을 별도로 확인해야 한다. Mac/Linux의 헤드리스 가상 디스플레이는 이 변경의 범위에 포함하지 않는다. 이전 Electron 검증 기록은 [역사 문서](../history/remote-desktop-posix-electron.md)에 보존한다.
