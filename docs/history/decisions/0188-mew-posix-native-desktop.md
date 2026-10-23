---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: Mac/Linux 원격 데스크톱도 상주 네이티브 H.264 경로로 전환한다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0188 — Mac/Linux 원격 데스크톱도 상주 네이티브 H.264 경로로 전환한다"
created: 2026-10-01
updated: 2026-10-01
---

- 날짜: 2026-10-01
- 상태: 채택
- 부분 대체: [0185](0185-mew-desktop-resident-direct-host.md) — Mac/Linux의 세션별 Electron·VP8 유지
- 부분 대체: [0148](0148-mew-macos-local-cursor.md) — Mac의 CPU 픽셀 복사·canvas·Electron 전송과 권한 앱
- 결정자: 사용자 (Windows와 같은 저지연 구조의 Mac/Linux 구현 요청), Codex (OS별 설계)

## 배경

사용자는 OS 호환성 보완이 아니라 Windows처럼 renderer 시작과 원시 화면 IPC를 제거하는 구조를 요청했다. 현재 계약은 [원격 데스크톱](../../development/remote-desktop.md)에 둔다.

## 결정

- 모든 OS에서 서버 수명에 속한 Node 상주 호스트·접속별 session ID·네이티브 H.264 WebRTC·종료 확인 후 제어권 이전을 공유한다. 웹 뷰어·직접 암호화 전송·TURN 및 서버 영상 중계 거부를 유지한다.
- Mac은 자체 서명된 앱 번들의 Node로 실행하고, ScreenCaptureKit의 NV12 CVPixelBuffer를 VideoToolbox 하드웨어 H.264 인코더에 직접 제출한다. RealTime·B-frame 없음·최신 표면 하나·제한된 압축 출력으로 지연을 제한한다. 화면 기록·손쉬운 사용은 같은 앱 번들에서 확인·요청한다. Electron 권한은 새 앱의 승인으로 간주하지 않는다.
- Linux는 자체 GStreamer C ABI 모듈을 사용한다. Wayland는 하나의 RemoteDesktop/ScreenCast portal 세션에서 입력 승인·화면·PipeWire FD를 얻어 같은 수명에 묶는다. VA-API 또는 NVENC 하드웨어 인코딩을 사용하고 GPU 메모리 협상이 가능한 경로를 유지한다. X11은 X11 네이티브 캡처를 사용하며 화면 읽기와 GPU upload가 남을 수 있다. 전체 Linux 경로를 zero-copy로 표시하지 않는다.
- 하드웨어 인코더 또는 OS 캡처 권한이 없으면 오류로 종료한다. CPU 인코더·Electron·영상 중계로 자동 복귀하지 않는다. 캡처 커서는 우선 영상에 포함하며 지원하지 않는 분리 커서를 광고하지 않는다.
- 대기 중 캡처·인코딩·사용자 입력·절전 방지를 시작하지 않는다. 연결마다 화면과 권한을 다시 확인한다. portal 승인 UI를 생략하거나 승인 토큰을 디스크에 저장하지 않는다. 알림 실패는 연결에 영향을 주지 않는다.
- 운영 설치·빌드·서버 재시작은 사용자가 수행한다. 검증용 소프트웨어 인코더는 별도로 컴파일한 테스트 모듈에만 존재한다. 실기 하드웨어 지연을 테스트 소스로 입증했다고 주장하지 않는다.

## 근거

[Apple 저지연 VideoToolbox](https://developer.apple.com/videos/play/wwdc2021/10158/)는 하드웨어 저지연 인코딩과 CVImageBuffer 직접 제출을 제공한다. [VA H.264](https://gstreamer.freedesktop.org/documentation/va/vah264enc.html)·[NVENC](https://gstreamer.freedesktop.org/documentation/nvcodec/nvh264enc.html)는 native GPU 인코딩 경로다. [RemoteDesktop portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.RemoteDesktop.html)은 같은 승인 세션의 화면·입력 결합을 지원한다. 실제 메모리 형식·추가 변환과 성능은 장치별로 검증한다.
