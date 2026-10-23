---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: Windows 캡처 실패 시에도 커서 분리를 유지한다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0146 — Windows 캡처 실패 시에도 커서 분리를 유지한다"
created: 2026-09-15
updated: 2026-09-15
---

- 상태: 채택
- 결정자: 사용자 (클라이언트 커서 미적용 수정 요청), Codex (구현)
- 부분 대체: [0144](0144-mew-desktop-local-cursor.md)의 Windows 초기화 실패 시 Chromium 직행 정책

## 결정

DXGI가 초기 화면이나 별도 커서를 제공하지 못하면 같은 로그인 세션의 worker에서 GDI 화면 복사와 별도 시스템 커서 조회를 사용한다. GDI도 실패하면 기존 Chromium으로 복귀한다. 커서 분리 여부를 연결 도움말에 표시한다.

GDI는 최대 30Hz로 화면을 읽고 동일한 픽셀은 인코더에 다시 공급하지 않는다. OS 커서를 화면에 그리지 않고 모양·hotspot·위치를 기존 커서 메시지로 보낸다. 원시 프레임은 helper 안에 머물고 기존 WebRTC/VP8 전송을 사용한다. 전역 커서 숨기기·OS 입력으로 화면을 강제 갱신하는 우회는 하지 않는다. 잠금·secure desktop 접근을 확장하지 않는다.

DXGI 초기 프레임 실패가 반복돼 Windows 연결에서 로컬 커서가 꺼지는 문제가 있었다. GDI는 CPU 읽기·비교 비용이 더 크고 일부 GPU/보호 콘텐츠를 읽지 못할 수 있으므로 보조 경로로만 사용한다. 변경 없는 영상의 네트워크 생략과 로컬 커서 응답은 유지한다.

근거: [Microsoft 화면 캡처](https://learn.microsoft.com/en-us/windows/win32/gdi/capturing-an-image), [CreateDIBSection](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-createdibsection), [GetIconInfo](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-geticoninfo).
구현·검증은 [개발 계약](../../development/remote-desktop.md), 진행 상태는 [작업 문서](../../work/remote-desktop-latency.md)에 둔다.
