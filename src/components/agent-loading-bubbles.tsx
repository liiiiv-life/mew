export function AgentLoadingBubbles({ label, active = true, compact = false }: {
  label: string
  active?: boolean
  compact?: boolean
}) {
  return (
    <div className="agent-loading-bubbles" data-active={active} data-compact={compact} role="status" aria-label={label}>
      <div aria-hidden="true" className="agent-loading-bubbles__shapes">
        <div className="agent-loading-bubbles__bubble" />
        <div className="agent-loading-bubbles__bubble" />
        <div className="agent-loading-bubbles__bubble" />
        {!compact && <div className="agent-loading-bubbles__bubble" />}
      </div>
    </div>
  )
}
