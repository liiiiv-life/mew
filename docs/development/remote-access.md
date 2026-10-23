---
title: "Mewlink 기기 등록과 로컬 사용자 인증 P2P 접속 계약"
description: "Mewlink 공개 기기 주소·인증·계정 병합 시 이전 계정 삭제·브라우저 신뢰와 회수·재연결을 정의한다. 역할별 런처의 공개 코드 캐시·앱 브리지 사전 준비·WebSocket bootstrap의 요청 한도 일괄 검사·DO 인가와 lease 안의 시그널링 재부착, P2P 소비 기반 수신 창·작업 슬롯과 native ACK 격리·UDP 및 운영 검증 경계를 설명한다."
created: 2026-10-07
updated: 2026-10-23
---

[작업·출시 기준](<../work/remote-access.md>) · [중앙 서비스 설치](../deployment/remote-central.md) · [ADR 0195](../history/decisions/0195-mew-account-based-p2p-remote-access.md) · [후속 ADR 0203](../history/decisions/0203-mewlink-workers-p2p-ui.md) · [로컬 인증 ADR 0207](../history/decisions/0207-mewlink-device-access-local-auth.md) · [권한](access-control.md)

중앙 Mewlink 계정은 기기 등록·목록·삭제와 선택적 외부 신원 증명을 관리한다. 공개 기기 주소는 중앙 로그인 없이 WebRTC 연결을 시작하며, 설치된 mew 로그인 화면에서 **로컬 이메일·비밀번호 또는 owner 승인·본인 연결을 마친 Mewlink 계정**으로 로그인한다. 중앙 신원과 로컬 사용자는 별개이며 이메일·주소·기기 등록자로 작업 권한을 부여하지 않는다. [ADR 0208](../history/decisions/0208-mewlink-approved-login-identities.md). 새 인증 경로의 구현·격리 검증과 실제 운영 적용을 구분하며, 사용자가 중앙 재배포와 로컬 업데이트를 진행해야 한다. 기존 운영의 제공자별 로그인·외부 Android/LTE·절전/망 전환 실측은 남아 있다.

2026-10-10 사용자가 공개 유저이름·기기 주소에서 실제 mew UI와 에이전트 채팅 사용을 확인한 뒤 데스크톱·모바일의 반복 끊김을 보고했다. 격리된 실제 RTC 부하 검사에서 작은 메시지의 IPC 개수 제한과 네이티브 송신 대기 반환을 실패로 취급하는 경로를 확인하고 수정했다. 추가로 소켓 종료·콜백 예외·전송 순서·중앙 탭 종료 경쟁도 재현·수정했다. 아래 검사는 현장 증상의 단일 원인 확정이나 실제 배포·모바일 망 전환 검증을 대신하지 않는다. 브라우저 보기의 자원 503은 이 연결 안정성 검사와 별도로 다룬다.

## 도메인 이전과 기기 대시보드

기기 주소는 `https://mew.run/{username}/{device}`, 관리 대시보드는 `https://mew.run/{username}`이다. 대시보드는 중앙 로그인한 본인에게만 기기 목록을 보여준다. 다른 계정의 대시보드는 404이며, 비로그인 상태에서는 기기 목록을 요청하지 않고 로그인 화면을 표시한다. `/`와 이전 `/dashboard`는 로그인 후 본인의 사용자 주소로 이동한다. 공개 기기 주소의 연결 시작에는 중앙 로그인을 요구하지 않는다.

내부 실행 origin은 `https://app.mew.run`이다. 관리 화면과 같은 site 안의 다른 origin으로 분리해 모바일 브라우저의 cross-site 저장소 제한을 줄이고 중앙 쿠키·API 격리를 유지한다. 이전 `mew.saens.kr`의 화면 주소는 새 도메인으로 이동하지만 등록·상시 WSS·서명 키·기기 ID는 유지한다. 중앙은 설정한 이전 origin만 허용하며 host 증명의 audience와 ticket issuer는 실제 연결한 host의 origin으로 검증한다. 새 브라우저는 중앙이 설정으로 허용한 현재·이전 origin 목록에 한정해 ticket issuer를 검증하며, 같은 서명 키·instance audience 검증도 유지한다. launch는 기존 Durable Object에 새 RPC 메서드를 요구하지 않는다. 승인된 로컬 Mewlink 신원의 issuer는 해당 host의 origin으로 유지하고, 직접 이메일 계정의 신원 namespace도 이전 값을 고정해 같은 이메일로 다른 계정이 생기지 않게 한다.

이전 제공자 콜백을 유지할 때는 `OAUTH_ORIGIN`에서 OAuth를 처리하고, 새 관리 origin의 브라우저 확인 쿠키와 결합한 60초·일회용 증명을 소비한 뒤 새 관리 세션을 발급한다. origin·쿠키·만료 검증을 통과하지 못한 요청은 세션을 만들지 않는다. 앱 origin에는 이 경로를 제공하지 않는다. [도메인 이전 결정](../decisions/0005-mewlink-domain-and-private-dashboard.md).

## 연결 정보 표시

기기 연결 화면은 공개 접속 주소를 먼저 보여주고, 연결된 Mewlink 계정의 `@username`, 기기 이름, 직접 연결 준비 상태와 본인 계정·기기 관리 링크를 표시한다. Mewlink 등록 계정과 접속 시 사용하는 로컬 mew 계정은 구분한다. 온라인 표시는 중앙 시그널링 상태이며 외부망 직접 연결 성공을 보장하지 않는다. 등록·등록 대기·주소 확인 실패·준비 필요·해제 확인은 같은 화면에서 처리한다.

호스트는 불변 내부 계정 ID로 공개 주소를 조립하지 않는다. 기존 공개 기기 경로에 인증 정보 없는 `HEAD` 요청을 보내 중앙의 사용자 이름 리다이렉트를 확인한다. 같은 공개 origin과 같은 기기 이름을 가리키며 쿼리·프래그먼트·사용자 인증 정보가 없는 주소만 표시·복사한다. 이전 `mew.saens.kr` 등록은 `mew.run`에서 확인하며 등록 키와 계정 매핑은 바꾸지 않는다. 사용자 이름이 확인되면 관리 링크는 해당 사용자 경로를 가리킨다. 확인 실패 시 내부 ID 주소를 대신 노출하지 않고 오류와 새로고침을 제공하며 관리 링크는 공개 루트로 연결한다.

조회 결과는 프로세스 안에서 60초간 재사용하고, 중앙 재연결과 명시적 새로고침은 다시 확인한다. 요청은 5초 제한과 중복 조회 합류를 사용한다. 등록 해제·교체 뒤 늦게 도착한 결과는 버린다. 상태 API에는 표시용 사용자 이름·기기 이름·주소만 추가하며 중앙 쿠키·이메일·내부 계정 ID·키는 제공하지 않는다. 중앙 서비스 변경이나 재배포는 필요하지 않다.

검증은 `server/remote-access-address.test.ts`의 주소·origin 검사, `server/remote-access-registration-network.test.ts`의 상태 조회·캐시·재시도·키 보존, `server/remote-access-ui.test.ts`의 주소 복사·계정 표시·오류 복구·등록 해제와 PC/모바일 표시를 사용한다. 모의 중앙 응답을 쓰는 격리 검사이며 실서비스 계정·외부망 접속 검증과 구분한다.

## 구성과 신원

`mewlink/src/worker.ts`가 Cloudflare 중앙 진입점이다. 부모 Git·npm workspace에서 제외한 폴더의 자체 package.json으로 관리한다. Workers + Static Assets는 로그인·기기 선택·연결 프론트만 함께 배포하고, D1은 중앙 관리 계정·등록·관리 세션·일회용 요청, 기기별 Durable Objects는 상시 WSS·시그널링·회수를 담당한다. 중앙은 로컬 API·워크스페이스·터미널·에이전트 모듈과 부모 mew `dist/`를 불러오지 않는다. 중앙 `/api`에는 작업 라우터가 없다. OAuth는 Google·GitHub·Apple과 선택 이메일 OIDC 직접 연동이며 Supabase를 사용하지 않는다.

주소창은 `mew.run/{user}/{device}`다. 새 런처는 중앙 로그인 없이 WebSocket bootstrap으로 대상 기기를 확인하고 연결을 시작한다. `authMode: local`·난수 subject는 연결 문맥이며 로컬 계정·역할이 아니다. 단회 nonce·ticket·브라우저 키·재개 토큰은 중앙 부모에서만 처리하고, 내부 앱 origin `app.mew.run/launch/{임시 ID}`에는 정확한 프레임의 공개 설정과 자격증명을 제거한 전송만 전달한다. 기기 등록·관리용 중앙 쿠키는 `__Host-`·Secure·HttpOnly이며 앱 origin에는 전송하지 않는다. 앱 호스트의 중앙 인증·계정 API는 차단한다. 실제 mew UI는 연결 후 A에서 받아 내부 iframe에서 실행한다. 두 호스트는 같은 Worker에 배포한다.

