---
title: "원격 데스크톱 Electron·서버 전송 이전 계약"
created: 2026-10-01
updated: 2026-10-01
description: "상주 GPU 직접 연결 전환 이전 Electron·VP8·서버 전송, 커서·수명·프로토콜과 최초 연결 최적화의 구현·검증 기록을 보존한다."
상위파일: "MOC.md"
---

[현재 계약](../development/remote-desktop.md)

2026-10-01 ADR 0185 적용 전 구현·검증 기록이다. 현재 Windows 상주 GPU 호스트와 직접 연결 정책에는 적용하지 않는다.

## 경계와 수명

화면 구성·설정·조작 도구를 설계할 때는 [공통 디자인 지침: 여백과 정보 밀도](../development/ui-contracts.md#%EB%94%94%EC%9E%90%EC%9D%B8-%EC%A7%80%EC%B9%A8-%EC%97%AC%EB%B0%B1%EA%B3%BC-%EC%A0%95%EB%B3%B4-%EB%B0%80%EB%8F%84)를 따른다.

`RemoteDesktop`은 body portal의 전체 화면 dialog다. DockWorkspace, workspaceUi, 패널 복원 목록에 넣지 않는다. 화면을 닫으면 세션을 종료하며, 재접속·공유 화면 변경은 새 세션이다. 내부 브라우저의 DOM 전송 계약은 바뀌지 않는다.

```mermaid
flowchart LR
  accTitle: 원격 데스크톱 연결 구조
  accDescr: 브라우저, Mew 서버, OS 보조 앱 사이의 영상 및 입력 전달 경로
  V[전체 화면 뷰어] <-->|인증 WS: 협상·수명·서버 영상과 입력| M[Mew 서버]
  M <-->|Mac/Linux: 부모 stdio| H[OS 네이티브 Electron 보조 앱]
  M <-->|Windows: 부모 stdio| B[Windows Node bridge]
  B -->|일회성 InteractiveToken 작업| T[Windows 로그인 세션]
  T --> H
  B <-->|인증한 로컬 named pipe| H
  H -->|WebRTC 직접 영상: SRTP| V
  H -->|서버 전송: VP8 이진 프레임| M
  V -->|DataChannel 입력| H
  H --> I[OS 입력 어댑터]
```

`server/remote-desktop-host.ts`는 OS 판별·고정 실행 경로·ICE 설정, `server/remote-desktop.ts`는 API·권한·단일 제어 연결을 맡는다. serve/Vite 양쪽에 같은 WS 핸들러를 설치한다. 공개 보조 앱 포트와 사용자 지정 실행 명령 API는 없다. WSL은 Windows에 설치한 `electron.exe`를 실행하고 WSLg를 대체 화면으로 사용하지 않는다.

Windows Electron의 익명 stdin은 실제 환경에서 즉시 EOF가 되어 직접 stdio 경로를 사용할 수 없다. [ADR 0137](../../../.mew/docs/decisions/0137-mew-windows-desktop-pipe-bridge.md)·[0138](../../../.mew/docs/decisions/0138-mew-desktop-automatic-preparation.md)에 따라 WSL Mew → Windows Node stdio → 인증한 named pipe → Electron으로 연결한다. bridge는 소스의 `windows-bridge.mjs`, Electron은 설치본의 `parent-channel.mjs`를 사용한다. 인증은 실행별 256bit 토큰, 3초/64자·후보 소켓 최대 4개로 제한한다. 전체 초기 연결은 40초, 부모가 끊기면 파이프 EOF와 8초 lease 만료로 캡처를 종료한다.

`windows-session.ps1` broker는 임의 bootstrap 파이프를 연 뒤 현재 Windows 사용자 SID의 InteractiveToken·최소 권한으로 임시 작업을 등록·실행한다. 작업 정의에는 고정 스크립트 경로와 공개 파이프 이름만 기록한다. 비밀번호나 토큰을 저장하지 않으며 부팅/로그인 트리거도 없다. 토큰은 부모 stdio와 bootstrap 파이프를 통해 받은 뒤 Electron 자식 환경으로 전달하고 인증 후 환경에서 제거한다.

bootstrap과 영상 시그널링 파이프는 현재 사용자 SID에만 허용하고 Network SID는 거부한다. libuv 기본 DACL이 서비스 로그온 SID에 묶일 수 있어 실제 파이프 ACL도 갱신한다. bootstrap 첫 바이트 수신 후 impersonation 사용자 SID와 실제 클라이언트 프로세스 세션 ID(0 아님)를 검사한다. 로그인 실행 대기는 25초이며 부모 소멸·실패·완료에서 작업을 제거한다. 로그인 세션의 launcher가 직접 시작한 Electron 프로세스 핸들을 보관한다. bootstrap 파이프는 연결 동안 유지하고 broker·bridge가 사라져 EOF가 오면 2초 뒤에도 끝나지 않은 Electron을 그 핸들로 종료한다. WSL이 서비스 쪽 프로세스들을 한꺼번에 종료해도 로그인 세션의 supervisor가 정리하며 PID 재사용으로 다른 프로세스를 죽이지 않는다. 비정상 OS 종료로 작업 정의가 남더라도 트리거·인증 정보가 없어 자동 실행되지 않는다. 다른 사용자나 로그인 전 화면으로 권한을 확장하지 않는다.

Windows 실행 전 설치한 전용 Node → Program Files → PATH 순서로 지원 버전을 찾는다. Electron 시작 후 별도로 조회한 해당 실행 파일의 명시적 inbound 방화벽 차단 규칙을 발견하면 서버가 `network-hint`를 전달한다. 직접 연결 실패 시 먼저 서버 전송으로 전환하며, 브라우저가 서버 전송을 준비하지 못할 때만 방화벽 안내를 함께 표시한다. 설정 위치는 Mew 서버가 실행 중인 컴퓨터의 Windows라고 명시한다. 규칙 존재만으로 실행을 막지 않고 조회만 한다. 방화벽 조회는 최대 8초이며 지연·실패가 helper 시작을 막지 않는다. 세션이 끝난 뒤 도착한 진단은 전송하지 않는다. WSL은 설치된 전용 `runtime/node.exe`를 `--version`으로 직접 검사하고, 지원 버전이면 PowerShell 탐색을 생략한다. 없거나 실행 불가·버전 미지원이면 기존 PowerShell 탐색으로 돌아간다. Node 탐색과 bridge 소스의 `wslpath` 변환은 병렬 수행한다. bridge 실행 경로도 별도의 30초 캐시로 진행 요청·성공 결과만 재사용하고, helper spec·WSL interop·PATH 변경과 조회 실패는 무효화한다. 로그인 세션 검증은 매 연결의 broker가 계속 수행한다. 준비 상태 API와 실제 spawn의 실행 경로 탐색은 30초 동안 동일 진행 요청/성공 결과 하나를 재사용한다. 플랫폼·helper 경로·WSL interop·PATH가 바뀌면 새로 탐색하고 실패는 캐시하지 않는다. 설치 버전·파일 접근·OS 권한·캡처·인증은 캐시하지 않는다. `ready`는 구성 파일 준비 상태이며 OS 로그인·네트워크 접근 성공을 보장하지 않는다.

Electron ESM 진입점에서 `await app.whenReady()`를 최상위로 기다리면 모듈 평가 완료와 앱 준비가 서로 기다린다. `createWindow()`를 비동기로 시작하고 진입 모듈 평가는 즉시 끝낸다. 시작 중 부모가 종료되면 준비 후 창을 만들지 않는다.

네이티브 `main.mjs`만 OS 캡처·입력·클립보드 권한을 가진다. 숨겨진 renderer는 sandbox·contextIsolation을 켜고 nodeIntegration을 끄며 고정된 로컬 파일만 읽는다. preload는 시그널링·검증되는 입력·단일 캡처 요청을 노출한다. 고정 로컬 renderer에만 media와 Chromium Local Network Access 권한을 허용한다([Electron 권한 계약](https://www.electronjs.org/docs/latest/api/session)). 세션용 임시 Chromium 프로필은 정상 종료 시 제거한다. Windows 파일 핸들 또는 강제 종료 때문에 임시 폴더가 남을 수 있다. 캡처 영상·키 입력·SDP·ICE 자격증명은 파일에 기록하지 않는다.

## 전송과 지연

배경은 [지연·대역폭 연구](../research/remote-desktop-latency.md), 구현 범위·검증 결과는 [작업 문서](remote-desktop-latency.md)에 있다.

- Windows/WSL은 아래의 DXGI worker를 우선하고 초기화 실패 시 GDI 보조 경로, 그마저 실패하면 Chromium 캡처를 사용한다. macOS는 아래의 ScreenCaptureKit 경로를 우선한다. Linux와 네이티브 초기화 실패 경로는 Electron desktopCapturer/Chromium이 캡처를 소유한다. `sender.mjs`는 캡처 수명을, `direct-sender.mjs`와 `relay-sender.mjs`는 각 전송을 맡는다. 뷰어의 `desktop-connection.ts`가 준비·수명·전환 정책을, `desktop-direct.ts`와 `desktop-relay.ts`가 수신을 맡는다.
- 직접 연결은 VP8 WebRTC, 최대 1920×1080·60fps·6Mbps다. 연결 실패 또는 offer 수신 후 1.2초 안에 영상 디코딩이 확인되지 않으면 서버 전송으로 한 번 전환한다. 제한 시간에 실제 `framesDecoded`를 한 번 더 확인해 통계 표시 주기보다 빠른 첫 프레임을 놓치지 않는다. 화면 공유 승인을 기다리는 시간에는 이 1.2초 타이머를 시작하지 않는다. 이미 연결된 직접 경로가 끊겨도 서버 전송으로 전환한다.
- 서버 전송은 같은 캡처 track → WebCodecs VP8 인코더 → 이진 IPC → Mew WS → WebCodecs 디코더 → canvas다. 최대 1920×1080·30fps이며 2.5Mbps에서 시작해 표시 ACK의 기준 시간 대비 증가와 전송 중 바이트에 따라 0.35–4Mbps로 조절한다. 서버는 디코딩·재인코딩하지 않는다. 하드웨어 가속 여부는 Chromium·OS·드라이버에 달려 있다.
- 인코더 작업 하나, 캡처 버퍼 하나와 최신 미인코딩 프레임 하나, 전송 중 최대 4프레임을 둔다. 전송 중 바이트가 1MiB 이상이면 다음 인코딩을 중단한다. 한 패킷도 1MiB 이하이므로 허용 직전 프레임까지 포함한 바이트 상한은 2MiB 미만이다. 네이티브 출력·서버 WS에도 별도 상한이 있다. 느린 수신자는 인코딩 전 프레임을 생략하며 이미 인코딩한 delta 프레임을 임의로 버리지 않는다.
- 브라우저는 디코딩된 최신 프레임 하나만 rAF에서 그린 뒤 누적 ACK를 보낸다. 표시하지 않는 대기 프레임과 사용한 VideoFrame은 즉시 닫는다. 디코딩 오류는 최대 두 번 키 프레임으로 재동기화한다. 송신 ACK 10초·수신 표시 15초 중단 시 종료한다. 다만 아래의 명시적 유휴 상태는 예외다. 키 프레임은 시작·복구 요청·설정 변경·활성 영상의 약 10초 간격에 생성하며 정지 중 주기적으로 생성하지 않는다.
- 기본 ICE 설정은 `[]`이며 외부 STUN/TURN 요청은 없다. 서버 전송은 기존 인증 WS URL을 사용하므로 추가 계정·공개 포트가 없다. 기존 프록시/터널 자체가 외부 서비스면 그 경로는 유지한다. 외부 접속은 HTTPS/WSS를 사용하며 TLS를 종료하는 프록시와 Mew 서버가 영상 신뢰 경계에 포함된다.
- WebCodecs는 보안 컨텍스트와 VP8 디코딩 지원이 필요하다. 런타임 기능 검사로 미지원 브라우저에 안내하며 JPEG 폴링이나 별도 코덱 다운로드로 우회하지 않는다. WebSocket/TCP는 손실 시 후속 영상도 기다리므로 망에 따라 직접 UDP 연결보다 지연이 커질 수 있다.
- 확대·뷰 이동·90도 회전·조이스틱/핫키 위치는 로컬 변환이며 재캡처·재협상하지 않는다.
- UI의 **직접 연결**·**서버 연결**이 선택한 경로를 표시한다. 직접 경로의 `왕복 … ms`는 candidate pair RTT, Mbps는 수신 바이트 증가량이다. 실제 종단 간 지연이나 보장 수치가 아니며 OS·모바일·망에서 지연과 발열을 별도 측정해야 한다.

### Windows 캡처·로컬 커서·유휴 영상

- `capture-windows.mjs`가 기존 Koffi로 Windows DXGI/D3D11을 호출한다. `capture-worker.mjs`의 별도 Node worker에서 GPU 복사·Map을 수행하여 main의 OS 입력 주입을 막지 않는다. `native-capture.mjs`는 worker 준비/요청당 3초 제한과 요청 하나 상한을 둔다. worker는 프로세스의 로그인 세션·수명을 공유하며 자기 스레드에서 COM 초기화·해제를 수행한다. 정상 종료는 worker에 자원 해제를 요청하고, 1초를 넘으면 종료한다. Chromium 화면 캡처와 동일하게 연결 중 display/system idle을 막는 Windows 스레드 실행 상태를 유지하고 종료 시 해제한다. 수동 절전·잠금은 우회하지 않는다.
- 선택한 물리 모니터의 bounds와 DXGI output을 맞춘다. 현재 x64/arm64 ABI, 회전 없는 BGRA 화면, 최대 4096×2160 픽셀 수를 지원한다. 회전·포맷·출력·포인터 분리가 지원되지 않거나 초기 프레임을 확보하지 못하면 GDI에서 커서를 분리한 화면을 준비한다. 두 네이티브 경로 모두 실패해야 Chromium으로 복귀한다. 실행 중 capture access lost·포인터 지원 실패 등은 입력을 해제하고 재연결 안내로 종료한다.
- [ADR 0146](../../../.mew/docs/decisions/0146-mew-desktop-cursor-capture-fallback.md)의 `capture-gdi.mjs`는 로그인 Default desktop에 연결한 worker에서 최대 30Hz로 BitBlt+GdiFlush를 수행한다. 픽셀을 native memcmp로 비교하고 바뀐 화면만 V8 버퍼에 복사·전달한다. 권한·활성 desktop·모니터 bounds가 바뀌면 종료한다. `cursor-windows.mjs`가 GetCursorInfo/GetIconInfo/GetDIBits로 모양·hotspot을 읽으며 생성된 bitmap 핸들은 해제한다. DXGI보다 CPU 읽기·비교 비용이 크고 일부 GPU/보호 콘텐츠는 읽지 못할 수 있다.
- 커서를 영상에 합성하지 않는다. `LastPresentTime=0`인 포인터 전용 갱신에서는 원시 화면 복사를 생략한다. 실제 화면 변경은 GPU staging→V8 소유 BGRA 버퍼→worker transfer→Electron IPC로 전달한다. Electron의 V8 memory cage 때문에 매핑 메모리를 외부 ArrayBuffer로 직접 노출하지 않는다. CPU readback·IPC 복사가 있으므로 zero-copy는 아니다.
- `native-stream.mjs`는 원시 프레임을 최대 1080p canvas로 축소하고 수동 갱신 track을 생성한다. 직접 연결과 서버 전송이 이 track을 공유한다. 표시하지 않은 raw 프레임을 큐에 쌓지 않는다. 초기 직접 협상과 서버 전환·복구 요청은 canvas를 다시 그려 정지 화면도 전달한다.
- `cursor-protocol.mjs`는 모양·hotspot·표시 상태·호스트 좌표·물리 화면 크기·적용 입력 seq를 검증한다. 모양은 최대 128×128, PNG의 실제 IHDR 크기도 확인한다. 모양이 바뀔 때만 PNG를 보내며 입력 주입으로 예상한 좌표와 일치하는 위치 echo는 생략한다. 호스트 실제 마우스·앱의 커서 이동은 별도 보정으로 보낸다. 데이터는 기존 인증 WS를 사용하며 이미지 파일로 저장하지 않는다.
- CSS로 배경 반전을 표현할 수 없는 monochrome/masked XOR 픽셀은 밝은 중심·어두운 테두리로 근사한다. 일반 alpha 커서는 유지한다. 원격 앱이 화면에 직접 그린 커서는 분리 대상이 아니다.
- `desktop-cursor.ts`는 모양 하나의 Blob URL을 캐시·회수한다. 마우스는 native CSS cursor, 조이스틱은 rAF에서 변환하는 이미지 레이어를 사용한다. 로컬 이동은 React 렌더·영상 ACK를 기다리지 않는다. `desktop-view.ts`의 공통 투영으로 확대·pan·letterbox·90도 회전을 반영하며 늦은 입력 seq의 위치는 적용하지 않는다. 호스트 보정은 마지막 마우스/조이스틱 표시 방식을 바꾸지 않는다. 첫 영상의 metadata 수신 또는 canvas 해상도 확정 시 위치를 다시 계산하여 초기 커서가 숨은 채 남지 않게 한다. 연결 도움말의 커서 표시 상태는 실제 localCursor 협상 결과를 표시한다.
- 네이티브 캡처가 500ms 이상 정지하고 최근 2초 안에 worker 응답이 왔으며, 미인코딩/인코딩/전송 중 프레임이 없을 때 송신기는 1초마다 `relay-status {seq,idle,ackMs,bitrate}`를 보낸다. 수신기는 해당 seq를 실제로 그린 상태에서 최근 3초 안의 유휴 응답만 인정한다. 입력 heartbeat만으로 영상 정상 상태를 판단하지 않는다. 복구 요청은 정지 중에도 최신 화면을 다시 공급한다.
- `relay-adaptation.mjs`는 최근 6개 10초 구간의 최소 ACK를 기준으로 쓴다. 기준보다 80ms 이상 증가·전송 중 256KiB 초과·ACK 1초 초과이면 최소 2초 간격으로 25% 낮춘다. 안정 상태는 최소 10초 간격으로 8% 올린다. 긴 기본 RTT만으로 220ms 임계값에 걸려 하한으로 내려가는 문제를 제거한다. 최대 4프레임 window는 유지하므로 높은 RTT에서는 여전히 FPS 상한이 생긴다.
- 서버의 `표시 응답 … ms`는 인코더 output 이후 전송·디코드·canvas 그리기·ACK 복귀 시간이다. 순수 네트워크 RTT나 click-to-photon이 아니다. `화면 정지`에서는 영상 payload가 없어도 제어·생존 확인 트래픽은 남는다. macOS의 ScreenCaptureKit 경로에도 유휴 생략을 적용한다. Linux와 네이티브 초기화 실패 경로는 기존 캡처를 유지한다.

### 이진 프로토콜과 신뢰 경계

`relay-protocol.mjs`는 브라우저·서버·네이티브가 공유하는 VP8 패킷 계약이다. 24바이트 헤더는 magic/version(`MDV1`), uint32 순서, float64 정수 마이크로초 timestamp, uint16 가로/세로, key flag와 예약 바이트를 담는다. network byte order를 사용한다. 길이·버전·순서·차원·유한한 timestamp를 디코딩 전에 검사한다. 제어 JSON에 Base64를 넣지 않는다.

`host-wire.mjs`는 기존 `MEW_DESKTOP <JSON>\n`과 `MEW_DESKTOP_FRAME <길이>\n<이진 패킷>`을 구분한다. pipe 청크 경계와 UTF-8 분할에 의존하지 않는다. Windows Node bridge는 인증 후 스트림을 그대로 전달하므로 다른 OS와 같은 프로토콜이다.

서버의 `desktop-relay.ts`는 전환을 한 번만 허용한다. 선택한 세션에서만 `relay-input`과 `frame-ack`를 받고 기존 입력 스냅샷 또는 제한된 붙여넣기 형태만 허용한다. 전송한 프레임을 넘는 ACK·중복 전환·과도한 입력·큰 패킷은 거부한다. 닫기·권한 회수·원본 캡처 종료는 두 경로를 모두 종료한다.

## 검증

```bash
MEW_DATA_DIR=/tmp/mew-desktop-test-data node --test --test-concurrency=1 server/remote-desktop.test.ts server/remote-desktop-relay.test.ts server/remote-desktop-bridge.test.ts server/remote-desktop-install.test.ts server/remote-desktop-native.test.ts server/remote-desktop-latency.test.ts server/remote-desktop-ui.test.ts src/utils/desktop-input.test.ts src/utils/desktop-preparation.test.ts server/remote-desktop-windows.test.ts
npx tsc -b
npm run lint
```

- protocol/joystick: 유실·역순·클릭 추월, 절대 위치, timeout, tap/즉시 이동/hold/cancel, 휠 축 제한, 로컬 뷰, 커서·버튼 드래그의 정지 중 무이동·미세 반전·새 터치 기준점 초기화, 휠/pan/zoom의 지속 속도·중앙 복귀·완만한 거리별 속도 증가·최대 속도 절반·중앙 근처 미세 조작·속도 상한·프레임 주기 독립성·50ms 적분 상한·취소.
- 서버: Origin·역할·임시 비밀번호, OS/WSL 경로, 메시지 검증, 단일 제어권, 화면 교체, 권한 회수·자식 종료. 가짜 stdio 프로세스를 사용한다.
- OS: Windows INPUT 레이아웃, Mac modifier/middle drag, X11 notch, Wayland 승인 응답 경합·입력 순서·종료. FFI/DBus는 모의 객체다.
- Windows bridge: 세션 0/로그인 세션 실행 인자·방화벽 차단 안내·오류의 WS 전달을 검사한다. `MEW_DESKTOP_TEST_WINDOWS_NODE`에 Windows `node.exe` 경로를 지정하면 실제 임시 작업·Electron 실행·화면 목록·인증 파이프·부모 종료·Electron 이벤트 루프 정지 시 강제 종료 테스트를 실행한다. 실제 Windows 로그인 세션에서 화면 목록이 나오는 것까지 확인했다. 픽셀이나 입력은 기록하지 않는다.
- Windows 영상 통합 검사는 추가로 `MEW_DESKTOP_TEST_WINDOWS_VIDEO=1`을 지정한다. 직접 후보를 사용할 수 없는 뷰어와 빈 ICE 설정으로 실제 Windows 로그인 화면의 서버 전송·디코딩·부모 종료를 검사했다. DXGI 경로는 정지 화면에서 연속 프레임을 요구하지 않는다. 초기 프레임이 없는 duplication은 300ms 예산으로 기다린 후 한 번 재생성하고, 다시 300ms 예산 안에 pixels가 없으면 GDI 보조 경로를 준비한다. 이는 `capture-start.mjs`의 빈 프레임 재시도 예산이며 worker 초기화·개별 요청·정리 시간은 별도다. 화면이 바로 나오면 기다리지 않고, API 오류는 재생성 없이 GDI로 넘어간다. 닫는 도중 도착한 프레임은 버리고 worker를 정리한다. 검증 결과와 적용 범위는 [진행 문서](remote-desktop-latency.md)를 따른다. `MEW_DESKTOP_TEST_WINDOWS_LOCAL_CURSOR=1`을 함께 지정하면 네이티브 로컬 커서 활성화·실제 이미지 디코드·보이는 픽셀·DOM 표시와 첫 표시 후 계속 연결됨을 검사한다. `MEW_DESKTOP_TEST_WINDOWS_GDI=1`은 임시 복사본에서 DXGI 실패, `=timeout`은 초기 프레임 부재를 모사해 실제 Windows GDI 보조 경로를 검사한다. 커서 위치 검사는 뷰어 DOM만 이동하며 Windows 입력을 보내지 않는다. 화면 파일·키 입력을 만들지 않는다. 설치본을 덮지 않고 별도 임시 helper 폴더와 Windows junction으로 기존 런타임을 참조하고 종료 후 제거한다. 실패 시 후보 유형·프로토콜·요청/응답 수만 출력하며 IP·포트·SDP·자격증명은 출력하지 않는다. Windows 실기 테스트는 `--test-concurrency=1`로 실행한다.
- 서버 전송 프로토콜: 이진 내용과 UTF-8/pipe 청크 경계, 과대 프레임·버전·차원·timestamp, 순서·위조/중복 ACK·프레임/바이트 상한, 잘못된 입력·전환 전 입력, 실제 WS의 영상 전달·권한 회수·부모 종료를 검사한다.
- 자동 준비: 설치 생략·한 번 시작·완료 후 재검사·중단/실패에서 반복 금지·닫을 때 폴링 취소, 코드 변경과 의존성 재사용 지문을 검사한다.
- Mac 캡처: 크기/Retina/음수 원점, 초기 프레임 전 커서 보존, 유휴 픽셀 생략, 커서만 변경, transfer 이후 버퍼 소유권, 실패·중복 close를 모의 FFI로 검사한다. Apple SDK 15.5와 Clang으로 arm64/x86_64 Mach-O 객체 컴파일을 검사했다. 이는 macOS 링크·실행·권한·영상 실측을 대신하지 않는다. 실제 Mac에서는 설치된 런타임과 화면 기록 권한을 준비한 뒤 `MEW_DESKTOP_TEST_MACOS_CAPTURE=1 node --test server/remote-desktop-macos.test.ts`로 임시 helper의 native 캡처·별도 커서 PNG 디코드·연속 응답·종료를 검사한다. 입력은 주입하지 않고 화면/커서 파일을 저장하지 않는다.
- 설치: 역할 제한·고정 명령·중복 시작·실패 출력 보존·재시도·상태 복구, 따옴표/공백 경로의 셸 실행, WSL PowerShell 인자·interop 실패·사용자 지정 설치 경로. 실제 npm 설치 대신 임시 스크립트와 모의 프로세스를 사용한다. UI에서는 터미널 렌더러를 대체하고 실제 팝업의 레이어·입력·닫기·재열기·실패/완료를 검증한다.
- Chromium UI: 실제 sender와 VP8 인코딩/디코딩을 사용해 직접 경로 및 후보 차단 후 서버 전송을 모두 검사한다. 네이티브 캡처 입력을 모사한 실제 WebCodecs 경로에서 로컬 커서·16초 정지 중 추가 영상 0프레임/0바이트·연결 유지·정지 중 키 프레임 복구와 갱신 재개를 확인한다. 화면은 합성 canvas다. 터치 탭·즉시 드래그·hold/cancel·6개 컨트롤·핸들·속도 조절 유지/중앙 복귀/해제/blur·양 테마 반투명 배경·감도 1/3배·90도 회전 클릭과 이동·전체화면 전환·핫키 순서/해제·설정 Esc·320px/가로 화면 경계·붙여넣기·모바일/데스크톱 배치·재접속·Esc·백그라운드 종료, 누른 키를 해제하는 연결 중 전환, 캡처 재사용, ACK 정지 시 프레임 상한과 복구, VP8 미지원 안내를 확인한다. Chromium이 없으면 skip한다.

**나머지 실기 검증은 별도다.** Mac 바이너리·OS 권한, X11/Wayland 실제 데스크톱 주입, Safari/iOS 실물, 사용자의 외부 모바일 망, Retina/혼합 DPI·다중 모니터, 실제 지연·대역폭은 자동 테스트만으로 검증됐다고 간주하지 않는다. 각 OS에서 로그인·권한 승인·커서/휠/세 버튼 드래그·한글 붙여넣기·닫은 뒤 해제·권한 회수를 확인해야 한다. 잠금 화면·로그인 전·Windows UAC secure desktop 지원은 범위 밖이다.

## 최초 연결 최적화 검증 — 2026-09-23

[연구](../research/remote-desktop-startup.md)의 일부를 구현했다. `remote-desktop-startup.test.ts`는 정상 DXGI 무대기, 빈 화면의 600ms 후 GDI 전환, 두 번째 duplication 복구, 두 네이티브 경로 실패와 시작 중 닫기·늦은 프레임 정리를 가상 시계로 검사한다. 기존 2초에서 0.6초로 줄인 것은 이 빈 프레임 대기 구간의 예산이며 전체 실기 접속 시간의 측정값은 아니다. 더 늦게 첫 화면을 제공하는 DXGI는 GDI로 넘어갈 수 있으므로 실기에서 fallback 비율·CPU 비용을 확인해야 한다.

bridge 테스트는 전용 Node 경로에서 PowerShell 미실행·병렬 조회, 전용 Node 누락/미지원의 기존 탐색, 캐시 만료·환경 변경·실패 재시도를 검사한다. 준비 테스트는 짧은 설치의 250ms 완료 조회와 장시간 작업의 1500ms 상한, 취소·인증 오류를 확인한다. 현재 에이전트 환경에서는 지원 Windows Node 탐색이 실패해 실제 Windows 전체 접속은 미측정이다. 직접 우선·1.2초 서버 전환, 비상주 helper·로그인 세션·단일 제어권·부모 lease는 유지한다.

검증 명령 `MEW_DATA_DIR=/tmp/mew-test-data node --test server/remote-desktop*.test.ts src/utils/desktop-*.test.ts`에서 81개 중 78개 통과, Windows/Mac opt-in 실기 3개는 생략했다. 통과 항목에는 실제 Chromium·WebRTC·VP8을 사용하는 합성 화면 4개 시나리오가 포함된다. `npx tsc -b`와 `npm run lint`는 통과했고 변경 범위 밖 기존 린트 경고 10개가 남는다. 실행 서버 빌드·재시작·설치는 수행하지 않았다.