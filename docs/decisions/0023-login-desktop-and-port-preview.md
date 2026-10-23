---
title: "로그인 가상 화면과 localhost 앱 접속 분리"
description: "내부 DOM 브라우저를 제거하고 OAuth는 독립 Linux 가상 화면의 영상·입력으로, 개발 앱은 인증된 localhost HTTP·WebSocket 프리뷰로 제공하는 결정. 직접 주소와 Mewlink의 실행 출처·배포 조건을 구분한다."
created: "2026-10-20"
updated: "2026-10-20"
---

## 상태

채택. 운영 적용은 사용자가 로컬 변경과 Mewlink 중앙 변경을 함께 반영한다.

## 배경

내부 DOM 브라우저의 페이지 재구성·입력 중계는 OAuth와 웹앱 호환성에 변수가 많았다. 호스트에서 게임하는 동안 다른 사용자가 브라우저를 사용해도 포커스·커서·키보드를 공유하지 않아야 한다. 개발 프론트를 보기 위해 호스트에서 브라우저까지 실행할 필요도 없다.

## 결정

일반 내부 브라우저 패널·주소창·독립 `/browser` 화면과 DOM 기록·재생 경로를 제거한다. 로그인에는 계정별 전용 X 서버, 창 관리·XTest 입력, 일반 Chrome과 영상 전송을 사용한다. 페이지에 DOM 기록기를 주입하거나 CDP를 연결하지 않는다. 가상 화면은 실제 데스크톱과 입력을 분리하며 계정별 전용 프로필은 유지한다.

개발 앱은 `/<port>` 또는 `mew.run/<user>/<device>/<port>`로 연다. 로그인과 `portPreview` 권한을 호스트에서 확인한 후 해당 loopback HTTP 포트만 전달한다. 앱의 JavaScript는 접속한 기기에서 실행한다. 직접 접속은 인증된 HTTP·WebSocket 호환 프록시를, Mewlink는 포트에 한정한 P2P 브리지를 사용한다.

경로는 보안 경계로 사용하지 않는다. 직접 접속의 프록시 문서는 opaque sandbox에서 실행하고, Mewlink 프리뷰는 세션마다 별도 preview origin에서 실행한다. 앱에 Mew의 세션·전체 API 전송 권한을 전달하지 않는다. 로그아웃·권한 회수에서 HTTP와 열린 소켓을 재검증한다.

## 근거와 영향

가상 모니터를 같은 로그인 데스크톱에 추가하는 것만으로 입력이 분리되지는 않는다. Linux/WSL의 독립 X 서버를 사용하면 가상 입력과 화면을 함께 소유할 수 있다. 기존 WebRTC 전송은 재사용할 수 있지만 사용자 흐름에 특정 전송 기술을 강제하지 않는다.

이 결정은 이전 [DOM 브라우저](../history/decisions/0127-mew-browser-server-dom-runtime.md)·[내부 OAuth](../history/decisions/0128-mew-browser-oauth-uses-internal-browser.md)·[직접 실행과 CDP](../history/decisions/0129-mew-browser-native-launch-cdp.md)의 현재 기능 범위를 대체한다. 과거 로그인 성공 기록은 당시의 실험 근거로 보존한다. DAP 디버거·외부 분석 파일 가져오기·Android 환경 점검은 유지한다.

현재 로그인 가상 화면의 지원 호스트는 Linux/WSL이다. Windows·macOS에 같은 입력 격리를 제공하는 네이티브 세션은 아직 구현하지 않았다. 실제 Google·Antigravity 인증, 게임 동시 실행 성능과 외부망은 격리 자동 검사와 구분해 사용자 환경에서 확인한다.

현재 구현 계약은 [로그인 가상 화면](../development/login-desktop.md), [localhost 앱 프리뷰](../development/port-preview.md), 조작 방법은 [사용법](../guides/browser.md)을 따른다.
