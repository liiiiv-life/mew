/** Localized first-project templates. Existing project documents are never translated. */
const copy = {
  ko: {
    agent: '에이전트 진입점', rules: '문서 관리', map: '문서 지도', current: '현재 문서', history: '이전 자료', project: '프로젝트',
    read: '프로젝트 README와 기존 지침을 먼저 읽고, 문서 지도에서 작업에 필요한 현재 문서만 확인합니다. 작업 후 관련 기준 문서를 갱신합니다.',
    ownership: '한 내용은 한 문서를 기준으로 관리하고 다른 곳에서는 링크합니다. 현재 안내와 이전 자료를 구분하고 원본을 보존합니다.',
    update: '기능·코드·운영 절차가 바뀌면 같은 작업에서 해당 문서를 갱신하고 새 문서를 지도에 연결합니다. 기존 결정을 변경하기 전에 프로젝트의 결정 기록 규칙을 따릅니다. 비밀값이나 임시 디버깅 로그를 저장하지 않습니다.',
    add: '프로젝트 문서가 생기면 여기에 연결합니다.', old: '필요한 이전 자료를 연결하고 원본을 보존합니다.', purpose: '목표, 시작 방법, 필요한 설정, 검증 방법을 기록합니다.',
  },
  ja: {
    agent: 'エージェントの入口', rules: '文書管理', map: '文書マップ', current: '現在の文書', history: '過去の資料', project: 'プロジェクト',
    read: '最初にプロジェクトのREADMEと既存の指示を読み、文書マップから作業に必要な現在の文書だけを確認します。作業後は関連する基準文書を更新します。',
    ownership: '各内容の基準文書を一つにし、他の場所からはリンクします。現在の案内と過去の資料を分け、原本を保存します。',
    update: '機能・コード・運用手順を変更したら同じ作業で文書を更新し、新しい文書をマップに追加します。既存の決定を変更する前にプロジェクトの決定記録ルールに従います。秘密情報や一時的なデバッグログを保存しません。',
    add: 'プロジェクトの文書ができたらここにリンクします。', old: '必要な過去の資料をリンクし、原本を保存します。', purpose: '目的、開始方法、必要な設定、検証方法を記録します。',
  },
  'zh-CN': {
    agent: '智能体入口', rules: '文档管理', map: '文档地图', current: '当前文档', history: '历史资料', project: '项目',
    read: '先阅读项目README和现有指令，再从文档地图中查阅当前任务所需的文档。完成工作后更新相关的基准文档。',
    ownership: '每项内容只保留一份基准文档，其他位置使用链接。区分当前指南与历史资料，并保留原件。',
    update: '功能、代码或操作流程变更时，在同一任务中更新相关文档，并将新文档加入地图。修改现有决定前遵循项目的决策记录规则。不要保存密钥或临时调试日志。',
    add: '创建项目文档后在此添加链接。', old: '链接所需的历史资料并保留原件。', purpose: '记录目标、开始方法、必要配置和验证方法。',
  },
}
export function localizedProjectTemplates(locale: string | undefined, docs: string): Map<string, string> | null {
  const c = copy[locale as keyof typeof copy]
  if (!c) return null
  const encoded = docs.split('/').map(encodeURIComponent).join('/')
  return new Map([
    [`${docs}/AGENT.md`, `# ${c.agent}\n\n[${c.rules}](README.md) · [${c.map}](MOC.md)\n\n${c.read}\n`],
    [`${docs}/README.md`, `# ${c.rules}\n\n[${c.map}](MOC.md) · [${c.agent}](AGENT.md)\n\n${c.ownership}\n\n${c.read}\n\n${c.update}\n`],
    [`${docs}/MOC.md`, `# ${c.map}\n\n## ${c.current}\n\n- [${c.agent}](AGENT.md)\n- [${c.rules}](README.md)\n\n${c.add}\n\n## ${c.history}\n\n${c.old}\n`],
    ['README.md', `# ${c.project}\n\n${c.purpose}\n\n[${c.map}](${encoded}/MOC.md) · [${c.rules}](${encoded}/README.md)\n`],
  ])
}
