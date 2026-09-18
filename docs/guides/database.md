# 표 데이터베이스 (/db)

[문서 지도](../MOC.md) · [이 분야](MOC.md) · [설치·실행](../../README.md)

에디터에서 `/db`를 치면 노션식 표 데이터베이스를 삽입한다 (v1은 표 보기만). 본문에는 참조 id만 저장되고(`<div data-mew-db="uuid">`), 실제 데이터는 **Postgres가 SSoT**다.

- **컬럼 타입**: 텍스트 · 숫자 · 체크박스 · 날짜. 열 헤더의 `+`로 추가하고, 헤더를 눌러 이름을 바꾼다.
- **실시간 협업**: 행·셀·열·제목 변경이 인프로세스 허브를 거쳐 WS로 같은 DB를 보는 모든 세션에 즉시 방송된다.
- **참조(뷰 전용)**: `/db 참조`로 기존 데이터베이스를 읽기 전용 뷰로 삽입하거나, 외부 Postgres 테이블(`schema.table`)을 `external`로 붙일 수 있다. 참조 노드는 절대 원본을 수정하지 않는다.
- **프로젝트 격리**: 물리 테이블은 프로젝트별 스키마 `mew_{프로젝트}`에, 메타데이터(제목·컬럼)는 카탈로그 스키마 `mew`에 저장된다. 다른 프로젝트의 dbId로는 조회조차 되지 않는다.
- **전체 DB 팝업**: 메뉴 → **데이터베이스**를 누르면 이 프로젝트의 모든 데이터베이스를 한 팝업에서 골라 열람·편집한다 (에디터 노드와 같은 표를 재사용).


접속 설정이 없거나 실패하면 `/db` API만 503을 반환하고 통합 테스트는 skip된다. 에디터의 나머지 기능은 정상 동작한다.

## Postgres만 Docker Compose로 띄우기 (선택)

현재 Docker Compose는 `/db` 기능의 Postgres만 보조한다. 앱 컨테이너에는 Dockerfile이 없으므로 `--profile app`은 실행하지 않는다. 네이티브 mew 서버에서 `/db`를 쓸 때만 다음을 사용한다.

```bash
npm run db:up     # Postgres만 127.0.0.1:55432에 기동
npm run db:down   # Postgres 중지
```

`DATABASE_URL`과 `MEW_PG_PASSWORD`는 레포에 커밋하지 않는 설정 파일에 둔다. 기본 연결 예시는 [.env.example](../../.env.example)에 있다.

## 보안

- 모든 값은 파라미터(`$1`)로, 모든 식별자는 앱이 생성하거나 화이트리스트 검증(`[a-z0-9_]+`) 후 쿼팅한다 (`server/db/identifiers.ts`) — SQL 인젝션 차단.
- external(참조) 테이블은 **읽기 전용**이다. 원본 테이블에 대한 INSERT/UPDATE/DELETE/DDL은 일절 없다.
- `/db`의 모든 REST·WS는 마운트 시 `requireAuthenticated`라 **게스트는 행 데이터를 받지 못한다**.
- 백엔드 계층: `pool → identifiers → schema → catalog → databaseService → hub`, REST는 `server/db/routes.ts`, 실시간 릴레이는 `server/db/socket.ts`.

보안 경계를 구현하는 지점: `server/guestAccess.ts`(게스트 파일 단위 승인), `server/paths.ts`(deny 목록), `server/reqAuth.ts`(역할 게이팅). **정책 자체는 [SECURITY.md](../../SECURITY.md)가 기준본**이고, 여기 코드는 그것의 구현이다 — 정책을 바꾸면 docs를 같은 세션에 고친다.
