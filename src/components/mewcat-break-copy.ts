import type { Locale } from '../i18n-locales'
const en = {
  title: 'Rest with Mewpet', enabled: 'Enforce rest breaks', work: 'Screen time', rest: 'Rest time', hours: 'hours', minutes: 'minutes', save: 'Save break settings', saved: 'Break settings saved',
  hint: 'Counts time while this mew tab is visible and focused. When time is up, Mewpet grows over your work. The surrounding screen stays visible and usable.',
  constraint: 'Each duration must be between 1 minute and 23 hours 59 minutes. Saving a change starts a new cycle.',
  invalid: 'Enter whole hours (0–23) and minutes (0–59), with a total of at least 1 minute for each duration.',
  scope: 'Off by default. Rest continues in other windows and survives refresh. Active time is tracked separately in each browser tab. Hiding the cat does not disable breaks.',
  resting: 'Time to take a break', message: 'Look away from the screen and rest for a moment.', remaining: 'Rest time remaining', resume: 'Mewpet will shrink when the timer ends.',
}
type Copy = { [K in keyof typeof en]: string }
export const mewcatBreakCopy: Record<Locale, Copy> = {
  en,
  ko: { title: '뮤펫과 쉬기', enabled: '강제 휴식 사용', work: '사용 시간', rest: '쉬는 시간', hours: '시간', minutes: '분', save: '휴식 설정 저장', saved: '휴식 설정을 저장했어요', hint: '이 mew 탭이 보이고 활성화된 시간을 셉니다. 시간이 되면 뮤펫이 작업 화면 위에서 거대하게 커집니다. 고양이 주변 화면은 계속 보이고 조작할 수 있어요.', constraint: '각 시간은 1분부터 23시간 59분까지 설정할 수 있어요. 설정을 변경해 저장하면 새 주기를 시작합니다.', invalid: '시간은 0~23, 분은 0~59의 정수로 입력하고 각각의 합계를 1분 이상으로 설정해 주세요.', scope: '기본은 꺼짐입니다. 휴식은 다른 창에서도 흐르며 새로고침해도 이어집니다. 사용 시간은 브라우저 탭별로 셉니다. 뮤펫을 숨겨도 휴식은 유지됩니다.', resting: '이제 잠깐 쉬어요', message: '화면에서 눈을 떼고 편하게 쉬어 주세요.', remaining: '남은 휴식 시간', resume: '시간이 끝나면 뮤펫이 다시 작아져요.' },
  ja: { title: 'Mewpet と休憩', enabled: '休憩を強制する', work: '使用時間', rest: '休憩時間', hours: '時間', minutes: '分', save: '休憩設定を保存', saved: '休憩設定を保存しました', hint: 'この mew タブが表示され、フォーカスされている時間を計測します。時間になると Mewpet が作業画面の上で大きくなります。周囲の画面は見えたまま操作できます。', constraint: '各時間は1分から23時間59分まで。設定を変更して保存すると新しい周期が始まります。', invalid: '時間は0〜23、分は0〜59の整数で、それぞれ合計1分以上を入力してください。', scope: '初期設定はオフです。別ウィンドウでも休憩は進み、再読み込み後も継続します。使用時間はタブごとに計測します。猫を非表示にしても休憩は有効です。', resting: '少し休憩しましょう', message: '画面から目を離して、ゆっくり休んでください。', remaining: '残りの休憩時間', resume: '時間になると Mewpet が小さく戻ります。' },
  'zh-CN': { title: '和 Mewpet 一起休息', enabled: '启用强制休息', work: '使用时间', rest: '休息时间', hours: '小时', minutes: '分钟', save: '保存休息设置', saved: '休息设置已保存', hint: '仅统计此 mew 标签页可见且获得焦点的时间。到时 Mewpet 会在工作画面上变得巨大，猫咪周围的画面仍然可见并可操作。', constraint: '每项可设置1分钟至23小时59分钟。更改并保存设置将开始新周期。', invalid: '小时请输入0–23的整数，分钟请输入0–59的整数，每项合计至少1分钟。', scope: '默认关闭。切换窗口后休息继续，刷新后也会保留。各浏览器标签页分别计时。隐藏猫咪不会关闭休息功能。', resting: '该休息一下了', message: '请把视线移开屏幕，放松片刻。', remaining: '剩余休息时间', resume: '倒计时结束后，Mewpet 会变回原来的大小。' },
}
