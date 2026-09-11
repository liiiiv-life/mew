---
title: "mew 오픈소스 공개 준비 실행 계획"
desc: "공개 릴리스 전 코드·문서·배포 경계를 검증하는 실행 순서와 잔여 외부 확인 사항."
created: 2026-09-04
updated: 2026-09-04
---

기준 결정은 [ADR 0112](../../../.mew/docs/decisions/0112-mew-public-release-security-and-credential-boundaries.md)와
[ADR 0111](../../../.mew/docs/decisions/0111-mew-native-deployment-and-supervisor.md)이다. 설치·운영 절차는 레포의
[README](../../README.md), 권한 경계는 `mew/SECURITY.md`가 기준이다.

## 이번 구현 범위

1. MIT LICENSE와 패키지 메타데이터를 복구하고, 재배포 금지 외부 이미지·원본 압축 파일을 공개 대상으로
   삼지 않는다.
2. Mewcat은 자체 코드 기반 벡터 마크로 바꾸고, 기존 자산 이름·스프라이트 계약·Oreo 스킨 저장값을
   호환상 숨김 처리한다.
3. 서버 보관 OAuth 토큰을 금지·정리하고, 서버 외부 URL fetch를 제거한다.
4. 업로드를 임시 디스크 스트림으로 옮기고 크기·횟수를 제한한다. 게스트의 Git revert를 막고, CSP·HSTS·
   Permissions-Policy와 loopback 기본 바인딩을 적용한다.
5. 단위 테스트·빌드·문서 검사·의존성 감사 결과를 릴리스 체크리스트로 남긴다.

## 릴리스 게이트

- `npm test`, `npm run lint`, `npm run build`, docs health와 레포 문서 허용목록 검사를 통과한다.
- dependency audit와 SBOM/제3자 고지 산출물을 릴리스 커밋에서 생성·검토한다. 네이티브·플랫폼 패키지는
  실제 배포 OS 기준으로 검사한다.
- 서버는 전용 비관리자 사용자, `MEW_BIND=127.0.0.1`, HTTPS 프록시/터널, 별도 workspace·data directory로
  새 설치 검증한다. 개발 서버와 직접 포트 공개는 금지한다.

## 코드로 대신할 수 없는 확인

다음 두 가지는 기술적으로 자동 판정할 수 없으므로, **공개 릴리스 태그를 찍는 유지보수자**가 확인한다.

1. 모든 기여자가 MIT로 배포할 권리가 있는지(외부에서 가져온 코드·폰트·디자인·회사 소유 기여 포함).
2. Claude Code/Anthropic 및 그 외 선택적 에이전트 SDK를 제품에 포함·호스팅·중계하는 방식이 해당 공급자
   계약에 맞는지. 이 확인 전에는 Mew가 공급자 OAuth bearer token을 수집하거나 저장하지 않는다.

이 두 확인은 사람의 서명·계약 권한이 필요한 법적 사실이라 자동화로 대체하지 않는다. 확인이 끝나지 않으면
해당 공급자 런타임을 공개 릴리스에서 비활성화하거나 제외한다.
