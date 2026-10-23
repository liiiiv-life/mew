---
title: "0034 — Mewlink 최상위 페이지의 키보드 영역 전달"
description: "중첩 iframe에서 무시되는 VirtualKeyboard overlay 설정을 Mewlink 최상위 페이지로 옮기고 기존 연결 포트로 영역을 전달하는 결정. 직접 접속의 처리는 유지하며 Brave 검은 띠의 실기 검증은 별도로 남긴다."
created: 2026-10-21
updated: 2026-10-21
---

# 0034 — Mewlink 최상위 페이지의 키보드 영역 전달

상태: 승인

## 배경

[0011](0011-fullscreen-keyboard-geometry.md)은 앱에서 VirtualKeyboard overlay 정책을 설정했다. 그러나 Mewlink 앱은 중앙 연결 화면과 내부 런처 아래의 중첩 iframe에서 실행된다. Chromium의 getter는 하위 프레임에서 false를 반환하고 setter는 설정을 무시하므로 직접 접속과 같은 처리가 적용되지 않는다.

## 결정

- Mewlink 최상위 연결 페이지가 터치 입력·전체화면 조건으로 키보드 정책을 설정하고 관찰 해제 시 이전 값을 복원한다. 하위 프레임은 네이티브 정책을 설정하지 않는다.
- 기존 연결 MessagePort를 통해 키보드 영역과 기준 viewport 크기·overlay 상태를 전달한다. 별도 전역 메시지 수신 경로를 추가하지 않는다. 내부 런처는 최근 영역을 새 앱 포트에도 전달한다.
- 앱은 전달 수치를 검증하고 CSS 너비 비율로 좌표를 보정해 공통 키보드 관찰자가 사용하도록 한다. 하단 경계는 최상위 페이지 기준으로 계산해 내부 프레임 축소와 중복 적용하지 않는다.
- 직접 접속과 API 미지원 환경의 viewport 관찰을 유지한다. 전체화면을 강제로 해제하거나 포커스를 옮기지 않는다.

## 근거와 영향

[W3C VirtualKeyboard 명세](https://www.w3.org/TR/virtual-keyboard/)는 overlay 정책 설정을 보안 컨텍스트의 최상위 페이지로 제한한다. [Chromium 구현](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/virtualkeyboard/virtual_keyboard.cc)도 이 제한을 적용한다.

공통 계산·앱 수신부·회귀 검사는 공개 저장소에 두고, 연결 부모·내부 런처·연결 통합 검사는 기존 정책대로 Git에서 제외한 `mewlink/`에 둔다. 적용에는 로컬 앱 반영과 중앙 프론트 재배포가 모두 필요하며 에이전트는 빌드·배포·재시작하지 않는다. 구체적인 검사와 Android Brave 직접 접속의 검은 띠에 대한 미검증 범위는 [공용 UI 계약](../development/ui-contracts.md#모바일-에디터와-키보드)에 기록한다.
