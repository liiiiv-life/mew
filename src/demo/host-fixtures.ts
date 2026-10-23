import type { AgentJobView, AndroidEnvStatus, MewUpdateStatus, SystemStats } from '../api/client.ts'
import type { UpdatesStatus } from '../../shared/updates.ts'

export function demoSystemStats(now = Date.now()): SystemStats {
  const wave = Math.sin(now / 4200), total = 16 * 1024 ** 3, used = Math.round((6.2 + wave * .15) * 1024 ** 3)
  return {
    hostname: 'mew-demo', uptime: 86400 + Math.floor(now / 1000) % 86400,
    cpu: { model: 'Demo CPU · 8 cores', cores: 8, usage: 24 + wave * 6, loadavg: [1.42, 1.18, .96], temperature: 48 + wave * 2 },
    memory: { total, used, available: total - used },
    gpus: [{ name: 'Demo GPU', utilization: 18 + wave * 4, memoryUsedMb: 1280, memoryTotalMb: 8192, temperature: 44 }],
    processes: [
      { pid: 1200, name: 'mew', cmd: 'node server/index.ts (demo)', cpu: 12 + wave, memMb: 384, gpuMemMb: 0 },
      { pid: 1201, name: 'agent', cmd: 'demo-agent · simulated', cpu: 8, memMb: 256, gpuMemMb: 0 },
      { pid: 1202, name: 'desktop', cmd: 'demo desktop renderer', cpu: 4, memMb: 96, gpuMemMb: 1280 },
      { pid: 1203, name: 'android', cmd: 'demo Android gateway', cpu: 3, memMb: 768, gpuMemMb: 0 },
    ],
  }
}

export const demoMewUpdate: MewUpdateStatus = { supported: true, canUpdate: true, branch: 'demo', localHash: 'demo001', remoteHash: 'demo002', ahead: 0, behind: 1, available: true, dirty: false, running: false, managedByMew: true, error: null, job: null }
export const demoUpdates: UpdatesStatus = {
  checkedAt: 0, job: { running: false, items: [] },
  items: [
    { id: 'demo-agent', label: 'Demo agent', category: 'agent', current: '1.0-demo', latest: '1.1-demo', available: true, canUpdate: true, error: null },
    { id: 'demo-desktop', label: 'Remote desktop · Demo', category: 'system', current: '1.0-demo', latest: '1.1-demo', available: true, canUpdate: true, error: null },
    { id: 'demo-dependencies', label: 'Mew dependencies · Demo', category: 'dependency', current: 'snapshot.1', latest: 'snapshot.2', available: true, canUpdate: true, error: null },
  ],
}

export function demoScheduleJobs(project: string): AgentJobView[] {
  return [
    { id: 'demo-docs', name: '문서 변경 요약 · Demo', cron: '0 9 * * 1-5', project, agent: 'codex', agentSetId: 'demo-default', prompt: '바뀐 문서를 요약하고 확인할 항목을 정리해 주세요.', enabled: true },
    { id: 'demo-tasks', name: '태스크 검토 · Demo', cron: '0 14 * * 1', project, agent: 'codex', agentSetId: 'demo-default', prompt: '미완료 태스크와 다음 작업을 정리해 주세요.', enabled: false },
  ].map(job => ({ ...job, command: `demo-agent --job ${job.id} (simulated)`, lastRun: null, session: `mewcmd-job-${job.id}`, running: false }))
}

export function demoAndroidStatus(active: string[]): AndroidEnvStatus {
  return {
    platform: 'linux (demo)', architecture: 'x64', isWsl: false, sdkRoot: '/demo/android-sdk',
    checks: [
      { id: 'sdk', label: 'Android SDK', ok: true, detail: 'Demo SDK · API 35' },
      { id: 'device', label: '가상 기기', ok: true, detail: 'Mew Demo Phone · 1080 × 2400' },
      { id: 'gateway', label: 'Gateway', ok: true, detail: '브라우저 안의 가상 Android 화면' },
    ],
    suggestedCommands: [
      { id: 'emulator', context: 'Demo emulator', command: 'emulator -avd Mew_Demo', session: 'mewcmd-demo-android-emulator', running: active.includes('mewcmd-demo-android-emulator') },
      { id: 'gateway', context: 'Demo gateway', command: 'android-gateway --device demo', session: 'mewcmd-demo-android-gateway', running: active.includes('mewcmd-demo-android-gateway') },
    ],
  }
}

/** A script-free, self-contained phone preview; inherited CSP permits only its inline style. */
export const DEMO_ANDROID_HTML = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mew Demo Phone</title><style>
*{box-sizing:border-box}body{margin:0;background:#121923;color:#e8eff8;font:14px/1.6 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:20px}.phone{width:min(100%,320px);min-height:460px;border:1px solid #46566b;border-radius:28px;background:#202c3b;padding:22px}header{display:flex;justify-content:space-between;color:#bfd0e4;font-size:12px}h1{font-size:25px;margin:42px 0 8px}p{color:#bfd0e4}nav{display:flex;gap:8px;margin:24px 0}label,summary{cursor:pointer}nav label{flex:1;padding:10px;text-align:center;background:#34455c;border-radius:8px}.view{display:none}#home:checked~.home,#notes:checked~.notes,#settings:checked~.settings{display:block}input[type=radio]{position:absolute;opacity:0}input[type=radio]:focus-visible+label{outline:2px solid #acd6ff}textarea{width:100%;height:130px;background:#121923;border:1px solid #6a809d;border-radius:8px;color:#e8eff8;font:inherit;padding:12px}dl{display:grid;grid-template-columns:auto 1fr;gap:12px}dd{text-align:right;margin:0}small{color:#bfd0e4}details{margin-top:20px}summary{padding:8px 0}
.phone:has(#home:focus-visible) label[for=home],.phone:has(#notes:focus-visible) label[for=notes],.phone:has(#settings:focus-visible) label[for=settings]{outline:2px solid #acd6ff;outline-offset:2px}
</style><main class="phone"><header><span>9:41 · Demo</span><span>Wi-Fi · 100%</span></header><h1>Mew Demo Phone</h1><p>Android 패널의 가상 미리보기입니다.</p><nav aria-label="앱"><label for="home">홈</label><label for="notes">메모</label><label for="settings">설정</label></nav><input type="radio" name="screen" id="home" checked><input type="radio" name="screen" id="notes"><input type="radio" name="screen" id="settings"><section class="view home"><h2>환영합니다</h2><p>메모와 설정을 눌러 체험해 보세요.</p><details><summary>이 화면에 관하여</summary>실제 기기·에뮬레이터에 연결하지 않습니다. 설치·화면 전송은 체험용입니다.</details></section><section class="view notes"><h2>메모</h2><textarea aria-label="데모 메모" placeholder="Android 체험 메모를 적어 보세요."></textarea><small>화면을 다시 열면 메모가 사라집니다.</small></section><section class="view settings"><h2>기기 정보</h2><dl><dt>모델</dt><dd>Mew Demo Phone</dd><dt>Android</dt><dd>15 · Demo</dd><dt>연결</dt><dd>로컬 시뮬레이션</dd></dl></section><p><small>Demo · 실제 기기에 반영되지 않습니다.</small></p></main></html>`
