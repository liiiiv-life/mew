/** Deterministic force engine. Repulsion is Barnes–Hut O(n log n), springs O(e). */
type Cell = { x: number; y: number; size: number; mass: number; cx: number; cy: number; indices: number[]; children: Cell[] }

export class DocumentGraphLayout {
  readonly positions: Float32Array
  private velocity: Float32Array
  private edges: Uint32Array
  private pinned = new Map<number, [number, number]>()
  alpha = 1
  visits = 0

  constructor(count: number, edges: Uint32Array) {
    this.positions = new Float32Array(count * 2)
    this.velocity = new Float32Array(count * 2)
    this.edges = edges
    for (let i = 0; i < count; i++) {
      const angle = i * 2.399963229728653, radius = 22 * Math.sqrt(i)
      this.positions[i * 2] = Math.cos(angle) * radius
      this.positions[i * 2 + 1] = Math.sin(angle) * radius
    }
  }

  pin(index: number, point: [number, number] | null): void {
    if (index < 0 || index >= this.positions.length / 2) return
    if (point) this.pinned.set(index, point)
    else this.pinned.delete(index)
    this.alpha = Math.max(this.alpha, 0.3)
  }

  private tree(indices: number[], x: number, y: number, size: number, depth = 0): Cell {
    let cx = 0, cy = 0
    for (const index of indices) { cx += this.positions[index * 2]; cy += this.positions[index * 2 + 1] }
    const cell: Cell = { x, y, size, mass: indices.length, cx: cx / indices.length, cy: cy / indices.length, indices, children: [] }
    if (indices.length <= 1 || depth >= 20 || size < 0.01) return cell
    const half = size / 2, buckets: number[][] = [[], [], [], []]
    for (const index of indices) {
      const quadrant = (this.positions[index * 2] >= x + half ? 1 : 0) + (this.positions[index * 2 + 1] >= y + half ? 2 : 0)
      buckets[quadrant].push(index)
    }
    cell.indices = []
    for (let q = 0; q < 4; q++) if (buckets[q].length) cell.children.push(this.tree(buckets[q], x + (q % 2) * half, y + (q >= 2 ? half : 0), half, depth + 1))
    return cell
  }

  step(): boolean {
    const count = this.positions.length / 2
    if (!count || this.alpha < 0.012) return false
    const pos = this.positions, vel = this.velocity, alpha = this.alpha
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let i = 0; i < pos.length; i += 2) { minX = Math.min(minX, pos[i]); minY = Math.min(minY, pos[i + 1]); maxX = Math.max(maxX, pos[i]); maxY = Math.max(maxY, pos[i + 1]) }
    const root = this.tree(Array.from({ length: count }, (_, i) => i), minX - 1, minY - 1, Math.max(maxX - minX, maxY - minY, 1) + 2)
    this.visits = 0
    for (let i = 0; i < count; i++) {
      const x = pos[i * 2], y = pos[i * 2 + 1]
      const stack = [root]
      let fx = -x * 0.0009, fy = -y * 0.0009
      while (stack.length) {
        const cell = stack.pop()!
        this.visits++
        const dx = x - cell.cx, dy = y - cell.cy, distance2 = dx * dx + dy * dy + 25
        const contains = x >= cell.x && x <= cell.x + cell.size && y >= cell.y && y <= cell.y + cell.size
        if (cell.children.length && (contains || cell.size * cell.size / distance2 > 0.64)) { stack.push(...cell.children); continue }
        if (!cell.children.length) {
          for (const other of cell.indices) {
            if (other === i) continue
            let ox = x - pos[other * 2], oy = y - pos[other * 2 + 1]
            if (ox === 0 && oy === 0) { ox = i < other ? -0.1 : 0.1; oy = 0.1 }
            const force = 800 / (ox * ox + oy * oy + 25)
            fx += ox * force; fy += oy * force
          }
        } else {
          const force = 800 * cell.mass / distance2
          fx += dx * force; fy += dy * force
        }
      }
      vel[i * 2] += fx * alpha; vel[i * 2 + 1] += fy * alpha
    }
    for (let e = 0; e < this.edges.length; e += 2) {
      const a = this.edges[e] * 2, b = this.edges[e + 1] * 2
      const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1]
      const distance = Math.hypot(dx, dy) || 1, force = (distance - 90) / distance * 0.015 * alpha
      vel[a] += dx * force; vel[a + 1] += dy * force; vel[b] -= dx * force; vel[b + 1] -= dy * force
    }
    for (let i = 0; i < count; i++) {
      const pin = this.pinned.get(i)
      if (pin) { pos[i * 2] = pin[0]; pos[i * 2 + 1] = pin[1]; vel[i * 2] = 0; vel[i * 2 + 1] = 0; continue }
      for (let axis = 0; axis < 2; axis++) {
        const j = i * 2 + axis
        vel[j] = Math.max(-24, Math.min(24, vel[j] * 0.72))
        pos[j] += vel[j]
      }
    }
    this.alpha *= 0.978
    return true
  }
}
