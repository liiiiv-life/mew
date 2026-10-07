import { uiText, getUiLocale } from '@mew/ui/i18n-core'
import type { TreeNode } from '@mew/editor'
import type { MentionOption } from '../components/MentionTextarea'

type Project = { name: string }

const FOCUSED_FILE = -1
const SUBPROJECT = 0
const FOLDER = 1
const FILE = 2

/**
 * 에이전트 입력의 @ 목록. 워크스페이스 프로젝트는 대괄호 토큰을 한 줄로 넣고,
 * 현재 프로젝트와 Documents의 폴더·파일은 각 스코프의 파일 참조 토큰을 쓴다.
 */
export function agentInputMentionOptions(tree: TreeNode[], project: string, projects: Project[], focusedFilePath: string | null = null, documentsTree: TreeNode[] = [], locale = getUiLocale()): MentionOption[] {
  const options = new Map<string, MentionOption>()

  // 에디터가 마지막으로 가리킨 파일은 트리가 아직 지연 로드된 폴더 안에 있어도 바로 멘션할 수 있다.
  // AgentPanel은 워크스페이스 밖 preview 탭을 넘기지 않으므로 이 토큰은 항상 현재 프로젝트를 가리킨다.
  if (focusedFilePath) {
    options.set(`file:${project}:${focusedFilePath}`, {
      id: `file:${project}:${focusedFilePath}`,
      label: focusedFilePath.split('/').pop() ?? focusedFilePath,
      hint: project === 'docs' ? `Documents/${focusedFilePath}` : focusedFilePath,
      hintTruncateStart: true,
      insert: `[[${project}:${focusedFilePath}]]`,
      sortPriority: FOCUSED_FILE,
    })
  }

  for (const item of projects) {
    options.set(`project:${item.name}`, {
      id: `project:${item.name}`,
      label: item.name,
      hint: uiText("하위 프로젝트", undefined, locale),
      insert: `[${item.name}]`,
      insertSuffix: '\n',
      sortPriority: SUBPROJECT,
    })
  }

  const visit = (nodes: TreeNode[], scope: string) => {
    for (const node of nodes) {
      if (node.project && scope !== 'docs') {
        // 워크스페이스 프로젝트 목록과 겹치면 대괄호 토큰 쪽을 보존한다.
        const id = `project:${node.name}`
        if (!options.has(id)) {
          options.set(id, {
            id,
            label: node.name,
            hint: uiText("하위 프로젝트", undefined, locale),
            insert: `[${node.name}]`,
            insertSuffix: '\n',
            sortPriority: SUBPROJECT,
          })
        }
      } else {
        const id = `${node.type}:${scope}:${node.path}`
        // 위에서 넣은 마지막 포커스 파일은 파일 일반 우선순위로 덮어쓰지 않는다.
        if (!options.has(id)) {
          options.set(id, {
            id,
            label: node.name,
            hint: `${scope === 'docs' ? 'Documents/' : ''}${node.path}${node.type === 'dir' ? '/' : ''}`,
            hintTruncateStart: true,
            insert: `[[${scope}:${node.path}]]`,
            sortPriority: node.type === 'dir' ? FOLDER : FILE,
          })
        }
      }
      if (node.children) visit(node.children, scope)
    }
  }

  visit(tree, project)
  visit(documentsTree, 'docs')
  return [...options.values()]
}
