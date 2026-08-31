import type { TreeNode } from '@mew/editor'
import type { MentionOption } from '../components/MentionTextarea'

type Project = { name: string }

const SUBPROJECT = 0
const FOLDER = 1
const FILE = 2

/**
 * 에이전트 입력의 @ 목록. 워크스페이스 프로젝트는 기존 # 토큰을 그대로 넣고,
 * 현재 프로젝트 트리의 폴더·파일은 기존 파일 참조 토큰을 쓴다.
 */
export function agentInputMentionOptions(tree: TreeNode[], project: string, projects: Project[]): MentionOption[] {
  const options = new Map<string, MentionOption>()

  for (const item of projects) {
    options.set(`project:${item.name}`, {
      id: `project:${item.name}`,
      label: item.name,
      hint: '하위 프로젝트',
      insert: `#${item.name}`,
      sortPriority: SUBPROJECT,
    })
  }

  const visit = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.project) {
        // 워크스페이스 프로젝트 목록과 겹치면 # 토큰 쪽을 보존한다.
        const id = `project:${node.name}`
        if (!options.has(id)) {
          options.set(id, {
            id,
            label: node.name,
            hint: '하위 프로젝트',
            insert: `[[${project}:${node.path}]]`,
            sortPriority: SUBPROJECT,
          })
        }
      } else {
        options.set(`${node.type}:${node.path}`, {
          id: `${node.type}:${node.path}`,
          label: node.name,
          hint: node.path,
          insert: `[[${project}:${node.path}]]`,
          sortPriority: node.type === 'dir' ? FOLDER : FILE,
        })
      }
      if (node.children) visit(node.children)
    }
  }

  visit(tree)
  return [...options.values()]
}
