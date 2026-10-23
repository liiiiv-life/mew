---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: 원격 커서와 화면 갱신을 분리한다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0144 — 원격 커서와 화면 갱신을 분리한다"
created: 2026-09-15
updated: 2026-09-15
---

- 날짜: 2026-09-15
- 상태: 채택
- 후속 결정: [0148](0148-mew-macos-local-cursor.md) — macOS ScreenCaptureKit·로컬 커서·유휴 영상 생략
- 후속 결정: [0146](0146-mew-desktop-cursor-capture-fallback.md) — Windows DXGI 초기화 실패 시 커서를 분리하는 GDI 보조 경로
- 결정자: 사용자 (지연·대역폭 연구안 설계·구현 승인), Codex (설계)
- 부분 대체: [0136](0136-mew-native-remote-desktop-webrtc.md) — Windows 캡처를 Electron/Chromium에서 부모 소유 DXGI worker로 분리; 권한·로그인 세션·입력 해제 경계 유지
- 부분 대체: [0139](0139-mew-desktop-server-transport.md) — 정지 영상의 유휴 상태·생존 확인 추가와 ACK 기반 적응 변경; VP8·직접 우선·서버 fallback·외부 서비스 없음 유지

## 결정

커서 좌표·모양과 화면 영상을 별도 경로로 처리한다. Windows/WSL 로그인 helper의 DXGI worker가 커서를 합성하지 않은 화면과 커서 정보를 제공한다. 캡처/CPU readback은 입력 주입과 다른 스레드에서 수행한다. renderer가 요청한 작업 하나만 처리하며 원시 프레임은 helper 프로세스 안에서만 전달한다. WebRTC와 VP8 서버 전송은 같은 생성 track을 사용한다. zero-copy나 하드웨어 VP8 인코딩을 보장하지 않는다.

네이티브 캡처를 준비할 수 없는 환경은 기존 Chromium 영상 커서로 복귀한다. 세션 중 캡처 권한·데스크톱이 바뀌면 실패를 알리고 종료한다. 커서가 없는 캡처를 확인한 경로만 로컬 커서를 활성화한다. 다른 OS는 기존 캡처를 유지하며, 검증 없이 cursor 옵션을 지원한다고 가정하지 않는다.

로컬 커서는 영상 ACK를 기다리지 않는다. 일반 이동은 합치고 드래그·휠은 높은 빈도를 유지하며 버튼·키 전환과 마지막 이동은 reliable 스냅샷으로 전달한다. 클릭·휠·해제는 이벤트 좌표를 먼저 확정한다. 기존 seq/epoch·누적 카운터·단일 제어권·해제 watchdog은 유지한다. 오래된 호스트 위치가 로컬 입력을 되감지 않도록 적용한 입력 순서와 함께 보정한다.

DXGI가 화면 변경을 보고하지 않으면 원시 화면 복사·새 영상 공급을 생략한다. 정지 상태에서도 캡처 worker와 renderer의 생존 응답을 확인한다. 수신기는 마지막 프레임이 ACK된 명시적 유휴 상태와 끊긴 영상을 구분한다. 재개·디코더 복구 요청은 최신 화면과 key frame으로 처리한다. ACK 혼잡 제어는 경로의 기본 소요와 추가 지연을 구분하며, 전송 중 프레임·바이트 상한은 유지한다.

## 근거와 범위

Chromium의 현재 캡처는 커서를 합성하며 확인한 런타임은 cursor 제약을 노출하지 않는다. DXGI는 화면 갱신과 포인터 갱신을 구분한다. 기존 Koffi로 Windows 시스템 API를 호출하여 코덱 실행 파일·외부 서비스·컴파일 도구 의존성을 추가하지 않는다. 입력·캡처 데이터는 기록하지 않는다.

근거: [DXGI Desktop Duplication](https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/desktop-dup-api), [프레임 갱신 정보](https://learn.microsoft.com/en-us/windows/win32/api/dxgi1_2/ns-dxgi1_2-dxgi_outdupl_frame_info).
구현 계획·검증 상태는 [작업 문서](../../work/remote-desktop-latency.md), 배경은 [연구](../../research/remote-desktop-latency.md)에 둔다.
