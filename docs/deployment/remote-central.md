---
title: "mewlink Cloudflare 배포"
description: "Google·GitHub·Apple 로그인 값 받기, 설정 파일에 저장하기, Cloudflare 배포와 로컬 기기 등록을 짧은 실행 순서로 안내한다. 뒤에는 발급·운영 상세 참고를 보존하며 실제 배포·외부망 검증은 남아 있다."
created: 2026-10-07
updated: "2026-10-08"
---

# mewlink Cloudflare 배포

## 내가 할 일

**처음에는 Google 또는 GitHub 하나만 설정해도 된다.** Apple은 나중에 추가해도 된다.

### 1. 설정 파일 만들기

터미널에서 실행한다.

```bash
cd /home/saens/dev/liiiiv/mew/mewlink
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

### 5. 내 mew 연결하기

1. 로컬 mew를 새 버전으로 빌드·적용한다. 방법은 [로컬 설치 안내](native.md)를 따른다.
2. 로컬 mew의 **계정 설정 → 원격 접속 → 기기 등록** 클릭.
3. 열린 `mew.saens.kr`에서 로그인 → 기기 이름 입력 → 등록 승인.
4. 다른 PC나 휴대폰에서 등록된 기기 링크를 열어 연결 확인.

현재는 실제 서비스에 배포하기 전이다. **이 문서에 적힌 명령은 사용자가 실행한다.**

---

## 상세 참고

아래는 추가 로그인 설정·문제 해결·운영 정보를 확인할 때 읽는다.

[구현·전송 계약](../development/remote-access.md) · [로컬 설치](native.md) · [작업·출시 게이트](<../tasks/mew 중계 기능 만들기.md>) · [ADR 0203](../../../.mew/docs/decisions/0203-mewlink-workers-p2p-ui.md)

**Cloudflare용 구현·로컬 자동 검증 완료, 미배포.** mewlink는 로그인·기기 목록·등록·접속 승인·시그널링만 제공한다. 실제 mew HTML·JS·CSS·worker·이미지와 작업 API는 등록된 로컬 A에서 인증된 WebRTC DataChannel로 받는다. 중앙 배포에 mew의 `dist/`나 워크스페이스를 포함하지 않는다. Supabase는 사용하지 않는다.

## 위치와 배포 구성

중앙 프로젝트는 `mew/mewlink/`다. 부모 `.gitignore`의 `/mewlink/`와 npm workspace 제외를 유지하며 별도 Git 저장소는 아직 만들지 않았다. 공개 mew의 기본 설치·타입 검사·테스트는 이 폴더 없이 동작한다. 중앙 소스·의존성·잠금 파일은 이 폴더에만 남으므로 별도 저장소나 백업에 폴더를 보관해야 한다.

공개 mew의 Git 이력에서도 이전 중앙 구현 `server/remote-central/`, 전용 테스트 `server/remote-central.test.ts`·`server/remote-access-authenticated.test.ts`, 이전 중앙 화면 `src/components/remote-dashboard.tsx`를 제외한다. 현재 파일 삭제와 `.gitignore`만으로 과거 커밋이 정리되지는 않는다. 공개 연결 클라이언트·공유 프로토콜은 유지하고, 중앙 소스와 이력 재작성 전 복구 백업은 공개 저장소 밖에서 보관한다. 복구 시 이 파일들이 공개 이력에 다시 들어오지 않도록 확인한다.

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

### OAuth 발급값

| 제공자 | `mewlink/.secrets.json` 항목 | 정확한 콜백 |
| --- | --- | --- |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `https://mew.saens.kr/auth/google/callback` |
| GitHub | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | `https://mew.saens.kr/auth/github/callback` |
| Apple | `APPLE_CLIENT_ID`(Services ID), `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`(PKCS8 `.p8`, JSON 문자열의 줄바꿈 보존) | `https://mew.saens.kr/auth/apple/callback` |
| 선택 이메일 OIDC | `EMAIL_OIDC_ISSUER`, `EMAIL_CLIENT_ID`, `EMAIL_CLIENT_SECRET` | `https://mew.saens.kr/auth/email/callback` |

설정은 제공자별로 독립적이다. Google·GitHub는 각각 ID와 secret 두 값, Apple은 네 값이 모두 있어야 버튼이 표시된다. 먼저 한 제공자만 설정해 배포하고 다른 제공자를 추가해도 된다. 모든 콜백은 **로그인 호스트 `mew.saens.kr`** 기준이다. `mew-ui.saens.kr`나 로컬 mew의 포트는 OAuth 콜백에 등록하지 않는다. 아래 콘솔 경로·공식 자료는 2026-10-08에 확인했다.

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

`npm run setup`은 빈 `.secrets.json`만 만들고 제공자 자격증명을 발급하지 않는다. JSON은 문자열 값과 쉼표로 구성하며 주석을 넣지 않는다. 아래는 **Google·GitHub만 활성화하는 가짜 값 예시**다. 처음 설정할 때 구조를 참고하고, 기존 파일에 `SIGNING_KEY`가 있으면 파일 전체를 덮어쓰지 말고 필요한 항목만 추가한다.

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
| Cloudflare Account ID | 여러 계정 중 대상 지정이 필요하면 Dashboard에서 대상 계정의 ID를 복사한다. `saens.kr` zone의 Overview에서도 Account ID를 확인할 수 있다. 배포 환경의 `CLOUDFLARE_ACCOUNT_ID`로 지정한다. | 배포 셸 환경변수. `.secrets.json`에 넣지 않음 |
| Cloudflare Zone ID | `saens.kr` Overview의 Zone ID. 현재 배포 스크립트는 직접 입력받지 않는다. | 수동 설정 불필요 |
| `CLOUDFLARE_API_TOKEN` | CI 등 비대화형 배포가 필요할 때 Dashboard의 프로필 → API Tokens → Create Token에서 발급한다. 대상 계정·zone의 Workers·D1·도메인 작업을 허용해야 한다. 로컬 브라우저 로그인 방식에서는 생략한다. | CI 비밀 저장소 또는 배포 셸 환경변수. Worker OAuth 설정 파일에 넣지 않음 |
| D1 `database_id` | `npm run deploy`가 이름 `mewlink`로 조회하고 없으면 생성해 UUID를 기록한다. 이미 다른 ID가 있으면 중단한다. | `mewlink/wrangler.jsonc` |
| `SIGNING_KEY` | 최초 배포에서 기존 원격·로컬 키가 모두 없을 때 Ed25519 private JWK를 자동 생성한다. OAuth 제공자가 발급하는 값이 아니다. | `.secrets.json`의 JSON 문자열과 Worker secret |
| 중앙·앱 origin | 현재 도메인으로 이미 설정된 `CENTRAL_ORIGIN`·`APP_ORIGIN`. ID나 secret이 아니다. | `mewlink/wrangler.jsonc`의 `vars` |
| 중앙 계정 ID·기기 주소 | 제공자 로그인·기기 등록 후 mewlink에서 생성한다. OAuth Client ID나 Cloudflare Account ID와 다르다. | 대시보드·기기 링크에서 확인 |

[Account·Zone ID 확인](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/), [배포 환경변수](https://developers.cloudflare.com/workers/wrangler/system-environment-variables/), [API token 발급](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/). Cloudflare 인증값은 배포 도구의 인증이고, Google 등의 OAuth secret은 사용자 로그인용이므로 서로 대신할 수 없다. 이미 등록된 A가 있으면 `SIGNING_KEY`를 새로 만들지 말고 기존 키·백업을 유지한다.

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
