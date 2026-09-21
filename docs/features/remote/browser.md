---
id: "mew-remote-browser"
parent: "mew-remote"
title: "서버 브라우저·로그인·팝업"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-20"
status_hash: "f10cdc472b8ce85de135351d9b60578cf2b8b0424ff75144f0a462226d043c03"
files: ["src/components/BrowserPanel.tsx", "src/components/server-dom-browser.tsx", "server/browser-dom.ts", "server/browser-dom-profile.ts"]
commits: []
---

## 요구사항

서버에서 웹페이지를 열어 프로젝트 웹앱과 외부 사이트를 사용한다.

### 범위

- URL·탭·뒤로/앞으로·폼·업로드/다운로드·로그인 팝업과 계정별 프로필을 제공한다.

### 경계와 제한

사용자의 개인 Chrome을 연결하지 않는다. 사이트 로그인 지원과 DOM 입력·렌더링 한계, 프로필·쿠키 경계는 브라우저 사용법을 따른다.

### 상세 계약

[서버 브라우저 계약](../../guides/browser.md)

상위: [분야 지도](MOC.md) · [상위 기능](../remote.md).

<!-- mew:implementation:start -->
## 구현 내용

URL·탭·뒤로/앞으로·폼·업로드/다운로드·로그인 팝업과 계정별 프로필을 제공한다.

관리되지 않는 Chromium 시작용 빈 탭 생성을 막고, 생성 도중 닫은 탭도 실제 서버 탭까지 정리한다. 정상 로그인 빈 팝업은 유지한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다: 페이지 이동·입력·팝업·계정별 로그인 상태가 맞고 다른 계정의 프로필과 섞이지 않는지 확인한다.

<!-- mew:validation:end -->
