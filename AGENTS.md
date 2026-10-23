Mew는 독립 프로젝트다. 이 저장소의 지침과 문서가 기준이며, Liiiiv 워크스페이스의 지침·문서 갱신 절차를 적용하지 않는다.

소개·언어별 사용법은 [README.md](README.md), 문서 탐색·작성은 [docs/AGENT.md](docs/AGENT.md)와 [문서 규칙](docs/README.md)을 따른다. `node server/document-descriptions.ts`로 문서의 `description`을 읽고 관련 본문만 선택한다. MOC 탐색·등록 의무는 없다.

작업 전 [실행·검증 규칙](docs/development/getting-started.md)을, UI 작업 전 같은 문서의 [필수 UI 구현 규칙](docs/development/getting-started.md#required-ui-rules)을 읽고 따른다. 코드·기능·운영을 바꾸면 Mew 안의 소유 문서와 description을 같은 작업에서 갱신한다. 결정 기록은 [docs/decisions/](docs/decisions/README.md)에 둔다.

새 Git worktree는 기본 체크아웃의 `.worktrees/<브랜치 슬러그>`에 둔다. 브랜치 이름의 `/`는 `-`로 바꾸며, 현재 worktree 안에 다시 `.worktrees`를 만들지 않는다. 생성 전에 기본 체크아웃의 `.gitignore`에 `/.worktrees/`가 있는지 확인한다. 기존 worktree를 옮길 때는 실행 중인 프로세스·세션의 경로 의존성을 확인하고 `git worktree move`로 미커밋 변경을 보존한다.
