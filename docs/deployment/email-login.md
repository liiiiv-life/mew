---
title: "mewlink 직접 이메일 로그인 설정"
description: "Cloudflare Email Service로 직접 이메일 로그인 코드를 발송하는 도메인·sender·Workers binding 설정과 중앙 배포, 모의 검증·실제 전달 확인의 경계를 안내한다."
created: 2026-10-09
updated: 2026-10-09
---

직접 이메일 로그인은 중앙 화면에서 이메일과 인증 코드를 입력한다. 외부 이메일 OIDC의 별도 issuer·client 설정은 [중앙 배포 문서](remote-central.md#4-선택-이메일-oidc-제공자에서-발급)를 따르고, 직접 로그인에는 OIDC 제공자가 필요 없다. 신원·보안·제한은 [원격 접속 계약](../development/remote-access.md#직접-이메일-로그인), 선택 근거는 [ADR 0206](../history/decisions/0206-mewlink-email-code-login.md)이 소유한다.

## 발송 준비와 배포

`mewlink/wrangler.jsonc`에는 `EMAIL` send binding과 `EMAIL_FROM=login@saens.kr`, 같은 주소의 `allowed_sender_addresses`가 설정돼 있다. Worker는 binding으로 발송하고 별도 이메일 API 키나 SMTP 비밀번호를 사용하지 않는다. 발송 주소를 바꾸면 변수와 허용 sender를 함께 바꾸며 해당 도메인이 발송용으로 준비돼 있어야 한다. [Workers Email API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/), [binding 제한](https://developers.cloudflare.com/email-service/configuration/send-bindings/).

사용자는 mewlink 폴더에서 Cloudflare 대상 계정·권한과 발송 도메인을 확인한다.

```bash
cd mewlink
npx wrangler email sending list
# 발송 도메인이 아직 활성화되지 않았다면 사용자 실행:
npx wrangler email sending enable saens.kr
npx wrangler email sending list saens.kr
npm run deploy
```

Cloudflare가 요구하는 도메인 인증과 발송 서비스 활성화를 완료한 뒤 배포한다. 위 `enable`은 발송 서비스 설정을 변경하므로 조회·테스트 명령과 구분한다. `Unauthorized`가 나오면 대상 Cloudflare 계정과 Email Sending 권한·접근 가능 여부를 확인한다. 활성화·DNS·권한·실제 수신은 자동 테스트 성공으로 대신하지 않는다.

`npm run deploy`는 D1 `0003_email_logins.sql`과 중앙 UI·Worker를 적용한다. 이 기능만을 위해 로컬 A를 재등록하거나 로컬 mew를 빌드·재시작할 필요는 없다. 미설정 binding·sender에서는 이메일 UI를 표시하지 않으며 API는 503을 반환한다. 도메인·발송 실패는 502 오류로 표시하고 대기 중 코드를 폐기한다.

## 검증과 운영 확인

`npm run check`, `npm test`, `npm run test:browser`로 타입·Worker·브라우저를 검증한다. 이메일 테스트는 모의 binding에 메일을 전달하며 실제 메일을 발송하지 않는다. 브라우저 검증은 이메일 입력·잘못된 코드 복구·인증·첫 유저이름 설정·원래 기기 등록 경로 복귀까지 실행한다.

운영 배포 후 사용자가 소유한 실제 이메일로 코드 수신, 10분 만료, 재발송과 최초 이름 설정을 확인한다. Cloudflare 로컬 email binding의 시뮬레이션 성공은 실제 전달 성공이 아니다. 개발 모드에서 실제 전달이 필요한 경우에만 사용자가 remote binding을 명시적으로 선택한다. [로컬 발송과 remote binding](https://developers.cloudflare.com/email-service/local-development/sending/).

인증 코드·challenge 쿠키·세션 쿠키·메일 본문은 애플리케이션 로그나 문서에 남기지 않는다. 자동 검증과 실제 전달 확인의 결과를 구분한다.
