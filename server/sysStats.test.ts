// 호스트 자원 스냅샷 — 센서·GPU가 없는 기계에서도 값의 범위가 성립하는지 본다.
import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import { collectSystemStats, parsePsProcesses } from './sysStats.ts'

test('parsePsProcesses: macOS ps 출력을 프로세스 목록으로 바꾼다', () => {
  const stats = parsePsProcesses(
    [
      '  101   0.0   512 /sbin/launchd /sbin/launchd',
      '  202 123.4 20480 /Applications/Foo.app/Contents/MacOS/Foo /Applications/Foo.app/Contents/MacOS/Foo --flag',
      '',
    ].join('\n'),
    new Map([[202, 64]]),
    8,
  )

  assert.equal(stats.length, 2)
  assert.equal(stats[0].pid, 202)
  assert.equal(stats[0].name, 'Foo')
  assert.equal(stats[0].cpu, 123.4)
  assert.equal(stats[0].memMb, 20)
  assert.equal(stats[0].gpuMemMb, 64)
  assert.ok(!stats[0].cmd.includes('\0'))
})

test('collectSystemStats: 범위가 성립한다', async () => {
  await collectSystemStats() // 첫 호출은 표본만 잡는다
  const s = await collectSystemStats()

  assert.equal(s.cpu.cores, os.cpus().length)
  if (s.cpu.usage !== null) {
    assert.ok(s.cpu.usage >= 0 && s.cpu.usage <= 100, `usage=${s.cpu.usage}`)
  }
  assert.ok(s.memory.total > 0)
  assert.ok(s.memory.used >= 0 && s.memory.used <= s.memory.total)
  assert.equal(s.memory.used + s.memory.available, s.memory.total)
  assert.ok(Array.isArray(s.gpus))
  for (const g of s.gpus) {
    assert.equal(typeof g.name, 'string')
    if (g.utilization !== null) assert.ok(g.utilization >= 0 && g.utilization <= 100)
  }

  assert.ok(Array.isArray(s.processes))
  if (process.platform === 'linux') {
    // 자기 자신은 반드시 목록에 있다 — /proc 파싱이 통째로 깨지면 여기서 걸린다
    const self = s.processes.find((p) => p.pid === process.pid)
    assert.ok(self, '자기 프로세스가 목록에 없다')
    assert.ok(self.memMb > 0, `memMb=${self.memMb}`)
    // sort(cpu 내림차순)와 필드 범위
    for (let i = 1; i < s.processes.length; i++) {
      assert.ok(s.processes[i - 1].cpu >= s.processes[i].cpu, '정렬이 깨졌다')
    }
    for (const p of s.processes) {
      assert.ok(Number.isInteger(p.pid) && p.pid > 0)
      assert.ok(p.cpu >= 0 && p.cpu <= os.cpus().length * 100, `pid=${p.pid} cpu=${p.cpu}`)
      assert.ok(p.memMb >= 0 && p.memMb <= s.memory.total / 1024 ** 2)
      assert.ok(p.gpuMemMb >= 0)
      assert.ok(!p.name.includes('\0') && !p.cmd.includes('\0'))
    }
  }
})
