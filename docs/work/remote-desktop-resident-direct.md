---
title: "상주 GPU 원격 데스크톱 직접 연결 구현·검증"
created: 2026-10-01
updated: 2026-10-01
description: "Windows/WSL 상주 GPU H.264 직접 연결의 구현·로컬 첫 화면 측정과 후속 가상 화면 연동, 사용자 적용·외부망·서명·헤드리스 검증 조건을 기록한다."
---

# 구현과 적용 확인

[작업 지도](_work.md) · [현재 아키텍처](../development/remote-desktop.md) · [ADR 0185](../../../.mew/docs/decisions/0185-mew-desktop-resident-direct-host.md)

Windows/WSL 구현을 완료하고 사용자 적용·외부 네트워크 실측을 기다린다. Mac/Linux의 Electron 제거는 이번 구현 범위에 포함하지 않는다. 운영 서버·설치본을 바꾸거나 커밋하지 않았다.

**후속 구현:** [ADR 0187](../../../.mew/docs/decisions/0187-mew-independent-virtual-display.md)에 따라 자체 UMDF 가상 디스플레이 소스와 WGC 캡처를 추가했다. 정식 서명·설치·headless 실기 검증은 남아 있다. 새로운 캡처 경로의 확인 범위·측정은 [가상 디스플레이 계약](../development/remote-desktop-virtual-display.md)을 따른다. 아래 최초 구현의 DXGI·시간 측정은 그 당시 결과로 보존한다.

## 확인한 동작

- Windows C++ GPU DLL을 임시 폴더에서 MSVC·Windows SDK로 컴파일했다. 실제 로그인 데스크톱을 D3D11·Media Foundation 하드웨어 H.264로 처리하고 Chrome `<video>`에서 decode·표시했다. 화면 파일과 클립보드 변경·키 입력을 만들지 않았다. 최종 검사에서는 커서 feedback이 idle 입력으로 되돌아가지 않게 수정한 뷰어를 사용했다.
- 호스트를 먼저 예열한 로컬 실기 반복에서 첫 세션 표시 약 383–761ms, 같은 프로세스의 다음 세션 약 111–179ms를 확인했다. 화면 목록 재조회·UDP 포트 고정이 포함된 후속 검증도 통과했다. 표본 수가 작으며 호스트 초기 실행·설치 시간을 제외한 테스트 페이지의 열기→첫 표시 값이다.
- 상주 호스트는 세션마다 캡처·인코더를 생성하고 해제한다. 장치만 대기에 보유하며 worker의 캡처 polling은 멈춘다. 실제 대기전력 W는 측정하지 않았다. 별도 예열만 한 호스트의 6초 샘플은 CPU 누적 0.046875초(한 코어 약 0.78%), working set 82.52MiB, 전용 GPU 메모리 11MiB였다. 초기 짧은 샘플이므로 장시간 정상 상태·추가 전력을 보장하는 값으로 사용하지 않는다.
- 활성 연결에서만 타이머 해상도 1ms를 요청하고 대기로 돌아오면 해제한다. Windows 4ms timer의 짧은 평균 검사에서 기본 약 15.28ms → 요청 시 약 4.40ms를 확인했다. 프레임 시계·MFT credit도 수정했으며 정지 화면 강제 refresh의 하드웨어 인코더에서 4.003초 동안 240개 H.264 keyframe 출력과 단조 증가 timestamp를 확인했다. 이 테스트를 실제 움직이는 화면의 브라우저 60fps 성능으로 취급하지 않는다.
- 캡처 없는 예열, 종료 확인 후 프로세스 재사용, 오래된 session ID/kill의 격리, 종료 확인 실패의 lease 대기와 시작 실패 재시도를 자동 검사한다. 서버는 relay·relay-input·frame-ack를 거부한다. Windows pipe 실기로 로그인 세션·입출력·JS가 멈춘 자식의 부모 종료 처리도 확인했다.

관련 자동 검사 106개 중 103개 통과·OS 실기 opt-in 3개 생략을 확인했다. Windows pipe·GPU opt-in은 별도로 실제 실행해 같은 파일의 기본 검사와 합쳐 9개를 통과했다. 최종 고정 UDP 포트 실기의 첫 세션은 536ms, 다음 세션은 130ms였다. TypeScript·lint·문서 링크/배치/MOC/ADR 검사를 통과했다. UI 검사에는 합성 직접 영상의 정지 16초 동안 추가 video payload 없이 연결 유지와 이후 화면/입력 재개가 포함된다.

## 적용 전후 확인

사용자가 앱을 빌드·적용하고 보조 앱을 준비한다. Windows는 C++ Build Tools·Windows SDK·하드웨어 H.264 지원이 필요하다. [설치 안내](../guides/remote-desktop.md)와 [의존성·배포 조건](../development/remote-desktop-distribution.md)을 따른다.

인터넷·휴대폰 환경에서는 직접 ICE 연결 성공률, 초기 화면 p50/p95, 입력→실제 화면 변화, 연속 60fps 부하, 손실·혼잡 시 복구를 별도로 측정한다. WSL Linux Chromium→Windows 호스트의 직접 경로는 현재 테스트 환경에서 실패했으며 Windows Chrome→Windows 호스트는 성공했다. 공개 STUN을 끈 로컬 시험의 결과이고, 원인을 방화벽·NAT·mDNS 중 하나로 단정하지 않는다. TURN 없이 도달할 수 없는 네트워크를 자동 해결했다고 기록하지 않는다.

H.264 송신은 bounded worker IPC·NACK·decode feedback과 단순 bitrate 제어를 사용한다. libwebrtc GCC·하드웨어별 pacing·adaptive resolution·같은 브라우저의 WebRTC 세션 유지 재개는 후속 최적화다. 이런 추가 기능을 구현 완료로 취급하지 않는다.
