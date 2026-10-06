---
title: "원격 데스크톱 커서·지연 개선 구현"
created: 2026-09-15
updated: 2026-10-01
---

# 원격 데스크톱 커서·지연 개선 구현

[작업 지도](_work.md) · [ADR 0144](../../../.mew/docs/decisions/0144-mew-desktop-local-cursor.md) · [ADR 0146](../../../.mew/docs/decisions/0146-mew-desktop-cursor-capture-fallback.md) · [연구](../research/remote-desktop-latency.md)

2026-10-01 후속: 아래는 기존 구현·측정 기록이다. Windows/WSL 캡처·호스트 수명과 전체 영상 전송은 [ADR 0185](../../../.mew/docs/decisions/0185-mew-desktop-resident-direct-host.md)·[상주 직접 연결 구현](remote-desktop-resident-direct.md)이 대체한다. 커서·터치 입력의 유지 범위는 현재 [개발 계약](../development/remote-desktop.md)을 따른다.

## 아키텍처

Windows DXGI worker → 한 요청/한 응답의 원시 BGRA 화면 → sandbox renderer의 생성 video track → 기존 WebRTC 또는 WebCodecs VP8 서버 전송. 포인터 변경은 별도 검증된 메타데이터로 뷰어에 전달한다. worker는 별도 스레드이며 입력 주입을 막지 않는다. Windows DXGI 초기화 실패 시 GDI worker의 별도 커서·화면 복사로 보완한다. macOS는 자체 ScreenCaptureKit 모듈의 커서 없는 최신 화면을 같은 worker 프로토콜로 전달한다. 각 OS의 네이티브 초기화 실패나 Linux는 기존 Chromium 캡처를 사용하고 이 경로에서는 로컬 커서를 활성화하지 않는다.

뷰어는 호스트 커서 이미지·hotspot을 캐시하고 마우스는 native CSS cursor, 조이스틱은 로컬 위치 레이어로 표시한다. 이동/호버와 영상의 갱신 주기를 분리하며 down/up/wheel은 현재 좌표를 동반한다. idle 영상의 생존 확인과 큐 제한을 함께 유지한다.

## 단계

- [x] 현재 캡처·프로토콜 확인, ADR 작성
- [x] Windows DXGI worker·원시 프레임 수명·포인터 변환과 기능 검사 구현
- [x] renderer 생성 track·캡처 fallback·유휴/재개 연결
- [x] 커서 메타데이터 검증·서버 전달·뷰어 표시와 위치 보정
- [x] 입력 합치기·마지막 이동 복구·down/up/wheel 좌표
- [x] 서버 ACK 적응·유휴 영상 생존 확인·복구
- [x] 단위·실제 Chromium 및 Windows fallback 실기 검증
- [x] 현재 계약·사용법·배포 문서 갱신, 타입·린트·문서 검사
- [x] Windows 네이티브 활성화·실제 커서 이미지 표시 검증, DXGI 오류/초기 프레임 부재를 실제 GDI 경로로 보완
- [x] 초기 영상 크기가 늦게 정해지는 경우 커서 위치 재계산·도움말의 적용 상태 표시

## 검증 결과와 남은 조건

| 범위 | 결과 |
| --- | --- |
| 프로토콜·입력·서버·설치 회귀 | Mac 확장 포함 회귀 41개 통과, Mac 실기 검사 1개 조건부 생략 |
| 실제 Chromium | 직접·서버·네이티브 모사 서버·네이티브 모사 직접→서버 4개 시나리오 통과 |
| 유휴 영상 | 합성 캡처의 16초 정지 동안 추가 영상 0프레임/0바이트, 연결 유지·정지 중 keyframe 복구·갱신 재개 확인 |
| Windows 설치 런타임 + 임시 helper | Chromium fallback 영상 수신·연결 유지·부모 종료 통과 |
| Windows 네이티브 커서 | 정상 초기화에서 커서 메타데이터 수신, 투명 PNG의 실제 픽셀·DOM 표시 확인. DXGI 오류/초기 프레임 부재를 강제한 두 조건 모두 실제 GDI + 로컬 커서 통과 |
| 정적 검사 | `npx tsc -b`, 린트 통과(기존 경고 10개), 문서 허용목록·workspace 링크 검사 통과 |

