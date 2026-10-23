---
title: "Mewlink 연결 시작의 요청 한도 일괄 검사"
description: "WebSocket bootstrap의 세 요청 한도 검사를 D1 batch 한 번으로 묶되 순서·거절 후 카운터·만료를 보존하는 결정과 운영 적용 전 검증 경계를 기록한다."
created: 2026-10-22
updated: 2026-10-22
---

## 상태

채택. 비공개 중앙 소스의 로컬 구현이며 운영 배포와 접속 시간 개선은 별도로 확인한다.

## 배경

기존 시작 병렬화 이후에도 익명 로그인 화면까지 수 초가 걸리는 사례를 운영 주소에서 확인했다. 중앙 Worker는 bootstrap의 기기 조회 뒤 IP launch·기기 launch·IP browser signal 한도를 순서대로 검사해 D1을 세 번 호출했다. 전체 시간의 측정 조건과 한계는 [배포 기록](../deployment/remote-central.md#2026-10-22-접속-지연-재측정과-요청-한도-batch)에 남긴다.

## 결정

세 한도 검사를 D1 `batch()` 한 번으로 처리한다. 뒤 UPSERT는 앞선 한도 초과 여부를 SQL에서 확인한다. 순차 검사의 한도·키·60초 창과 거절 후 뒤 카운터를 올리지 않는 동작을 유지한다. batch 오류에는 연결을 허용하지 않으며, 일반 signal과 구버전 HTTP launch는 기존 경로를 사용한다.

## 근거와 영향

[D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)는 한 DB 호출로 여러 문장을 순서대로 실행하고 실패 시 전체를 rollback한다. 정상 bootstrap에서 DB 왕복 두 번을 제거하면서 기존 요청 한도와 인증 경계를 유지한다. 스키마 변경은 없으며 중앙 Worker 배포만 필요하다. [ADR 0028](0028-mewlink-websocket-bootstrap.md)의 nonce·ticket·키 증명·RTC 준비 계약은 유지한다.

로컬 런처·네트워크·기기 상태에 따른 다른 대기는 남는다. 격리 검사는 한도 경계·거절 순서·만료·기존 검사와의 카운터 공유·동시 요청·rollback을 확인하며, 운영 배포 후의 실제 시간 단축을 대신하지 않는다. 현재 값과 적용 절차는 [접속 계약](../development/remote-access.md#연결-인증과-회수)과 배포 기록이 소유한다.
