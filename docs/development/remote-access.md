---
title: "계정 기반 P2P 원격 접속 계약"
description: "Workers·D1·Durable Objects의 비공개 mewlink와 A의 인증된 DataChannel, UI 전체·HTTP·WebSocket·자원 전송과 origin·신원·권한·수명·제한을 정의한다. 실제 배포·제공자 로그인·외부망 검증은 남아 있다."
created: 2026-10-07
updated: 2026-10-07
---

# 계정 기반 P2P 원격 접속

[작업·출시 기준](<../tasks/mew 중계 기능 만들기.md>) · [중앙 서비스 설치](../deployment/remote-central.md) · [ADR 0195](../../../.mew/docs/decisions/0195-mew-account-based-p2p-remote-access.md) · [후속 ADR 0203](../../../.mew/docs/decisions/0203-mewlink-workers-p2p-ui.md) · [권한](access-control.md)

중앙 계정·서버 등록·멤버 승인·시그널링과 브라우저 ↔ A의 앱 DataChannel을 구현했다. 로컬 Chromium과 네이티브 RTC, 실제 파일 API를 사용한 자동 검증을 완료했다. **중앙 배포·실제 제공자 로그인·WSL ↔ 외부 Android/LTE 실측은 완료하지 않았다.** 이 문서는 현재 코드 계약이며 출시 승인 기록은 아니다.

## 구성과 신원

`mewlink/src/worker.ts`가 Cloudflare 중앙 진입점이다. 부모 Git·npm workspace에서 제외한 폴더의 자체 package.json으로 관리한다. Workers + Static Assets는 로그인·기기 선택·연결 프론트만 함께 배포하고, D1은 계정·등록·세션·멤버십·일회용 요청, 기기별 Durable Objects는 상시 WSS·시그널링·회수를 담당한다. 중앙은 로컬 API·워크스페이스·터미널·에이전트 모듈과 부모 mew `dist/`를 불러오지 않는다. 중앙 `/api`에는 작업 라우터가 없다. OAuth는 Google·GitHub·Apple과 선택 이메일 OIDC 직접 연동이며 Supabase를 사용하지 않는다.

주소창은 `mew.saens.kr/{user}/{device}`다. 로그인 후 중앙 세션에 묶인 60초 일회용 launch를 내부 앱 origin `mew-ui.saens.kr/launch/{임시 ID}`의 정확한 프레임에 전달한다. 중앙 세션 쿠키는 `__Host-`·Secure·HttpOnly이며 앱 origin에는 전송하지 않는다. 앱 호스트의 인증·계정 API는 차단한다. 실제 mew UI는 연결 후 A에서 받아 내부 iframe에서 실행한다. 동일 origin의 경로 분리는 중앙 인증의 보안 경계가 아니므로 내부 origin을 별도로 둔다. 두 호스트는 같은 Worker에 배포하며 사용자가 앱 호스트를 직접 열 필요는 없다.

`server/remote-ui.ts`는 인증된 dispatcher의 GET/HEAD에서만 설치된 A의 `dist/`를 제공한다. direct HTTP·임의 파일·포트·개발 서버를 허용하지 않고 실제 경로 검사로 외부 symlink·dotfile·탐색을 거부한다. 파일은 최대 32MiB, index는 512KiB다. 빌드된 index의 `mew-p2p-bootstrap=1`을 확인해 구버전 UI를 실행하기 전에 거부하고, 응답에 주입한 `mew-p2p-app` meta를 통해 원격 bootstrap을 선택한다. `src/main.tsx`는 부모의 MessagePort를 확인해 전송·계정/instance 저장소 범위를 정한 **뒤** App 모듈을 import한다. A의 일반 프로젝트 경로는 원격 모드를 선택하지 않는다.

Service Worker는 `/__mew_ui/{임시 ID}/...`를 `/api/remote-ui/file?path=...`로 연결하고 절대 정적 URL을 같은 접두사로 redirect한다. JS의 `import.meta.url`·동적 import·worker 자원도 같은 연결에 남는다. worker 재시작 시에도 정확히 같은 `/launch/{임시 ID}` window만 찾으며 다른 탭으로 대체하지 않는다. 앱 요청은 MessagePort → 부모의 인증된 DataChannel, native URL 요청은 worker → 같은 부모 전송을 사용한다. 실제 앱 코드에는 중앙 세션·launch 증명을 전달하지 않는다.

