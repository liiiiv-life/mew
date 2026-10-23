---
title: "에이전트 메모리 보호"
created: 2026-09-21
updated: 2026-10-09
description: "Linux systemd·cgroup v2의 동적 가용 메모리 90% 에이전트 합산 한도 설치, 작업 보류·재개·진단·복구와 WSL 지원 경계를 안내한다."
상위파일: "MOC.md"
---

결정: [ADR 0205](../history/decisions/0205-mew-dynamic-agent-memory.md), [ADR 0164](../history/decisions/0164-mew-agent-memory-protection.md). 실행 계약: [에이전트 세션](../development/agent-sessions.md).

## OS 한도 설치

Linux cgroup v2·systemd 254 이상과 현재 사용자의 systemd 관리자가 필요하다. root는 필요하지 않다. mew를 실행하는 OS 사용자로 저장소 루트에서 실행한다.

```sh
sh native/agent-memory/install.sh
```

`~/.config/systemd/user/mew-agents.slice`에 설치하고 활성화한다(`XDG_CONFIG_HOME` 존중). 기존 파일은 덮어쓰지 않는다. 현재 mew·에이전트를 재시작하거나 그룹을 옮기지 않는다. 새 코드로 시작된 ACP 어댑터와 에이전트 패널 CLI 셸만 `systemd-run --user --scope`로 들어간다. 모든 탭과 자식 빌드·검사가 같은 합산 예산을 공유하며 mew 서버·독립 감독은 밖에 남는다.

| 설정 | 기본 설치값 | 역할 |
| --- | --- | --- |
| `MemoryHigh` | infinity | 초기화까지 멈추는 별도 속도 제한 제거 |
| `MemoryMax` | 초기 호스트 RAM 90%, 이후 동적 예산의 90% | 다른 앱 부하와 WSL 총량에 따라 갱신되는 최종 OS 상한 |
| `MemorySwapMax` | 호스트 RAM 25% | 에이전트 합산 스왑 상한 |

