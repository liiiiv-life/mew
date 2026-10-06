---
title: "원격 데스크톱 배포와 라이선스"
created: 2026-09-14
updated: 2026-10-01
description: "네이티브 원격 데스크톱 설치본의 OS별 구성 요소와 라이선스·고지·소스 제공 조건, STUN 및 런타임 재배포 경계를 정한다."
---

# 원격 데스크톱 배포

[개발 지도](MOC.md) · [전송 계약](remote-desktop.md) · [ADR 0185](../../../.mew/docs/decisions/0185-mew-desktop-resident-direct-host.md)

## 배포 형태

현재 배포는 Mew 소스와 설치기다. 수신 환경에서 잠금 파일의 npm 패키지·필요한 OS 런타임을 다운로드한다. Windows/WSL은 고정 위치 `runtime/node.exe`의 전용 Windows Node를 준비하며 기존 Electron 바이너리를 다운로드할 필요가 없다. Mac/Linux는 현재 지원 Node를 전용 경로로 복사하고 해당 버전의 Node LICENSE를 보존한다. 기본 공개 STUN은 주소 발견만 수행하고 영상 중계는 하지 않는다. `[]`로 조회를 비활성화할 수 있다.

Windows/WSL은 `node-datachannel 0.33.4`와 그 플랫폼별 네이티브 npm 패키지(libdatachannel 0.24.5), Koffi 3.2.1, 자체 `gpu-windows.cpp`를 사용한다. 설치 시 Visual Studio C++ Build Tools·Windows SDK로 DLL을 컴파일하고 D3D11·DXGI·Media Foundation·Windows OS 라이브러리에 연결한다. 공급자 하드웨어 H.264 MFT를 사용하며 자체 H.264 인코더·FFmpeg 명령·WASM 코덱을 배포하지 않는다. 생성 DLL·Windows SDK·MSVC 도구는 저장소에 넣지 않는다. 필수 네이티브 npm binding을 실제 import한 뒤 컴파일 성공 시에만 준비 마커를 기록한다.

`node-datachannel`과 `libdatachannel`은 [MPL-2.0](https://github.com/murat-dogan/node-datachannel/blob/v0.33.4/LICENSE)이다. 패키지의 라이선스·적용 대상 파일의 대응 소스 제공 조건을 유지한다. 별도 Mew 파일은 기존 MIT다. 플랫폼 binary 안의 전송·암호화 구성 요소에도 각각의 upstream 조건이 적용되므로 전체 binary를 MIT라고 표시하지 않는다. H.264 OS 인코더 사용과 특정 시장의 코덱 특허 조건은 별도이며 소스 라이선스만으로 특허 허락을 충족했다고 주장하지 않는다.

Mac은 VideoToolbox, Linux는 시스템 GStreamer VA-API/NVENC 하드웨어 H.264를 사용한다. Windows의 과거 Electron·VP8 서버 전송 선택은 [이전 계약](../history/remote-desktop-electron-transport.md)에 보존한다.

Mac/Linux x64/arm64 지원·설치 조건은 [POSIX 계약](remote-desktop-posix.md)을 따른다.

Windows 자체 가상 디스플레이는 별도 UMDF 2·IddCx DLL·INF·카탈로그 소스 배포다. Microsoft MIT IndirectDisplay 예제의 DDI·swapchain 구조를 참고했으며 `virtual-display-origin-license`의 원문 고지를 패키지에 포함한다. StarDesk·타사 IDD 바이너리를 재배포하지 않는다. 운영 설치에는 신뢰되는 release 카탈로그 서명이 필요하며, 아직 서명된 mew 배포 패키지는 없다. WDK·서명·사용자 SID 장치 ACL·설치 경계는 [별도 계약](remote-desktop-virtual-display.md)을 따른다. 생성한 바이너리·서명 키·SDK/WDK는 저장소에 넣지 않는다.

macOS는 자체 `gpu-macos.m`을 설치 시 컴파일·로컬 서명하고 Metal·ScreenCaptureKit·VideoToolbox·UserNotifications 등 호스트 OS 프레임워크를 동적 연결한다. Linux는 자체 `gpu-linux.cpp`를 시스템 GStreamer·X11 라이브러리에 동적 연결한다. 생성 바이너리·Apple SDK는 저장소나 제품에 넣지 않는다. 테스트 전용 x264 경로는 운영 빌드에 포함하지 않는다.

Node·node-datachannel/libdatachannel·Koffi·dbus-next 및 잠금 파일의 간접 의존성 고지를 유지한다. Wayland Unix FD 전달의 usocket과 빌드 도구 node-gyp도 각각의 upstream 고지를 유지한다. GStreamer와 공급자 플러그인을 새 번들로 배포한다면 해당 구성 요소의 LGPL 등 정확한 라이선스·대응 소스·교체 권리를 배포 방식에 맞게 확인해야 한다. 현재 설치기는 시스템 라이브러리를 사용한다.

이전 Electron 공식 배포물의 상세 라이선스 검토는 [역사 기록](../history/remote-desktop-electron-distribution.md)에 보존한다. 그 검토를 새 네이티브 배포물 전체의 감사 완료로 해석하지 않는다.
