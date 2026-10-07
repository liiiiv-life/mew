---
title: "브라우저 네트워크 사용량 집계"
description: "현재 Mew 탭의 HTTP·WebSocket·WebRTC 사용량을 원격 데스크톱과 그 외로 분리해 헤더·상세 팝업에 표시하는 집계 수명, 중복 방지와 추정 범위 및 검증 계약을 정의한다."
created: "2026-10-07"
updated: "2026-10-07"
---

# 네트워크 사용량

[기능 계약](../features/화면·계정·운영/네트워크%20사용량.md) · [원격 데스크톱의 세션별 집계](remote-desktop.md#뷰어-설정과-좌표)

`main.tsx`는 React 렌더 전에 `startNetworkTracking()`을 설치한다. `network-usage.ts`의 메모리 저장소는 현재 탭을 연 뒤의 사용량을 수신·송신과 `desktop`·`other`로 구분한다. 프로젝트 전환·원격 연결 종료·재접속에도 탭 합계를 유지하고 새로고침·새 탭에서 다시 시작한다. 다른 탭·사용자·서버 전체의 사용량을 합산하거나 영구 저장하지 않는다. payload·자격증명·메시지 내용은 보관하지 않으며 팝업은 집계를 위해 서버에 추가 요청하지 않는다.

## 집계 범위

- 같은 서버의 완료된 HTTP 요청은 buffered ResourceTiming의 `encodedBodySize`로 실제 전송된 응답 본문을 집계한다. `transferSize`가 0인 로컬 캐시 응답은 제외하며 압축된 본문 길이를 사용한다. 초기 앱·폰트·이미지 등의 자원과 navigation 통계를 제공하는 브라우저의 첫 HTML 응답도 포함한다.
- fetch 송신은 문자열의 UTF-8 길이, ArrayBuffer·뷰·Blob 크기, URLSearchParams 인코딩 길이와 FormData의 필드 이름·값·파일 크기를 센다. multipart 경계·헤더는 제외한다. 이미 만든 Request에만 존재하는 본문과 크기를 알 수 없는 송신 ReadableStream은 임의로 읽거나 추정하지 않는다. 응답이 반환된 요청부터 반영하며 전송 도중 실패한 업로드의 일부 바이트는 확인할 수 없다.
- fetch의 `text/event-stream` 응답은 TransformStream으로 읽는 청크를 즉시 집계한다. 별도 clone·백그라운드 소비·전체 버퍼링을 추가하지 않고 원래 backpressure·취소·오류를 전달한다. 반환하는 Response의 상태·헤더·URL·type·redirected와 clone 동작을 유지한다. 완료 시 ResourceTiming 항목은 제외해 이중 집계를 막는다. 청크 길이는 브라우저가 압축을 해제한 본문 길이다.
- 같은 서버의 WebSocket은 정상 OPEN 상태에서 보낸 메시지와 받은 메시지를 UTF-8·Blob·ArrayBuffer 길이로 집계한다. 외부 서버 통신은 제외하고 native 정적 상수·이벤트·binaryType·오류 동작을 유지한다. 추적 해제는 원래 fetch·WebSocket을 복원하고 observer를 정리한다.
- `/api/remote-desktop/` HTTP는 원격 데스크톱으로 분류한다. `/api/remote-desktop/ws`는 공통 WebSocket 집계에서 제외하고 기존 연결의 인증 메시지·WebRTC 통계와 함께 `desktopUsageReporter`가 새 바이트만 추가한다. 원격 세션의 자체 표시값은 재접속마다 초기화하지만 헤더 합계는 이전 세션을 보존한다. RTP·DataChannel·candidate-pair와 인증 WebSocket을 서로 중복해서 더하지 않는다.

HTTP·WebSocket/TLS/IP 헤더·ICE 연결 검사, 다른 창·Worker·iframe 내부에서 별도로 수행한 통신, 브라우저가 노출하지 않는 전송량은 포함하지 않는다. 로컬 캐시·압축·SSE 해제·multipart·실패한 업로드와 WebRTC 표본 시점 차이가 있으므로 OS·통신사 청구량과 일치하는 계량기가 아닌 **현재 탭의 추정치**다.

## 화면과 갱신

`NetworkUsageButton`은 활성 세션 왼쪽에 합계만 compact 숫자로 표시하며 번역된 접근성 이름과 공통 hover 툴팁을 제공한다. 클릭하면 공통 `DialogFrame`의 표에 원격 데스크톱·그 외·전체 행과 수신·송신·합계 열을 표시한다. 열린 팝업도 갱신하며 닫기·바깥 클릭·Esc·뒤로가기·포커스 복원은 공통 계약을 따른다. 원격 뷰어가 덮고 있는 동안에도 집계는 계속된다.

저장소는 메시지마다 카운터를 갱신하되 구독 알림은 초당 한 번으로 합친다. 고빈도 터미널·협업·브라우저 메시지마다 React를 다시 렌더링하지 않는다. 한국어·영어·중국어 간체·일본어와 PC·모바일 레이아웃을 공유한다.

## 검증

`network-usage.test.ts`는 세션 합산·중복 방지·불변 snapshot·알림 제한과 요청 본문 바이트 계산을 검사한다. `network-usage-ui.test.ts`는 실제 격리 HTTP/WebSocket 서버의 자원·업로드·SSE·취소·clone을 사용해 집계와 팝업을 확인한다. `remote-desktop-ui.test.ts`는 실제 WebRTC 통계가 헤더 저장소에 반영되고 뷰어를 닫아도 합계가 남는지 검사한다. 실제 원격 기기·운영 청구량 일치 여부는 이 검사에서 보장하지 않는다.
