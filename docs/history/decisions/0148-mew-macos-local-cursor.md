---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: macOS 화면과 커서를 ScreenCaptureKit으로 분리한다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0148 — macOS 화면과 커서를 ScreenCaptureKit으로 분리한다"
created: 2026-09-15
updated: 2026-09-15
---

- 상태: 채택
- 결정자: 사용자 (외부 서비스 없는 Mac 최적화 구현 요청), Codex (설계)
- 부분 대체: [0144](0144-mew-desktop-local-cursor.md)의 Mac 기존 캡처 유지 범위
- 부분 대체: [0136](0136-mew-native-remote-desktop-webrtc.md)의 macOS Chromium 캡처 선택

## 결정

**후속 결정:** [0188](0188-mew-posix-native-desktop.md)은 Mac의 Electron·CPU 픽셀·canvas 전송을 네이티브 VideoToolbox H.264와 자체 권한 앱으로 전환한다. 우선 영상 커서를 사용하며 기존 분리 커서 구현은 역사적 근거로 보존한다.

macOS 12.3 이상에서는 ScreenCaptureKit의 `showsCursor = NO`로 전체 모니터를 캡처한다. 자체 Objective-C 모듈의 C ABI를 기존 Koffi worker에서 호출한다. ScreenCaptureKit 비동기 콜백은 네이티브 코드 안에서만 처리하며 JavaScript 콜백으로 넘기지 않는다. 설치 시 Apple Command Line Tools로 해당 CPU의 dylib를 컴파일·서명한다. 소스·빌드 스크립트는 helper 지문에 포함하고 바이너리는 저장소에 넣지 않는다.

OS에서 최대 1080p·60Hz로 변환한 최신 프레임 하나만 유지한다. 변경 없는 화면은 복사·인코딩·영상 전송을 생략한다. 기존 생성 track·WebRTC·VP8 서버 전송·ACK 적응·유휴 생존 확인을 공유한다. 별도 서비스·계정·코덱 의존성을 추가하지 않는다.

시스템 커서의 모양·hotspot·위치를 별도로 읽어 기존 로컬 커서 프로토콜로 전달한다. AppKit 커서 이미지는 main queue에서 읽고, 화면 복사는 worker에서 수행한다. Retina 영상 픽셀과 CoreGraphics 입력의 논리 좌표를 구분한다. 모양 조회에 쓰는 공개 `currentSystemCursor`와 `CGCursorIsVisible`은 deprecated API이며 최신 OS에서 실제 동작을 별도로 확인한다. 모양 조회가 nil이면 시스템 화살표를 사용한다. 비공개 WindowServer API와 전역 커서 숨기기는 사용하지 않는다.

첫 커서 없는 프레임을 확인한 뒤에만 로컬 커서를 활성화한다. 초기 네이티브 캡처 실패는 기존 Chromium 영상 커서로 복귀하고 실제 모드는 도움말에 표시한다. 실행 중 권한·로그인 세션·화면 구성 변화나 캡처 종료는 입력을 해제하고 재연결하도록 종료한다. 잠금·로그인 전 화면을 지원하지 않는다. 설치 실패를 성공으로 기록하지 않는다.

## 근거·검증

[Apple ScreenCaptureKit](https://developer.apple.com/videos/play/wwdc2022/10156/), [showsCursor](https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration/showscursor), [시스템 커서](https://developer.apple.com/documentation/appkit/nscursor/currentsystem), [커서 표시 상태](https://developer.apple.com/documentation/coregraphics/cgcursorisvisible()).

구현·지원 조건은 [개발 계약](../../development/remote-desktop.md), 테스트 결과와 실기 미확인 범위는 [작업 문서](../../work/remote-desktop-latency.md)에 기록한다.