A의 `server/remote-access-agent.ts`는 로컬 owner가 시작한 5분짜리 등록 요청을 확인한다. A가 생성한 Ed25519 키의 소유 증명과 중앙 서명 영수증을 검증하고 불변 instance ID·중앙 계정 ID·기기 이름·키를 저장한다. 로컬 `serve.ts`와 Vite plugin은 등록이 있을 때만 중앙으로 WSS를 연결한다. 지수 backoff는 최대 30초에 jitter를 더하며, 재시작은 저장한 키를 사용한다.

중앙 신원은 **제공자 ID + 검증된 issuer + 불변 subject**다. GitHub는 고정 issuer 아래 숫자 사용자 ID를 쓴다. 동일 이메일·표시 이름이나 다른 제공자의 동일 subject를 합치지 않는다. 로그인 제공자 변경·이메일 OIDC issuer 교체는 별도 계정이 된다. 제공자 간 계정 연결 UI는 아직 제공하지 않는다.

A의 기존 이메일 기반 계정을 유지한다. 최초 중앙 owner를 등록을 시작한 로컬 owner에 연결하고, 멤버는 owner가 **중앙 계정 ID ↔ 기존 로컬 계정**을 명시적으로 연결한다. 새 로컬 계정 생성·역할 승격·이메일 자동 인수는 등록 과정에서 수행하지 않는다. 임시 비밀번호 변경이 필요한 계정은 P2P 작업에 접속하지 못한다.

A의 `<DATA_DIR>/remote-access.json`에는 버전 1, 서버 키, 고정 중앙 공개 키와 계정 매핑을 원자적으로 저장한다. 비공개 키는 OS 사용자 전용 파일 권한을 사용한다. 손상된 설정을 새 키로 덮어쓰지 않는다. 중앙의 키·DB 위치와 백업은 [설치 계약](../deployment/remote-central.md)을 따른다.

## 연결 인증과 회수

1. A가 매 WSS 연결에서 중앙 nonce에 서버 키로 서명한다. 중앙은 등록된 공개 키와 instance ID를 확인한다.
2. 로그인한 B가 일회용 launch를 받아 내부 연결 프레임에서 임시 Ed25519 공개 키·SDP offer와 함께 보낸다. 중앙은 launch 서명·원래 세션·멤버십·대상 A를 확인하고 D1에서 원자적으로 소비한다. 이후 세션 유효성과 A의 온라인 상태를 재검증한다.
3. A가 자신의 로컬 계정 매핑을 확인하고 연결별 challenge·generation을 만든다. 중앙은 해당 사용자·instance·연결·challenge·generation·B 키·SDP SHA-256 지문을 담은 60초 접속 증명을 서명한다.
4. A가 고정 중앙 키·issuer·audience·알고리즘·만료·subject·협상 값을 검증한다. A의 answer에도 서버 키로 서명한 지문 증명을 붙인다. B는 중앙에서 확인한 A의 등록 키로 이를 검증한다.
5. 채널의 첫 메시지에서 B가 정확한 ticket과 임시 키 소유 증명을 제시한다. A가 이를 검증한 뒤에만 HTTP·WS 프레임을 처리한다. challenge/generation은 재접속·프로세스 재시작에 재사용하지 않는다.

활성 연결의 lease는 최대 **60초**, B의 갱신 간격은 **20초**다. 인증 완료 전 갱신은 A가 적용하지 않는다. 중앙 로그아웃·멤버 회수·등록 폐기는 열린 신호 연결을 종료하고 A에 종료를 보낸다. A는 매 요청과 1초 간격으로 현재 계정·lease를 재검증하며, 중앙 단절 때 즉시 작업 연결을 닫는다. A의 정책 변경 이벤트도 검증을 촉발한다. 기존 WS·데스크톱의 기능별 권한 재검증과 입력 lease를 함께 사용한다.

멤버 회수는 네트워크 요청에 앞서 A의 매핑을 삭제한다. 중앙 반영이 실패해도 로컬 권한을 복원하지 않는다. 로컬 등록 해제도 먼저 작업을 닫고 키를 제거한 뒤 서버 서명으로 중앙 등록을 폐기한다. 중앙이 응답하지 않으면 대시보드에서 남은 등록을 삭제하라는 오류를 표시한다. 내려받은 자료나 이미 시작한 OS 작업의 소급 회수는 기존 권한 경계를 따른다.

## 전송 경로

