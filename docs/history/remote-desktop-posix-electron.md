---
title: "이전 Mac/Linux Electron 원격 데스크톱"
created: 2026-10-01
updated: 2026-10-01
---

# 이전 Mac/Linux Electron 원격 데스크톱

ADR 0188 이전의 계약과 검증 기록이다. 현재 기준은 [네이티브 POSIX 계약](../development/remote-desktop-posix.md)을 따른다.

## OS 어댑터

| 호스트 | 캡처·실행 | 입력 |
| --- | --- | --- |
| macOS 13+, x64/arm64 | 로그인한 Mac의 ScreenCaptureKit + 화면 기록 권한; 초기 실패 시 Chromium | CoreGraphics·손쉬운 사용 권한. modifier flags와 중간 버튼 드래그 유지 |
| Linux X11, x64/arm64 | 같은 DISPLAY/Xauthority의 Electron | libX11·libXtst/XTest. 누적 휠을 notch로 변환 |
| Linux Wayland, x64/arm64 | Chromium/PipeWire 화면 공유 승인 | D-Bus RemoteDesktop portal의 별도 입력 승인. XWayland 주입 폴백 없음 |
| Windows/WSL | 상주 Node + D3D11/Media Foundation 하드웨어 H.264, WSL interop | Windows SendInput·실제 픽셀 커서 위치. Linux 화면 사용 안 함 |

