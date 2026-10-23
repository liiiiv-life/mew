---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: Windows 헤드리스 원격 화면에 자체 가상 디스플레이를 사용한다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0187 — Windows 헤드리스 원격 화면에 자체 가상 디스플레이를 사용한다"
created: 2026-10-01
updated: 2026-10-01
---

- 날짜: 2026-10-01
- 상태: 채택
- 후속: [0185](0185-mew-desktop-resident-direct-host.md) — 가상 화면·드라이버 설치 경계 추가
- 결정자: 사용자 (StarDesk 제거 후 독립 동작·가능하면 자체 드라이버 요청), Codex (구현 설계)

## 결정

- Windows UMDF 2·IddCx 기반 `Mew Virtual Display` 드라이버를 소스로 제공한다. StarDesk 드라이버·비공개 프로토콜과 타사 가상 디스플레이 제어 파이프에 의존하지 않는다.
- 드라이버는 시작 시 모니터를 만들지 않는다. 허용된 로컬 사용자 SID의 장치 핸들에 한 가상 모니터의 소유권을 묶고, 핸들 정리·명시적 종료·lease 만료에서 해제한다. 화면 생성은 인증된 원격 세션에 한정한다.
- 렌더 GPU LUID를 화면 생성 전에 지정한다. 실제 swapchain 렌더 GPU를 확인하고, 같은 물리 GPU의 Windows Graphics Capture·D3D11 NV12 변환·하드웨어 H.264를 사용한다. CPU 픽셀 읽기와 소프트웨어 인코더 fallback을 넣지 않는다.
- 가상 화면은 별도 확장 화면이다. 물리 모니터 복제·주 화면 변경·창의 자동 이동·다른 디스플레이 비활성화를 하지 않는다. 모니터가 없는 경우 Windows가 가상 화면을 유일한 데스크톱 출력으로 사용하도록 활성화한다.
- 영상의 첫 디코드와 입력 채널 준비를 모두 확인해야 뷰어를 연결 완료로 표시한다. 채널만 열리고 영상이 없는 상태는 제한된 시간 내 오류로 종료한다.
- 드라이버 패키지 생성과 운영 설치를 분리한다. 서명되지 않은 자체 빌드 결과는 운영 설치기가 거부한다. 서명 검증된 패키지를 사용자가 Windows 관리자 권한으로 한 번 설치하며, mew 호스트는 기존 일반 사용자 권한을 유지한다. Secure Boot 해제·테스트 서명 활성화·자체 루트 인증서 설치는 자동화하지 않는다.
- 개발 에이전트는 실행 중인 서버·설치본·실제 디스플레이 구성을 변경하지 않는다. 격리된 컴파일과 기존 출력의 GPU 캡처 검증을 수행하고, 서명·드라이버 설치·모니터 전원 꺼짐 상태의 검증은 수행 여부를 구분한다.

## 근거와 한계

[Microsoft IDD 모델](https://learn.microsoft.com/en-us/windows-hardware/drivers/display/indirect-display-driver-model-overview)은 사용자 모드 가상 모니터와 DirectX 표면을 제공한다. [렌더 어댑터 지정](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/iddcx/nf-iddcx-iddcxadaptersetrenderadapter)은 선호일 뿐이므로 실제 GPU를 확인한다. 드라이버 작성·컴파일만으로 신뢰되는 서명 인증서나 실기 설치 검증을 얻지는 못한다. 빌드·서명·설치 절차와 현재 검증 범위는 [프로젝트 계약](../../development/remote-desktop-virtual-display.md)이 소유한다.
