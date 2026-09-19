---
id: "mew-remote-desktop"
parent: "mew-remote"
title: "원격 데스크톱·터치 입력"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-19"
status_hash: "278f4dc5c3b21929284aadc8ff47af89a35f48d29be6a318f5b80773c2f10e81"
files: ["src/components/remote-desktop.tsx", "server/remote-desktop.ts", "server/remote-desktop-host.ts", "native/remote-desktop/main.mjs"]
commits: []
---

## 요구사항

서버가 사용하는 데스크톱 화면을 원격으로 보고 조작한다.

### 범위

- 구성 요소 준비·화면 선택·직접 연결/서버 전송과 마우스·키보드·모바일 조이스틱을 제공한다. 전체화면·90도 회전·속도 비례 커서 가속·감도 설정(기본 3배)·핸들로 옮기는 세로 핫키를 지원하고, 시작 경로의 중복 탐색·방화벽 진단 대기·직접 연결 fallback 대기를 줄인다.

### 경계와 제한

서버 전체에 한 연결을 사용한다. 지원 OS의 로그인된 데스크톱과 승인이 필요하며 잠금·로그인 전·UAC 화면은 지원하지 않는다. 실제 성능은 환경에 따라 달라진다.

### 상세 계약

[설치·조작](../../guides/remote-desktop.md) · [전송·입력·검증 범위](../../development/remote-desktop.md)

상위: [분야 지도](MOC.md) · [상위 기능](../remote.md).

<!-- mew:implementation:start -->
## 구현 내용

구성 요소 준비·화면 선택·직접 연결/서버 전송과 마우스·키보드·모바일 조이스틱을 제공한다. 전체화면·90도 회전·속도 비례 커서 가속·감도 설정(기본 3배)·핸들로 옮기는 세로 핫키를 지원하고, 시작 경로의 중복 탐색·방화벽 진단 대기·직접 연결 fallback 대기를 줄인다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

사용자 확인 기준: 지원 환경에서 연결·중단·화면 선택·터치 드래그·회전 후 클릭 좌표·감도·핫키 이동/입력·전체화면과 직접 연결 실패 시 서버 전송을 확인한다. 자동 검증과 실기 한계는 [구현 계획](../../work/remote-desktop-controls.md)에 기록한다.

<!-- mew:validation:end -->
