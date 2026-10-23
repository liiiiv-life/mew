---
title: "외부 로컬 스프라이트 MCP 연결"
description: "Mew와 별도인 local-sprites를 MCP로 연결하고 이미지 전용 모델의 대표이미지 생성·선택 후 애니메이션과 선택적 Mewpet 등록으로 이어가는 사용법, 재사용·배포 경계를 설명한다."
created: 2026-10-19
updated: 2026-10-19
상위파일: "agent-harness.md"
---

# 외부 로컬 스프라이트 MCP 연결

`local-sprites`는 Mew와 별도인 오픈소스 도구다. 생성 코드·Python 의존성·모델 가중치는 Mew 배포에 포함하지 않는다. 다른 MCP 클라이언트에서도 재사용하며, 설치·모델·생성·검증 안내는 별도 프로젝트의 `README.md`가 소유한다. [결정 0021](../decisions/0021-external-local-sprites.md)을 따른다.

## Codex에 연결

현재 도구 소스는 `/home/saens/dev/local-sprites`, 설치된 모델·가상환경·작업 데이터는 `~/.local/share/mew-sprites`에 있다. 기존 데이터는 다시 다운로드하지 않고 유지한다. 새 설치의 기본 데이터 위치는 `~/.local/share/local-sprites`다.

다음은 Mew의 활성 `DATA_DIR`가 `/home/saens/dev/mew/.data`인 현재 설치 예시다. 다른 설치에서는 소스·Python·데이터·스킨 경로를 실제 절대 경로로 바꾼다. [Mew 데이터 위치](../development/architecture.md#서버-상태-파일-data)를 확인한다.

```bash
"$HOME/.local/share/mew-sprites/venv/bin/python" \
  /home/saens/dev/local-sprites/register_mcp.py \
  --runtime codex \
  --python "$HOME/.local/share/mew-sprites/venv/bin/python" \
  --sprites-home "$HOME/.local/share/mew-sprites" \
  --skins-dir /home/saens/dev/mew/.data/mewpet/skins
```

기존 `local-sprites` 항목을 이전 경로에서 옮길 때는 `--replace`를 붙인다. 다른 MCP 항목은 보존한다. Mew 체크아웃이나 Node.js는 등록에 필요하지 않다. 다른 클라이언트는 `--print-config`로 얻은 stdio 설정을 해당 클라이언트 형식에 맞춰 등록한다. Mewpet 등록이 필요 없으면 `--skins-dir`를 생략한다.

## 채팅에서 사용

등록 후 Mew에서 **새 Codex 채팅**을 열고 `local_sprite_status`로 설치·GPU·등록 경로를 확인한다. 예: **“첨부한 이미지를 참고해서 뮤펫을 그려 줘. 가만히 있기·걷기·잡힌 동작을 만들고 결과를 보여 줘.”** 참조 이미지는 선택 사항이며 에이전트가 접근할 수 있는 로컬 경로로 전달한다.

에이전트는 먼저 `generate_character`로 이미지 전용 모델의 대표이미지를 만들고 `get_sprite_job`·`preview_character`로 보여 준다. 대표이미지만 요청했다면 여기서 마친다. 사용자가 이미지를 고르면 `generate_sprites`에 해당 `character_job_id` 또는 선택한 이미지의 로컬 경로를 전달해 애니메이션을 만들고 `preview_sprites`로 확인한다. 생성 완료는 파일이 준비됐다는 뜻이며 그림의 형태·동작 품질은 실제 결과로 확인한다. 현재 동작 생성은 실험 단계로 외형 변형·불필요한 물체·반복 연결 문제가 남아 있어 원본 프레임과 GIF를 확인해야 한다.

사용자가 등록을 요청하면 `install_sprite_skin`이 지정한 `<DATA_DIR>/mewpet/skins`에 추가한다. 이후 **설정 → 뮤펫**에서 선택한다. [스킨 형식](../features/화면%C2%B7계정%C2%B7운영/Mewpet%20마스코트%C2%B7알림%C2%B7휴식.md#파일로-스킨-등록)은 Mew가 소유하며, 생성 도구 설치나 연결에 Mew 빌드·재시작은 필요 없다.
