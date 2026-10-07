---
title: "mewlink Cloudflare 배포"
description: "Git에서 제외한 mewlink의 Workers·Static Assets·D1·Durable Objects 통합 배포, P2P UI의 내부 origin 분리, Google·GitHub·Apple OAuth 설정과 자동 배포 명령, 사용자가 수행할 최소 절차를 안내한다. 실제 배포·제공자 로그인·외부망 검증은 남아 있다."
created: 2026-10-07
updated: 2026-10-07
---

# mewlink Cloudflare 배포

[구현·전송 계약](../development/remote-access.md) · [로컬 설치](native.md) · [작업·출시 게이트](<../tasks/mew 중계 기능 만들기.md>) · [ADR 0203](../../../.mew/docs/decisions/0203-mewlink-workers-p2p-ui.md)

**Cloudflare용 구현·로컬 자동 검증 완료, 미배포.** mewlink는 로그인·기기 목록·등록·접속 승인·시그널링만 제공한다. 실제 mew HTML·JS·CSS·worker·이미지와 작업 API는 등록된 로컬 A에서 인증된 WebRTC DataChannel로 받는다. 중앙 배포에 mew의 `dist/`나 워크스페이스를 포함하지 않는다. Supabase는 사용하지 않는다.

## 위치와 배포 구성

중앙 프로젝트는 `mew/mewlink/`다. 부모 `.gitignore`의 `/mewlink/`와 npm workspace 제외를 유지하며 별도 Git 저장소는 아직 만들지 않았다. 공개 mew의 기본 설치·타입 검사·테스트는 이 폴더 없이 동작한다. 중앙 소스·의존성·잠금 파일은 이 폴더에만 남으므로 별도 저장소나 백업에 폴더를 보관해야 한다.

| 구성 | 책임 |
| --- | --- |
| `mewlink/src/worker.ts` | OAuth 콜백·세션·등록·멤버십·일회용 launch·접속 증명 |
| `mewlink/src/client.ts`, `public/index.html` | 로그인·기기 선택·P2P 연결용 작은 프론트 |
| Worker의 `ASSETS` | mewlink의 `dist/`만 제공. 부모 mew 빌드 제외 |
| D1 `DB` | 계정·등록·해시 세션·멤버십·일회용 요청·만료 정리 |
| 기기별 Durable Object `SIGNAL` | A의 상시 WSS, 승인된 연결의 SDP·ICE, lease·회수 |
| 공개 `shared/remote-access*.ts`, `src/utils/remote-*` | mew와 mewlink가 공유하는 연결·서명·자원 계약 |

