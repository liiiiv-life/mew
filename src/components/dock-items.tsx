import { Brain, Computer, EditPencil, Folder, GitBranch, Globe, Notes, Terminal, Calendar } from 'iconoir-react'
import { uiText } from '@mew/ui/i18n-core'
import { useI18n } from '../i18n'
import { featureCopy } from './feature-copy'
import { FeatureIcon } from './feature-icon'
import type { MobileDockPanel } from '../utils/mobile-dock'

export const dockIcons = { sidebar: Folder, editor: EditPencil, agent: Brain, terminal: Terminal, git: GitBranch, browser: Globe, desktop: Computer, features: FeatureIcon, memo: Notes, tasks: Calendar }
const labels = { sidebar: 'panel.sidebar', editor: 'panel.editor', agent: 'header.agent', terminal: 'header.terminal', git: 'access.git', browser: 'header.browser', desktop: 'access.desktop' } as const
export function useDockLabel() {
  const { t, locale } = useI18n()
  return (id: MobileDockPanel) => id === 'tasks' ? uiText('태스크') : id === 'memo' ? uiText('메모') : id === 'features' ? featureCopy[locale].title : t(labels[id])
}