| 경로 | 구현과 지원 범위 |
| --- | --- |
| 실제 UI의 HTML·JS·CSS·worker·이미지·PDF 정적 자원 | A의 설치된 빌드 → 인증된 P2P GET/HEAD → 내부 iframe. 중앙에는 연결 프론트만 배포 |
| 앱 HTTP·JSON·multipart·SSE | 명시적 `mewFetch` → 로컬 fetch 또는 인증된 DataChannel 요청/응답/스트림 |
| 앱 WebSocket | `openMewSocket`; 터미널은 주입한 `socketFactory`. 기존 WS 서버의 세션·권한·account workspace를 사용 |
| 허용 WS | `/api/tmux/ws`, `/api/agent/ws`, `/api/presence`, `/api/collab`, `/api/db/ws`, `/api/browser-dom/ws`, `/api/remote-desktop/ws` |
| 이미지·PDF.js·미디어·다운로드의 URL 요청 | 내부 앱 origin의 `remote-resource-worker.js`가 `/api/` GET/HEAD를 **요청한 탭/worker에 결합된 연결**로 전달. Range·PDF 버전/편집 헤더를 보존 |
| 중앙 계정·등록·로그인·신호 | 중앙 HTTPS/WSS. 작업 전송과 별도 유지 |
| 원격 데스크톱 | 협상은 앱 전송, 영상·입력은 기존 별도 peer. OS 승인·단일 제어·입력 lease·NAT 계약 유지. 이 작업에서 실제 영상/입력 검증은 수행하지 않음 |
| Android iframe·일반 브라우저 프록시 | P2P에서 미지원. Android capability를 숨기고 `/__mew_browser`·임의 URL/포트·프록시 WS를 허용하지 않음 |
| 로컬 로그인·비밀번호 변경·최초 등록 시작 | A의 로컬 로그인 경로. 중앙 접속은 중앙 로그아웃을 사용하며 로컬 비밀번호 폼은 숨김 |

`remote-access-dispatch.ts`는 메모리의 duplex socket에 검증된 세션 조회 함수를 결합하고 기존 HTTP parser·Express 라우터·WS upgrade를 실행한다. TCP loopback 중계 포트를 만들지 않는다. 인증 정보는 비공개 WeakMap 문맥에서 가져오며 B의 Cookie·Authorization·역할·Host·forwarded 헤더를 사용하지 않는다. 허용 요청 헤더만 B와 A 양쪽에서 전달한다. `/api/auth/me`·profile과 owner의 원격 멤버 관리는 기존 인가를 적용한다.

`remotePath`는 고정 `/api`와 WS 목록, 경로 정규화와 크기를 검사한다. 사용자 HTML/SVG 자원 응답에는 sandbox CSP·nosniff·no-store를 적용한다. 앱 iframe 탐색은 연결별 임시 경로에 결합하며 요청의 연결을 식별할 수 없는 자원은 실패한다. Service Worker는 작업 본문을 캐시하거나 다른 탭의 연결로 대체하지 않는다. 미지원 브라우저·네트워크에는 오류와 재시도를 제공한다. TURN 설정·relay ICE 후보·중앙 HTTP 작업 프록시는 사용하지 않는다.

원격 다운로드 링크는 Chromium에서 Service Worker를 우회하는 `download` 속성을 쓰지 않고 A의 `Content-Disposition` 응답으로 다운로드한다. worker는 일반 요청의 `clientId` 또는 같은 탭 탐색의 `replacesClientId`로 출발 탭을 확인한다. 요청에 연결된 탭을 찾지 못하면 503으로 끝내며 다른 탭의 전송을 선택하지 않는다.

중앙 접속 모드는 연결 종료 뒤에도 유지한다. 전송이 없으면 앱 요청·소켓은 실패하며 중앙 HTTP/WSS로 대체하지 않는다. 종료 후 늦게 실행되는 저장·명령 요청의 본문도 중앙에 보내지 않는다. 중앙 계정/로그아웃 요청은 별도 중앙 클라이언트를 사용한다.

## 프로토콜과 자원 수명

프로토콜 버전은 `shared/remote-access.ts`의 **1**이다. 중앙 challenge와 A의 인증 완료 메시지에서 확인하며 호환되지 않는 연결을 거부한다. 서버 이름은 최초 등록 후 고정이고, 변경은 삭제·재등록을 사용한다. 버전별 업데이트/자동 키 회전의 운영 검증은 남아 있다.