프론트와 백엔드는 **Workers + Static Assets 한 배포**로 묶었다. Pages 프로젝트와 Worker를 따로 만들 필요가 없다. Pages Functions에서 Durable Objects를 쓰면 별도 Worker가 필요하므로 통합 배포 요구에는 이 구성이 맞는다. [Cloudflare 통합 앱 배포](https://developers.cloudflare.com/workers/static-assets/), [Pages의 Durable Objects binding](https://developers.cloudflare.com/pages/functions/bindings/#durable-objects).

운영 서버의 Node 프로세스·내부 `5002` 포트·HTTPS 역방향 프록시는 더 이상 요구하지 않는다. 공개 접속은 Cloudflare HTTPS `443`이며 로컬 A는 기존 `localhost:5000` 또는 설정한 `5001`에서 실행한다. 개발용 Wrangler 포트는 운영 포트가 아니다.

## 접속 주소와 P2P UI

사용자는 **`https://mew.saens.kr/{중앙 계정 ID}/{기기 이름}`** 또는 `/dashboard`만 연다. 주소창은 이 경로를 유지한다. 내부 연결 프레임은 `https://mew-ui.saens.kr/launch/{임시 ID}`에서 열고, 그 안의 `/__mew_ui/{임시 ID}/index.html`부터 실제 UI를 A에서 받는다. JS·CSS·worker의 절대 자원 주소도 연결별 접두사로 돌려 받아 동적 import와 worker 요청을 같은 A에 결합한다. 새로고침은 새 접속 증명과 P2P 연결을 만든다.

`mew-ui.saens.kr`는 같은 Worker에 붙는 **내부 실행 origin**이다. 전체 mew UI를 별도 배포하는 사이트가 아니다. 로그인 호스트의 `__Host-mew_central` cookie와 인증·계정 API를 P2P 앱 코드에서 분리하기 위한 경계다. 한 origin 아래 `/user/device` 경로만 나누면 같은 origin의 JS가 인증 API를 호출할 수 있다. 중앙에서 발급한 60초·일회용 launch 증명은 정확한 내부 프레임에만 전달하며 실제 앱에는 중앙 cookie·launch 증명을 전달하지 않는다.

자원 Service Worker는 정확히 대응하는 연결 페이지·탭의 전송만 사용한다. 브라우저 저장 범위는 중앙 계정·instance ID로 나눈다. 공유 앱 origin을 서로 불신하는 기기 간 보안 격리로 표현하지 않는다. A가 오프라인이거나 직접 연결할 수 없으면 UI와 작업 요청은 실패하며 중앙 HTTP 프록시·TURN으로 대체하지 않는다.

## 사용자가 할 일

이 세 단계만 직접 수행한다. 이번 세션에는 Cloudflare 관리 MCP가 없었고, Wrangler의 기존 로그인은 읽기 전용으로 확인했다. OAuth 앱의 신규 등록·Apple 계정 승인은 사용할 수 있는 도구로 대신할 수 없다. 빌드·배포는 [실행 규칙](../development/getting-started.md)의 사용자 적용 범위다.

1. **OAuth 앱 등록.** 사용할 제공자만 아래 표의 콜백을 등록하고 발급값을 로컬 `mewlink/.secrets.json`에 넣는다. `cd mewlink && npm ci --ignore-scripts && npm run setup`으로 권한 `0600`인 빈 설정 파일을 준비한다. 값은 문서·채팅·Git에 남기지 않는다. Apple은 Services ID, Team ID, Key ID, `.p8` 비공개 키가 필요하다. Worker가 client secret JWT를 요청마다 5분 수명으로 서명하므로 수동 JWT 갱신은 필요 없다.
2. **Cloudflare 배포.** `saens.kr` zone을 해당 Cloudflare 계정에서 관리할 수 있는지 확인한 뒤 `cd mewlink && npm run deploy`를 실행한다. 다른 계정이라면 먼저 `npx wrangler login`한다. 이 명령은 작은 프론트 빌드 → 기존 D1 조회/필요 시 생성 → ID 기록 → 원격 마이그레이션 → 서명 키 생성·보관 → secret 주입과 두 custom domain 배포를 수행한다. 기존 DNS 충돌이나 계정 권한 오류는 정리 후 재실행한다. 기존 레코드를 임의 삭제하지 않는다.
3. **로컬 적용·등록.** 사용자가 로컬 mew를 새 버전으로 빌드·적용한 뒤(구버전 UI 빌드는 연결 전에 거부한다) owner의 계정 설정 → 원격 접속 → 기기 등록을 누른다. 열린 중앙 페이지에서 로그인·기기 이름 승인을 끝낸다. 다른 PC/휴대폰에서 고정 URL을 열어 실제 로그인과 외부망 직접 연결을 확인한다.

Cloudflare·D1·도메인·서명 키를 화면에서 따로 생성하거나 Supabase 프로젝트를 만들 필요는 없다. 위 명령은 정상 계정·zone 권한을 전제로 자동화하며, 이번 작업에서는 원격 리소스를 생성하거나 배포하지 않았다.

### OAuth 발급값

| 제공자 | `mewlink/.secrets.json` 항목 | 정확한 콜백 |
| --- | --- | --- |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `https://mew.saens.kr/auth/google/callback` |
| GitHub | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | `https://mew.saens.kr/auth/github/callback` |
| Apple | `APPLE_CLIENT_ID`(Services ID), `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`(PKCS8 `.p8`, JSON 문자열의 줄바꿈 보존) | `https://mew.saens.kr/auth/apple/callback` |
| 선택 이메일 OIDC | `EMAIL_OIDC_ISSUER`, `EMAIL_CLIENT_ID`, `EMAIL_CLIENT_SECRET` | `https://mew.saens.kr/auth/email/callback` |

Google은 웹 앱 유형과 동의 화면·공개 상태를 설정한다. GitHub 중앙 OAuth 앱은 A의 Git Device Flow 앱과 별개다. Apple은 Sign in with Apple이 활성화된 App ID와 연결한 Services ID에 `mew.saens.kr` domain·return URL을 등록한다. 설정이 완성된 제공자만 로그인 화면에 표시한다. 이메일 링크·비밀번호·SMTP는 선택한 OIDC 제공자가 운영한다.

Google/GitHub/이메일은 Authorization Code + PKCE, Apple은 공식 confidential-client 흐름과 `form_post`·state·nonce를 사용한다. Apple metadata에서 PKCE 지원을 선언하지 않으므로 적용을 가정하지 않는다. OIDC는 issuer·audience·nonce·만료·JWKS 서명을 검증한다. Apple의 교차 사이트 POST용 로그인 cookie는 `SameSite=None`, 중앙 세션 cookie는 `SameSite=Lax`다. 신원은 제공자/issuer/불변 subject로 식별하고 같은 이메일로 계정을 합치지 않는다.

[Google 웹 서버 OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [GitHub 웹 OAuth](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps), [Apple 웹 인증 설정](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/), [Apple 인증 metadata](https://appleid.apple.com/.well-known/openid-configuration).

## 상태·키·복구

D1 마이그레이션은 `mewlink/migrations/0001_accounts.sql`이다. 세션 7일, 로그인/등록 요청 5분, launch 60초, 재사용 방지 증명·rate limit은 각각 만료값을 가진다. 매시간 Cron이 만료 행을 정리한다. DO는 WebSocket attachment로 인증·협상 상태를 보존하고 hibernation 이후 재검증한다. A의 20초 heartbeat는 자동 응답으로 처리하며 60초 무응답·10초 간격 만료 검사로 오프라인을 판정한다. 열린 작업 연결의 lease는 60초·20초 갱신이고 로그아웃·멤버 회수·등록 폐기 시 해당 DO와 A에 종료를 보낸다.

중앙 Ed25519 `SIGNING_KEY`는 최초 배포 때 생성하여 보호된 `.secrets.json`과 Worker secret에 보관한다. `.deployment-state.json`은 배포된 공개 키 지문만 기록한다. 기존 Worker의 키를 다른 값으로 자동 교체하지 않는다. 로컬 키가 없으면 이미 배포된 Worker secret을 유지한다. 키를 잃고 Worker secret도 지웠다면 새 키는 기존 A에 고정된 공개 키와 달라지므로 복구 또는 명시적 재등록이 필요하다. 자동 키 회전은 제공하지 않는다.

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

브라우저 통합 테스트는 부모 mew 개발 환경의 Chromium·네이티브 RTC·rolldown을 사용하며 작은 테스트 fixture를 메모리에서 컴파일한다. 실제 앱 `dist/`를 쓰거나 빌드하지 않는다. 현재 검증은 Worker/D1/DO의 등록·권한·일회용 승인·hibernation·로그아웃, 제공자 응답 fixture를 통한 OAuth, 실제 Chromium과 A의 P2P UI·worker·자원·새로고침·여러 탭을 포함한다. 실제 OAuth 앱 로그인·Cloudflare 운영 배포·Windows/WSL/Mac ↔ Android/LTE/5G 성공률은 검증하지 않았다. 일반 출시 판단은 [태스크 기준](<../tasks/mew 중계 기능 만들기.md>)을 따른다.
