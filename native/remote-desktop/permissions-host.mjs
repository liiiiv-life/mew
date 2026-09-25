// Use the installed Electron executable, just like main.mjs. Only check/request
// OS permissions here; never capture pixels or inject input.
import { app, systemPreferences, shell } from 'electron'

const mode = process.argv[2]
const profile = process.env.MEW_DESKTOP_PERMISSION_PROFILE
if (process.platform !== 'darwin' || !profile || !['check', 'accessibility', 'screen'].includes(mode)) app.exit(1)
else {
  app.setPath('userData', profile)
  app.setAppLogsPath(`${profile}/logs`)
  const stop = () => app.exit(1)
  process.stdin.resume()
  process.stdin.on('end', stop)
  process.stdin.on('error', stop)
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  process.stdout.on('error', stop)
  const watchdog = setTimeout(stop, 35_000)

  async function run() {
    await app.whenReady()
    app.dock?.hide()
    if (mode === 'accessibility' && !systemPreferences.isTrustedAccessibilityClient(false)) {
      process.stdout.write('MEW_DESKTOP_PERMISSION_REQUESTED\n')
      systemPreferences.isTrustedAccessibilityClient(true)
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
    }
    if (mode === 'screen' && systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
      const koffi = (await import('koffi')).default
      const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
      process.stdout.write('MEW_DESKTOP_PERMISSION_REQUESTED\n')
      cg.func('bool CGRequestScreenCaptureAccess()')()
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
    }
    const status = { accessibility: systemPreferences.isTrustedAccessibilityClient(false), screen: systemPreferences.getMediaAccessStatus('screen') }
    clearTimeout(watchdog)
    process.stdout.write(`MEW_DESKTOP_PERMISSIONS ${JSON.stringify(status)}\n`, () => app.exit(0))
  }
  // Finish module evaluation before waiting for Electron readiness.
  void run().catch(() => {
    process.stderr.write('Mac 권한 요청을 실행하지 못했습니다. 로그인 세션과 시스템 설정을 확인해 주세요.\n', stop)
  })
}