| 제한 | 현재 값 |
| --- | --- |
| 단일 JSON 프레임 / 바이너리 청크 | 32KiB / 12KiB(base64 전 크기) |
| RTC 송신 대기열 | 512KiB 이상이면 대기, 10초 진행 불가 시 종료 |
| HTTP·WS 동시 작업 | 브라우저 연결당 합계 16개 |
| 브라우저 동시 연결 | A당 8개 |
| HTTP 업로드 / 단일 WS 메시지·대기열 | 각각 최대 25MiB. 기존 API의 더 낮은 제한도 적용 |
| A의 진행 중 HTTP 본문·WS 조립/송신 데이터 합계 | 64MiB. OS 프로세스 전체 RAM 한도는 아님 |
| 시그널링 메시지 / 처리 대기 / ICE 개수 | 96KiB / 연결당 128개 / 앱 연결당 양방향 합계 256개 |
| 초기 HTTP 응답·업로드 진행 없음 | 30초. 응답 이후 스트림은 취소·채널/인증 수명으로 종료 |

응답 청크는 reader의 credit로 흐름을 제어한다. 파일 전체를 Blob에 모아 전달하지 않으며 다운로드 크기는 기존 파일 API와 스트림에 따른다. 큰 WS 메시지는 순서 번호로 나누어 복원한다. HTTP의 조기 403과 취소 뒤에 도착한 청크를 버려 다른 작업을 끊지 않는다. 쓰기·명령은 자동 재전송하지 않고 결과가 유실되면 확인 후 다시 시도하도록 오류를 표시한다. 모든 스트림·가상 socket·RTC 자식 프로세스는 종료 시 정리하며 자식 helper는 부모 heartbeat가 10초 동안 없으면 종료한다.

`@mew/ui/browser-storage-scope`는 중앙 계정 ID와 instance ID를 localStorage·IndexedDB 이름에 포함한다. 파일·탭·초안·에이전트 기록을 A별로 분리하고 IndexedDB의 열린 연결도 범위가 바뀔 때 교체한다. 재생성 localStorage 캐시의 기존 origin 전체 예산·보관 기간은 여러 A에 공통 적용한다. 연결 종료는 현재 범위의 재생성 본문/전사/전송 기록을 정리하며 **미전송 초안·PDF 필기·열린 탭·설정은 보존**한다. [브라우저 저장 계약](browser-storage.md)을 따른다. 전역 fetch·WebSocket·localStorage를 교체하지 않는다.

## 검증과 남은 게이트

- `remote-access.test.ts`: 허용 경로·프레임 크기, 서명/만료/대상, 헤더 위조, JSON·바이너리, 기존 WS 문맥과 계정 회수.
- 로컬 `mewlink/test/worker.test.ts`: 실제 Workers/D1/DO의 원자적 등록·세션·기기 권한·origin·launch 재사용 차단·서명 시그널링·hibernation·로그아웃 회수.
- 로컬 `mewlink/test/oauth.test.ts`: Google·GitHub·Apple·이메일 OIDC 응답 fixture의 state·PKCE(지원 흐름)·nonce·JWKS·호스트 전용 세션. 실제 제공자 로그인을 대신하지 않음.
- 로컬 `mewlink/test/p2p.browser.test.ts`: HTTPS Workers 중앙 + 등록된 네이티브 A + 실제 Chromium, P2P HTML/CSS/JS/동적 import/이미지/worker와 작업 요청, 공개 주소 유지·새로고침·두 탭과 중앙 작업 요청 0건.
- `remote-ui.test.ts`: 설치 UI의 P2P 접근, 직접 HTTP·비밀 파일·탐색·외부 symlink 차단.
- `remote-access-files.test.ts`: 실제 파일 API의 읽기/저장, 읽기 전용·권한 회수·임시 비밀번호 차단, 계정별 작업 루트.
- `remote-access-browser.test.ts`: 1MiB 다운로드·POST·조기 403·취소, native 이미지·Range, 큰 바이너리 WS, 중앙 작업 API 요청 0건.
- `remote-access-storage.test.ts`와 공통 저장소 테스트: 같은 로컬 계정/세션 키의 서로 다른 중앙 계정·A 격리와 origin 캐시 예산·초안 보존.
- `remote-access-ui.test.ts`: 등록 오류·등록 완료·멤버 회수, PC/모바일 화면과 조작.

브라우저 자동 검증은 **동일 호스트**에서 수행했다. 실제 OAuth/OIDC 제공자, 다른 NAT·LTE/5G·Windows/WSL·macOS·휴대폰 절전/망 전환, 실제 터미널·에이전트·DB·브라우저·데스크톱의 동시 사용, 악성 콘텐츠·부하·키 교체/복구와 보안 검토는 [태스크의 출시 기준](<../tasks/mew 중계 기능 만들기.md>)으로 남긴다. 로컬 검증으로 직접 연결 성공률이나 실서비스 지원을 확정하지 않는다.
