---
title: "mewlink Cloudflare 배포"
description: "mew.run 기기 접속·대시보드·등록·OAuth·신뢰와 회수의 배포를 안내한다. 소비 기반 전송·시그널링 재부착·역할별 런처·공개 코드 캐시·브리지 사전 준비와 요청 한도 batch, 접속 지연 측정·구버전 호환·최초 Worker 배포와 D1 ID 불일치 복구, 기존 키·D1/DO·데모 자산 보존과 검증·복귀 경계를 설명한다."
created: "2026-10-07"
updated: "2026-10-23"
---

## 2026-10-23 공개 런처 캐시·브리지 사전 준비·초기 청크

**코드와 격리 검증 단계이며 운영에는 미배포 상태다.** 대기 화면부터 Mew 표시까지의 다운로드·직렬 준비를 줄인다. [공개 런처 캐시와 브리지 준비 계약](../development/remote-access.md#중앙-공개-런처와-설치된-호스트-코드의-캐시-구분), [초기 청크 계약](../development/architecture.md#브라우저-첫-시작), [ADR 0050](../decisions/0050-mewlink-startup-preparation.md)이 범위와 보안 경계를 정의한다.

| 변경 | 적용 위치·검증 범위 |
| --- | --- |
| 해시 공개 JS/CSS의 브라우저 캐시 | 중앙 Worker 변경. 작은 번들 fixture의 첫 JS/CSS 전송 389B/329B가 후속 문서에서 0B/0B였고 새 해시는 390B/330B를 다시 받았다. 503 뒤 다음 요청의 200도 확인했다. 운영 런처의 크기나 초 단위 개선 수치가 아니다. |
| 앱 브리지 사전 준비 | 중앙 connect 런처 변경. 공개 HTML의 origin을 먼저 확인하고 bootstrap 대기와 숨은 브리지 다운로드를 겹친다. 각각 300ms 지연의 fixture에서 기존 887ms→조기 396ms였다(각 1회·실제 망/ICE 제외). 기기 context·포트·설치 UI 요청은 기존 검증 경계를 따른다. |
| 초기 정적 청크 묶음 | 로컬 Mew UI의 다음 빌드에 적용. 실제 시작 코드·모의 Workspace fixture의 초기 JS 요청 8→3개, 로그인까지 9→4개. 실제 작업 화면 전체의 청크 수와 접속 시간은 별도로 측정해야 한다. |

검증은 중앙 캐시/역할 페이지 Workers 검사 7개·캐시 Chromium 1개, 준비 취소·위조 ready·설정 불일치·구버전·같은 계정 복구를 포함한 startup 브라우저 12개 경로를 분할 실행해 확인했다. 실제 Workers/DO·네이티브 RTC·Chromium의 P2P 통합 1개도 통과했다. 루트의 초기 청크·인증 경계·P2P 자원 압축/재검증·상대 preload 경로 검사 5개, 루트·중앙 타입 검사와 변경 파일 lint, 문서 description/링크 검사를 통과했다. 보안 검토에서도 인증·호스트 코드 재검증·정확한 탭/토큰 확인이 유지됨을 확인했다.

사용자가 기존 중앙 절차로 런처 자원과 Worker를 함께 배포하고, 로컬 Mew UI도 다음 빌드·적용을 수행한다. 중앙 변경만 적용하면 이전 호스트와 계속 연결되지만 로컬 청크 묶음은 바뀌지 않는다. D1 migration·기기 재등록·키 교체는 필요 없다. HTML·키·인증 API·Service Worker와 호스트 코드의 현재 P2P 재검증을 캐시 대상으로 넓히지 않는다. 비공개 중앙 소스·테스트의 공개 Git 제외는 유지한다.

배포 후 새 브라우저와 후속 방문에서 첫 HTML→bootstrap→P2P 준비→실제 Mew 화면 표시를 나눠 다시 측정한다. 런처 캐시는 따뜻한 방문에서, 브리지 중첩은 첫 방문에서도 효과 후보이며 외부망·휴대폰에서의 실제 단축량은 미측정이다. 변경을 되돌릴 때는 Worker와 역할별 HTML/청크를 일치시킨다. HTML을 저장하지 않으므로 다음 탐색은 배포된 HTML이 선택한 해시 파일을 사용하지만 이미 열린 탭은 새로고침이 필요할 수 있다.

## 2026-10-22 접속 지연 재측정과 요청 한도 batch

**요청 한도 batch는 로컬 비공개 중앙 소스의 변경이며 운영에는 미배포 상태다.** 기존 운영 주소를 새 Chromium 컨텍스트에서 열고 익명 로컬 로그인 화면의 비밀번호 필드가 보일 때까지 측정했다. 같은 탭의 후속 방문 두 번도 비교했다. 저장된 로그인 세션·로그인 후 workspace·휴대폰 외부망은 포함하지 않는다.

| 적용 전 측정 | 첫 방문 | 후속 방문 1 | 후속 방문 2 |
| --- | --- | --- | --- |
| 로그인 화면까지 | 4.478초 | 2.220초 | 2.211초 |
| 중앙 challenge 수신 | 2.358초 | 1.181초 | 1.073초 |
| ticket 수신 | 2.852초 | 1.723초 | 1.555초 |
| 호스트 answer 수신 | 3.032초 | 1.890초 | 1.704초 |

모든 시각은 탐색 시작 기준이다. 세 번 모두 새 WebSocket bootstrap을 사용했고 `/central/launch`·`/central/key`·`/config` HTTP 요청은 없었다. 첫 방문은 HTML·런처 코드·앱 프레임 준비가 더 오래 걸렸고, 후속 방문에도 challenge·ticket·answer 대기가 남았다. 이 관측만으로 개별 DB 쿼리·네트워크·DO 실행의 소요 시간을 확정하지 않는다.

중앙 Worker의 bootstrap 경로는 기기 조회 뒤 요청 한도를 세 번 순서대로 D1에 요청했다. `mewlink/src/store.ts`의 `limitedBatch`와 `mewlink/src/worker.ts`의 호출을 통해 세 검사를 한 번의 DB 호출로 묶었다. 한도·검사 순서·거절 후 카운터·만료·구버전 경로는 [현재 접속 계약](../development/remote-access.md#연결-인증과-회수)을 따른다. [D1 batch 계약](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)에 따라 SQL은 같은 트랜잭션에서 순서대로 실행한다.

격리 검증에서 `rate-limit.test.ts`·`bootstrap.test.ts`·`worker.test.ts`·`signaling-performance.test.ts`·`signaling.test.ts`의 46개 검사와 실제 Workers/DO·네이티브 RTC·Chromium의 `p2p.browser.test.ts` 1개가 통과했다. 중앙 타입 검사·변경 파일 lint·문서 description/링크 검사도 통과했으며 기존 lint 경고 3개는 유지했다. 이 결과는 위 운영 측정 이후 수정본의 로컬 검증이다.

기존 중앙 배포 절차로 사용자가 Worker를 반영한다. 이번 변경만 적용할 때는 로컬 mew UI 빌드·호스트 재시작·D1 migration·재등록이 필요 없다. 비공개 `mewlink/`의 소스와 테스트는 계속 공개 Git에서 제외한다. 이전 Worker로 복귀해도 DB 스키마와 카운터 키는 같다. 배포 후 동일 조건의 첫 방문·후속 방문을 다시 측정해야 하며, DB 왕복 두 번 제거를 실제 초 단위 개선이나 0.5초 달성으로 표현하지 않는다.

## 소비 기반 전송과 시그널링 재부착 적용

[표시용 도구 이벤트](../decisions/0031-agent-display-events.md)·[소비 기반 전송](../decisions/0032-mewlink-consumer-flow-control.md)·[시그널링 재부착](../decisions/0033-mewlink-signaling-resume.md)는 적용 위치가 다르다. 전사 투영·선표시와 송신 제어는 로컬 서버, 앱의 수신 제어는 로컬 UI 빌드, 각 브리지와 중앙 시그널링은 Mewlink 런처·Worker가 담당한다. 중앙만 배포하면 기존 호스트와 계속 연결되지만 로컬 서버·UI 변경까지 적용되지는 않는다.

중앙과 로컬 실행본을 모두 적용한 뒤 새 기기 페이지를 열어 기능 협상을 확인한다. 미협상 상대는 기존 16개 공통 슬롯·HTTP 수신 창·전체 RTC 복구를 사용한다. 새 상대는 HTTP·WS 슬롯 분리와 소비 기반 수신 창, 현재 lease 안의 같은 RTC 시그널링 재부착을 사용한다. 실제 연결의 회수·로그아웃·만료 검사를 생략하지 않는다.

이 변경에는 D1 migration·기기 재등록·키 교체가 필요 없다. DO는 분리된 시그널링 상태를 기존 SQLite에 추가하며 최대 8개와 기존 만료 시각으로 정리한다. 구버전 복귀 시 회수의 DO·D1 보존 규칙은 아래 절을 따른다. 새 재부착 상태가 구버전에서 사용되지 않으면 기존 전체 재연결로 복귀하며, 소켓 상태 전체를 잃는 플랫폼 강제 종료까지 무중단을 보장하지 않는다.

2026-10-20 중앙 변경 배포에서는 기존 운영의 데모 HTML과 로컬 자산이 같은지 확인한 뒤 데모 파일 565개를 보존했다. `mewlink/`에서 런처를 빌드하고 데모 파일을 복원·해시 대조했다. 기존 Worker·D1 ID·공개 origin·서명 공개 키를 확인하고 프로젝트 Wrangler의 `deploy --dry-run --keep-vars` 뒤 `deploy --keep-vars`로 배포했다. 초기 설정·새 DB 생성·secret 업로드와 루트 앱·데모 재빌드는 수행하지 않았다. 일반 초기 설치는 아래 절차를 따른다.

### 2026-10-20 운영 검증

활성 버전은 `35616b2c-18ad-4315-bf9f-6f2144aac36f`이며 12:01:12 UTC에 100% 배포했다. 서명 공개 키와 기존 데모 HTML이 배포 전과 같은 것을 확인했다. 이전 버전은 `4c888aac-7ce5-4b95-b385-b513333f34a4`다. 로컬 mew 서버는 빌드·재시작하지 않았으므로 대화 표시용 전송·호스트 송신 창·앱 수신 창·native ACK 격리의 운영 적용은 남아 있다.

업로드 직후에는 일부 DO가 `context`·`signalResume` 없는 이전 challenge를 보내 HTTP launch로 우회했다. 이후 새 challenge를 직접 확인한 뒤 아래 브라우저 검사를 다시 수행했다. 배포 100% 표시는 이 응답 검증을 대신하지 않는다. Worker와 DO의 신구 코드가 전파 중 섞일 수 있으므로 실제 bootstrap challenge를 확인한다. 같은 클래스의 코드 수정에 별도 DO 마이그레이션은 필요 없다. [코드 업데이트](https://developers.cloudflare.com/durable-objects/platform/known-issues/#code-updates) · [기존 클래스 코드 배포](https://developers.cloudflare.com/durable-objects/reference/durable-object-class-migrations-legacy/)

| 검사 | 실제 결과·범위 |
| --- | --- |
| 새 Chromium 세션 3개의 첫 접속·새로고침 | 6회 모두 WebSocket bootstrap. `/central/launch`·`/central/key`·`/config` HTTP 각 0회, 연결 오류 0건 |
| 익명 로컬 로그인 화면까지 | 첫 접속 1.95~2.85초·중앙값 2.35초, 새로고침 1.76~2.30초·중앙값 2.19초. 현재 측정 환경이며 0.5초 목표 미달 |
| 마지막 연결 유지 | 80초·서버 갱신 요청 7회, 추가 시그널링 연결·RTC 재접속·오류·복구 안내 0건 |
| 격리 회귀 | Workers 93개, 소비 기반 전송 관련 61개, 시그널링 복구 관련 52개·호스트 startup 13개 통과. 범위가 겹치므로 합산하지 않음 |
| 브라우저 회귀 | 14개 경로를 분할 실행해 통과. 실제 RTC·양쪽 신호 순단·정상 종료 뒤 전체 재연결·65초 갱신·혼합 전송·회수 포함 |
| 정적 검증 | 로컬·중앙 타입 검사, lint와 문서 description·링크 검사. 기존 lint 경고는 유지 |

이 운영 검사는 익명 로그인 화면과 연결 유지까지만 확인했다. 로그인 후 실제 에이전트 대화의 전체 표시 시간과 로컬 수정 적용 후의 외부망 순단·모바일 성공률은 포함하지 않는다. 격리 데이터 검사에서 최근 전사 20개의 표시용 전송은 합계 65,539,527바이트에서 7,816,900바이트로 줄었고 원본 저장은 유지했다. 100ms RTT 모사 4MiB 전송과 혼합 RTC 부하 결과는 [원격 접속 계약](../development/remote-access.md#소비-기반-httpwebsocket-수신-제어)을 따른다.

## 역할별 런처 HTML·청크 적용

[ADR 0029](../decisions/0029-mewlink-launcher-entries.md)의 중앙 빌드는 connect·app·dashboard HTML과 `/launcher/`의 역할별 JS/CSS를 함께 생성한다. Worker가 해당 HTML을 직접 선택하므로 동적 라우터를 추가로 받지 않는다. HTML의 CSS·정적 의존성 preload는 Vite가 구성하고 앱 브리지는 HTML의 두 공개 origin 설정을 사용해 `/config` 왕복을 생략한다.

역할 HTML·청크·Worker는 기존 중앙 배포 절차로 함께 반영한다. 이 역할 분리만으로 로컬 mew를 다시 빌드하거나 재시작할 필요는 없으며, 앞선 WebSocket·호스트 RTC 변경의 로컬 적용 조건은 아래 절을 따른다. 공개 기기·내부 launch의 GET/HEAD가 redirect 없이 200인지, 일반 연결이 관리 코드·제공자 SVG를 받지 않는지 확인한다. 기존 `launcher.js`·`launcher.css`는 이전 HTML의 호환 경로로 유지한다. 비공개 중앙 코드의 Git 제외와 사용자 빌드·배포 원칙은 변하지 않는다.

## WebSocket bootstrap과 RTC 병렬 준비 적용

[ADR 0028](../decisions/0028-mewlink-websocket-bootstrap.md)의 새 런처는 별도 HTTP launch 없이 기기 WebSocket에서 연결을 시작하고 중앙 공개 키도 같은 challenge에서 받는다. 호스트는 ready 뒤 RTC를 준비하면서 최종 ticket을 검증한다. 인증 전 작업 차단·브라우저 키 증명·회수·lease·중앙/앱 origin 분리는 유지한다.

중앙 Worker·런처와 로컬 호스트 코드를 사용자가 함께 적용한다. 중앙의 `npm run build`는 정적 런처만 만들며 Worker 배포를 대신하지 않는다. 기존 배포 절차로 중앙을 재배포하고 로컬 호스트도 업데이트·재시작한다. 추가 D1 마이그레이션·등록·키 교체는 필요 없다. 에이전트는 빌드·배포·재시작하지 않으며 중앙 소스는 공개 Git에서 계속 제외한다.

구버전 브라우저의 HTTP launch·토큰 소비와 기존 호스트의 ready/ticket 흐름은 유지한다. 새 브라우저가 bootstrap 문맥을 받기 전 연결에 실패하면 기존 HTTP 경로로 복귀할 수 있다. 잘못된 문맥·회수·문맥을 받은 뒤 실패에는 복귀하지 않는다. 되돌릴 때는 이 변경과 별개인 [DO·D1 회수 보존 규칙](#시그널링-인가-상태의-보존과-복귀)을 함께 지킨다.

적용 후 캐시 없는 첫 접속·새로고침에서 `/central/launch`와 `/central/key` HTTP가 없는지, 연결·앱 표시·회수·재연결이 동작하는지 확인한다. 격리 테스트 통과는 운영 배포 완료나 0.5초 달성을 뜻하지 않는다. 외부 기기·모바일 망의 시간은 별도로 측정한다.

## mew.run 운영 주소와 이전 등록 유지

기기 접속은 `https://mew.run/{username}/{device}`, 기기 대시보드는 `https://mew.run/{username}`을 사용한다. 대시보드는 중앙 로그인한 본인에게만 기기 목록을 표시하고, 기기 접속은 중앙 로그인 없이 로컬 mew 로그인 화면을 연다. 이전 `/dashboard`와 기기 링크는 호환 이동을 제공한다.

같은 `mewlink` Worker에 `mew.run`·`app.mew.run`을 Custom Domain으로 연결한다. `app.mew.run`은 같은 site의 별도 실행 origin이며 중앙 세션·계정 API를 제공하지 않는다. 기존 `mew.saens.kr`은 기기 등록과 상시 연결 및 제공자 콜백을 위해 유지한다. 다음 설정과 D1 migration을 적용한다.

| 설정 | 운영값·역할 |
| --- | --- |
| `CENTRAL_ORIGIN` | `https://mew.run` |
| `APP_ORIGIN` | `https://app.mew.run` |
| `LEGACY_CENTRAL_ORIGINS` | `https://mew.saens.kr`; 명시한 이전 origin만 호환 |
| `EMAIL_IDENTITY_ISSUER` | `https://mew.saens.kr`; 기존 이메일 계정 namespace 보존 |
| `OAUTH_ORIGIN` | `https://mew.saens.kr`; 기존 Google·GitHub 등 제공자 callback 유지 |
| `0004_oauth_bridge.sql` | 브라우저에 결합한 일회용 로그인 이전 요청·증명 저장 |
| `0005_browser_access.sql` | 호스트별 신뢰 브라우저 이름·시각·영속 접근 회수 기록 |

기존 로컬 등록 파일의 origin·instance ID·키를 수동 변경하거나 서명 키·DB를 새로 만들지 않는다. 중앙은 실제 host origin의 서명 audience·ticket issuer와 승인 신원을 유지한다. OAuth는 위 고정 origin의 기존 콜백을 사용하고, 60초 일회용 증명과 새 관리 origin의 브라우저 쿠키를 함께 확인한 뒤 관리 세션을 발급한다. 아래 제공자 설정의 `mew.saens.kr` 콜백은 이 호환 운영값이다. 새로 설치하는 독립 서비스는 자신의 OAuth origin을 등록한다.

Mewlink의 UDP 범위는 `55000–55031`이다. 새 로컬 실행본은 owner의 기기 등록 때 Windows 수신 규칙을 준비하고, 기존 등록은 **Mewlink → 연결 준비**로 키를 보존하며 복구한다. 필요할 때만 UAC를 요청하고 상태 조회·서버 시작·외부 접속은 승격하지 않는다. helper는 지연된 직접 연결에 한해 지원 공유기의 임시 PCP/NAT-PMP/UPnP 매핑도 시도한다. 데이터 전송은 WebRTC 직접 연결만 사용한다. 지원 조건·정리·수동 회수 범위는 [원격 접속 계약](../development/remote-access.md#wsl-외부-접속과-udp-수신)을 따른다.

2026-10-15 Cloudflare MCP로 두 신규 Custom Domain을 연결하고 중앙 Worker와 additive D1 migration을 운영 반영했다. 새 익명 모바일 Chromium에서 `mew.run/saens`는 기기 없이 로그인 화면을, `mew.run/saens/home`은 기존 호스트의 로컬 로그인 화면을 표시했다. 이전 기기 URL의 이동·기기 목록 API의 비로그인 401·앱 origin의 중앙 API 차단도 확인했다. 제공자 실제 로그인 완료와 외부 LTE·WebKit은 별도 확인이 필요하다. WSL UDP 규칙 추가는 관리자 권한 부족으로 거부되어 아직 적용하지 않았다.

2026-10-16 네트워크 자동 준비·등록/복구 UI와 임시 NAT 매핑의 격리 검사를 추가했다. 새 준비 API·UI는 로컬 업데이트 적용이 필요하며 이번 변경을 위해 중앙 재배포는 필요하지 않다. 현재 PC의 실제 Windows 규칙 적용과 외부 폰 연결 성공은 아직 확인하지 않았다.

## 브라우저 로그인 유지와 접근 회수 적용 (2026-10-19)

이 변경은 **로컬 mew 서버·앱 업데이트와 중앙 프론트·Worker·D1 `0005_browser_access.sql` 적용**이 모두 필요하다. 사용자가 로컬 변경을 빌드·재시작하고 `mewlink/`에서 기존 `npm run deploy`로 중앙을 배포한다. 기존 D1·서명 키·호스트 instance ID는 유지한다. 에이전트는 빌드·배포·재시작하지 않는다. 중앙 소스는 공개 mew Git에서 계속 제외되므로 공개 코드 커밋만으로 전달되지 않으며, 별도 보관한 중앙 사본에도 같은 수정과 마이그레이션을 적용해야 한다.

연결 후 로컬 비밀번호 또는 승인된 외부 계정으로 로그인하고 **이 브라우저에서 로그인 유지 → 기억하기**에 동의하면 브라우저 키에 결합한 90일 미사용 세션을 보관한다. 중앙 origin의 IndexedDB 키는 호스트 instance별로 나누며 같은 호스트의 탭끼리 공유한다. 이후 중앙 로그인 쿠키가 끝나도 현재 호스트 자격증명이 유효하면 자동 재개한다. 60초 연결 lease·20초 갱신·중앙 단절 시 작업 종료는 유지하며, 새 launch로 최대 30초 대기의 자동 재연결을 시도한다. 앱 iframe·미저장 입력은 같은 계정·인증 수단 확인 후 이어 쓰고 진행 중 요청·저장·명령은 재실행하지 않는다. 원격 데스크톱의 별도 영상·입력 peer는 수동 재연결 범위를 유지한다. [인증·복구 계약](../development/remote-access.md#브라우저-로그인-유지와-접근-해제).

중앙 owner는 자신의 대시보드에서 기기의 **접속 브라우저 관리**를 열고 이름·최근 접속·연결 상태를 확인한 뒤 **접근 해제**할 수 있다. 최초 등록 시각은 조회 API에서 제공하며 현재 목록 UI에는 표시하지 않는다. 해제하면 해당 호스트·키의 모든 탭을 즉시 끊고 같은 키의 새 연결을 거부한다. 다른 브라우저와 다른 호스트의 접속은 유지한다. 회수 기록은 D1에 남기며 재신뢰로 재활성화하지 않는다. 호스트 자체의 **등록 해제**와 구분한다. 브라우저 키를 지우고 유효한 계정으로 새 키를 인증하는 것은 새 브라우저 등록이므로 인증 수단 탈취에는 로컬 비밀번호 변경·외부 승인 회수도 필요하다.

중앙 타입 검사와 Workers Vitest **9개 파일·56개 테스트**, 로컬 타입 검사와 호스트·전송 관련 **69개 테스트**를 통과했다. 중앙 검증에는 owner·Origin 검사, 같은 키의 여러 탭 회수·다른 브라우저/호스트 격리, pending/재등록 경쟁과 앱 브리지의 동의 우회 차단을 포함한다. 별도의 네이티브 P2P 브라우저 검사와 모의 런처·RTC 응답을 사용한 신뢰/복구 Chromium 검사도 수행했으며 PC 1100px·모바일 390px의 양 테마 화면을 확인했다. D1의 운영 적용은 아래 기록을 따른다. 중앙 코드 배포·로컬 적용과 휴대폰 절전·외부망 자동 복구는 아직 확인하지 않았다. 검증별 범위는 [원격 접속](../development/remote-access.md#검증과-남은-게이트), 저장 경계와 위험은 [보안](../operations/security.md#브라우저-로그인-유지와-회수)을 따른다.

2026-10-19 06:01:26 UTC에 운영 D1 `mewlink`에 `0005_browser_access.sql`을 적용했다. 적용 이력과 `browser_access`의 6개 열·`(instance, id)` 복합 기본 키·`instances(id)` 참조를 원격 조회로 확인했고, 미적용 마이그레이션은 0건이다. 이번 작업에서는 DB 스키마만 적용했으며 중앙 Worker 코드 배포와 로컬 빌드·재시작은 수행하지 않았다.

## 기기 접속의 인증 경계 (2026-10-12)

Mewlink 로그인은 기기 등록·목록·삭제와 중앙 계정 관리에 사용한다. 등록된 `/<유저이름>/<기기이름>` 주소는 중앙 로그인 없이 WebRTC 연결을 시작하고, 해당 컴퓨터의 mew 이메일·비밀번호로 로그인한다. 중앙 계정 ID와 로컬 계정을 연결하는 기존 멤버 접근은 신규 접속에 사용하지 않는다. 자세한 현재 계약은 [원격 접속](../development/remote-access.md)과 [ADR 0207](../history/decisions/0207-mewlink-device-access-local-auth.md)을 따른다.

이 인증 전환은 중앙 `mewlink` 재배포와 로컬 mew 서버·UI 업데이트를 함께 적용해야 한다. 기존 등록 키·instance ID는 유지하며 재등록·서명 키 교체·DB 삭제를 하지 않는다. 중앙과 로컬 버전이 다르면 기존 중앙 계정 권한으로 접속을 우회하지 않고 연결을 거부한다. 중앙 소스는 계속 공개 mew Git에서 제외한다. 배포·빌드·서버 적용은 사용자가 실행한다.

## 내가 할 일

**처음에는 Google 또는 GitHub 하나만 설정해도 된다.** Apple은 나중에 추가해도 된다.

### 1. 설정 파일 만들기

터미널에서 실행한다.

```bash
cd /home/saens/dev/mew/mewlink
npm ci --ignore-scripts
npm run setup
```

### 2. 로그인 버튼에 쓸 값 받기

**Google을 쓰려면**

1. [Google 콘솔](https://console.cloud.google.com/) → 프로젝트 선택 또는 생성.

2. **Google Auth platform → Branding → Get started** → 앱 이름 `mewlink`와 이메일 입력.

3. **Audience → External** 선택 → **Test users**에 내 Google 계정 추가.

4. **Clients → Create client → Web application** 선택. **Authorized redirect URIs**에 아래 주소 입력.

   `https://mew.saens.kr/auth/google/callback`

5. 생성된 **Client ID**와 **Client secret** 복사.

**GitHub를 쓰려면**

1. [GitHub 설정](https://github.com/settings/developers) → **OAuth apps → New OAuth App**.

2. 아래처럼 입력하고 **Register application** 클릭.

   | 입력칸 | 넣을 값 |
   | --- | --- |
   | Application name | `mewlink` |
   | Homepage URL | `https://mew.saens.kr` |
   | Authorization callback URL | `https://mew.saens.kr/auth/github/callback` |

3. **Client ID** 복사 → **Generate a new client secret** 클릭 → 나온 secret 복사.

**Apple도 쓰려면 — Apple Developer Program 가입 필요**

1. [Apple 개발자 계정](https://developer.apple.com/account/) → **Membership details**에서 **Team ID** 복사.

2. **Certificates, Identifiers & Profiles → Identifiers**에서 앱 ID의 **Sign in with Apple**을 켠다.

3. **Identifiers → + → Services IDs**로 웹 로그인 ID를 만든다. **Sign in with Apple → Configure**에서 2번 앱을 선택하고 다음 주소를 저장한다.

   | 입력칸 | 넣을 값 |
   | --- | --- |
   | Domains and Subdomains | `mew.saens.kr` |
   | Return URLs | `https://mew.saens.kr/auth/apple/callback` |

4. **Keys → + → Sign in with Apple**에서 같은 앱을 선택하고 키를 만든다. **Key ID**를 복사하고 **Download**로 `.p8` 파일을 받는다.

### 3. 받은 값 저장하기

`mewlink/.secrets.json`을 열고, 사용하는 로그인 방식의 항목만 추가한다.

| 복사한 값 | 파일에 넣을 이름 |
| --- | --- |
| Google Client ID | `GOOGLE_CLIENT_ID` |
| Google Client secret | `GOOGLE_CLIENT_SECRET` |
| GitHub Client ID | `GITHUB_CLIENT_ID` |
| GitHub Client secret | `GITHUB_CLIENT_SECRET` |
| Apple 웹 로그인 ID(Services ID) | `APPLE_CLIENT_ID` |
| Apple Team ID | `APPLE_TEAM_ID` |
| Apple Key ID | `APPLE_KEY_ID` |
| Apple `.p8` 파일 내용 | `APPLE_PRIVATE_KEY` |

예를 들어 **GitHub만 사용하면** 이렇게 넣는다. 따옴표 안을 실제 값으로 바꾼다.

```json
{
  "GITHUB_CLIENT_ID": "복사한 Client ID",
  "GITHUB_CLIENT_SECRET": "복사한 Client secret"
}
```

기존 값이 있으면 지우지 말고 추가한다. Apple 파일 내용 넣기는 아래 [Apple 상세 안내](#3-apple-services-id-team-id-key-id-p8)의 명령을 사용한다. 실제 값은 이 문서나 채팅에 붙여 넣지 않는다.

### 4. Cloudflare에 올리기

같은 터미널에서 실행한다. 브라우저가 열리면 **`saens.kr`를 관리하는 Cloudflare 계정**으로 로그인한다.

```bash
npx wrangler login
npm run deploy
```

데이터베이스와 서버용 키는 이 명령이 자동으로 준비한다.

### ERR_TOO_MANY_REDIRECTS가 표시될 때

Worker가 화면 요청을 `/index.html`로 바꾸면 Cloudflare Static Assets의 기본 HTML 정규화가 `/`로 307 리다이렉트한다. `/`에서도 같은 처리를 반복하므로 무한 리다이렉트가 발생한다. 화면 경로는 Worker 내부에서 정규 주소 `/`로 요청하여 HTML을 받고, 브라우저의 대시보드·등록·기기·launch 주소를 유지한다. [Cloudflare HTML 처리](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/).

수정된 소스로 `mewlink/`에서 `npm run deploy`를 다시 실행한다. 재배포 후 `curl -I https://mew.saens.kr/`의 상태가 `200`이고 `Location: /`가 없는지 확인한다. 회귀 테스트는 빌드 산출물 대신 `public/index.html`과 실제 Cloudflare Assets 바인딩을 사용해 중앙 화면과 내부 launch 화면의 GET·HEAD를 검사한다.

### 5. 내 mew 연결하기

1. 로컬 mew를 새 버전으로 빌드·적용한다. 방법은 [로컬 설치 안내](native.md)를 따른다.
2. 로컬 mew에 `owner`로 로그인한 뒤 **헤더 메뉴 → Mewlink → 원격 접속 → 기기 등록** 클릭. **설정 → 계정**은 개인 프로필·비밀번호 설정이며 원격 접속 항목이 없다.
3. 열린 `mew.saens.kr`에서 로그인 → 기기 이름 입력 → 등록 승인.
4. 다른 PC나 휴대폰에서 등록된 기기 링크를 열어 연결 확인.

사용자가 최초 배포를 실행했다. 제공자 로그인과 외부망 P2P 연결은 아직 검증하지 않았다. **이 문서에 적힌 명령은 사용자가 실행한다.**

---

## 상세 참고

아래는 추가 로그인 설정·문제 해결·운영 정보를 확인할 때 읽는다.

[구현·전송 계약](../development/remote-access.md) · [로컬 설치](native.md) · [작업·출시 게이트](../work/remote-access.md) · [ADR 0203](../history/decisions/0203-mewlink-workers-p2p-ui.md)

**Cloudflare용 구현·로컬 자동 검증 완료, 사용자 최초 배포 실행.** mewlink는 로그인·기기 목록·등록·접속 승인·시그널링만 제공한다. 실제 mew HTML·JS·CSS·worker·이미지와 작업 API는 등록된 로컬 A에서 인증된 WebRTC DataChannel로 받는다. 중앙 배포에 mew의 `dist/`나 워크스페이스를 포함하지 않는다. Supabase는 사용하지 않는다.

## 위치와 배포 구성

중앙 프로젝트는 `mew/mewlink/`다. 부모 [.gitignore](../../.gitignore)의 `/mewlink/`와 npm workspace 제외를 유지하며 별도 Git 저장소는 아직 만들지 않았다. 공개 mew의 기본 설치·타입 검사·테스트는 이 폴더 없이 동작한다. 중앙 소스·의존성·잠금 파일은 이 폴더에만 남으므로 별도 저장소나 백업에 폴더를 보관해야 한다.

공개 mew의 Git 이력에서도 이전 중앙 구현 `server/remote-central/`, 전용 테스트 `server/remote-central.test.ts`·`server/remote-access-authenticated.test.ts`, 이전 중앙 화면 `src/components/remote-dashboard.tsx`를 제외한다. 현재 파일 삭제와 [.gitignore](../../.gitignore)만으로 과거 커밋이 정리되지는 않는다. 공개 연결 클라이언트·공유 프로토콜은 유지하고, 중앙 소스와 이력 재작성 전 복구 백업은 공개 저장소 밖에서 보관한다. 복구 시 이 파일들이 공개 이력에 다시 들어오지 않도록 확인한다.

| 구성 | 책임 |
| --- | --- |
| `mewlink/src/worker.ts` | OAuth 콜백·세션·등록·멤버십·일회용 launch·접속 증명 |
| `mewlink/src/client.ts`, `mewlink/public/index.html` | 로그인·기기 선택·P2P 연결용 작은 프론트 |
| Worker의 `ASSETS` | mewlink의 `dist/`만 제공. 부모 mew 빌드 제외 |
| D1 `DB` | 계정·등록·해시 세션·멤버십·일회용 요청·만료 정리 |
| 기기별 Durable Object `SIGNAL` | A의 상시 WSS, 승인된 연결의 SDP·ICE, lease·회수 |
| 공개 `shared/remote-access*.ts`, `src/utils/remote-*` | mew와 mewlink가 공유하는 연결·서명·자원 계약 |

프론트와 백엔드는 **Workers + Static Assets 한 배포**로 묶었다. Pages 프로젝트와 Worker를 따로 만들 필요가 없다. Pages Functions에서 Durable Objects를 쓰면 별도 Worker가 필요하므로 통합 배포 요구에는 이 구성이 맞는다. [Cloudflare 통합 앱 배포](https://developers.cloudflare.com/workers/static-assets/), [Pages의 Durable Objects binding](https://developers.cloudflare.com/pages/functions/bindings/#durable-objects).

운영 서버의 Node 프로세스·내부 `5002` 포트·HTTPS 역방향 프록시는 더 이상 요구하지 않는다. 공개 접속은 Cloudflare HTTPS `443`이며 로컬 A는 기존 `localhost:5000` 또는 설정한 `5001`에서 실행한다. 개발용 Wrangler 포트는 운영 포트가 아니다.

## 접속 주소와 P2P UI

사용자는 `https://mew.saens.kr/{중앙 계정 ID}/{기기 이름}` 또는 `/dashboard`만 연다. 주소창은 이 경로를 유지한다. 내부 연결 프레임은 `https://mew-ui.saens.kr/launch/{임시 ID}`에서 열고, 그 안의 `/__mew_ui/{임시 ID}/index.html`부터 실제 UI를 A에서 받는다. JS·CSS·worker의 절대 자원 주소도 연결별 접두사로 돌려 받아 동적 import와 worker 요청을 같은 A에 결합한다. 새로고침은 새 접속 증명과 P2P 연결을 만든다.

`mew-ui.saens.kr`는 같은 Worker에 붙는 **내부 실행 origin**이다. 전체 mew UI를 별도 배포하는 사이트가 아니다. 로그인 호스트의 `__Host-mew_central` cookie와 인증·계정 API를 P2P 앱 코드에서 분리하기 위한 경계다. 한 origin 아래 `/user/device` 경로만 나누면 같은 origin의 JS가 인증 API를 호출할 수 있다. 중앙에서 발급한 60초·일회용 launch 증명은 정확한 내부 프레임에만 전달하며 실제 앱에는 중앙 cookie·launch 증명을 전달하지 않는다.

자원 Service Worker는 정확히 대응하는 연결 페이지·탭의 전송만 사용한다. 브라우저 저장 범위는 중앙 계정·instance ID로 나눈다. 공유 앱 origin을 서로 불신하는 기기 간 보안 격리로 표현하지 않는다. A가 오프라인이거나 직접 연결할 수 없으면 UI와 작업 요청은 실패하며 중앙 HTTP 프록시·TURN으로 대체하지 않는다.

### OAuth 발급값

| 제공자 | `mewlink/.secrets.json` 항목 | 정확한 콜백 |
| --- | --- | --- |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `https://mew.saens.kr/auth/google/callback` |
| GitHub | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | `https://mew.saens.kr/auth/github/callback` |
| Apple | `APPLE_CLIENT_ID`(Services ID), `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`(PKCS8 `.p8`, JSON 문자열의 줄바꿈 보존) | `https://mew.saens.kr/auth/apple/callback` |
| 선택 이메일 OIDC | `EMAIL_OIDC_ISSUER`, `EMAIL_CLIENT_ID`, `EMAIL_CLIENT_SECRET` | `https://mew.saens.kr/auth/email/callback` |

설정은 제공자별로 독립적이다. Google·GitHub는 각각 ID와 secret 두 값, Apple은 네 값이 모두 있어야 버튼이 표시된다. 먼저 한 제공자만 설정해 배포하고 다른 제공자를 추가해도 된다. 모든 콜백은 **로그인 호스트** `mew.saens.kr` 기준이다. `mew-ui.saens.kr`나 로컬 mew의 포트는 OAuth 콜백에 등록하지 않는다. 아래 콘솔 경로·공식 자료는 2026-10-08에 확인했다.

### 1. Google: Client ID와 Client Secret

1. [Google Cloud Console](https://console.cloud.google.com/)에 로그인하고 상단 프로젝트 선택에서 mewlink용 프로젝트를 선택하거나 새로 만든다. Google Cloud 프로젝트 이름·번호는 `GOOGLE_CLIENT_ID`가 아니다.
2. **Google Auth platform → Branding**을 연다. 처음이면 **Get started**로 앱 이름 `mewlink`, 사용자 지원 이메일, 개발자 연락 이메일을 입력한다. 운영용 홈페이지·개인정보처리방침·이용약관 URL은 실제 게시한 주소를 사용하고, 승인된 도메인은 `saens.kr`로 설정한다.
3. **Audience**에서 일반 Google 계정을 받을 서비스는 **External**을 선택한다. 테스트 중에는 **Test users → Add users**에서 사용할 계정을 추가한다. 조직 전용 Internal은 그 조직의 Workspace 계정으로 제한된다. 일반 공개 전에는 Audience의 게시 상태와 Branding 검증 요구를 확인한다.
4. **Data Access**에서 로그인에 필요한 `openid`, 이메일, 기본 프로필 범위만 설정한다. 현재 코드는 `openid profile email`을 요청하며 Drive·Gmail 권한은 요청하지 않는다. [동의 화면 설정 공식 안내](https://developers.google.com/workspace/guides/configure-oauth-consent).
5. **Clients → Create client**에서 **Web application**을 선택하고 이름을 `mewlink production`으로 정한다. **Authorized redirect URIs**에 `https://mew.saens.kr/auth/google/callback`을 정확히 추가한다. Authorized JavaScript origins는 현재 서버 리다이렉트 흐름의 필수값이 아니다. 입력한다면 `https://mew.saens.kr`만 쓰며 경로를 붙이지 않는다.
6. 생성 화면 또는 해당 클라이언트 상세에서 **Client ID**를 `GOOGLE_CLIENT_ID`, **Client secret**을 `GOOGLE_CLIENT_SECRET`에 복사한다. ID는 일반적으로 `.apps.googleusercontent.com`으로 끝난다. secret을 표시할 수 없다면 새 secret을 추가해 그 값을 저장한다. [클라이언트 생성](https://developers.google.com/workspace/guides/create-credentials), [secret 추가·교체](https://support.google.com/googleapi/answer/6158849?hl=en).

`redirect_uri_mismatch`는 등록한 콜백의 프로토콜·호스트·경로·마지막 `/`를 대조한다. 테스트 계정 접근 오류는 Audience의 Test users와 게시 상태를 확인한다. Google API key나 서비스 계정 JSON을 OAuth secret 칸에 넣지 않는다.

### 2. GitHub: OAuth App의 Client ID와 Client Secret

1. [GitHub OAuth Apps 설정](https://github.com/settings/developers)에서 **New OAuth App**을 누른다. 메뉴 경로는 프로필 **Settings → Developer settings → OAuth apps**다. 조직 소유로 만들 때는 해당 조직의 관리 권한으로 조직 설정에서 등록한다.
2. **Application name**은 `mewlink`, **Homepage URL**은 `https://mew.saens.kr`, **Authorization callback URL**은 `https://mew.saens.kr/auth/github/callback`으로 입력하고 **Register application**을 누른다. 현재 중앙 로그인은 웹 인증이므로 **Enable Device Flow**는 필요 없다. [OAuth App 등록 공식 안내](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app).
3. 앱 상세의 **Client ID**를 `GITHUB_CLIENT_ID`에 복사한다. **Client secrets → Generate a new client secret**으로 생성한 값을 `GITHUB_CLIENT_SECRET`에 저장한다. 다시 표시되지 않을 수 있으므로 생성 시 저장한다. [Client ID·secret 위치 공식 안내](https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api#using-basic-authentication).
4. 현재 요청 범위는 `read:user`다. 저장소 접근 `repo` 권한이나 Personal Access Token은 중앙 로그인에 필요하지 않다. 로컬 A의 Git 인증용 Device Flow 앱과 중앙 mewlink OAuth 앱의 ID를 구분한다.

GitHub App의 App ID, 설치 ID, PAT는 위 두 값의 대체물이 아니다. callback 오류는 앱 상세의 URL을 수정하고 다시 로그인한다. 조직 정책으로 승인이 필요한 계정은 해당 조직 정책도 확인한다.

### 3. Apple: Services ID, Team ID, Key ID, `.p8`

Apple은 Apple Developer Program 멤버십과 **Sign in with Apple을 활성화한 primary App ID**에 웹 Services ID를 연결하는 준비가 필요하다. 개발팀의 Account Holder 또는 Admin과 진행한다. 단순 Apple Account 로그인만으로 모든 등록 메뉴를 사용할 수 있는 것은 아니다. [멤버십별 제공 기능](https://developer.apple.com/help/account/basics/account-landing-page/), [웹 인증 연결 요건](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/).

1. [Apple Developer 계정](https://developer.apple.com/account/)에서 올바른 팀을 선택하고 **Membership details**의 **Team ID**를 `APPLE_TEAM_ID`에 저장한다. Apple이 부여한 10자리 팀 식별자이며 App Store Connect의 Issuer ID와 다르다. [Team ID 공식 안내](https://developer.apple.com/help/glossary/team-id/).
2. **Certificates, Identifiers & Profiles → Identifiers**에서 연결할 App ID를 선택하고 **Sign in with Apple**을 활성화한다. App ID가 없다면 앱용 명시적 Bundle ID를 등록하고 capability를 설정한다. 이 App ID는 다음 단계의 primary App ID로 쓰며, 웹 로그인 `APPLE_CLIENT_ID`에는 Services ID를 넣는다.
3. **Identifiers → + → Services IDs**로 새 웹 식별자를 등록한다. Description은 `mewlink web`, Identifier는 팀 내 유일한 역도메인 이름(예: `kr.saens.mewlink.web`)으로 정한다. 예시 문자열을 자동 발급값처럼 쓰지 말고 실제 등록된 Identifier를 `APPLE_CLIENT_ID`에 저장한다.
4. 해당 Services ID를 열고 **Sign in with Apple → Configure**에서 위 primary App ID를 선택한다. **Domains and Subdomains**에는 `mew.saens.kr`(프로토콜·경로 없이), **Return URLs**에는 `https://mew.saens.kr/auth/apple/callback`을 등록하고 **Done → Continue → Save**로 저장한다. 현재 Apple 공식 안내상 이 등록을 위해 서버에 도메인 검증 파일을 올릴 필요는 없다. [Services ID와 웹 주소 설정](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/).
5. **Keys → +**에서 이름을 `mewlink Sign in with Apple`로 입력하고 **Sign in with Apple**을 선택한다. **Configure**에서 같은 primary App ID를 연결한 뒤 등록한다. 키 상세의 **Key ID**를 `APPLE_KEY_ID`에 저장하고 **Download**로 `.p8` 파일을 받는다. App Store Connect API용 `.p8` 키 대신 Sign in with Apple용 키를 사용한다. [Apple 로그인 키 생성](https://developer.apple.com/help/account/capabilities/create-a-sign-in-with-apple-private-key/).
6. `APPLE_PRIVATE_KEY`는 `.p8` 파일 경로가 아니라 `-----BEGIN PRIVATE KEY-----`부터 끝까지의 **파일 내용 전체**다. 다운로드는 한 번만 가능하므로 별도로 보호해 백업한다. [키 다운로드·보관 공식 안내](https://developer.apple.com/help/account/keys/create-a-private-key/).

`.p8`의 실제 줄바꿈을 JSON 문자열로 안전하게 저장하려면 아래를 **사용자가 `mewlink/`에서** 실행한다. 인자만 다운로드한 파일의 실제 절대 경로로 바꾼다. 기존 설정을 읽어 이 키만 추가하므로 다른 제공자 값과 자동 생성된 `SIGNING_KEY`는 유지한다. 키 내용은 터미널에 출력하지 않는다.

```bash
node --input-type=module - '/절대/경로/AuthKey_실제KeyID.p8' <<'NODE'
import fs from 'node:fs/promises'
const file = '.secrets.json'
const settings = JSON.parse(await fs.readFile(file, 'utf8'))
settings.APPLE_PRIVATE_KEY = await fs.readFile(process.argv[2], 'utf8')
await fs.writeFile(file, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 })
await fs.chmod(file, 0o600)
NODE
```

파일 내용의 줄바꿈은 JSON에서 `\n`으로 보이고 파싱 후 실제 줄바꿈으로 복원된다. 수동으로 이중 이스케이프하지 않는다. `APPLE_CLIENT_SECRET`은 현재 설정 항목이 아니다. Worker가 위 네 값으로 짧은 수명의 client secret JWT를 만들므로 장기 JWT를 별도로 발급받아 붙여 넣지 않는다.

### 4. 선택 이메일 OIDC: 제공자에서 발급

Google·GitHub·Apple 중 하나로 먼저 사용할 수 있다. 별도 이메일 로그인이 필요할 때만 이메일·매직 링크 등을 지원하는 OIDC 제공자를 준비한다. 현재 프로젝트에서 이메일 제공자는 정해 두지 않았으므로 콘솔 메뉴 이름은 선택한 제공자의 안내를 따른다.

1. 제공자 콘솔의 Applications/Clients에서 **서버용 웹 애플리케이션(confidential client)**을 등록한다. Authorization Code와 PKCE `S256`, `openid profile email`, 서명된 ID token·JWKS를 지원하는지 확인한다.
2. 허용된 callback/redirect URL에 `https://mew.saens.kr/auth/email/callback`을 등록한다. 발급된 Client ID와 Client Secret을 각각 `EMAIL_CLIENT_ID`, `EMAIL_CLIENT_SECRET`에 넣는다.
3. 애플리케이션의 OpenID Connect 설정·discovery 문서에 표시된 **issuer**를 `EMAIL_OIDC_ISSUER`에 복사한다. `https://` issuer 원문을 그대로 사용하며 discovery 문서 URL 자체, 로그인 페이지, JWKS URL은 넣지 않는다. 경로·마지막 `/`가 있다면 임의로 제거하지 않는다. mewlink는 issuer discovery를 사용하므로 해당 제공자가 반환하는 issuer와 설정값이 일치해야 한다. [OIDC Discovery 표준](https://openid.net/specs/openid-connect-discovery-1_0.html).
4. 제공자 콘솔에서 이메일 로그인 방식을 활성화하고 필요하면 그 제공자의 발송 도메인·SMTP를 설정한다. 현재 mewlink는 `SMTP_PASSWORD`나 이메일 API 키를 사용하지 않는다. 메일 발송과 비밀번호 관리는 제공자의 책임이다.

### 5. 설정 파일에 옮기기

`npm run setup`은 빈 `mewlink/.secrets.json`만 만들고 제공자 자격증명을 발급하지 않는다. JSON은 문자열 값과 쉼표로 구성하며 주석을 넣지 않는다. 아래는 **Google·GitHub만 활성화하는 가짜 값 예시**다. 처음 설정할 때 구조를 참고하고, 기존 파일에 `SIGNING_KEY`가 있으면 파일 전체를 덮어쓰지 말고 필요한 항목만 추가한다.

```json
{
  "GOOGLE_CLIENT_ID": "발급받은-client-id.apps.googleusercontent.com",
  "GOOGLE_CLIENT_SECRET": "발급받은-Google-secret",
  "GITHUB_CLIENT_ID": "발급받은-GitHub-client-id",
  "GITHUB_CLIENT_SECRET": "발급받은-GitHub-secret"
}
```

Apple을 추가할 때는 위 네 항목을, 이메일 OIDC를 추가할 때는 위 세 항목을 같은 객체에 추가한다. 사용하지 않는 제공자는 항목을 생략한다. secret을 바꾸어도 이미 배포한 Worker에는 자동 반영되지 않는다. 사용자가 `npm run deploy`를 다시 실행하면 `wrangler deploy --secrets-file`로 반영된다. 파일에서 항목을 지우는 것만으로 기존 Worker secret이 삭제되지는 않으므로 제공자 비활성화는 원격 secret 삭제까지 별도로 확인한다.

### 6. Cloudflare 인증과 자동 생성값

기본 배포는 Wrangler의 브라우저 OAuth 로그인을 사용하므로 별도 Cloudflare API token을 발급할 필요가 없다. 사용자가 `mewlink/`에서 `npx wrangler login`으로 `saens.kr`를 관리하는 계정에 로그인하고 `npx wrangler whoami`로 대상 계정을 확인한다. [Wrangler 로그인 공식 안내](https://developers.cloudflare.com/workers/wrangler/commands/#login).

| 값 | 얻는 곳·처리 방식 | 저장 위치 |
| --- | --- | --- |
| Cloudflare Account ID | 여러 계정 중 대상 지정이 필요하면 Dashboard에서 대상 계정의 ID를 복사한다. `saens.kr` zone의 Overview에서도 Account ID를 확인할 수 있다. 배포 환경의 `CLOUDFLARE_ACCOUNT_ID`로 지정한다. | 배포 셸 환경변수. `mewlink/.secrets.json`에 넣지 않음 |
| Cloudflare Zone ID | `saens.kr` Overview의 Zone ID. 현재 배포 스크립트는 직접 입력받지 않는다. | 수동 설정 불필요 |
| `CLOUDFLARE_API_TOKEN` | CI 등 비대화형 배포가 필요할 때 Dashboard의 프로필 → API Tokens → Create Token에서 발급한다. 대상 계정·zone의 Workers·D1·도메인 작업을 허용해야 한다. 로컬 브라우저 로그인 방식에서는 생략한다. | CI 비밀 저장소 또는 배포 셸 환경변수. Worker OAuth 설정 파일에 넣지 않음 |
| D1 `database_id` | `npm run deploy`가 이름 `mewlink`로 조회하고 없으면 생성해 UUID를 기록한다. 이미 다른 ID가 있으면 중단한다. | `mewlink/wrangler.jsonc` |
| `SIGNING_KEY` | 최초 배포에서 기존 원격·로컬 키가 모두 없을 때 Ed25519 private JWK를 자동 생성한다. OAuth 제공자가 발급하는 값이 아니다. | `mewlink/.secrets.json`의 JSON 문자열과 Worker secret |
| 중앙·앱 origin | 현재 도메인으로 이미 설정된 `CENTRAL_ORIGIN`·`APP_ORIGIN`. ID나 secret이 아니다. | `mewlink/wrangler.jsonc`의 `vars` |
| 중앙 계정 ID·기기 주소 | 제공자 로그인·기기 등록 후 mewlink에서 생성한다. OAuth Client ID나 Cloudflare Account ID와 다르다. | 대시보드·기기 링크에서 확인 |

[Account·Zone ID 확인](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/), [배포 환경변수](https://developers.cloudflare.com/workers/wrangler/system-environment-variables/), [API token 발급](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/). Cloudflare 인증값은 배포 도구의 인증이고, Google 등의 OAuth secret은 사용자 로그인용이므로 서로 대신할 수 없다. 이미 등록된 A가 있으면 `SIGNING_KEY`를 새로 만들지 말고 기존 키·백업을 유지한다.

#### 최초 배포의 Worker 없음 처리

최초 배포에서는 `wrangler secret list`가 `Worker "mewlink" not found.`를 반환할 수 있다. 배포 스크립트는 이 경우 원격 secret이 없는 상태로 진행하고, 필요한 서명 키를 준비한 뒤 `deploy --secrets-file`로 Worker와 secret을 함께 배포한다. 인증·권한·네트워크 등 다른 조회 오류는 중단하며, 기존 Worker의 서명 키 보호는 유지한다.

#### D1 ID 불일치로 배포가 중단될 때

`기존 D1 ID와 이름이 다릅니다` 또는 `D1 ID 불일치`는 `wrangler.jsonc`에 저장된 ID와 현재 계정의 같은 이름 DB의 UUID가 다르다는 뜻이다. 자동으로 DB를 바꾸지 않고 중단한다.

`mewlink/`에서 아래 조회 명령을 실행한다.

```bash
npx wrangler whoami
npx wrangler d1 list --json
```

대상 Cloudflare 계정이 맞는지 먼저 확인한다. 다른 계정이면 배포 계정을 바로잡는다. 올바른 계정이고 목록의 `mewlink`가 사용할 DB라면 `wrangler.jsonc`의 `d1_databases`에서 `DB` 바인딩의 `database_id`를 조회된 `uuid`로 수정하고 `npm run deploy`를 다시 실행한다. 기존 계정·기기 등록을 복구하려는 상황이면 빈 DB로 대체하지 말고 기존 DB가 있는 계정과 백업을 먼저 확인한다. 이 복구에 DB 삭제나 서명 키 재생성은 필요 없다. [D1 조회 명령](https://developers.cloudflare.com/d1/wrangler-commands/).

Google/GitHub/이메일은 Authorization Code + PKCE, Apple은 공식 confidential-client 흐름과 `form_post`·state·nonce를 사용한다. Apple metadata에서 PKCE 지원을 선언하지 않으므로 적용을 가정하지 않는다. OIDC는 issuer·audience·nonce·만료·JWKS 서명을 검증한다. Apple의 교차 사이트 POST용 로그인 cookie는 `SameSite=None`, 중앙 세션 cookie는 `SameSite=Lax`다. 신원은 제공자/issuer/불변 subject로 식별하고 같은 이메일로 계정을 합치지 않는다.

[Google 웹 서버 OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [GitHub 웹 OAuth](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps), [Apple 웹 인증 설정](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/), [Apple 인증 metadata](https://appleid.apple.com/.well-known/openid-configuration).

## 상태·키·복구

D1은 `mewlink/migrations/0001_accounts.sql`부터 `0005_browser_access.sql`까지 순서대로 적용한다. 중앙 관리 세션 7일, 로그인/등록 요청 5분, launch 60초, 재사용 방지 증명·rate limit은 각각 만료값을 가진다. 매시간 Cron이 만료 행을 정리하되 브라우저 접근 회수 기록은 보존한다. DO는 WebSocket attachment로 브라우저 키 지문·인증·협상 상태를 보존하고 hibernation 이후 재검증한다. A의 20초 heartbeat는 자동 응답으로 처리하며 60초 무응답·10초 간격 만료 검사로 오프라인을 판정한다. 열린 작업 연결의 lease는 60초·20초 갱신이며 브라우저 회수·등록 폐기는 해당 DO와 A에 종료를 보낸다. 중앙 로그아웃과 로컬 신뢰 세션의 경계는 [원격 인증 계약](../development/remote-access.md#승인된-mewlink-계정-로그인)을 따른다.

중앙 Ed25519 `SIGNING_KEY`는 최초 배포 때 생성하여 보호된 `mewlink/.secrets.json`과 Worker secret에 보관한다. `.deployment-state.json`은 배포된 공개 키 지문만 기록한다. 기존 Worker의 키를 다른 값으로 자동 교체하지 않는다. 로컬 키가 없으면 이미 배포된 Worker secret을 유지한다. 키를 잃고 Worker secret도 지웠다면 새 키는 기존 A에 고정된 공개 키와 달라지므로 복구 또는 명시적 재등록이 필요하다. 자동 키 회전은 제공하지 않는다.

D1의 일관된 export/복구와 서명 키를 함께 백업한다. 과거 Node 중앙의 `central.sqlite`와 `signing-key.json` 자동 이관은 제공하지 않는다. 실제 과거 등록이 있다면 키·계정·등록을 확인하고 별도 이관 또는 owner 승인 재등록을 수행한다. 보관/개인정보 안내·계정 삭제·재해 복구 실습은 출시 전 운영 게이트다.

OAuth callback query/form·Cookie·launch·등록 코드·SDP·ICE·접속 증명은 로그에 기록하지 않는다. Wrangler 설정은 invocation 로그를 끄고 오류 응답은 비밀값을 포함하지 않는다. 사용자 작업 데이터를 위한 중앙 `/api` 경로는 제공하지 않는다.

## 멤버·설정과 검증

A의 중앙 주소는 기본 `https://mew.saens.kr`이며 `MEW_REMOTE_ORIGIN`으로 최초 등록 대상을 바꾼다. 등록 후에는 저장한 origin·키를 사용하므로 주소/키 변경은 등록 해제·재등록을 따른다. CLI `./mew remote-access account`는 안내만 제공하고 owner 인가를 대신하지 않는다. 로컬 bind·포트는 유지한다.

멤버는 중앙에 먼저 로그인하고 헤더의 이름을 눌러 계정 ID를 복사한다. A의 owner가 **멤버 접근**에서 이 ID와 기존 로컬 계정을 연결한다. 임시 비밀번호·역할·기능·파일 권한은 로컬에서 계속 검사한다. 회수는 A에서, 중앙 등록 삭제는 owner 대시보드 또는 A의 등록 해제로 수행한다.

```bash
# 공개 mew: 빌드·서비스에 영향을 주지 않는 검증
npx tsc -b
npm run lint
node --test server/remote-ui.test.ts server/remote-access.test.ts

# 비공개 중앙: Cloudflare 런타임과 실제 브라우저/네이티브 RTC 검증
cd mewlink
npm run check
npm test
npm run test:browser
```

브라우저 통합 테스트는 부모 mew 개발 환경의 Chromium·네이티브 RTC·rolldown을 사용하며 작은 테스트 fixture를 메모리에서 컴파일한다. 실제 앱 `dist/`를 쓰거나 빌드하지 않는다. 현재 검증은 Worker/D1/DO의 등록·권한·일회용 승인·hibernation·로그아웃, 제공자 응답 fixture를 통한 OAuth, 실제 Chromium과 A의 P2P UI·worker·자원·새로고침·여러 탭을 포함한다. Cloudflare 운영 배포는 사용자가 실행했으며 수정본의 운영 반영은 재배포 후 확인한다. 실제 OAuth 앱 로그인·Windows/WSL/Mac ↔ Android/LTE/5G 성공률은 검증하지 않았다. 일반 출시 판단은 [작업 기록](../work/remote-access.md)을 따른다.

## 시그널링 인가 상태의 보존과 복귀

기기·브라우저 인가 상태는 기기별 DO SQLite에도 영속 저장한다. 중앙 코드가 `mew_signal_instances`·`mew_signal_browsers` 테이블을 생성하고 첫 접근에서 기존 D1 기록을 가져온다. D1 스키마 변경·기기 재등록·로컬 mew 재시작 없이 중앙 재배포로 적용한다. [현재 인가 계약](../development/remote-access.md#중앙-시그널링의-인가-상태)·[ADR 0025](../decisions/0025-mewlink-signaling-authority.md).

브라우저 회수·기기 폐기는 DO에 먼저 기록한 뒤 D1을 갱신한다. D1 갱신 실패로 관리 요청이 실패해도 DO의 회수는 유지된다. 같은 회수 요청을 다시 실행해 D1 반영을 확인한다. 이 단계에서 기기를 재등록하거나 DO 상태를 삭제해 오류를 해소하지 않는다.

백업은 중앙 서명 키·D1과 함께 DO의 영속 인가 상태를 포함한다. D1 export만으로는 아직 D1에 반영하지 못한 DO 회수 기록을 복구할 수 없다. 구버전으로 복귀하기 전에 회수 기록의 D1 반영을 확인하고 열린 연결을 종료한다. 상태를 복구할 때 오래된 active 기록으로 DO 회수를 덮어쓰지 않는다. DO SQLite의 복구 기능은 [Cloudflare PITR](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#pitr-point-in-time-recovery-api)을 따른다.

## localhost 앱 프리뷰 origin

`mew.run/<user>/<device>/<port>`의 포트 연결에는 `PREVIEW_DOMAIN=preview.mew.run`과 `*.preview.mew.run/*` Worker 경로가 필요하다. 같은 Worker로 proxied wildcard DNS를 연결하고 `*.preview.mew.run`의 HTTPS 인증서를 준비한다. 기본 `*.mew.run` 인증서만으로 중첩 하위 도메인이 포함되지는 않는다. 각 프리뷰는 별도 난수 호스트를 사용하며 앱의 자산·API·WebSocket은 기존 P2P 전송으로 전달한다.

중앙의 `src/port-preview.ts`·`public/port-preview-launch.js`·`public/port-preview-worker.js`·`public/port-preview-runtime.js`와 Worker 진입점·클라이언트·설정을 함께 반영한 후 사용자가 배포한다. 자세한 권한·보안 경계와 미지원 항목은 [포트 프리뷰](../development/port-preview.md)를 따른다. 이 작업에서는 중앙 배포·실제 도메인·외부망 검사를 실행하지 않았다.
