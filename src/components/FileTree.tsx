import { useState } from 'react'
import type { TreeNode } from '../api/client'

function Node({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: TreeNode
  depth: number
  selectedPath: string | null
  onSelect: (path: string, opts?: { preview?: boolean }) => void
}) {
  const [open, setOpen] = useState(depth < 1)

  if (node.type === 'file') {
    const isSelected = node.path === selectedPath
    return (
      <button
        type="button"
        onClick={() => onSelect(node.path)}
        onDoubleClick={() => onSelect(node.path, { preview: false })}
        className={`block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-surface-raised ${
          isSelected ? 'bg-surface-raised font-medium' : ''
        }`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        {node.name}
      </button>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="block w-full truncate rounded px-2 py-1 text-left text-sm font-medium text-ink-secondary hover:bg-surface-raised"
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        {open ? '▾' : '▸'} {node.name}
      </button>
      {open && node.children && (
        <div>
          {node.children.map((child) => (
            <Node key={child.path} node={child} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  )
}

export function FileTree({
  tree,
  selectedPath,
  onSelect,
}: {
  tree: TreeNode[]
  selectedPath: string | null
  onSelect: (path: string, opts?: { preview?: boolean }) => void
}) {
  return (
    <div className="h-full overflow-y-auto border-r border-edge bg-surface-deep py-2">
      {tree.map((node) => (
        <Node key={node.path} node={node} depth={0} selectedPath={selectedPath} onSelect={onSelect} />
      ))}
    </div>
  )
}