각 작업 scope에는 `OOMPolicy=kill`을 적용해 선택된 작업의 일부 자식만 죽고 나머지가 남는 것을 막는다. 일반 종료·CLI 취소도 해당 scope의 자손을 정리한다. 공유 slice 전체에 종료 신호를 보내지 않는다. systemd 설명은 [자원 제어](https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html)와 [scope OOM 정책](https://www.freedesktop.org/software/systemd/man/latest/systemd.scope.html)을 참고한다.

`MEW_AGENT_MEMORY_SCOPE`는 `auto`(기본), `required`, `off`를 지원한다. `auto`는 활성화된 유한 한도의 slice가 있을 때 적용하고, 없으면 감독 로그에 경고하며 Linux 가용 메모리 감시를 유지한다. `required`는 OS 제한을 준비할 수 없으면 실행을 거부한다. `off`는 OS scope만 끄며 가용 메모리 감시는 유지한다. 설정된 scope 실행 실패 시 제한 없이 다시 실행하지 않는다.

감독은 시작 전과 기존 2초 감시에서 `/proc/meminfo`의 `MemTotal`·`MemAvailable` 및 slice 사용량을 다시 읽는다. 에이전트의 회수 불가능 사용량은 `max(0, memory.current - inactive_file)`이며, 동적 풀은 `min(MemTotal, MemAvailable + 에이전트 회수 불가능 사용량)`이다. 이미 쓰는 메모리를 더하므로 에이전트 자체의 할당을 두 번 차감하지 않는다. 풀의 90%를 `MemoryMax`로 적용한다. OS 적용은 목표와 실제 상한이 64MiB 이상 다를 때 수행하며 `MemoryHigh=infinity`도 복구한다. 여러 감독은 실제 cgroup 값을 읽어 불필요한 중복 설정을 줄인다.

현재 `memory.current` 이하로 상한을 내리지 않는다. 외부 앱 부하나 총량 감소로 예산을 넘으면 아래 취소·보류 경로로 먼저 사용량을 줄이고 이후 상한을 적용한다. 이때 기존 상한이 잠시 유지될 수 있다. 설정 실패는 가용 메모리 확인 실패로 작업을 보류하며 제한 없는 실행으로 우회하지 않는다.

기존 설치 파일은 보존한다. 설치 스크립트를 다시 실행하면 현재 부하로 runtime 상한을 갱신한다. 새 설치의 90% 초기값도 첫 측정에서 동적 값으로 바뀐다. 런타임 설정은 systemd 재시작 후 새 감독의 첫 측정 또는 설치 스크립트 재실행으로 다시 적용한다.

## 작업 보류와 재개

감독은 2초마다, 작업 시작·큐 인출 직전에도 확인한다. Linux `MemAvailable`을 쓰며 `MemFree`만으로 판단하지 않는다. 공유 slice에서는 위 동적 풀에서 회수 불가능 사용량을 뺀 여유를 계산한다. 소프트웨어 보호는 풀의 10% 여유에서 작동하고 OS 상한도 풀의 90%이므로 예산에 10%를 이중 차감하지 않는다.

- 호스트 또는 공유 slice 여유가 **10% 이하**(최소 여유 512MiB)이면 작업 시작을 거부한다. 진행 AI 턴에는 ACP 취소를 요청하고, CLI에는 기존 중단 경로를 사용한다.
- 화면에 메모리 부족 오류를 표시하고 날짜·런타임·가용량·기준을 감독 로그에 기록한다. 오류 전사도 즉시 저장한다. 대기 AI·CLI·`/clear` 순서는 보존하고 회복 전까지 다음 작업을 실행하지 않는다.
- 회복 후 **20% 초과**(최소 여유 1GiB)가 되면 2초 주기의 감시에서 자동으로 재개한다. 작은 머신에서 요구 여유는 총량 40%로 제한한다. 아직 취소 처리 중이면 재개를 거부한다.
- 예약 메시지·기능 자동 작업은 보류된 대기열에 추가할 뿐 재개하지 않는다. 배경 단발 실행은 보류 상태에서 오류를 반환한다. 편집 잠금·인증·사용량 보류는 자동 재개로 해제하지 않는다.
- 중단된 AI 턴은 같은 세션에서 원래 모델·노력·권한으로 이어가기 메시지를 먼저 실행한다. 이전 대화와 현재 파일 상태를 확인하고 완료된 작업은 반복하지 않도록 지시한다. CLI 명령은 자동 재실행하지 않고 다음 대기 작업부터 처리한다. 사용자 중단 버튼은 자동 이어가기를 제거하고 대기열은 보존한다([ADR 0192](../history/decisions/0192-mew-agent-memory-auto-resume.md)).
- 강제 캐시 삭제나 다른 프로세스 종료는 하지 않는다. OS의 회수 또는 사용자의 메모리 정리로 여유가 확보되기를 기다린다.

SIGSTOP은 이미 쓰는 메모리를 반환하지 않으므로 사용하지 않는다. ACP가 취소를 무시하거나 2초 사이에 급증하면 OS 상한이 최종 방어선이다. OS가 어댑터까지 종료하면 감독은 종료 오류를 표시·저장하고 해당 세션을 닫는다. 이 경우 메모리상의 대기열은 복구되지 않으며, 저장한 완료 대화에서 다시 시작해야 한다. 정상 보호 보류 중 대기열이 남은 감독은 유휴 종료하지 않는다.

## 확인과 로그

```sh
systemctl --user show mew-agents.slice -p ControlGroup -p MemoryHigh -p MemoryMax -p MemorySwapMax
systemctl --user list-units 'mew-agent-*.scope'
journalctl --user --since '1 hour ago' --grep='mew-agent|oom|Killed'
```

`ControlGroup` 앞에 `/sys/fs/cgroup`을 붙인 경로의 `memory.current`, `memory.max`, `memory.events`를 확인한다. `oom_kill`은 해당 그룹 OOM 종료의 누적 횟수다. mew 오류는 `<MEW_DATA_DIR>/agent/<runtime>-<hash>.log`의 `[mew:agent-memory]`에서 찾는다. `SIGKILL`/137 자체는 메모리 부족의 확정 증거가 아니므로 journal과 함께 판단한다.

새 코드는 새 감독부터 적용된다. 진행 작업을 마친 뒤 기존 에이전트 탭을 닫고 새 탭을 열어 적용한다. mew 서버 안에 이미 로드된 예약·기능 실행 코드는 사용자의 서버 재시작 뒤 반영된다. mew 서버만 재시작해도 기존 독립 감독은 계속 살아 있으므로 그것만으로 기존 에이전트가 새 보호를 얻지는 않는다. 에이전트는 서버 빌드·재시작을 실행하지 않는다.

## WSL과 범위

WSL VM의 `memory`·`swap` 상한과 `autoMemoryReclaim`은 Windows 사용자 `.wslconfig`가 소유한다. 캐시 회수는 실행 프로세스의 메모리 상한을 대신하지 않는다. 설정 변경에는 WSL 재시작이 필요하다([Microsoft 설정 문서](https://learn.microsoft.com/en-us/windows/wsl/wsl-config)). 이 설치는 `.wslconfig`를 변경하지 않는다.

일반 터미널, terminal 표면 에이전트, 별도 서버·Docker·브라우저·Windows 프로세스는 제한 그룹 밖이다. 사용자 systemd로 직접 다른 서비스를 실행하는 작업도 그룹을 벗어날 수 있다. 감독 자체의 전사 메모리도 scope 상한에 포함되지 않는다. 따라서 이것은 자원 보호이며 보안 샌드박스나 모든 WSL 종료의 해결 보장은 아니다. Linux OOM 기록 없이 WSL 전체가 종료되면 Windows 이벤트·VM 오류도 확인해야 한다.

Linux 이외 환경에는 이 OS 제한과 `/proc` 감시를 적용하지 않는다.

## 검증

```sh
node --test --test-concurrency=2 server/agent-memory.test.ts server/agent-clear.test.ts server/agentAcp.test.ts server/agentHost.test.ts server/agent-commands.test.ts
# slice 설치 환경에서만: 64MiB의 별도 scope 안에서 OOM을 발생시키는 제한된 통합 검사
MEW_TEST_MEMORY_SCOPE=1 node --test server/agent-memory.test.ts
```

실제 호스트 메모리를 고갈시키지 않는다. 합성 메모리 값으로 AI·CLI 취소, 대기열 보존, 회복 기준·자동 이어가기·사용자 중단·자동 예약 보류를 검증한다. OS 검사는 scope 소속·인자 원문 보존·64MiB 한도 안의 OOM 종료를 확인한다.