DXGI 초기 프레임 부재 시 빈 duplication을 한 번 재생성하며 각 시도에서 약 1초 대기한다. 다시 실패하거나 API/형식 오류가 나면 GDI 보조 캡처로 커서 분리를 유지한다. 두 네이티브 경로가 모두 준비되지 않으면 Chromium으로 연결하고 도움말에 영상 커서라고 표시한다. DXGI 자체의 모든 드라이버/화면 상태를 해결했다고 주장하지 않는다. GDI의 화면 읽기·비교 비용과 일부 GPU/보호 콘텐츠 제한은 남는다.

실기 테스트는 기능 활성화 신호만 확인하던 범위에서 실제 모양 수신·PNG 디코드·불투명 픽셀·브라우저 이미지 표시까지 확장했다. Windows API 오류/초기 프레임 timeout은 임시 테스트 helper에서만 모사하며 설치본을 수정하지 않는다.

0바이트는 영상 payload에 한정한다. 입력 heartbeat·상태·커서 메타데이터는 남으며, 외부 모바일 망의 실제 지연·대역폭이나 StarDesk 대비 우위는 측정하지 않았다. macOS 네이티브 경로는 같은 로컬 커서·유휴 생략을 사용하며 실기는 아직 확인하지 않았다. Linux는 기존 영상 커서를 유지한다. DXGI에는 CPU readback과 IPC 복사가 있고, DXGI 회전·분리 불가 커서는 GDI 보조 경로 대상이며, 두 경로의 크기 상한을 넘는 화면은 Chromium fallback 대상이다.

## 검증 원칙

화면·키 입력을 영구 기록하지 않는다. 브라우저 UI는 합성 화면으로 검사하고 Windows 실기는 임시 helper와 설치된 런타임 참조를 사용한다. 설치본·실행 서버를 변경하지 않는다. 실제 OS/API 검증과 합성 장면 성능 수치는 구분한다. 실제 외부 망·Mac/Linux·모바일 실물 성능을 검증했다고 확대하지 않는다. 빌드·재시작은 README에 따라 사용자가 한다.

## macOS 확장 — ADR 0148

- [x] [ADR 0148](../../../.mew/docs/decisions/0148-mew-macos-local-cursor.md), ScreenCaptureKit·자체 C ABI·설치 계획
- [x] 커서 없는 최신 화면 하나·중복 화면 생략·별도 커서·Retina/모니터 좌표·종료 처리
- [x] CPU별 자동 컴파일·로컬 서명·실패 시 준비 마커 방지·바이너리 누락 감지
- [x] Apple SDK 15.5 기준 arm64·x86_64 Mach-O 객체 컴파일(`-Wall -Wextra -Werror`)
- [x] Mac adapter/설치와 기존 입력·서버 회귀: 41개 통과, Mac 실기 1개 조건부 생략
- [x] 실제 Chromium 직접/서버/합성 네이티브/직접→서버 4개 시나리오 통과; 16초 정지 중 추가 영상 0프레임/0바이트
- [x] 타입·린트(기존 경고 10개)·문서 허용목록·workspace 링크 검사 통과
- [ ] 실제 Mac의 dylib 링크/로딩, Screen Recording·Accessibility 권한, 시스템 커서 모양·숨김, Retina·혼합 배율·다중 화면, 잠금·재연결 확인

실기 검사는 `MEW_DESKTOP_TEST_MACOS_CAPTURE=1 node --test server/remote-desktop-macos.test.ts`로 별도 임시 helper에서 실행하도록 추가했다. 현재 작업 환경은 Linux/WSL이므로 실행하지 않았다. SDK 컴파일과 모의 FFI/브라우저 검증을 Mac 실기 성공으로 해석하지 않는다. macOS 커서 조회 API의 deprecated 상태와 화살표 대체는 [현재 개발 계약](../development/remote-desktop.md#macos-캡처설치-계약)에 명시한다.