Mac/Linux의 Electron 44.3.0 실행 조건은 `runtime-support.mjs`가 소유한다. 설치 전·준비 상태 조회·Mac 권한 준비에서 macOS 13/Darwin 22와 x64/arm64 조건을 확인한다. 미지원 OS에는 재설치를 반복하지 않는다([Electron 44 지원 조건](https://www.electronjs.org/blog/electron-44-0)).

`host-permissions.mjs`는 고정 로컬 renderer의 요청·조회 양쪽에서 media·display-capture·직접 WebRTC용 로컬 네트워크 권한만 허용한다. 다른 WebContents·하위 프레임·종료 중 요청과 그 외 권한은 거부한다. OS의 화면 기록·portal 승인과 Electron sandbox·contextIsolation·navigation 차단은 유지한다. `display-capture`는 Chromium이 media와 별도로 검사하는 권한이다([Electron session API](https://github.com/electron/electron/blob/v44.3.0/docs/api/session.md)).

Mac의 접속 경로는 손쉬운 사용 권한을 요청 없이 확인하며 부족하면 `desktop-setup`을 안내한다. 종료 시 renderer에 즉시 stop을 보내 영상 track·WebRTC를 먼저 닫고 최대 300ms 동안 완료 응답을 기다린다. 입력 close는 최대 500ms, 네이티브 캡처 close는 병렬로 기다린 뒤 창·임시 프로필·호스트를 종료한다. Linux에서 활성 캡처를 남긴 채 창을 먼저 파괴해 정상 종료가 지연되던 경로를 방지한다. 부모의 강제 종료 상한도 유지한다.

Wayland 캡처와 입력 portal의 ScreenCast stream이 같지 않아 절대 좌표를 주입하지 않는다. 조이스틱 상대 이동·클릭·드래그·휠을 사용한다. compositor에 RemoteDesktop portal이 없으면 오류로 종료한다. 키보드 권한을 제외하면 포인터만 사용할 수 있다. PipeWire에서는 OS 선택기가 공유 소스 하나를 반환할 수 있다.

Wayland의 Session Closed·D-Bus 오류·입력 거부는 adapter의 `check()`에 보관한다. 기존 250ms 호스트 watchdog이 이를 확인해 추가 사용자 입력 없이도 세션·영상·입력을 종료한다. portal Close 실패에도 bus를 정리한다. 권한은 승인한 portal 세션 수명에만 유효하다([RemoteDesktop portal 계약](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.RemoteDesktop.html)).

붙여넣기는 사용자가 제출한 최대 4096자만 서버 클립보드에 쓰고 Ctrl+V/Mac Cmd+V를 보낸다. 양방향 클립보드 동기화·오디오·파일 전송은 구현하지 않는다. 로컬 Esc는 보조 창·전체화면·뷰어 순으로 닫으며 도구의 원격 Esc로 키를 전달한다.

## macOS 캡처·설치 계약

### Mac 터미널 권한 준비

`permissions.mjs`는 macOS에서만 `/dev/console` 소유 UID와 현재 비-root UID가 같은지 확인하고, 실제 원격 연결과 같은 설치 경로의 Electron 실행 파일로 `permissions-host.mjs`를 실행한다. 다른 OS에서는 권한 helper를 실행하지 않는다. 실행 인자는 고정된 check/accessibility/screen 중 하나이며 셸로 감싸지 않는다. `NODE_OPTIONS`와 `ELECTRON_RUN_AS_NODE`를 제거하고 고유 임시 프로필을 사용한다. 앱 바이너리·서명·권한 DB는 수정하지 않는다.

helper는 `systemPreferences.isTrustedAccessibilityClient`와 `getMediaAccessStatus('screen')`로 확인하고, 누락된 권한만 `isTrustedAccessibilityClient(true)` 또는 CoreGraphics의 `CGRequestScreenCaptureAccess`로 요청한다. 해당 Privacy 설정 URL을 열며 화면 목록·캡처·입력 어댑터·renderer는 만들지 않는다. 설정을 여는 것은 승인이 아니며 granted 상태 확인만 완료로 취급한다. 파일 설치 마커와 권한 상태는 분리한다.

손쉬운 사용 후 화면 기록 순서로 각 권한을 한 번만 요청하고, 최대 5분 동안 2초 간격(프로세스 실행 시간 별도)으로 **새 Electron 프로세스**에서 재확인한다. 앱 실행 중 권한 캐시·OS의 종료 및 다시 열기를 고려한 경로다([Electron 권한 API](https://www.electronjs.org/docs/latest/api/system-preferences)). 상태 조회는 10초, 요청은 30초 상한이며 남은 전체 예산을 넘기지 않는다. 요청 표시 후 OS 종료/시간 초과는 다음 상태 확인으로 넘기되 완료로 기록하지 않는다. 정책 제한·조회 실패·전체 대기 만료는 오류다. 같은 명령의 재실행은 OS 상태를 다시 읽는다.

Ctrl+C·SIGTERM은 AbortSignal로 현재 자식과 대기를 취소하고 130/143으로 종료한다. 자식 종료를 확인한 후 임시 프로필을 정리한다. helper도 stdin EOF·오류·35초 watchdog에서 종료한다. 서버나 이미 실행 중인 원격 세션을 종료하지 않으며 공개 포트·백그라운드 서비스도 추가하지 않는다.

검증은 `server/remote-desktop-permissions.test.ts`의 승인 순서·기존 승인·거부·제한·로그인 불일치·취소·경로/환경·실제 자식 프로세스 종료·모사 Electron API·셸 흐름 12개 테스트로 수행했다. 실제 Mac은 사용할 수 없어 OS 권한창, TCC의 실제 앱 식별·권한 유지와 승인 후 실제 캡처는 미검증이다. Mac에서 미승인 상태 → 설정 표시 → 승인 → 완료 → 실제 연결, 재실행 시 요청 생략을 별도로 확인해야 한다.

### 캡처 모듈

[ADR 0148](../../../.mew/docs/decisions/0148-mew-macos-local-cursor.md)에 따라 자체 `capture-macos.m` 모듈을 사용한다. ScreenCaptureKit API와 모듈의 배포 target은 macOS 12.3 이상이지만, 현재 전체 보조앱은 Electron 44의 요구 조건에 따라 **macOS 13 이상**에서 지원한다. 별도 서비스·계정·공개 포트를 추가하지 않는다.

- `install-macos.mjs`가 helper 준비 중 `/usr/bin/xcrun --sdk macosx clang`으로 현재 Node CPU(Apple Silicon arm64 또는 Intel x64)의 dylib를 컴파일한다. Apple Command Line Tools와 ScreenCaptureKit을 포함한 SDK가 필요하다. `codesign`의 로컬 ad-hoc 서명·검증 후 임시 파일을 원자적으로 교체한다. 컴파일/서명 실패는 준비 실패이며 `.mew-ready`를 만들지 않는다. CLT 설치·업데이트 후 다시 연결한다. 바이너리는 저장소 밖 설치 산출물이며 소스·헤더·설치 스크립트는 `HELPER_FILES`에 포함한다.
- `capture-macos.mjs`가 기존 Koffi로 작은 C ABI를 호출한다. ScreenCaptureKit 비동기 콜백은 Objective-C 내부 queue에서 처리한다. Electron main도 라이브러리를 유지하여 worker 종료 후 도착한 native stop completion이 해제된 코드에 접근하지 않게 한다. 시작 도중 닫기는 시작 completion 이후 stream까지 종료한다.
- Electron의 `display_id`를 `CGDirectDisplayID`와 맞추고 CoreGraphics의 논리 bounds를 확인한다. 화면은 배율을 반영하되 OS 변환 단계에서 최대 1920×1080의 짝수 크기·60Hz·BGRA로 제한한다. 입력·포인터 정규화는 논리 좌표를 사용하므로 Retina 및 음수 원점의 두 번째 화면에서 픽셀 배율을 중복 적용하지 않는다. 회전 화면도 화면 bounds의 종횡비를 사용한다.
- `SCStreamConfiguration.showsCursor = NO`, `queueDepth = 3`으로 화면에서 커서를 제외한다. native queue는 최신 미소비 CVPixelBuffer 하나만 보관하고 이전 surface를 해제한다. worker가 요청하면 행 stride를 반영해 이전 화면과 비교하고 변경분이 있을 때만 V8 소유 버퍼에 전체 화면을 복사한다. 유휴 상태는 픽셀 없이 응답하며 기존 생성 track·VP8·직접 WebRTC를 사용한다. GPU→CPU 복사는 남으며 zero-copy나 하드웨어 VP8 인코딩을 보장하지 않는다.
- `CGEventGetLocation`의 전역 위치와 `CGCursorIsVisible`을 읽고 AppKit main queue에서 `NSCursor.currentSystemCursor`의 모양·hotspot을 최대 30Hz 확인한다. 이미지는 논리 크기의 premultiplied BGRA, 최대 128×128로 제한하고 변경 시에만 PNG로 전송한다. 현재 OS에서 시스템 모양 조회가 nil이면 시스템 화살표를 사용한다. `currentSystemCursor`와 `CGCursorIsVisible`은 deprecated 공개 API이며 최신 macOS에서 커서 모양·숨김 상태 실기 확인이 필요하다. 비공개 API나 전역 hide/show는 쓰지 않는다.
- 첫 화면을 확보하기 전에는 커서 모양을 소비하지 않는다. 약 3초의 초기 프레임 probe에 성공해야 로컬 커서를 켠다. 초기 API/권한/화면 실패는 Chromium 영상 커서로 복귀하며 도움말에 실제 모드를 표시한다. 실행 중 stream 종료·blank/suspended/stopped·권한/활성 사용자/디스플레이 bounds·화면 크기·회전 변화는 오류로 종료한다. 연결 중 idle sleep을 막는 activity는 close 때 해제한다. 잠금·수동 절전·로그인 전 화면은 지원하지 않는다.

근거: [ScreenCaptureKit 소개](https://developer.apple.com/videos/play/wwdc2022/10156/), [프레임 상태](https://developer.apple.com/documentation/screencapturekit/scframestatus), [커서 제외](https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration/showscursor), [시스템 커서](https://developer.apple.com/documentation/appkit/nscursor/currentsystem).

## 검증

상주 호스트 테스트는 캡처 없는 예열, 종료 확인 후 프로세스 재사용, 오래된 세션의 응답·kill 격리, 종료 확인 실패의 lease 대기, 시작 실패 재시도를 확인한다. WebSocket 테스트는 인증 회수·단일 제어권과 relay/relay-input/frame-ack 거부를 확인한다. 기존 합성 Chromium 테스트는 직접 WebRTC 영상·모바일 입력을 검사한다.

알림 검사는 첫 디코드와 두 입력 채널의 준비 전 전송 금지, 연결당 한 번 표시, 재접속, 종료 후 응답 무시, OS 알림 오류 격리를 확인한다. 합성 Chromium 검사는 실제 WebRTC의 reliable 채널에서 호스트 알림 신호를 확인하며 OS 팝업 자체는 따로 실기 확인한다.

2026-10-01 알림·연결 준비·설치·WebSocket·입력·합성 Chromium 검사 54개와 Windows 네이티브 컴파일을 통과했다. 격리된 Windows Node에서 알림 시작·취소를 32회 반복한 뒤 프로세스 핸들 수가 증가하지 않음을 확인했다. 실제 로그인 화면의 Windows 팝업과 Mac/Linux의 OS 알림 표시는 사용자 적용 후 확인할 항목이다.

같은 날 Mac/Linux 보완은 OS별 설치·권한 제한·입력·준비·알림 검사 40개와 합성 Chromium UI 검사 2개를 통과했다. 별도 Linux 프로세스의 실제 Electron·X11 캡처/XTest 입력·Chromium 직접 WebRTC 검사도 통과했다. 첫 영상·두 입력 채널·연결당 한 번의 D-Bus 알림 요청·키/버튼 주입·인증 회수 후 해제·정상 종료 코드 0·재접속·뷰어 닫기 후 정상 종료·서버 영상 중계 없음까지 확인했다. Xvfb와 별도 D-Bus 알림 서비스에서 검사했으므로 물리 GPU 성능·실제 데스크톱 알림 팝업의 확인은 포함하지 않는다. Mac ScreenCaptureKit 실기 검사는 실행 환경이 없어 건너뛰었으며, 실제 Mac TCC·알림과 Wayland compositor의 승인/회수 검증도 남아 있다.

Linux 실기 경로 검사는 `server/remote-desktop-linux.test.ts`의 opt-in이다. 별도 helper 복사본에 의존성·Electron을 설치하고, Xvfb·xauth·dbus-run-session·libX11·libXtst 및 테스트용 Chromium을 준비한다. 아래 명령은 실제 사용자 데스크톱 대신 전용 Xvfb·D-Bus에서만 입력한다. 영상은 메모리에만 받고 운영 helper·서버는 변경하지 않는다.

```bash
env -u WAYLAND_DISPLAY -u ELECTRON_RUN_AS_NODE \
  MEW_DESKTOP_TEST_LINUX_HELPER=/absolute/path/to/isolated-helper \
  MEW_DESKTOP_TEST_LINUX_ISOLATED=1 \
  dbus-run-session -- xvfb-run -a -s '-screen 0 1280x720x24 -nolisten tcp' \
  node --test server/remote-desktop-linux.test.ts
```

