---
title: "0011 — 모바일 전체화면의 명시적 키보드 영역 반영"
description: "Chromium 전체화면에서 viewport·루트 크기만으로 OS 키보드 가림을 알 수 없는 문제를 VirtualKeyboard overlay 정책과 geometrychange로 보완하고, 데스크톱 사이트의 초기 축소와 터치 입력 판별, 일반 화면 복원·구형 좌표·미지원 환경·검증 범위를 정한 결정. Mewlink 중첩 iframe의 설정 주체는 후속 결정 0034, 진입 전 정책 준비는 0038로 보완한다."
created: 2026-10-16
updated: 2026-10-22
---

# 0011 — 모바일 전체화면의 명시적 키보드 영역 반영

상태: 승인

Mewlink의 중첩 iframe에서는 [0034 — 최상위 페이지의 키보드 영역 전달](0034-mewlink-keyboard-host.md)로 정책 설정 주체와 영역 전달을 보완한다. 직접 접속의 기존 처리와 구형 좌표 보정은 유지한다.

최상위 페이지의 전체화면 진입 전 정책 준비와 진행 중 유지·실패 복원은 [0038 — 전체화면 진입 전 키보드 정책 준비](0038-fullscreen-keyboard-entry-order.md)로 보완한다.

## 배경

모바일 전체화면에서 키보드를 열면 에이전트 입력창과 전송 버튼의 아래쪽이 가려진다. 루트의 실제 하단을 높이 계산에 추가한 뒤에도 사용자 실기에서 문제가 이어졌다. 이전 회귀 검사는 CSS로 루트를 줄이는 조건만 다뤘으므로, 키보드가 DOM 밖에서 화면을 덮는 경우를 검증하지 못했다.

[Chromium 구현](https://github.com/chromium/chromium/blob/main/content/browser/web_contents/web_contents_impl.cc)은 전체화면에서 키보드로 콘텐츠 크기를 줄이지 않는다. 따라서 viewport 설정과 DOM 크기의 최솟값만으로 가림을 처리하기에 부족하다.

## 결정

- 너비 768px 미만이거나 주 포인터가 coarse인 환경의 전체화면에서 VirtualKeyboard API를 지원하면 `overlaysContent`를 켜고 `geometrychange`와 `boundingRect`로 키보드 영역을 받는다. 일반 화면·터치 키보드 대상이 아닌 환경으로 전환하거나 관찰을 해제하면 이전 정책을 복원한다.
- 데스크톱 사이트 모드의 넓은 CSS 레이아웃과 터치 키보드 처리는 독립적으로 판단한다. 화면 높이는 visual viewport와 레이아웃의 너비 비율로 정규화하며, 초기 축소 배율을 CSS 높이에 다시 곱하지 않는다. 같은 높이 보정을 작업 영역과 키보드 감지에 사용한다.
- 작업 영역과 에이전트 입력창은 기존 viewport·루트 경계에 키보드 영역 경계를 추가한다. 독 숨김, 편집기 높이·커서, fixed 보조키와 뮤펫도 명시적 키보드 영역을 반영한다.
- 하단 고정 키보드의 가림 경계는 전체 레이아웃 높이에서 키보드 높이를 빼서 구한다. 구형 Android Chromium이 키보드 top 대신 root의 보이는 원점을 보고하므로 top에 의존하지 않는다. 기기별 키보드 높이나 여백을 상수로 추정하지 않는다.
- API가 없는 브라우저·보안 컨텍스트에서는 기존 viewport 관찰을 유지한다. 전체화면을 강제로 해제하거나 입력 포커스를 옮기지 않는다.

## 근거와 영향

[Chrome 공식 API 안내](https://developer.chrome.com/docs/web-platform/virtual-keyboard)는 overlay 정책을 명시적으로 켠 뒤 키보드 영역을 관찰하는 방식을 제공한다. 일반 화면의 `interactive-widget=resizes-content`는 유지한다. 구형 좌표 보완은 [Chromium의 geometry 계산](https://github.com/chromium/chromium/blob/main/chrome/android/java/src/org/chromium/chrome/browser/compositor/CompositorViewHolder.java)에 있는 이전 root origin 처리에 대응한다.

공유 구현과 검사 범위는 [공용 UI 계약](../development/ui-contracts.md#모바일-에디터와-키보드)에 둔다. 격리 Chromium 검사는 실제 전체화면의 에이전트·편집기에 키보드 영역을 모의 주입하며, 실제 Android Brave의 OS 키보드를 재현한 검사는 아니다. API 미지원 환경의 같은 증상과 실기 브라우저별 적용 결과는 별도로 확인해야 한다.
