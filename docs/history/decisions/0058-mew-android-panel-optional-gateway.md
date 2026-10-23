---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: mew Android 창은 optional gateway다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0058 — mew Android 창은 optional gateway다"
legacy_description: "Android Emulator를 배포물에 넣지 않고, 상태 점검과 loopback gateway 표시만 mew에 붙인다."
created: 2026-08-20
updated: 2026-09-11
---

# 0058 — mew Android 창은 optional gateway다

- 상태: 채택
- 후속 결정: [0067](0067-mew-android-guided-tmux-actions.md) — 사용자가 누른 고정 안내 명령 실행; 배포물 미포함·자동 실행 금지는 유지
- 범위: mew
- 관련: [0057 — mew 브라우저 창은 manager·owner 전용 loopback 프록시로 연다](0057-mew-localhost-browser-panel.md)

## 맥락

mew에서 서버 기계의 Android Emulator 세션을 브라우저 안에 띄우고 싶다. 후보는 세 가지다.

1. mew 배포물에 emulator/WebRTC 런타임을 포함한다.
2. mew 서버가 emulator 설치·AVD 생성·실행까지 관리한다.
3. mew는 상태 점검과 loopback gateway 표시만 하고, emulator 런타임은 외부 도구로 둔다.

Android Emulator와 system image는 크고, 실행 중 자원 사용량도 크다. 반대로 mew는 기본 실행 경로가 가벼워야 한다.
또한 WSL/KVM 권한, Android SDK 설치, system image 라이선스 수락은 호스트별 조건이라 앱 배포물의 일부로 고정하기
어렵다.

## 결정

mew Android 창은 optional gateway로 둔다.

- mew 배포물에 Android Emulator, system image, AVD, WebRTC gateway를 포함하지 않는다.
- mew 서버는 emulator 프로세스를 시작하지 않는다.
- mew는 `GET /api/android/status`로 Linux·WSL의 `/dev/kvm` 또는 macOS의 Emulator 가속 상태, Android SDK 도구,
  호스트 CPU와 같은 아키텍처의 AVD 존재 여부만 점검한다. Apple Silicon은 `arm64-v8a`, Intel/AMD는 `x86_64`다.
- Android 화면은 사용자가 별도로 띄운 WebRTC/gateway URL을 브라우저 창과 같은 loopback 프록시로 연다.
- 권한은 브라우저 창·터미널과 같은 manager·owner로 제한한다.

## 결과

Android 기능을 켜지 않았을 때 mew의 추가 무게는 패널 코드와 상태 점검 API뿐이다. 에뮬레이터의 RAM·CPU·디스크
비용은 사용자가 별도 세션을 시작했을 때만 생긴다.

첫 구현은 수동 gateway URL 입력이다. 나중에 emulator supervisor를 붙이려면 별도 ADR이 필요하다. 그때도 supervisor는
mew 본체와 분리된 opt-in 실행 경로여야 한다.