`server/remote-ui.ts`는 키·연결 증명을 확인한 dispatcher의 GET/HEAD에서만 설치된 A의 `dist/`를 제공한다. direct HTTP·임의 파일·포트·개발 서버를 허용하지 않고 실제 경로 검사로 외부 symlink·dotfile·탐색을 거부한다. 파일은 최대 32MiB, index는 512KiB다. 빌드된 index의 `mew-p2p-bootstrap=1`을 확인해 구버전 UI를 실행하기 전에 거부하고, 응답에 주입한 `mew-p2p-app` meta를 통해 원격 bootstrap을 선택한다. `src/main.tsx`는 경량 인증 진입점 다운로드와 부모 MessagePort 확인을 병렬로 시작하되 전송·계정/instance 저장소 범위를 정한 **뒤** 렌더링한다. 로그인·비밀번호 변경 전에는 workspace App을 받지 않으며 첫 인증 상태를 재사용한다. 상세 책임은 [브라우저 첫 시작](architecture.md#브라우저-첫-시작)을 따른다. A의 일반 프로젝트 경로는 원격 모드를 선택하지 않는다.

Service Worker는 `/__mew_ui/{임시 ID}/...`를 `/api/remote-ui/file?path=...`로 연결하고 절대 정적 URL을 같은 접두사로 redirect한다. JS의 `import.meta.url`·동적 import·worker 자원도 같은 연결에 남는다. worker 재시작 시에도 정확히 같은 `/launch/{임시 ID}` window만 찾으며 다른 탭으로 대체하지 않는다. 앱 요청은 MessagePort → 중앙 origin 부모의 검증된 DataChannel, native URL 요청은 worker → 같은 부모 전송을 사용한다. 실제 앱 코드에는 중앙 세션·launch 증명을 전달하지 않는다.

A의 `server/remote-access-agent.ts`는 로컬 owner가 시작한 5분짜리 등록 요청을 확인한다. A가 생성한 Ed25519 키의 소유 증명과 중앙 서명 영수증을 검증하고 불변 instance ID·중앙 계정 ID·기기 이름·키를 저장한다. 로컬 `serve.ts`와 Vite plugin은 등록이 있을 때만 중앙으로 WSS를 연결한다. 지수 backoff는 최대 30초에 jitter를 더하며, 재시작은 저장한 키를 사용한다.

중앙 신원은 **제공자 ID + 검증된 issuer + 불변 subject**다. GitHub는 고정 issuer 아래 숫자 사용자 ID를 쓴다. 동일 이메일·표시 이름이나 다른 제공자의 동일 subject를 합치지 않는다. 로그인 제공자 변경·이메일 OIDC issuer 교체는 별도 계정이 된다. 제공자 간 계정 연결 UI는 아직 제공하지 않는다.

A의 기존 이메일·비밀번호·역할·서버측 세션을 유지하고, 승인된 외부 신원은 별도 로그인 수단으로 연결한다. 최초 등록의 기존 `accounts` 매핑은 설정 파일 호환을 위해 보존하되 신규 기기 접속의 인가에 사용하지 않는다. 이전 로컬·중앙 멤버 API는 계속 410이며 중앙 멤버십으로 작업 권한을 만들지 않는다. 새 승인은 아래의 로컬 접근 요청 API와 owner 관리 화면을 사용한다.

연결용 ticket과 브라우저 키 소유 증명을 검증한 뒤 transport를 연다. 로그인 전에는 `GET/HEAD /api/remote-ui`·`/api/remote-ui/file`, `GET /api/auth/me`·`/api/auth/mewlink`, `POST /api/auth/login|logout|change-password`·`/api/auth/mewlink/request|login`만 제공한다. 일반 guest에게 공개한 파일도 미인증 P2P에서는 차단하며 모든 작업 WS를 거부한다. 임시 비밀번호로 로그인한 계정은 비밀번호 변경 후에 작업을 허용한다. 승인된 외부 인증은 비밀번호 변경 요구를 비밀번호 저장에 그대로 남기고 독립적으로 로그인한다.

로컬 인증은 기존 `createAuthRouter`와 scrypt·로그인 실패 한도를 재사용한다. 중앙이 서명한 `clientIp`만 IP 한도에 사용하고 앱의 Cookie·역할·인증 헤더는 신뢰하지 않는다. 로컬 세션은 연결에 귀속한 서버측 문맥으로 요청·WS에 적용하며 비밀번호 변경·계정 삭제·만료·권한 회수를 매 요청과 타이머에서 확인한다. 사용자 전환과 로그아웃은 이전 요청·WS를 먼저 정리한다.

로그인·비밀번호 변경·로그아웃과 브라우저 신뢰 응답의 `x-mew-session`은 중앙 origin의 trusted launcher가 기기별 저장소에 저장하거나 제거한 뒤 앱 origin에 보낼 헤더에서 삭제한다. WebRTC·브라우저 키·재개 토큰은 중앙 origin에서 처리하고 앱 origin의 launcher에는 자격증명을 제거한 MessagePort 전송만 제공한다. 다음 방문의 세션은 첫 transport 인증 메시지에서만 재개한다. 실제 앱 저장소는 `/api/auth/me`의 로컬 이메일과 instance ID로 나누고 계정 전환 때 앱 프레임을 다시 시작한다. [브라우저 저장 계약](browser-storage.md)을 따른다.

A의 `<DATA_DIR>/remote-access.json`에는 버전 1, 서버 키, 고정 중앙 공개 키와 계정 매핑을 원자적으로 저장한다. 비공개 키는 OS 사용자 전용 파일 권한을 사용한다. 손상된 설정을 새 키로 덮어쓰지 않는다. 중앙의 키·DB 위치와 백업은 [설치 계약](../deployment/remote-central.md)을 따른다.

## 기기 연결 설정 진입

owner는 헤더 햄버거 메뉴의 **Mewlink**에서 기기 등록·연결 상태·접속 주소 복사·등록 해제를 관리한다. `RemoteAccessModal`은 공통 `DialogFrame`의 Esc·뒤로가기·바깥 누름 닫기와 포커스 복원을 따른다. 계정 관리에는 Mewlink 신원 접근 승인·회수만 남기며 기기 연결 설정은 표시하지 않는다. 원격 접속 중에는 기존대로 등록·등록 해제 조작을 숨긴다.

## 브라우저 로그인 유지와 접근 해제

로컬 비밀번호 또는 승인된 Mewlink 계정으로 로그인한 뒤 중앙 부모 화면의 **이 브라우저에서 로그인 유지 → 기억하기**를 누르면 현재 브라우저를 신뢰한다. 여기서 브라우저는 기기의 브라우저·프로필 단위이며, 모든 브라우저를 기기 하나로 묶지 않는다. 임시 비밀번호는 변경을 마쳐야 한다. 앱 브리지는 `/api/auth/remote-device` 요청을 거부하므로 설치된 앱이 중앙 부모의 동의를 우회할 수 없다. [ADR 0015](../decisions/0015-trusted-browser-access.md).

`POST /api/auth/remote-device`는 현재 인증된 P2P 연결에서 `{ label }`을 받는다. 호스트가 확인한 로컬 계정·`authenticationMethod`·비밀번호 자격증명 또는 승인 연결의 `credentialId`·브라우저 공개 키 지문에 세션을 결합한다. 신뢰 세션은 **90일 미사용** 시 만료하며 재개할 때 만료를 즉시 갱신한다. 열린 연결의 유효한 세션 검사에서도 하루 최대 한 번 갱신해 계속 사용 중인 연결을 유지한다. 동일한 키의 소유 증명을 통과해야 재개할 수 있고, 신뢰 전의 bearer 세션은 폐기한다. 매 요청에서 비밀번호 변경·승인 연결 회수·계정 삭제·현재 권한을 재검증한다. 다른 키로 토큰만 가져와 재개하거나 비밀번호 로그인을 외부 로그인으로 자동 대체하지 않는다.

중앙 런처는 중앙 origin의 IndexedDB에 **호스트 instance별** 비추출 Ed25519 키를 보관한다. 같은 호스트의 탭은 키를 공유하지만 다른 호스트에는 별도 키를 써 방문 상관관계를 줄인다. 저장할 수 없으면 메모리의 비추출 키를 사용하며 다음 방문까지 같은 키를 보존할 수 없다. 신뢰한 세션 토큰만 중앙 origin의 기기별 localStorage에 저장하고, 새 세션은 먼저 sessionStorage에 두면서 이전 영속 항목을 제거한다. `/api/auth/me`가 신뢰 상태를 확인하거나 중앙 부모의 기억하기 요청이 성공해야 localStorage로 승격한다. 기존 30일 로컬 토큰은 호환 재개를 유지한다. 앱 iframe에는 키·토큰을 전달하지 않으며 비밀번호는 저장하지 않는다. 승인된 외부 로그인도 동의하면 현재 승인 연결에 결합된 신뢰 세션을 발급할 수 있다. 이후 중앙 쿠키가 끝나도 호스트의 승인 연결과 브라우저 키가 유효하면 재개한다. 저장 위치와 제거 조건은 [브라우저 저장 계약](browser-storage.md#원격-로컬-계정-접속의-저장소-범위)을 따른다.

호스트는 로컬 인증과 신뢰 동의를 마친 연결에만 `{ type: 'trusted-browser', connection, label }`을 중앙 WSS로 보낸다. 중앙은 해당 연결의 공개 키 지문을 `browserId`로 사용하고 D1 `0005_browser_access.sql`의 기기별 registry에 이름·최초 등록·최근 신뢰 확인 시각을 저장한다. 회수한 행은 삭제하거나 재활성화하지 않는다. 키 확인·등록 처리 도중 회수가 겹쳐도 이미 끝낸 연결을 다시 열지 않는다.

| 경로·조작 | 계약 |
| --- | --- |
| `GET /central/instances/:id/browsers` | 중앙 기기 owner만 `{ id, label, createdAt, lastSeen, revoked, connected }[]` 조회. 시각은 epoch ms이며 `connected`는 DO의 유효한 연결 상태 |
| `DELETE /central/instances/:id/browsers/:browserId` | owner만 접근 해제. 영속 회수 기록을 먼저 저장하고 같은 기기·키의 모든 탭에 `access-revoked`를 보낸 뒤 연결 종료·호스트 `end` 전달 |
| 대시보드의 **접속 브라우저 관리 → 접근 해제** | 위 API로 특정 브라우저를 회수. 다른 브라우저와 다른 호스트의 접속은 유지 |
| 기기의 **등록 해제** | 호스트 등록 전체를 폐기하고 모든 접속 종료. 특정 브라우저 해제와 별도 조작 |

로그아웃과 명시적 회수는 저장된 재개 토큰을 제거하고 자동 접속을 중단한다. `access-revoked`·명시적 인증 거부도 자동 재시도를 멈춘다. 해당 브라우저의 키는 회수 식별을 유지하도록 남기며 다른 호스트의 키·토큰은 건드리지 않는다. IndexedDB 키를 지우고 새 키로 비밀번호 또는 승인된 외부 계정을 다시 인증하면 새 브라우저로 등록할 수 있으므로, 브라우저 회수는 인증 수단 자체의 회수가 아니다. 분실 기기·인증 수단 탈취에는 해당 비밀번호 변경이나 외부 연결 회수도 필요하다.

## 정적 자원 압축과 재검증 캐시

### 중앙 공개 런처와 설치된 호스트 코드의 캐시 구분

[ADR 0050](../decisions/0050-mewlink-startup-preparation.md)에 따라 중앙의 `/launcher/<이름>-<8자리 빌드 해시>.js/css` 중 정상 GET/HEAD 응답만 브라우저 전용 1일 캐시를 허용한다. 상태 200·확장자에 맞는 JS/CSS MIME·강한 ETag를 요구하고 `Set-Cookie`·개인화 `Vary`·Range·Authorization·query와 upstream `no-store`가 있으면 허용하지 않는다. 헤더는 `private, max-age=86400, immutable, no-transform`이며 CSP·origin 격리는 유지한다. 새 HTML이 다른 해시 URL을 가리키면 새 코드를 받는다.

HTML·연결 토큰 경로·공개 설정/키·Service Worker·API·비해시 호환 파일과 오류는 계속 `no-store`다. 이 HTTP 캐시는 개인화되지 않는 중앙 공개 코드에만 적용한다. 아래 설치된 호스트 코드의 기기별 SHA-256·현재 P2P 304 재검증 계약은 그대로 유지한다. 인증 결과·문서·세션을 캐시하거나, 단절·권한 오류에서 저장 코드로 진입하지 않는다.

### 호스트 UI의 압축과 재검증

Vite의 `base: './'`는 설치된 앱을 루트와 P2P 임시 접두사 양쪽에서 실행하도록 HTML 자산·동적 modulepreload·CSS·worker URL을 상대 경로로 만든다. preload와 실제 import가 같은 URL을 사용하므로, `/assets/...`를 접두사 URL로 redirect한 뒤 같은 모듈을 다시 가져오는 중복을 피한다. 이전 빌드의 절대 자원 경로는 Service Worker의 기존 redirect로 호환한다. [Vite의 상대 base](https://vite.dev/config/shared-options.html#base)·[modulepreload 경로](https://vite.dev/config/build-options.html#build-modulepreload).

Service Worker는 `DecompressionStream`을 지원하는 브라우저에서 UI 파일의 Range 없는 GET에만 `encoding=gzip`을 요청한다. A는 기존 경로·realpath·크기·bootstrap 검사를 통과한 HTML·JS·CSS·JSON·SVG·텍스트를 gzip 스트림으로 전송한다. dispatcher는 UI 응답에 한해 `Content-Encoding`을 전달하며, worker는 이를 스트리밍 해제하고 압축 인코딩·길이 헤더를 제거한 응답을 브라우저에 제공한다. P2P 수신 창과 취소·역압은 같은 스트림에 적용한다. HEAD·Range·이미지·woff2는 기존 raw 응답을 사용한다.

선택 협상이라 구서버는 query를 무시하고 raw 파일을 보내며, 이전 worker·미지원 브라우저는 압축을 요청하지 않는다. 작업 API·문서 본문을 압축 자원으로 취급하거나 CacheStorage에 보관하지 않는다.

[ADR 0018](../decisions/0018-mewlink-startup-revalidation.md)에 따라 내부 런처의 `remote-resources.ts`는 `/assets/` 아래 JS·MJS·CSS·폰트·Wasm의 Range 없는 GET만 `mew-remote-ui-v1` CacheStorage에 보관한다. 키에는 현재 부모가 확인한 instance ID와 자원 경로를 넣고, launch 토큰이 달라져도 같은 호스트의 코드를 찾는다. 계정·문서·인증 토큰·HTML·이미지·API와 HEAD·Range는 이 캐시에 넣지 않는다. 한 자원은 해제 후 8MiB, 앱 origin 전체는 64개·32MiB·7일 한도이며 사용 시각을 갱신하고 오래된 항목부터 지운다. 저장소 실패는 기존 P2P 다운로드로 처리한다. HTTP 응답의 `no-store`는 유지하고 명시적으로 관리하는 정적 코드 사본만 별도 저장한다. [Cache API의 수명·HTTP 캐시와의 구분](https://developer.mozilla.org/en-US/docs/Web/API/Cache).

A는 기존 경로·realpath·크기 검사 뒤 파일 내용의 SHA-256으로 강한 ETag를 만들며 raw와 gzip 표현을 구분한다. 런처는 저장 본문을 다시 해시한 뒤 현재 인증된 P2P 연결에 `If-None-Match`를 보낸다. A의 304와 ETag가 일치해야 해제된 본문을 재사용한다. 같은 origin의 다른 앱이 캐시를 변조해도 저장 ETag만 믿지 않으며, 불일치·만료·구서버에는 새 본문을 받는다. 잘못된 304는 조건 없이 다시 요청한다. 단절·403·503에는 캐시로 대체하지 않고 현재 worker가 응답 CSP를 다시 적용한다. 첫 다운로드는 계속 스트리밍하고 캐시 저장을 기다리지 않는다. 서버의 해시는 파일 식별자·크기·수정/변경 시각이 같을 때 재사용하며 최대 256개만 보관한다.

이 변경은 사용자가 로컬 mew를 빌드·재시작하고 중앙을 재배포한 뒤 페이지를 새로 열어 적용한다. 첫 방문·코드 변경·저장소 제한 환경은 다운로드가 필요하며, 재접속에도 현재 인증과 자원별 P2P 왕복은 남는다.

## 연결 협상 중 앱 브리지 사전 준비

중앙 connect HTML에 공개된 central/app origin metadata가 모두 있고 central origin이 현재 페이지와 일치하면, `connection-frame.ts`가 새 임시 토큰의 숨은 앱 브리지 iframe을 WebSocket bootstrap과 함께 준비한다. metadata가 없는 이전 HTML은 기존처럼 bootstrap 뒤 준비하며, 일부 누락·잘못된 origin은 오류로 끝낸다. 이 단계에는 기기 ID·인증 정보·MessagePort를 전달하지 않는다.

bootstrap이 확인한 central/app origin이 사전 준비 값과 같아야 기존 연결 코드가 iframe을 인수한다. 정확한 iframe·origin·토큰의 ready 메시지만 수용하고, 공개 기기 context는 bootstrap 뒤, 전송 포트는 `ready && connected` 뒤에 전달한다. 호스트의 `/__mew_ui/` 화면과 작업 API는 기존 인증된 P2P 준비 이후에만 요청한다. 브라우저 키와 저장 세션·ticket 검증·회수·lease·복구 시 같은 계정 확인을 유지한다.

실패·취소·중복 시작·페이지 이탈·설정 불일치는 준비한 iframe·리스너·타이머·미완료 bootstrap을 정리한다. saved instance hint는 조회 힌트로만 사용하며 실제 기기가 다르면 이전 준비 연결을 닫고 올바른 신원 모드로 다시 준비한다. 조기 iframe 자체에는 기기 ID가 없으므로 새로 확정한 context를 인수하기 전까지 연결 권한이 없다. [ADR 0050](../decisions/0050-mewlink-startup-preparation.md).

## 승인된 Mewlink 계정 로그인

로그인 화면의 **Mewlink로 로그인**은 지정 앱 MessagePort에서 행동만 전달한다. 내부 launch 프레임과 중앙 부모는 정확한 포트·프레임을 확인하고, 부모가 현재 기기의 `?login=mewlink` 경로로 이동한다. 중앙 OAuth·이메일 로그인은 이 경로로 돌아온다. 앱이 제공한 URL을 이동 대상으로 사용하지 않고 중앙 쿠키·launch·로컬 세션 토큰을 앱에 전달하지 않는다.

중앙 세션이 있는 연결은 선택적으로 `{ issuer, subject, displayName, provider, username }` 신원을 ticket에 서명한다. `issuer`는 중앙 origin, `subject`는 불변 중앙 계정 ID다. 연결의 난수 subject와 로컬 사용자 ID는 서로 다르다. WebSocket bootstrap의 신원·세션 해시는 해당 소켓 attachment에 결합하며 connect·ticket 생성·갱신·alarm에서 같은 세션과 계정을 확인한다. 구버전 HTTP launch는 기존 서명·실제 세션 해시·단회 소비 검증을 유지한다. A는 서명된 ticket의 신원을 고정 중앙 키와 origin으로 검증한 뒤에만 신뢰한다. HTTP 본문·헤더·prepare 메시지의 표시 정보는 신원 증명이 아니다.

미승인 사용자는 **접근 요청**을 누른다. 요청은 검증된 transport 신원만 저장하며 이메일·역할 입력으로 사용자나 권한을 만들지 않는다. owner의 **계정 관리 → Mewlink 계정 접근**에서 신원·제공자·유저이름을 확인하고 **승인**을 누르면 비밀번호 없는 member가 즉시 등록되어 승인된 목록에 표시된다. 역할은 계정 관리에서 변경한다. 승인 뒤 대기 화면은 상태를 확인하여 로그인하고, 이후 새 연결에서는 같은 승인 신원으로 바로 접속한다. 중앙 기기 등록 자체로 로컬 권한을 얻지 않으며 승인 또는 본인 연결이 필요하다.

기존 이메일 사용자는 **설정 → 계정 → Mewlink 계정 연결**에서 본인이 연결한다. 같은 살아 있는 P2P 접속의 검증된 중앙 신원과 비밀번호 로그인 세션을 함께 요구하며 임시 비밀번호 변경을 마쳐야 한다. 기존 로컬 권한이 있으므로 별도 접근 승인 없이 연결할 수 있다. 외부 로그인 상태에서는 **기존 이메일 계정으로 로그인**으로 전환하고, 계정 범위가 정해진 새 앱 화면에서 연결한다. [본인 연결 결정](../decisions/0007-mewlink-self-service-linking.md).

연결 대상은 현재 비밀번호 세션의 사용자로 고정한다. 본문의 신원·계정 ID·역할은 증명이나 연결 대상으로 쓰지 않는다. `previousAccountId`는 화면에서 확인한 이전 연결의 비교값이며, 실제 연결이 달라지면 409로 거부한다. 같은 대상에 대한 재시도는 기존 연결을 반환한다. 다른 연결을 옮길 때는 새 연결 ID를 발급하여 이전 외부 세션·작업을 회수하고 관련 접근 요청을 정리한다. 연결을 옮긴 뒤 비밀번호와 다른 Mewlink 신원이 남지 않는 이전 계정은 같은 계정 디렉터리 저장에서 삭제한다. 이전 계정의 저장된 세션·신뢰 브라우저·Git 자격증명과 모든 워크스페이스의 기능·파일 권한도 회수한다. 비밀번호나 다른 Mewlink 신원이 남아 있는 이전 계정은 유지하며, 마지막 owner를 없애는 병합은 409로 거부한다. 대상 계정의 역할·비밀번호·개인 설정과 현재 이메일 로그인 세션은 유지한다. 이전 계정의 프로젝트 파일·개인 설정·작업 기록은 보존하며 대상 계정으로 자동 이관하지 않는다.

P2P의 계정 병합 요청은 동기적인 권한 정리 동안 해당 요청만 유지하고, 완료 직후 현재 권한에 다시 고정해 성공 응답을 보낸다. 다른 진행 중 요청과 이전 계정의 접속은 기존 권한 재검증·회수 규칙을 따른다. [병합 결정](../decisions/0041-mewlink-merged-account-removal.md).

| 경로 | 경계와 동작 |
| --- | --- |
| `GET /api/auth/mewlink` | 검증된 연결 신원과 unavailable/unlinked/pending/denied/approved 상태. 일반 HTTP에서는 unavailable |
| `POST /api/auth/mewlink/request` | transport 신원으로만 요청. 중복 제거·대기 최대 256개·처리 이력 최대 256개·7일 수명·거절 후 15분 재요청 제한 |
| `POST /api/auth/mewlink/login` | 현재 승인 연결을 선택. 비밀번호 세션 발급 없이 요청 generation을 전환하고 이전 작업 종료 |
| `POST /api/auth/mewlink/link` | 검증된 transport 신원과 현재 비밀번호 계정의 본인 연결. 미로그인·신원 없음 401, 외부 로그인·임시 비밀번호 403, 이전 연결 충돌 409 |
| `GET /api/admin/mewlink` | owner만 요청·연결 목록 조회 |
| `POST /api/admin/mewlink/requests/:id/approve` | owner 승인. UI는 빈 본문으로 새 member를 생성한다. 호환 API의 기존 accountId·표시 이름·member/manager 선택은 유지한다. 처리/만료 요청 재실행 거부 |
| `POST /api/admin/mewlink/requests/:id/deny` | owner의 요청 거절 |
| `DELETE /api/admin/mewlink/links/:id` | owner의 외부 인증 회수. 로컬 비밀번호·개인 설정은 보존 |

요청 처리 즉시 대기 슬롯을 반환한다. 처리 이력은 최근 256건까지만 보관하며, 거절의 15분 재요청 제한도 보관 중인 이력에 적용한다. 짧은 시간에 그보다 많은 요청을 처리해 오래된 거절 기록이 제거되면 해당 신원은 다시 요청할 수 있지만 승인 없이는 권한을 얻지 못한다.

`users.json` v2는 `accounts`·`passwordCredentials`·`mewlinkIdentities`·`mewlinkRequests`를 같은 원자적 파일에 저장한다. 사용자 생성과 승인 연결을 한 번에 저장해 실패한 승인에서 미연결 사용자가 남지 않는다. 기존 v1은 첫 계정 저장 시 이관하며 기존 이메일 기반 내부 ID·세션·권한·개인 데이터를 유지한다. 새 외부 전용 사용자는 `account_…` ID를 쓰며 가짜 이메일이나 비밀번호를 만들지 않는다. 호환 API의 `email`은 내부 사용자 ID이며 `accountId`를 함께 제공한다. 연락처·프로필과 로그인 수단은 별개다. CLI의 `role`·`remove`는 내부 ID도 받으며 `add`·`reset`은 이메일 로그인 계정용이다.

`server/remote-authentication.ts`는 연결에서 선택한 로그인 수단을 관리한다. 외부 인증은 당시의 로컬 계정과 승인 연결 ID에 고정하고 매 요청에 재검증한다. 해제·삭제 후 재승인으로 이전 연결의 권한을 되살리지 않는다. 기존 대기 연결에서 승인만으로 계정을 조용히 바꾸지 않고 로그인 동작으로 전환한다. 로컬 비밀번호 만료·로그아웃 뒤 외부 인증으로 자동 대체하지 않는다. `/api/auth/me`의 `hasPassword`와 `authenticationMethod`로 비밀번호 없는 계정의 설정 폼과 외부 로그아웃을 구분한다. 프로필 저장은 실제 비밀번호 레코드를 보존한다.

저장된 로컬 비밀번호 세션 또는 명시적으로 발급한 신뢰 세션을 재개하는 런처는 `identity: false`로 중앙 신원을 생략하며 중앙 로그인과 독립적으로 접속한다. 신뢰한 외부 세션도 원래 승인 연결을 호스트에서 계속 검증한다. 명시적 Mewlink 로그인은 저장된 로컬 세션을 보내지 않는다. 신원을 포함한 transport는 중앙 세션 종료 때 연결을 끝낸다. 그 연결에서 비밀번호로 전환했더라도 로컬 비밀번호 세션 자체는 회수하지 않으며 다음 연결에서 독립적으로 재개한다. 외부 로그아웃은 로컬 선택을 지우고 부모가 중앙 세션을 종료한 뒤 같은 기기 로그인 화면으로 돌아간다.

변경 적용에는 **사용자의 로컬 mew 업데이트와 Mewlink 재배포**가 모두 필요하다. 에이전트는 운영 빌드·배포·재시작을 하지 않는다. 중앙 소스는 기존 공개 Git 제외 정책을 유지하므로 별도 비공개 백업에 보관한다.

## 유저이름과 기기 주소

중앙 로그인 후 처음에는 유저이름을 설정하며, 이후 헤더의 계정 설정(`/account`)에서 변경한다. 영문·숫자·하이픈 3~30자이고 처음·끝은 영문 또는 숫자, 연속 하이픈과 서비스 경로 예약어는 허용하지 않는다. 앞뒤 공백을 제거하고 소문자로 저장하며 대소문자 구분 없이 중앙 전체에서 유일하다. OAuth 표시 이름이나 제공자의 유저이름을 자동으로 선점하지 않는다.

현재 기기 주소는 `https://mew.run/<username>/<device-name>`이다. D1 `0002_usernames.sql`은 기존 계정에 nullable `username`을 추가하고 이름 소유 이력을 별도 테이블에 보존한다. 이름 선점과 현재 이름 변경을 D1 batch로 원자적으로 실행해 동시 요청 중 한 계정만 이름을 얻는다. 사용했던 이름은 계속 같은 계정 소유로 남고 다른 계정이 가져갈 수 없다. 이전 이름·대문자 주소·기존 내부 ID 주소는 현재 이름 주소로 307 이동한다. 미설정 계정의 기존 주소는 설정 전까지 유지한다.

중앙 내부 계정 ID·제공자 신원·관리 세션·기기 owner는 기존 불변 ID를 사용한다. 작업 권한과 브라우저 저장 범위는 로컬 계정과 instance ID를 사용한다. 유저이름은 주소 별칭이며 이름 변경으로 권한이나 저장 범위를 옮기지 않는다. 중앙 내부 ID는 관리 계정의 식별자이며 기기 사용 권한이나 로컬 로그인 계정이 아니다. 로컬 mew가 저장한 내부 ID 기반 기기 주소도 중앙에서 현재 이름 주소로 이동하므로 재등록할 필요가 없다.

`PUT /central/account`는 중앙 origin과 로그인 세션을 요구하며 잘못된 이름은 400, 이미 다른 계정 소유인 이름은 409로 응답한다. 내부 앱 origin에서는 계정 API를 계속 차단한다. 사용자 적용은 `npm --prefix mewlink run deploy`로 중앙 프론트·Worker와 D1 마이그레이션을 함께 배포한다. 이 변경만을 위해 로컬 mew를 빌드하거나 재시작할 필요는 없다.

`mewlink/test/username.test.ts`는 동시 선점·대소문자·예약어·변경 이력·세션/owner 보존·origin·이전 주소 이동을 검증한다. `mewlink/test/p2p.browser.test.ts`는 첫 설정·중복 오류 복구·변경과 새 주소/이전 주소의 실제 P2P UI 접속 및 모바일 너비를 확인한다. 실제 중앙 배포는 사용자가 진행한다.

## 직접 이메일 로그인

중앙 로그인 화면은 Cloudflare `EMAIL` binding과 유효한 `EMAIL_FROM`이 있으면 이메일 입력 폼을 제공한다. 이메일 입력 → 코드 발송 → 코드 확인 → 처음에는 유저이름 설정 → 원래 기기 등록·접속 경로 순서다. 설정 없는 경우 폼을 숨기며, 기존 Google·GitHub·Apple·선택 이메일 OIDC는 독립적으로 유지한다. [발송 설정·배포](../deployment/email-login.md), [ADR 0206](../history/decisions/0206-mewlink-email-code-login.md).

`POST /central/email/start`는 중앙 origin과 제한된 본문에서 이메일을 검증하고 브라우저별 호스트 전용 Secure·HttpOnly `__Host-mew_email` 쿠키를 발급한다. 6자리 코드는 암호학적 난수로 생성하고 10분 동안 유효하다. D1 `email_logins`에는 challenge 해시와 challenge 원문에 결합한 코드 해시를 저장하고 평문 코드는 저장하지 않는다. 발송 성공 후에만 `ready`로 바꾸며 실패하면 요청을 삭제한다. 같은 브라우저의 새 요청은 이전 challenge를 삭제한다.

`POST /central/email/verify`는 해당 쿠키와 코드 모두를 요구한다. D1에서 확인 횟수를 원자적으로 증가시키고 최대 5회만 허용한다. 해시를 고정 길이 timing-safe 비교한 뒤 성공 요청을 원자적 DELETE로 소비하여 재사용·동시 성공을 막는다. 소비 후에만 계정·중앙 세션을 생성하며 기존 세션 쿠키 보안 속성을 유지한다. 발송은 IP당 분당 10회·정규화 이메일당 분당 1회, 확인은 IP당 분당 30회로 제한한다. 코드·쿠키·메일 본문은 로깅하지 않는다. 만료 요청은 기존 시간별 cleanup에서 제거한다.

이메일은 앞뒤 공백을 제거하고 ASCII 주소 전체를 소문자로 정규화한다. 로컬 부분 최대 64자·전체 최대 254자이며 점·플러스 등 제공자별 별칭을 합치지 않는다. 직접 이메일 신원은 `email-code:<central-origin>` namespace와 검증된 정규화 주소로 찾고 계정의 불변 ID를 계속 사용한다. 같은 이메일을 표시하는 OAuth/OIDC나 로컬 mew 계정과 자동 병합하지 않는다. 인증 메일 소유 확인은 기존 기기 관리나 로컬 작업 권한을 새로 부여하지 않는다.

메일 발송 실패는 502, 제한 초과는 429, 잘못된 코드·쿠키는 401, 만료·횟수 초과·사용 완료는 410으로 끝낸다. UI는 입력·오류를 보존하고 코드 재요청·이메일 변경을 제공하며, 재발송 대기·확인 중에는 중복 동작을 막는다. 새로고침·탐색 때 카운트다운을 정리한다. 최초 이름 설정 뒤에는 안전하게 검증한 원래 중앙 경로로 돌아간다. 메일 테스트는 모의 발송이며 실제 메일 전달·도메인 활성화·중앙 배포는 사용자 확인이 필요하다.

## 중앙 로그인·기기 선택 UI

중앙 프론트는 mew의 심벌과 IBM Plex Sans KR, 보라색 액센트를 사용한다. 운영체제의 밝은/어두운 테마를 따르며 로그인·이메일 코드·처음 유저이름 설정·계정 설정·기기 등록은 같은 입력·버튼·오류 스타일로 표시한다. OAuth 버튼에는 제공자 심벌과 행동 이름을 표시하고, 이메일 코드 단계에서는 제공자 선택을 숨긴다. 코드 입력은 붙여넣기·자동 완성을 지원하는 단일 필드이며 재발송 카운트다운은 화면 판독기에 매초 알리지 않는다.

유저이름·기기 이름 입력에는 최종 기기 주소 미리보기를 표시한다. 계정 설정의 내부 ID는 접힌 상세 영역에 두고 필요할 때 복사한다. 기기 목록은 이름·온라인/오프라인·주소를 같은 행에 표시하며 소유자에게만 등록 해제를 제공한다. 복사 성공은 체크 아이콘과 상태 알림으로 표시한다. 등록 해제는 해당 행 안에서 확인하고, 취소·Esc로 닫은 뒤 원래 버튼에 포커스를 돌려준다. 마우스와 키보드에는 공통 DOM 툴팁을 제공하고 터치에서는 hover 툴팁을 띄우지 않는다.

빈 목록에는 로컬 mew의 계정 설정에서 등록하는 경로를 안내한다. 기기 주소의 접속 화면은 **전체 화면 그라데이션과 중앙 인디케이터**로 mew를 여는 과정만 표시하며 중앙 헤더·계정 메뉴·기기 주소 카드·목록 링크를 표시하지 않는다. 처음 내려오는 HTML부터 같은 화면을 제공한다. 연결 중에는 `mew에 연결 중`, transport가 준비되면 `mew를 여는 중`을 표시하고 앱의 준비 신호를 받은 뒤에만 화면을 넘긴다. 일시적인 재연결에서는 기존 앱과 초안을 유지한다.

배경은 밝은/어두운 OS 테마를 따르는 CSS radial gradient 한 레이어이며 transform·opacity만 움직인다. 이미지·영상·canvas·추가 애니메이션 라이브러리를 받지 않는다. 모션 감소 설정에서는 정적 배경과 인디케이터를 사용하고 숨은 탭에서는 애니메이션을 멈춘다. 연결 화면은 시스템 글꼴을 사용한다. 약 809KB인 중앙의 일반·굵은 글꼴 두 파일은 연결 과정에 필요하지 않으므로 `shell()`로 중앙 로그인·등록·관리 화면을 열 때만 글꼴 CSS를 등록한다. 실제 mew 앱의 글꼴은 기존 앱 계약을 따른다. [CSS 애니메이션 렌더링 지침](https://web.dev/articles/animations-guide).

`bootstrapRemoteConnection()`은 기기 경로 또는 instance ID로 WSS를 열면서 SDP offer와 ICE를 준비한다. 같은 origin의 challenge에서 instance·앱 origin·허용 issuer·중앙 공개 키를 확인하므로 별도 HTTP launch·`/central/key` 조회는 하지 않는다. 확인한 instance의 브라우저 키와 재개 세션이 준비되면 소켓 nonce·offer·공개 키로 connect를 한 번 보낸다. 준비 중 취소는 소켓·peer·대기를 닫으며, 늦은 준비가 끝난 연결을 다시 열지 못한다. 구버전 `connectRemote()`의 HTTP launch·중앙 키 조회는 호환 경로로 유지한다. bootstrap 문맥 전 전송 실패에만 호환 경로를 사용하고 잘못된 문맥·접근 거부·회수에는 사용하지 않는다. ICE 후보는 검증된 ticket의 연결 ID가 정해진 뒤 전송하며 키·서명·issuer·audience·시간·브라우저/기기 증명 검증을 유지한다.

호스트는 prepare에서 challenge·generation을 만들고 ready를 먼저 보낸 뒤 RTC helper를 시작해 ticket 왕복과 준비를 겹친다. 최종 ticket과 브라우저 키 증명을 검증하기 전에는 세션 재개·작업 dispatcher·인증 완료 응답을 허용하지 않는다. 먼저 도착한 데이터는 `remoteTicketInbox`에서 기존 frame 32KiB·합산 512KiB·대기 4096개 한도 안에 보관한다. 종료·만료는 대기를 해제하고 helper를 정리하며 늦은 ticket·서명·프로세스 callback은 버린다. [ADR 0028](../decisions/0028-mewlink-websocket-bootstrap.md).

내부 런처는 role HTML의 `mewlink-central-origin`·`mewlink-app-origin` metadata와 정확한 부모 프레임의 instance 안내를 확인한 뒤 P2P 준비 중 Service Worker 등록·활성화를 시작한다. 두 metadata가 없는 이전 HTML만 `/config`를 조회하며, 일부 누락·잘못된 origin은 오류로 처리한다. HTML에는 nonce·ticket·브라우저 키·세션을 넣지 않는다. 최종 MessagePort의 instance도 일치해야 사용한다. 최초 연결에서는 `/api/auth/me`와 앱 자원 준비를 겹치며, index가 같은 bootstrap 검사를 수행하므로 중복 `/api/remote-ui` 조회는 하지 않는다. index의 403·404·409는 자원 브리지에서 런처 오류로 전달한다. 복구 중인 기존 앱에는 같은 계정·인증 수단 확인을 마친 뒤에만 전송을 다시 연다.

런처의 현재 연결에서 확인한 인증 상태가 앱 MessagePort 준비 전에 도착하면 `initialAuth`로 한 번 전달하고 앱의 중복 `/api/auth/me`를 생략한다. 상태가 늦거나 이전 런처이면 기존 조회로 돌아간다. 재연결·계정 전환에는 전달 대기 상태를 버리며 인증 결과를 영속 캐시하지 않는다. 앱의 경로별 인증 진입점 다운로드도 MessagePort·저장소 범위 준비와 병렬로 시작하고 실제 렌더링은 범위 확인 뒤에 한다.

저장 세션과 이전 기기 경로 힌트가 있으면 bootstrap부터 `identity=0`을 선택해 중앙 신원을 생략한다. 공개 주소와 instance의 저장 대응은 힌트일 뿐이며 응답 instance가 다르면 준비한 소켓을 닫고 실제 기기의 신원 모드로 다시 시작한다. 해당 세션이나 브라우저 키를 다른 기기로 보내지 않는다. 명시적 Mewlink 로그인은 저장 세션을 사용하지 않는다. 자동 복구도 새 bootstrap을 사용하며 기존 앱은 같은 계정·인증 수단 확인 뒤 이어 쓴다.

기존 모의시간 검사에서는 180ms 로컬 준비를 200ms 시그널링 대기와 겹쳐 connect 전송까지 200ms로 확인했다. 이는 운영 개선 시간의 실측이 아니며 네트워크·ICE 협상·로컬 앱 다운로드까지 포함한 실서비스 지연을 보장하지 않는다. 변경은 사용자 로컬 앱 적용과 Mewlink 중앙 재배포가 필요하다.

오프라인·요청 실패는 같은 전체 화면에서 구체적인 오류와 재연결·기기 목록 이동을 제공한다. 내부 런처의 실패 사유는 바인딩된 relay port로 종료 알림보다 먼저 전달해 정리 과정의 일반 메시지가 구체적인 오류를 덮지 않는다. 내부 연결 프레임 준비 신호, 화면 자원 준비, 앱 준비 신호는 각각 15초 한도를 둬 정지한 단계에서 무한 로딩을 유지하지 않는다. 이 연결 프론트 변경은 사용자의 **Mewlink 중앙 재배포**로 적용한다. 운영 빌드·배포는 에이전트가 실행하지 않는다.

`shared/remote-launcher-role.ts`는 공개 기기·포트 주소, 앱 프레임, 관리 주소의 역할을 공유한다. Worker는 connect·app·dashboard HTML을 직접 선택하고, Vite는 하나의 `public/index.html` 템플릿에 역할별 entry와 정적 CSS·modulepreload를 구성한다. 새 HTML은 통합 `launcher.js` 라우터를 거치지 않는다. `client.ts`의 작은 동적 라우터는 이전 HTML 호환용으로 남는다. [ADR 0029](../decisions/0029-mewlink-launcher-entries.md).

`connection-parent.ts`는 WSS·브라우저 키·세션·신뢰·복구를, `app-launcher.ts`는 MessagePort·Service Worker·설치 앱을, `dashboard.ts`는 로그인·등록·관리를 맡는다. 일반 연결은 관리 코드·제공자 SVG를 받지 않고 앱 브리지는 JOSE·중앙 연결·브라우저 키 코드를 받지 않는다. 명시적 Mewlink 로그인에만 관리 로그인 모듈을 동적으로 준비한다. 공통 DOM·상태·툴팁은 `launcher-ui.ts`·`launcher-page.ts`, 브랜드·제공자 SVG는 `dashboard-ui.ts`가 소유한다. 기본·접속 스타일은 `launcher.css`, 관리 스타일은 `dashboard.css`로 분리한다.

`launcher-assets.ts`와 Vite 설정은 부모 `public/`의 기존 심벌·폰트·폰트 라이선스/출처에서 중앙 자산을 생성한다. Worker는 기존 지정 자산과 `/launcher/` 바로 아래 JS/CSS만 제공하며 중첩 경로·source map·임의 소스는 제공하지 않는다. 앱 origin의 인증/API 차단과 P2P 자원 경계를 유지한다.

중앙·앱 런처의 HTTP 응답은 `Cache-Control: no-store, no-transform`을 지정한다. 저장 금지와 함께 Cloudflare의 자동 방문 통계 스크립트 등 중간 계층의 본문 삽입을 막도록 요청하며, 자체 스크립트만 허용하는 기존 CSP를 유지한다. `static.cloudflareinsights.com/beacon.min.js` 차단 로그는 통계 스크립트의 CSP 위반이며 그 로그만으로 기기 연결 실패를 판단하지 않는다. 브라우저 회귀 검사는 통계 스크립트를 의도적으로 삽입해 차단 로그가 나와도 네이티브 P2P 화면·새로고침·두 탭 접속이 성공하는지 확인한다. [Cloudflare 방문 통계 FAQ](https://developers.cloudflare.com/web-analytics/faq/) · [Cache-Control 지시어](https://developers.cloudflare.com/cache/concepts/cache-control/#other).

격리 브라우저 검사는 320·390·700·1100px와 양 테마, 제공자 버튼·이메일 오류 복구·첫 이름/중복/변경·주소 미리보기·계정 ID·빈 목록·온라인/오프라인/긴 이름·복사·등록 해제/취소/Esc·터치·연결 실패/준비 시간 초과 및 실제 네이티브 P2P 전체 화면을 확인한다. 제공자 버튼 검증은 모의 설정이며 실제 OAuth 로그인·메일 발송과 중앙 배포는 별도 적용 확인이 필요하다.

## WSL 외부 접속과 UDP 수신

Mewlink의 네이티브 WebRTC helper는 UDP `55000–55031`만 사용한다. STUN으로 외부 후보를 얻어도 해당 포트의 수신이 차단되면 다른 네트워크의 폰에서 연결하지 못할 수 있다. WSL mirrored 모드에서는 Windows Defender와 별도로 Hyper-V 방화벽의 WSL 수신 정책을 확인한다. 전체 기본 수신 정책을 허용으로 바꾸지 않고 필요한 UDP 범위만 연다. [Microsoft WSL 네트워킹](https://learn.microsoft.com/windows/wsl/networking#mirrored-mode-networking).

owner가 로컬 **Mewlink → 기기 등록**을 누르면 `remote-access-network.ts`가 등록 전에 네트워크 준비를 시작한다. 이미 등록한 기기는 **연결 준비**로 같은 절차를 실행하며 기기 ID·키를 보존한다. 서버 시작·상태 조회·외부 폰 접속은 Windows 승인창을 열지 않는다. 상태 조회는 읽기 전용이며 30초간 재사용한다. `POST /api/remote-access/prepare-network`는 로컬 owner만 사용할 수 있고 P2P 작업 dispatcher에서는 허용하지 않는다.

고정 `remote-access-network.ps1`은 WSL의 Hyper-V UDP 수신 또는 Windows 실행 Node 프로그램의 UDP 수신 범위만 준비한다. 관리자 권한이 필요하면 Windows UAC를 한 번 요청하고 동시 요청은 합친다. 취소·명시적 차단·동명 충돌·관리 정책 제한은 준비 실패로 표시하고 기존 규칙을 덮어쓰지 않는다. WSL 규칙은 WSL VM 전체에 적용되는 포트 범위이며 프로그램별 규칙은 아니다. Linux·macOS나 Hyper-V 정책을 검사할 수 없는 환경은 `unknown`으로 보존하고 등록을 허용하지만 준비 완료로 표시하지 않는다.

수동 복구가 필요한 WSL에서는 관리자 PowerShell에서 아래와 같이 범위 규칙을 추가할 수 있다.

```powershell
New-NetFirewallHyperVRule -PolicyStore PersistentStore -Name 'Mewlink-ICE-UDP-55000-55031' -DisplayName 'Mewlink ICE UDP 55000-55031' -Direction Inbound -VMCreatorId '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -Protocol UDP -LocalPorts '55000-55031' -Action Allow -Enabled True
```

이미 같은 이름의 규칙이 있으면 범위·방향·허용 여부를 확인하고 중복 생성하지 않는다. 관리 정책에서 로컬 규칙을 막거나 일반 Defender 규칙이 추가로 차단하면 그 정책도 확인해야 한다. 공유기의 NAT·외부망 UDP 제한은 별도 조건이며 방화벽 규칙만으로 모든 네트워크 연결을 보장하지 않는다. 회수할 때는 같은 이름의 규칙만 삭제한다.

소스 설치의 `remote-access-rtc.mjs`는 새 연결마다 별도 프로세스에서 읽는다. helper의 포트·후보 처리만 바꾸면 다음 연결에 적용된다. 부모 등록 API·설정 UI·네트워크 준비 변경은 사용자의 로컬 업데이트·빌드·재시작 후 적용한다. CLI 실행본은 새 실행본 배포가 필요하다. 같은 PC의 익명 모바일 브라우저 연결과 호스트 UDP 후보 포트 확인은 외부 LTE 실검증과 구분한다.

### 공유기 준비와 직접 연결 진단

helper는 기존 WebRTC host·STUN 후보를 즉시 교환한다. 2초 내 연결되지 않으면 실제 host UDP 소켓과 OS가 선택한 기본 경로가 일치할 때 기존 `nativeConnectivity`의 PCP → NAT-PMP → UPnP를 시도한다. 지원 공유기에 해당 UDP 포트의 120초 임대를 요청하고 성공한 공인 후보를 추가한다. 임대는 반환 수명의 절반마다 갱신하며 연결 종료 때 소유한 매핑만 삭제한다. 이미 직접 연결된 경우 불필요한 탐색을 취소한다. 채널·peer는 즉시 닫고 매핑 정리는 최대 3.5초 기다린다.

`RemoteStatus.network`는 OS 준비 상태, `connectivity`는 최근 helper의 후보 수집 상태·host/srflx/공인 IPv4/전역 IPv6 개수와 매핑 상태다. 주소·포트·인증값은 진단에 넣지 않는다. `online`은 중앙 시그널링 연결이며 외부 폰의 연결 성공을 뜻하지 않는다. OS 규칙 준비나 합성 NAT 검사도 외부망 성공의 증거가 아니다.

작업 데이터는 계속 WebRTC DataChannel로 직접 전송한다. HTTPS·WSS·TURN 데이터 중계는 추가하지 않는다. 공유기가 매핑을 지원하지 않거나 다중 NAT·외부 UDP 차단이 남으면 직접 연결은 실패할 수 있다. [자동 준비 결정](../decisions/0006-mewlink-direct-network-preparation.md).

## Windows Chrome과 같은 PC의 WSL 연결

`server/remote-access-rtc.mjs`는 WSL 커널에서만 `remote-access-ice.ts`로 IPv4 UDP host 후보와 동일한 소켓 포트·mid를 갖는 `127.0.0.1` 후보를 추가한다. 다른 인터페이스가 같은 소켓을 광고해도 loopback 후보는 한 번만 보낸다. 일반 host·STUN 후보와 인증된 ticket·키 검증은 유지한다. TCP·IPv6·srflx·relay·mDNS 후보에서 loopback 주소를 만들지 않으며 별도 중계 소켓이나 HTTP 경로를 열지 않는다.

WSL mirrored 모드에서는 같은 PC라도 Windows와 Linux의 일반 인터페이스 주소로 보낸 ICE 확인이 응답하지 않을 수 있다. 2026-10-09 실제 Windows Chrome 155와 WSL2 mirrored의 격리 네이티브 helper에서 기존 후보만 사용한 실패(확인 패킷 응답 0)를 재현했고, loopback 후보 추가 후 후보 쌍 선택·DTLS/DataChannel 열림을 확인했다. Chrome 실험 설정·Windows 방화벽·WSL 설정은 변경하지 않았다. 이 결과는 다른 WSL 네트워크 모드나 외부망의 성공 보장이 아니다. [Microsoft WSL 네트워크](https://learn.microsoft.com/windows/wsl/networking).

helper는 접속 시 새로 생성되므로 실행 중인 서버도 다음 연결부터 수정된 helper 파일을 읽는다. 이 후보 처리만 바꿀 때 중앙 재배포나 앱 번들 재빌드는 필요 없다. 실패한 기기 페이지의 **다시 연결** 또는 페이지 새로고침으로 새 연결을 만든다.

## 중앙 시그널링의 인가 상태

기기별 Durable Object는 기기 공개 키·브라우저 신뢰 목록·회수 기록을 자체 SQLite에 보관한다. 첫 접근에서 기존 D1 기기·브라우저 목록을 한 번 가져오며, 가져오기 실패를 빈 목록이나 초기화 완료로 처리하지 않는다. 이후 hibernation에서도 SQLite와 WebSocket attachment를 복원해 같은 상태를 사용한다. 공유 구현은 `shared/remote-signaling-state.ts`, 중앙 연결은 비공개 `mewlink/src/signaling.ts`가 담당한다. [ADR 0025](../decisions/0025-mewlink-signaling-authority.md).

SDP ready·answer와 ICE candidate마다 기기·브라우저 상태를 D1에서 다시 읽지 않는다. 로컬 비밀번호·저장 세션·익명 연결은 해당 메시지의 D1 조회가 0회다. 외부 Mewlink 신원이 포함된 연결의 중앙 세션 조회와 요청 한도는 유지한다. 새 WebSocket bootstrap은 D1 launch INSERT/DELETE 대신 소켓 attachment의 nonce를 한 번 소비하며, 구버전 HTTP launch의 발급·단회 소비는 D1에 남는다. prepare/ready·서명·lease·직접 P2P 전송은 유지한다.

관리 API의 브라우저 회수·기기 폐기는 DO SQLite에 먼저 영속 기록하고 대상 연결을 종료한 뒤 D1을 갱신한다. D1 갱신에 실패하면 API는 실패를 반환하지만 DO의 회수를 되돌리지 않는다. 새 admission과 오래 걸린 토큰 검증·서명 뒤에도 최신 회수를 확인하며, 늦게 도착한 D1 초기 목록이나 신뢰 등록은 회수를 해제하지 못한다. 브라우저 관리 목록은 DO 상태를 읽는다.

lease 갱신과 10초 alarm은 D1의 기기·브라우저 회수를 단조 병합하고 중앙 세션을 재검증한다. D1의 active 값으로 DO 회수를 복구하지 않는다. 관리 API 밖에서 D1을 직접 수정한 회수는 다음 갱신·alarm에 반영된다. 백업과 구버전 복귀는 DO·D1 상태를 함께 고려해야 하며, 절차는 [중앙 배포 문서](../deployment/remote-central.md#시그널링-인가-상태의-보존과-복귀)를 따른다.

## 연결 인증과 회수

1. A가 매 WSS 연결에서 중앙 nonce에 서버 키로 서명한다. 중앙은 등록된 공개 키와 instance ID를 확인한다.
2. B는 기기 경로 또는 instance ID로 `/central/signal?role=browser&bootstrap=1` WSS를 연다. 중앙은 origin·등록 기기·IP와 기기 요청 한도를 확인한다. DO는 nonce·난수 subject·선택적 중앙 신원을 해당 소켓에 결합해 challenge를 보낸다. 익명/신원 생략 연결의 session은 빈 문자열이다.
3. B는 해당 소켓 nonce·SDP offer·Ed25519 공개 키를 전송한다. 중앙은 nonce를 한 번 소비하고 현재 기기·브라우저 회수를 확인한다. A가 challenge·generation을 만들어 ready를 보내면 중앙은 instance·연결·브라우저 키·SDP 지문·신뢰한 CF 접속 IP의 60초 ticket을 서명한다. 구버전은 기존 HTTP launch를 발급받아 서명·대상·세션 결합을 확인하고 원자적으로 한 번 소비한다.
4. A는 ready 뒤 RTC 준비를 시작하며, 고정 중앙 키·issuer·audience·알고리즘·만료·연결·협상·인증 모드·IP의 최종 ticket 검증을 별도로 완료한다. answer 지문은 서버 키로 서명하고 B는 중앙에서 확인한 A의 등록 키로 검증한다. DO의 호스트 FIFO는 ticket을 보낸 뒤 answer·candidate를 전달한다.
5. 채널의 첫 메시지에서 B가 정확한 ticket과 브라우저 키 소유 증명을 제시한다. 재접속용 로컬 세션은 이 메시지의 `session`에서만 받으며 신뢰 세션은 저장된 공개 키 지문도 일치해야 한다. 무효 세션은 작업 권한 없이 로그인 화면으로 이어진다. challenge/generation은 재사용하지 않는다.
6. 로그인 전 제한된 UI·인증·접근 요청 API를 사용한다. 로컬 비밀번호 또는 명시적으로 승인된 외부 신원으로 기존 계정의 기능·파일 권한을 적용한다. 중앙 로그인과 로그아웃은 로컬 비밀번호 세션을 만들거나 회수하지 않는다. 신원을 포함한 transport는 중앙 세션 수명을 함께 검사한다.

브라우저의 중앙 접속 증명·기기 answer 검증과 서버·중앙의 `verifyRemoteToken`은 공통 `REMOTE_TOKEN_CLOCK_TOLERANCE`로 **2초**의 시계 오차를 허용한다. 브라우저 검증에서 누락됐던 허용값을 서버와 맞췄으며 `iat` 최대 나이 60초·만료·서명·issuer·audience 검증은 유지한다. 미래 `iat`가 허용 범위를 넘으면 원시 JWT 오류 대신 접속 기기와 mew 호스트의 날짜·시간 자동 동기화를 안내한다. 토큰의 발급 시각으로 현재 시각을 바꾸거나 시간 검증을 생략하지 않는다. 이 수정의 중앙 런처 적용에는 사용자 Mewlink 재배포가 필요하며, 실제 기기의 시계 오차와 운영 반영은 별도 확인한다.

활성 연결의 lease는 최대 **60초**, B의 갱신 간격은 **20초**다. transport 키 증명 완료 전 갱신은 A가 적용하지 않는다. 중앙 로그아웃은 신원 포함 연결을 종료하고, 신원을 생략한 로컬 비밀번호 접속과 저장된 비밀번호 세션은 유지한다. 이전 중앙 멤버 회수는 신규 로컬 권한의 근거가 아니다. 기기 등록 폐기는 열린 신호 연결과 A의 연결을 종료한다. A는 매 요청과 1초 간격으로 선택된 인증 수단·현재 계정·lease를 재검증한다. 중앙 단절 때는 재부착을 협상한 연결만 기존 lease 안에서 유지하며 나머지는 즉시 닫는다. A의 정책 변경 이벤트도 검증을 촉발한다. 기존 WS·데스크톱의 기능별 권한 재검증과 입력 lease를 함께 사용한다.

중앙 DO는 `serverRenewal: true`를 보낸 브라우저에 기존 10초 alarm 검사 후 연결 ID를 지정한 `renew` 요청을 보낸다. 브라우저는 키 증명을 마친 같은 연결에서만 즉시 응답하므로 20초 타이머가 지연돼도 갱신할 수 있다. 요청을 보내는 것만으로 lease를 연장하지 않으며, 응답에도 기기·신원·만료 검증을 적용한다. 기존 브라우저에는 이 요청을 보내지 않고 기존 중앙에 연결한 새 브라우저는 20초 타이머를 계속 사용한다. 브라우저 실행 중단이나 인증 WSS 단절이 현재 lease를 연장하지 않으며, 협상된 재부착도 아래 유효기간 안에서만 수행한다. 적용에는 사용자 Mewlink 중앙 재배포가 필요하다. 격리 검증은 타이머 지연 경로를 확인하며 실제 반복 끊김의 원인 확정이나 휴대폰 절전·외부망 검증을 대신하지 않는다.

브라우저·네이티브 RTC는 일시적인 `disconnected`에 최대 **15초**의 복구 시간을 둔다. 상태 이벤트 반복으로 기한을 연장하지 않으며 `connected`로 돌아오면 같은 transport·앱 iframe·입력 초안을 유지한다. `failed`·`closed`, 실제 DataChannel과 부모 종료는 해당 transport를 즉시 정리한다. 인증 WSS는 재부착을 협상하지 않았거나 정상 종료·권한 거부·회수인 경우 즉시 정리한다. 브라우저가 visible 상태로 돌아오거나 `pageshow`·`online`을 받으면 기존 세션의 갱신을 즉시 요청한다. 60초 인증 lease를 늘리거나 이미 만료된 권한을 복구하지 않으며 쓰기·명령을 재실행하지 않는다. `disconnected`를 자연 복구 가능한 상태로 다루는 근거는 [WebRTC 상태 계약](https://www.w3.org/TR/webrtc/#dom-rtcicetransportstate)을 따른다.

### 시그널링 순단의 같은 RTC 재부착

[ADR 0033](../decisions/0033-mewlink-signaling-resume.md)에 따라 중앙 challenge·호스트 nonce 서명·브라우저 요청·서명된 ticket에서 모두 `signalResume`를 협상한 연결은 일시적 WSS 단절 때 RTC와 진행 중 작업을 유지한다. 정상 종료(code 1000)·명시적 거부·회수·로그아웃·만료는 이 복구를 사용하지 않는다. 구버전은 기존 전체 재연결을 유지한다.

브라우저는 새 소켓의 단회 nonce를 기존 키로 서명하고 중앙은 instance·origin·connection·generation·SDP 지문·키 지문·subject·선택적 신원의 같은 세션과 회수를 다시 검사한다. 재부착은 기존 lease만 복원한다. 갱신 요청 ID와 요청 시작의 단조 시각, 중앙의 남은 시간에서 1초 여유를 빼 유효기간을 계산하므로 시계 차이·네트워크 지연·재시도 자체가 허용 시간을 늘리지 않는다.

DO는 끊긴 브라우저 상태를 `mew_signal_recovery` SQLite 테이블에 최대 8개 보관하며 기존 만료 시각·alarm·새 연결·회수로 정리한다. 열린 소켓은 attachment로 복원한다. 새 호스트 WSS는 등록 키로 nonce와 실제 보유한 인증 완료 연결 목록을 서명하고, 중앙은 현재 연결·보존 상태와 대조해 기존 lease만 재전송한다. 호스트 신원 조회의 await 뒤에도 현재 호스트·브라우저·저장 상태를 다시 확인한다. 준비되지 않은 새 호스트 프로세스는 이전 peer를 되살리지 않는다. 활성 peer 8개가 있어도 재부착용 브라우저 대기 슬롯과 호스트 인증 슬롯을 확보한다.

격리 Workers는 nonce·키·세대·기기 불일치·재사용·회수·로그아웃·만료·hibernation·호스트 교체와 브라우저 재부착 경합을 검사했다. 실제 Workers·네이티브 RTC·Chromium 안정성 검사에서는 브라우저와 호스트 WSS를 각각 끊어도 같은 iframe·RTC에서 HTTP가 성공하고 새 prepare가 생성되지 않았다. 종료 callback 없이 플랫폼이 모든 소켓 상태를 잃는 강제 종료까지 무중단을 보장하지는 않는다. 재부착 실패나 lease 만료는 아래 전체 재연결로 이어진다.

최종 연결 종료나 절전·망 전환 뒤에는 중앙 런처가 새 WebSocket bootstrap과 같은 브라우저 키·저장 세션으로 자동 재연결한다. 구버전 호환 경로에서만 새 HTTP launch를 사용한다. 재시도 대기 시간은 점차 늘려 최대 **30초**로 제한한다. 기존 앱 iframe·미저장 입력을 유지하며, 새 연결의 `/api/auth/me`에서 같은 로컬 계정과 인증 수단을 확인한 뒤 전송을 교체한다. instance·중앙/앱 origin·previewDomain이 달라지면 새 준비 연결과 기존 iframe을 정리하고 자동 복구를 중단해 새로고침을 안내한다. 계정·인증 수단이 달라져도 기존 앱 상태를 이어 쓰지 않는다. 종료된 연결의 진행 중 요청은 취소하고 저장·명령을 자동 재실행하지 않는다. DOM 브라우저 화면과 뮤펫 대화는 읽기 구독을 다시 열고 이전 입력을 재전송하지 않는다. 명시적 회수·인증 거부·로그아웃은 저장 토큰을 지우고 재시도를 멈춘다. 원격 데스크톱의 별도 영상·입력 peer는 수동 재연결 범위를 유지한다. 90일 미사용·비밀번호 변경·승인 연결 회수 이후에는 재인증해야 하며, 휴대폰 절전 중 실제 연결 유지나 외부망 복구 성공을 보장하지 않는다.

중앙 DO의 비동기 인가 검사 중 수신 대상 탭이 닫혀도 그 탭의 송신 실패만 정리한다. 이 오류를 메시지를 보낸 호스트의 인증 실패로 확장하지 않는다. 실제 호스트 종료·권한 회수는 기존처럼 종속 연결을 모두 닫는다.

중앙 launch는 IP당 분당 30회·기기당 분당 60회로 제한하고 신호 연결도 IP 빈도·기기별 pending·전체 연결 수를 제한한다.

[ADR 0048](../decisions/0048-mewlink-bootstrap-rate-batch.md)에 따라 새 bootstrap은 기기 조회 뒤 IP launch 30회·기기 launch 60회·IP browser signal 30회 검사를 D1 `batch()` 한 번으로 처리한다. 각 UPSERT는 앞선 카운터의 초과 여부를 SQL에서 확인하므로 순서·60초 창·기존 카운터 공유와 거절 후 뒤 카운터를 올리지 않는 동작을 유지한다. 한 문장이 실패하면 전체 batch를 rollback하고 연결을 허용하지 않는다. 구버전 HTTP launch와 일반 host/browser signal 경로는 기존 검사를 사용한다.

역할 힌트와 후속 키 증명으로 browser·host 대기 슬롯을 나누고 host handshake 여유를 둔다. 브라우저 시그널링은 중앙 origin에서만 허용하며 앱 origin에서는 거부한다. 로컬 미인증 연결은 최대 5분이며 central renew가 이 기한을 늘리지 않는다. 연결·작업 대기열·본문과 프레임 크기 한도는 아래 전송 계약을 유지한다.

로컬 계정 회수는 기존 로컬 계정·세션·권한 변경으로 처리한다. 로컬 등록 해제는 작업을 닫고 키를 제거한 뒤 서버 서명으로 중앙 등록을 폐기한다. 중앙이 응답하지 않으면 대시보드에서 남은 등록을 삭제하라는 오류를 표시한다. 내려받은 자료나 이미 시작한 OS 작업의 소급 회수는 기존 권한 경계를 따른다.

## 전송 경로

| 경로 | 구현과 지원 범위 |
| --- | --- |
| 실제 UI의 HTML·JS·CSS·worker·이미지·PDF 정적 자원 | A의 설치된 빌드 → 인증된 P2P GET/HEAD → 내부 iframe. 중앙에는 연결 프론트만 배포 |
| 앱 HTTP·JSON·multipart·SSE | 명시적 `mewFetch` → 로컬 fetch 또는 인증된 DataChannel 요청/응답/스트림 |
| 앱 WebSocket | `openMewSocket`; 터미널은 주입한 `socketFactory`. 기존 WS 서버의 세션·권한·account workspace를 사용 |
| 허용 WS | `/api/tmux/ws`, `/api/agent/ws`, `/api/presence`, `/api/collab`, `/api/db/ws`, `/api/login-desktop/ws`, `/api/remote-desktop/ws` |
| 이미지·PDF.js·미디어·다운로드의 URL 요청 | 내부 앱 origin의 `remote-resource-worker.js`가 `/api/` GET/HEAD를 **요청한 탭/worker에 결합된 연결**로 전달. Range·PDF 버전/편집 헤더를 보존 |
| 중앙 계정·등록·로그인·신호 | 중앙 HTTPS/WSS. 작업 전송과 별도 유지 |
| 원격 데스크톱 | 협상은 앱 전송, 영상·입력은 기존 별도 peer. OS 승인·단일 제어·입력 lease·NAT 계약 유지. 이 작업에서 실제 영상/입력 검증은 수행하지 않음 |
| localhost 앱 프리뷰 | `/user/device/<port>` 진입. Mew 로그인과 `portPreview` 권한으로 발급한 포트 전용 capability만 전달한다. 별도 preview origin의 자산·API·WS는 P2P로 호스트 loopback에 연결한다. [포트 프리뷰](port-preview.md)의 wildcard HTTPS 설정이 필요하다. |
| Android iframe | P2P에서 미지원. Android capability를 숨기고 임의 URL 프록시를 허용하지 않는다. |
| 에이전트·GitHub 로그인 화면 | `/api/login-desktop/ws`의 JPEG 영상과 입력을 기존 앱 전송으로 전달한다. 가상 화면과 입력은 호스트의 독립 X 서버가 소유한다. |
| 로컬 로그인·비밀번호 변경·로그아웃 | P2P로 A의 기존 인증 API를 사용. 중앙 기기 등록·관리 로그인과 별개 |

`remote-access-dispatch.ts`는 메모리의 duplex socket에 검증된 세션 조회 함수를 결합하고 기존 HTTP parser·Express 라우터·WS upgrade를 실행한다. TCP loopback 중계 포트를 만들지 않는다. 인증 정보는 비공개 WeakMap 문맥에서 가져오며 B의 Cookie·Authorization·역할·Host·forwarded 헤더를 사용하지 않는다. 허용 요청 헤더만 B와 A 양쪽에서 전달한다. `/api/auth/me`·profile·비밀번호 변경은 기존 로컬 계정 인가를 적용하며 이전 원격 멤버 API는 410으로 폐기한다.

`remotePath`는 고정 `/api`와 WS 목록, 경로 정규화와 크기를 검사한다. 사용자 HTML/SVG 자원 응답에는 sandbox CSP·nosniff·no-store를 적용한다. 앱 iframe 탐색은 연결별 임시 경로에 결합하며 요청의 연결을 식별할 수 없는 자원은 실패한다. Service Worker는 작업 본문을 캐시하거나 다른 탭의 연결로 대체하지 않는다. 미지원 브라우저·네트워크에는 오류와 재시도를 제공한다. TURN 설정·relay ICE 후보·중앙 HTTP 작업 프록시는 사용하지 않는다.

원격 다운로드 링크는 Chromium에서 Service Worker를 우회하는 `download` 속성을 쓰지 않고 A의 `Content-Disposition` 응답으로 다운로드한다. worker는 일반 요청의 `clientId` 또는 같은 탭 탐색의 `replacesClientId`로 출발 탭을 확인한다. 요청에 연결된 탭을 찾지 못하면 503으로 끝내며 다른 탭의 전송을 선택하지 않는다.

중앙 접속 모드는 연결 종료 뒤에도 유지한다. 전송이 없으면 앱 요청·소켓은 실패하며 중앙 HTTP/WSS로 대체하지 않는다. 종료 후 늦게 실행되는 저장·명령 요청의 본문도 중앙에 보내지 않는다. 중앙 계정/로그아웃 요청은 별도 중앙 클라이언트를 사용한다.

개별 로컬 WebSocket의 정상 종료 중 이미 도착 중인 메시지와 로컬 송신 실패는 해당 소켓만 정리한다. 가상 소켓의 앱 이벤트 콜백은 [DOM 이벤트 처리](https://dom.spec.whatwg.org/#concept-event-listener-inner-invoke)를 사용해 예외를 브라우저 오류로 보고하며 P2P 수신 처리의 실패로 확장하지 않는다. 잘못된 프로토콜·전체 전송 장애는 연결 전체를 종료한다. 로컬 세션이나 권한 회수는 해당 이전 작업·WS를 종료하고 제한된 로그인 transport를 유지한다. 소켓을 닫은 뒤 Blob 읽기가 완료되거나 다음 분할 청크가 준비돼도 추가 메시지를 보내지 않는다.

## 프로토콜과 자원 수명

프로토콜 버전은 `shared/remote-access.ts`의 **1**이다. 중앙 challenge와 A의 인증 완료 메시지에서 확인하며 호환되지 않는 연결을 거부한다. 서버 이름은 최초 등록 후 고정이고, 변경은 삭제·재등록을 사용한다. 버전별 업데이트/자동 키 회전의 운영 검증은 남아 있다.

| 제한 | 현재 값 |
| --- | --- |
| 단일 JSON 프레임 / 바이너리 청크 | 32KiB / 12KiB(base64 전 크기) |
| HTTP·WS 확장 수신 창 | 협상 후 처음 8청크 / 96KiB, 소비 뒤 최대 256청크 / 3MiB. 미협상 HTTP는 기존 1~8청크, WS는 기존 송신 방식 |
| RTC 송신 대기열 | 512KiB 이상이면 대기, 10초 진행 불가 시 종료 |
| A의 연결별 native IPC 수신 대기열 | 처리 중 프레임을 포함한 UTF-8 합계 512KiB, 대기 항목 최대 4096개. 인증·프레임을 FIFO 처리하고 종료 때 미처리 항목 제거 |
| A의 native IPC 송신 ACK 대기 | 연결당 최대 64개, A의 8개 연결 합계 최대 512개. 10초 미응답 시 해당 연결 종료 |
| HTTP·WS 동시 작업 | 분리 협상 후 각 16개·채널 합계 32개. 미협상 상대는 공통 16개 |
| 동시 작업 초과 시 admission 대기열 | 전송 인스턴스당 최대 64개, 30초 대기. 실제 채널의 앱·자원 공유 대기열에서도 같은 상한 적용 |
| 브라우저 동시 연결 | A당 8개 |
| HTTP 업로드 / 단일 WS 메시지·대기열 | 각각 최대 25MiB. 기존 API의 더 낮은 제한도 적용 |
| A의 진행 중 HTTP 본문·WS 조립/송신 데이터 합계 | 64MiB. OS 프로세스 전체 RAM 한도는 아님 |
| 시그널링 메시지 / 처리 대기 / ICE 개수 | 96KiB / 연결당 128개 / 앱 연결당 양방향 합계 256개 |
| 초기 HTTP 응답·업로드 진행 없음 | 30초. 응답 이후 스트림은 취소·채널/인증 수명으로 종료 |

브라우저는 슬롯이 찬 새 작업을 대기열에 넣고 빈 슬롯이 생기면 처음 전송한다. 앱 MessagePort의 요청과 런처·자원 요청도 실제 DataChannel의 admission을 함께 사용한다. `flowControl.separateStreams: true`를 응답·소켓 열기로 확인한 뒤 HTTP와 WS의 슬롯을 각각 16개로 분리한다. 같은 종류는 FIFO를 유지하고, 막힌 WS 대기 때문에 빈 HTTP 슬롯을 사용하지 못하는 일은 피한다. 구버전과 협상 전에는 기존 공통 16개 FIFO다. HTTP는 응답 본문 완료까지, WS는 연결 종료까지 슬롯을 유지한다. 대기 중 취소·닫기·채널 종료는 미전송 작업을 제거하며, 대기열 상한·시간 초과는 오류로 끝낸다. 서버는 완료 작업을 먼저 정리하고 종료 프레임을 보내며, 브라우저는 취소 프레임 전송 뒤 슬롯을 반환한다. 쓰기 요청을 자동 재전송하지 않는다.

MessagePort에서 전달된 같은 작업의 `request`·청크·`end`·`cancel`·credit는 요청별 송신 FIFO에 넣는다. RTC 역압을 기다리는 청크를 종료·취소가 추월하지 않는다. admission 전 취소는 즉시 미전송 본문을 폐기하고, 이미 시작한 작업은 앞선 프레임과 취소를 순서대로 보낸 뒤 슬롯을 반환한다. 완료된 작업의 늦은 credit는 폐기한다.

`node-datachannel` 0.33.4의 `sendMessage()`가 `false`를 반환해도 예외 없이 RTC 대기열에 프레임을 수용한 경우는 정상 송신이다. helper는 한 번만 전송하고 RTC 수용 ACK를 보내며, 이후 대기열에 기존 512KiB·10초 역압을 적용한다. 같은 프레임을 재송신하지 않는다. 반환값은 원격 앱의 작업 완료 ACK가 아니다. 설치본이 사용하는 [libdatachannel v0.24.5의 SCTP 송신 구현](https://github.com/paullouisageneau/libdatachannel/blob/v0.24.5/src/impl/sctptransport.cpp#L340-L359)과 실제 네이티브 부하 검사를 근거로 한다. 닫힌 채널·실제 송신 예외는 종료한다.

native ACK 대기 수는 연결마다 세어 여러 브라우저의 정상 전송이 서로의 한도를 소모하지 않게 한다. 정확히 64개까지 허용하고 65번째 송신은 해당 연결에서 거부한다. 종료 시 대기를 정리하며 늦은 ACK가 같은 ID로 재생성된 연결에 영향을 주지 않게 한다. 세 브라우저가 각각 HTTP 16개·WS 16개의 ACK를 기다리는 경우와 한 연결의 초과·종료·재생성을 호스트 회귀 검사로 확인했다.

이 변경은 로컬 앱·서버와 중앙 연결 프론트 양쪽에 적용해야 한다. 사용자가 저장소 루트에서 `npm run build` 후 `./mew restart`로 로컬 버전을 적용하고, `npm --prefix mewlink run deploy`로 중앙을 갱신한 뒤 공개 기기 페이지를 새로고침한다. 에이전트는 실행 중 인스턴스의 빌드·재시작·배포를 수행하지 않는다.

버전 1의 기존 선택 필드 `request.responseWindow`와 `response.responseWindow`는 1~8청크를 유지한다. 필드 없는 이전 서버에는 1청크 credit 방식을 사용하며, 필드 없는 이전 클라이언트 요청에는 초기 credit를 부여하지 않는다. 새 상대끼리는 아래 소비 기반 확장을 사용한다. 파일 전체를 Blob에 모아 전달하지 않으며 다운로드 크기는 기존 파일 API와 스트림에 따른다. 큰 WS 메시지는 순서 번호로 나누어 복원한다. HTTP의 조기 403과 취소 뒤에 도착한 청크를 버려 다른 작업을 끊지 않는다. 쓰기·명령은 자동 재전송하지 않고 결과가 유실되면 확인 후 다시 시도하도록 오류를 표시한다. 모든 스트림·가상 socket·RTC 자식 프로세스는 종료 시 정리하며 자식 helper는 부모 heartbeat가 10초 동안 없으면 종료한다.

### 소비 기반 HTTP·WebSocket 수신 제어

[ADR 0032](../decisions/0032-mewlink-consumer-flow-control.md)의 `flowControl: { version: 1, maxWindow: 256, separateStreams: true }`를 HTTP 요청·소켓 열기에 넣고 같은 기능을 응답·`open`에서 확인한 경우에만 사용한다. `maxWindow`는 8~256이며 `separateStreams`는 선택 기능이다. 미협상 상대에는 기존 HTTP 수신 창과 WS 전송을 사용하고 배치 credit를 보내지 않는다.

새 호스트도 처음에는 8청크만 보낸다. 최종 소비자의 `RemoteReceiveWindow`는 요청 왕복시간·청크 처리 비용·아직 도착하지 않은 credit·읽지 않은 바이트를 함께 계산해 최대 3MiB 안에서 창을 조절한다. HTTP는 실제 reader가 소비한 뒤에만 확장하고, 읽지 않는 응답에는 초기 96KiB만 보낸다. WS는 청크 검증·디코딩·조립과 메시지 dispatch 뒤에 처리 비용을 반영한다. credit는 소비 배치마다 다음 작업으로 미뤄 반환해 UI와 작은 메시지가 실행될 기회를 준다. 브리지의 `forward`는 최종 소비자의 credit를 통과시킬 뿐 자체 수신 확인을 추가하지 않는다.

협상된 `credit.count`는 1~256개를 한 프레임으로 반환한다. 서버의 `RemoteSendWindow`는 상한을 넘는 credit를 거부하고 취소·소켓 종료·권한 회수 때 대기를 해제한다. 브라우저도 창을 넘는 청크를 거부하며 닫힌 창의 예약된 반환을 버린다. 단일 메시지·업로드·RTC 송신·서버 바이트 예산은 유지한다. Base64 형식은 유지하면서 네이티브 변환을 우선하고 미지원 브라우저에는 단순 반복 변환을 사용한다.

2026-10-20 격리 네이티브 RTC·Chromium·MessagePort 두 단의 혼합 부하 검사에서 22.5MB WS 수신 중 작은 WS 지연 p95는 3ms, 작은 HTTP는 5.9ms, 화면 프레임 간격 최대는 16.8ms였다. 별도의 100ms 왕복 지연 모사에서 4MiB HTTP는 기존 수신 창 4.48초에서 확장 창 0.55초로 줄었다. CPU 4배 지연·읽지 않는 응답·느린 reader·16개 지속 WS와 HTTP 병행·구버전·취소·권한 회수도 검사했다. 수치는 해당 격리 실행의 결과이며 실제 사용자 기기·외부망의 전체 로딩시간은 아니다.

`@mew/ui/browser-storage-scope`는 로컬 이메일과 instance ID를 localStorage·IndexedDB 이름에 포함한다. 파일·탭·초안·에이전트 기록을 로컬 계정·A별로 분리하고 IndexedDB의 열린 연결도 범위가 바뀔 때 교체한다. 재생성 localStorage 캐시의 기존 origin 전체 예산·보관 기간은 여러 A에 공통 적용한다. 연결 종료는 현재 범위의 재생성 본문/전사/전송 기록을 정리하며 **미전송 초안·PDF 필기·열린 탭·설정은 보존**한다. [브라우저 저장 계약](browser-storage.md)을 따른다. 전역 fetch·WebSocket·localStorage를 교체하지 않는다.

## 검증과 남은 게이트

2026-10-22 요청 한도 batch 변경은 로컬 비공개 중앙 소스에 반영했으며 운영에는 미배포 상태다. 실제 Workers/D1 회귀 검사와 적용 전 운영 시간은 [중앙 배포 기록](../deployment/remote-central.md#2026-10-22-접속-지연-재측정과-요청-한도-batch)에 구분해 기록한다. 이 변경은 DB 호출 두 번을 제거하며 첫 접속 전체나 외부망 지연의 해소를 보장하지 않는다.

2026-10-20 소비 기반 전송·시그널링 재부착·연결별 native ACK 격리의 격리 회귀 검사를 통과했다. 중앙 런처·Worker는 배포하고 새 bootstrap의 익명 첫 접속·새로고침 6회와 80초 연결 유지를 확인했다. 로컬 mew 빌드·재시작과 로그인 후 실제 대화 시간 측정은 남아 있다. 배포 버전·측정 범위·DO 전파 확인은 [중앙 운영 검증](../deployment/remote-central.md#2026-10-20-운영-검증)을 따른다. 아래 이전 검증 기록의 미배포 표기는 각 기록 시점의 상태다.

2026-10-20 역할 분리의 메모리 ESM·캐시 비활성 Chromium 검사는 두 문서의 JS 본문을 194,482B에서 102,017B로 줄였음을 확인했다. CSS·Vite preload 보조 코드·HTTP 압축을 제외한 같은 minify 조건이며 운영 빌드·접속 시간 수치가 아니다. 일반 접속의 관리 코드·제공자 SVG와 앱 브리지의 JOSE·브라우저 키 구현은 포함되지 않았고 `/config` 요청은 0회였다. 새 그래프 1개와 기존 런처 11개, 역할 HTML·ASSETS 경계를 포함한 Workers 83개 검사가 통과했다.

역할 분리 뒤 실제 네이티브 P2P의 접속·신호 복구·새로고침과 별도 65초 lease·WS 1000건·혼합 HTTP·비밀번호/기기 회수 검사도 통과했다. CSS 기본→관리 순서를 고정하고 PC/모바일·밝은/어두운 테마의 기존 선언·계산 스타일을 대조했다. 루트·중앙·Vite 설정 타입 검사와 lint·문서 검사를 수행했으며 운영 빌드·배포·서버 재시작은 하지 않았다.

2026-10-20 WebSocket bootstrap·RTC 병렬 준비는 Workers 79개, 브라우저 연결 33개, 호스트·ticket inbox 14개, 모의 Chromium 런처 11개 검사로 확인했다. 실제 Workers/DO·네이티브 RTC·Chromium에서 첫 접속·신호 복구·새로고침의 HTTP launch 0회와 새 bootstrap WS를 관측했다. 별도 65초 이상 lease·WS 1000건·혼합 HTTP·비밀번호/기기 회수 검사도 통과했다. 루트·중앙 타입 검사, lint·문서 검사는 운영 반영과 구분하며 기존 lint 경고는 남는다. 새 경로의 운영 재배포·외부망 시간·0.5초 목표는 아직 검증하지 않았다.

연결·인증의 격리 검증:

2026-10-19 이번 변경의 로컬 타입 검사와 호스트·전송 관련 69개 테스트, 중앙 타입 검사와 Workers Vitest 9개 파일·56개 테스트를 통과했다. 네이티브 P2P 브라우저 검사 1개와 모의 런처의 신뢰/복구 검사는 구분해 실행했다. 신뢰 화면·브라우저 관리·회수 상태는 1100px/390px와 밝은·어두운 테마에서 확인했다. 이 결과는 아래에 보존한 이전 전체 `npm test` 실패 이력을 전체 통과로 바꾸지 않는다.

- `remote-access-network.test.ts`·`remote-access-registration-network.test.ts`: 읽기 전용 조회·명시적 준비·권한 거부·취소·중복 요청·기존 키 보존·검사 불가 환경과 Windows PowerShell 정책 모의 응답. 실제 방화벽·UAC는 변경하지 않는다.
- `remote-access-rtc-nat.test.ts`·`remote-access-rtc-nat-browser.test.ts`: UDP host 후보만 임시 매핑에 전달, 조기 연결 취소·종료 정리·주소 없는 진단, 실제 node-datachannel↔Chromium이 합성 UDP NAT의 매핑 후보만으로 데이터 왕복 후 임대 삭제. 실제 공유기·휴대폰 망 검증은 아니다.

- `server/remote-ui.test.ts`·`server/remote-ui-resource-browser.test.ts`: gzip의 실제 dispatcher 전송·Service Worker 해제, HTML·JS·CSS·동적 import·worker 실행, 구서버/미지원 브라우저·HEAD/Range·압축/취소·경로/크기/bootstrap 제한. 새 launch의 304·본문 0바이트, 호스트 분리·본문 변조·자원 갱신·7일 만료·잘못된 304·저장소 실패·오프라인 재사용 차단도 검증한다.
- `server/vite-resource-paths.browser.test.ts`: 별도 write:false Vite fixture에서 기존 절대 preload의 중복 요청을 재현하고, 실제 상대 base 설정의 로컬 `/browser`·P2P 접두사에서 모듈 요청 1회·CSS/이미지/worker 경로와 실행을 확인한다. 운영 빌드·dist를 변경하지 않는다.
- `src/app-bootstrap.browser.test.ts`·`src/utils/fontPreferences.test.ts`: 로그인 전 workspace 다운로드 제거·인증 결과 재사용과 계정 수명, 기본 글꼴의 외부 CSS 요청 제거·선택 글꼴의 한 번 준비. 상세 경계는 [앱 시작 계약](architecture.md#브라우저-첫-시작)을 따른다.
- 로컬 `mewlink/test/connection-screen.browser.test.ts`: 최초 HTML·PC/모바일·밝은/어두운 테마의 전체 화면/중앙 정렬, 모션 감소·숨은 탭 정지, 연결 전 글꼴 요청 0건, 연결 완료 전 화면 자원 준비 시작·메타데이터 요청 0건, 앱 전환·정지/실패 복구와 관리 화면의 지연 글꼴 로드.
- 로컬 `mewlink/test/startup.browser.test.ts`의 2026-10-19 검증은 실제 앱 bootstrap을 사용하는 모의 브라우저에서 저장 세션의 launch 1회·잘못된 경로 힌트 보정, 키 준비와 자원 준비 병렬화, 인증 대기 중 index 요청, 인증 결과 전달 시 추가 GET 0회·미전달 시 기존 조회, index 오류 안내와 복구의 동일 신원 확인을 확인했다. 당시 로컬 관련 65개 테스트·중앙 브라우저 6개와 실제 Workers/DO·네이티브 RTC P2P 1개, 양쪽 타입 검사·루트 lint·문서 검사를 통과했다. 현재 WebSocket bootstrap의 launch 0회 검증은 이 절 앞의 2026-10-20 기록을 따른다.
- `src/utils/remote-connection.test.ts`: 협상 전 인증 키 준비·ticket에서 재사용·종료 시 미완료 요청 취소, 기존 서명·시간 오차·재연결·세션 전달 경계.

- `mewlink-identities.test.ts`·`users-cli-identity.test.ts`: v1→v2 이관·owner 승인·허위 입력·기존/신규 사용자·비밀번호 없는 계정·요청과 처리 이력 한도·만료·회수·CLI 역할/삭제와 이메일 owner 복구.
- `remote-mewlink-auth.test.ts`: 실제 메모리 HTTP/WS dispatcher의 접근 요청·owner 승인·비밀번호 세션 없는 외부 로그인·로컬 역할·회수·재승인·인증 전환·지연 요청 차단과 비밀번호 변경 요구 보존. 본인 연결의 transport 신원·비밀번호 세션 검증, 임시 비밀번호·허위 대상·충돌·중복 요청과 이전 접속 권한 회수.
- `mewlink-identity-ui.test.ts`: 로그인·접근 요청·대기 후 진입, 즉시 승인·거절·해제와 본인 이메일 로그인 후 연결·실패 복구·PC/모바일 양 테마.
- 로컬 `mewlink/test/identity.test.ts`·`login.browser.test.ts`: 서명 신원·중앙 세션 결합·일회용 launch·위조/만료/로그아웃·익명 fallback·저장된 로컬 세션 독립·정확한 프레임의 로그인/로그아웃 복귀.
- 로컬 `mewlink/test/p2p.browser.test.ts`: 실제 Workers/D1/DO·네이티브 RTC·Chromium에서 서명 신원→접근 요청→owner 승인→비밀번호 없는 member→작업 허용→연결 해제 후 401. 중앙 작업 요청·앱 origin의 중앙 쿠키·장기 세션 헤더 노출은 0건.

프로젝트 타입 검사와 lint를 수행했다. 전체 `npm test`는 기존 계정별 에이전트 지침 기대값·Git 환경·DB·UI 실패와 종료되지 않는 Git 패널 테스트로 통과하지 못했다. 같은 기준 커밋의 분리 checkout에서도 계정별 에이전트 지침 기대값 실패를 확인했다. 위 인증·승인·원격 접속·UI 검증은 개별 실행으로 확인했으며 전체 테스트 통과로 표현하지 않는다.

- `remote-local-auth.test.ts`: 익명 UI·인증 경계, 기존 세션 재개·임시 비밀번호 변경·로그아웃·계정 전환, 지연된 이전 인증 요청 차단, 만료·삭제·리셋·권한·IP 실패 한도와 일반 HTTP 쿠키 인증 회귀.
- `remote-trusted-device.test.ts`: 신뢰 전 bearer 폐기·키 지문 결합·토큰 해시 저장·프로세스 재시작 후 재개, 90일 미사용 만료·활성 검사 하루 최대 1회 연장·재개 즉시 연장, 외부 승인 회수/재승인·계정 삭제와 지연된 신뢰 요청 차단. 2026-10-19 `node --experimental-strip-types --test server/remote-trusted-device.test.ts server/remote-local-auth.test.ts server/remote-mewlink-auth.test.ts server/auth.test.ts`의 29개 테스트, 타입 검사와 변경 파일 lint를 통과했다.
- `remote-login-ui.test.ts`: PC·모바일의 필수 로그인·잘못된 비밀번호·임시 비밀번호 변경·저장된 임시 세션 흐름.
- `remote-access-inbox.test.ts`: 인증 대기 중 작은 메시지 1000개 FIFO, UTF-8 바이트·항목 상한, 처리 중 종료·실패 뒤 미처리 작업 폐기.
- `remote-access-rtc-buffer.test.ts`: 네이티브 송신의 정상 대기 반환은 한 번만 수용 ACK, 실제 예외는 종료.
- `remote-connection.test.ts`: 연결 handshake와 로컬 키·offer 준비의 병렬 실행·challenge 전 전송 차단·종료 중 준비 취소와 오류 처리, 실제 서명 토큰으로 브라우저 ticket·answer의 1·2초 미래 시각 허용, 3초 미래 시각 거부와 동기화 안내, 만료 토큰 거부를 검증.
- `remote-access-rtc-state.test.ts`·`remote-connection.test.ts`: 양끝의 15초 복구·기한 고정·같은 transport 유지·즉시 종료 조건·복귀 갱신·타이머 없는 중앙 요청 응답과 연결 ID 검사·인증 전 대기·listener 정리.
- `remote-access-socket-close.test.ts`·`remote-transport-callbacks-ui.test.ts`: 정상 소켓 종료 중 늦은 메시지, 로컬 송신 실패, 앱 이벤트 예외와 Blob 읽기 중 닫기에서 다른 HTTP·소켓 유지; 잘못된 프로토콜은 전체 종료.
- `remote-forward-order.test.ts`: RTC 역압 중 종료·취소 추월 방지, admission 전 취소와 완료 후 늦은 credit 폐기.
- 로컬 `mewlink/test/signaling.test.ts`: DO hibernation·heartbeat·서버 갱신 요청·응답 전 lease 불변·구버전 호환·lease 갱신·만료 회수와 비동기 인가 검사 중 탭 종료의 영향 격리. 브라우저 registry의 owner·Origin 검사, 같은 키 다중 탭 회수·다른 브라우저/호스트 보존과 pending·늦은 신뢰 등록 경합도 검증한다.
- `server/remote-signaling-state.test.ts`와 로컬 `mewlink/test/signaling-performance.test.ts`: SQLite 초기화·복원·회수의 단조 병합·실패 시 rollback, 실제 Workers/DO 시그널링의 기기·브라우저 D1 조회 제거와 외부 신원의 세션 검사 유지, hibernation 복원·관리 API의 D1 갱신 실패 뒤 회수 유지·초기 목록 조회 실패의 연결 차단을 검증한다. 0.5초 최초 접속이나 외부망 성능을 검증하는 검사는 아니다.
- 로컬 `mewlink/test/browser-consent.test.ts`: 설치된 앱의 브리지에서 `/api/auth/remote-device`와 query를 붙인 요청을 거부하고 일반 로그인·로그아웃은 유지한다.
- 로컬 `mewlink/test/p2p-stability.browser.test.ts`: 실제 Workers/D1/DO·네이티브 RTC·Chromium에서 중앙 로그인 없이 저장된 로컬 세션 재개, 정상 WS 메시지 1000개, 256KiB 다운로드 40개와 2MiB 업로드·취소, 브라우저의 20초 갱신 타이머를 중단한 채 65초 이상 중앙 요청으로 lease 갱신 후 동일 UI 유지·모바일 너비의 후속 전송·로컬 비밀번호 리셋 후 작업 차단과 기기 폐기. 중앙 작업 요청 0건. 기기 절전·외부 모바일 네트워크 검사는 아니다.
- 로컬 `mewlink/test/recovery.browser.test.ts`: 실제 launcher의 복구 상태 전환에서 기존 iframe·미저장 입력 유지와 메타데이터 요청 0건.
- 로컬 `mewlink/test/trusted-browser.browser.test.ts`: 모의 중앙·RTC 응답을 사용한 Chromium에서 비추출 키·같은 호스트 키 재사용, 새 연결로 전송 교체 후 같은 iframe·초안 유지, 명령 1회 실행, 새 bearer의 sessionStorage 한정, 만료 시 빈 세션 응답 뒤 이전 계정 재활성화 차단과 `access-revoked`의 토큰 삭제·재시도 중지를 검증했다. 실제 망 전환·네이티브 RTC 검사는 아니다.
- `server/mewcat-assistant-reconnect-ui.test.ts`는 뮤펫 대화의 읽기 구독 복구·대화 보존과 입력 재전송 금지를 검증한다. 제거한 DOM 브라우저의 재접속 검사는 로그인 영상의 `server/login-desktop.test.ts`와 `src/components/login-desktop-viewer.browser.test.ts`로 대체했다. 포트 전용 origin·HTTP·WS·실제 Service Worker/P2P 전송은 `server/port-preview-browser.test.ts`에서 검증한다.
- `remote-transport-admission-ui.test.ts`: 실제 Chromium·메모리 HTTP/WS dispatcher로 앱의 지속 WS 4개와 앱·자원의 HTTP 48개를 함께 실행해 실제 채널의 진행 작업이 16개를 넘지 않고 모두 완료하는지, 대기 중 HTTP·WS 취소와 연결 종료 시 미전송 작업 정리를 검증.
- `remote-response-window-ui.test.ts`: 실제 브라우저 전송과 메모리 HTTP dispatcher, 왕복 100ms를 모사한 86,023B 응답의 이전 방식 약 937ms → 수신 창 약 110ms, 미소비 응답 8청크 상한과 이전 서버 호환. 실제 외부망 속도의 보장은 아니다.
- `remote-access.test.ts`: 선택 수신 창 검증·8청크 역압·이전 클라이언트 호환, 허용 경로·프레임 크기, 서명/만료/대상, 헤더 위조, JSON·바이너리, 기존 WS 문맥과 계정 회수.
- 로컬 `mewlink/test/worker.test.ts`: 실제 Workers/D1/DO의 원자적 등록·관리 세션·익명 local-mode launch·origin·역할·재사용 차단·서명 시그널링·hibernation·중앙 로그아웃과 로컬 사용 분리·기기 폐기.
- 로컬 `mewlink/test/oauth.test.ts`: Google·GitHub·Apple·이메일 OIDC 응답 fixture의 state·PKCE(지원 흐름)·nonce·JWKS·호스트 전용 세션. 실제 제공자 로그인을 대신하지 않음.
- 로컬 `mewlink/test/p2p.browser.test.ts`: HTTPS Workers 중앙 + 등록된 네이티브 A + 실제 Chromium, P2P HTML/CSS/JS/동적 import/이미지/worker와 작업 요청, 중앙 쿠키 없는 공개 주소 접속·잘못된/올바른 로컬 비밀번호·미인증 작업 차단·세션 헤더 비노출과 앱 realm JSON 가로채기에서도 자격증명 미노출·새로고침·두 탭과 중앙 작업 요청 0건.
- `remote-ui.test.ts`: 설치 UI의 P2P 접근, 직접 HTTP·비밀 파일·탐색·외부 symlink 차단.
- `remote-access-files.test.ts`: 실제 파일 API의 읽기/저장, 읽기 전용·권한 회수·임시 비밀번호 차단, 계정별 작업 루트.
- `remote-access-browser.test.ts`: 1MiB 다운로드·POST·조기 403·취소, native 이미지·Range, 큰 바이너리 WS, 중앙 작업 API 요청 0건.
- `remote-access-storage.test.ts`와 공통 저장소 테스트: 계정·A별 격리와 origin 캐시 예산·초안 보존.
- `remote-access-ui.test.ts`: 등록 오류·등록 완료·로컬 인증 안내, PC/모바일 화면과 조작.

브라우저 자동 검증은 **동일 호스트**에서 수행했다. 추가로 Windows Chrome↔WSL2 mirrored의 동일 PC 네이티브 DataChannel 연결을 검증했다. 실제 OAuth/OIDC 제공자, 다른 NAT·LTE/5G·Windows/WSL·macOS·휴대폰 절전/망 전환, 실제 터미널·에이전트·DB·브라우저·데스크톱의 동시 사용, 악성 콘텐츠·부하·키 교체/복구와 보안 검토는 [작업 기록의 출시 기준](<../work/remote-access.md>)으로 남긴다. 로컬 검증으로 직접 연결 성공률이나 실서비스 지원을 확정하지 않는다.
