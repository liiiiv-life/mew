---
title: "Mewlink WebSocket 연결 시작과 호스트 RTC 병렬 준비"
description: "별도 HTTP launch 대신 WebSocket에 결합한 단회 nonce로 연결을 시작하고, 최종 ticket 검증과 호스트 RTC 준비를 겹치는 결정. 구버전 호환·인가 경계·취소와 격리 검증 및 운영 적용의 범위를 정한다."
created: 2026-10-20
updated: 2026-10-20
---

## 상태

채택. 코드와 격리 검증을 위한 결정이며 운영 적용이나 첫 접속 0.5초 달성을 뜻하지 않는다. 로컬 호스트 업데이트와 비공개 Mewlink 중앙 재배포는 사용자가 수행한다.

시그널링 단절 시 전체 연결 종료의 범위는 [ADR 0033](0033-mewlink-signaling-resume.md)의 협상된 재부착으로 대체한다. 이 결정의 최초 연결·키 증명·ticket·구버전 호환 계약은 유지한다.

## 배경

운영 주소의 동일 호스트 Chromium 측정에서 로그인 화면까지 캐시 없는 첫 방문 5회의 중앙값은 2.70초, 새로고침 5회는 2.34초였다. launch·WebSocket·ticket·answer의 직렬 구간은 약 1.6~1.7초였다. 이 측정은 외부 모바일 망이나 로그인 후 workspace 표시 시간을 포함하지 않는다.

[ADR 0025](0025-mewlink-signaling-authority.md)는 신호 메시지마다 반복하던 기기·브라우저 D1 조회를 제거했다. HTTP launch 응답 뒤 WebSocket을 열고, 호스트가 ticket을 받은 뒤 RTC를 만드는 시작 순서는 남았다. 캐시와 독립적으로 이 대기 순서를 줄인다.

## 결정

새 중앙 런처는 기기 경로 또는 instance ID로 WebSocket bootstrap을 요청한다. Worker가 origin·기기 존재·기존 IP/기기 요청 한도를 확인한 뒤 해당 기기 DO에 전달한다. 기기 이름 조회는 계정과 기기를 JOIN 한 번으로 확인한다. 등록되지 않은 ID로 DO 저장소를 만들지 않는다.

DO는 중앙 쿠키에서 확인한 선택적 신원, 세션 해시, 난수 subject와 단회 nonce를 해당 WebSocket attachment에 저장한다. challenge는 공개 연결 문맥과 중앙 공개 키를 같은 origin의 WSS로 전달한다. 브라우저는 nonce와 offer·공개 키를 제출하며, DO는 nonce를 한 번만 소비한 뒤 기존 prepare·ready·ticket 경로를 실행한다. 새 경로는 D1 `launches`에 기록하거나 소비하지 않는다. 요청 제한과 중앙 신원 검증은 유지한다.

브라우저의 연결 controller는 생성 즉시 WSS와 ICE 준비를 시작한다. 서버가 확인한 instance를 받은 뒤 해당 기기의 브라우저 키·재개 세션을 결합한다. 경로 힌트가 다른 기기를 가리키면 준비한 연결을 닫고 실제 기기의 신원 모드로 다시 시작한다. 앱 프레임에는 허용한 공개 설정과 자격증명을 제거한 전송만 전달한다.

재접속은 기존 instance·중앙/앱 origin·previewDomain이 같은지 확인한다. 실행 설정이 달라지면 새 준비 연결과 기존 iframe을 정리하고 자동 복구를 중단한다. 설정이 같아도 로컬 계정·인증 수단 확인을 마친 뒤에만 기존 앱 전송을 교체한다.

호스트는 prepare에서 challenge·generation을 생성하고 ready를 먼저 보낸 뒤 RTC helper를 시작한다. RTC 준비와 중앙 ticket 왕복을 겹치되 ticket·외부 신원·브라우저 키 소유 증명을 모두 확인하기 전에는 세션 재개·dispatcher·인증 완료 응답을 허용하지 않는다. `remoteTicketInbox`가 기존 유한 inbox의 크기·개수 한도를 유지하며 먼저 도착한 데이터를 검증 뒤 처리한다. 취소·만료·회수는 대기를 해제하고 helper와 송신 대기를 정리한다. 늦은 ticket·서명·프로세스 callback은 끝난 연결을 다시 열지 못한다.

기존 DO의 호스트 메시지 FIFO는 ready 처리와 ticket 전송을 마친 뒤 answer·candidate를 전달한다. 브라우저의 ticket → answer 검증 순서, 최종 서명·키 증명, lease와 직접 P2P 데이터 경로를 유지한다.

기존 HTTP launch와 토큰 소비 경로는 구버전 클라이언트를 위해 유지한다. 새 클라이언트는 bootstrap 문맥을 받기 전 전송 실패에만 기존 경로를 시도한다. 문맥을 받은 뒤의 오류, 잘못된 문맥, 명시적 접근 거부·회수에는 복귀하지 않는다. 기존 호스트의 prepare·ready·ticket 메시지도 그대로 지원한다.

## 근거와 영향

HTTP launch를 먼저 기다리는 브라우저 왕복과 새 경로의 launch INSERT/DELETE를 없애고, RTC 준비를 ticket 왕복에 겹친다. 앞당긴 준비는 인가가 아니므로 최종 작업 허용 조건을 바꾸지 않는다. nonce와 신원은 attachment에서 복원하며 메모리 상태를 인가 근거로 삼지 않는다. [Cloudflare WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).

ADR 0025의 기기 DO 인가 상태·회수 보존은 유지하고, HTTP launch만 사용하던 시작 경로와 ticket 이후 RTC 생성 순서를 이 결정으로 대체한다. 정적 자원 캐시와 번들 구성은 이번 결정의 대상이 아니다. 현재 연결·인가 계약은 [원격 접속](../development/remote-access.md), 적용과 복귀는 [중앙 배포](../deployment/remote-central.md)가 소유한다.

## 검증 경계

Workers 79개 검사는 새 bootstrap의 launch SQL 0회, nonce 변조·재사용·다른 소켓·만료·hibernation, 기존 요청 한도, 로그아웃·기기/브라우저 회수 경합과 구버전 연결을 포함한다. 공개 브라우저 연결 검사 33개와 호스트·ticket inbox 검사 14개는 HTTP 키 조회 없는 연결, 문맥 검증·취소, ticket 전 데이터 대기, 준비 중 종료·만료·잘못된 ticket·최대 8개와 늦은 callback을 검증했다.

격리 Chromium 런처 검사 11개는 첫 접속·새로고침·자동 복구의 launch HTTP 0회, 구버전 복귀, 잘못된 기기 힌트, 키·자원 준비 병렬화·동일 계정 복구와 변경된 실행 설정의 연결 중지를 확인했다. 타입·린트·문서 검사와 실제 Workers/네이티브 RTC/Chromium 검증 결과는 소유 문서에 기록한다. 운영 재배포 후의 첫 접속·새로고침·외부망 시간은 별도 측정해야 한다.
