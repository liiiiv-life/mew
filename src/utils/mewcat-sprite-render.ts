import type { SpriteStrip } from './mewcat-sprites'

export function paintSpriteFrame(svg: SVGSVGElement, strip: SpriteStrip, frame: number): void {
  if (svg.dataset.source === strip.src && svg.dataset.frame === String(frame)) return
  svg.dataset.source = strip.src
  svg.dataset.frame = String(frame)
  const width = strip.width / strip.frames
  svg.setAttribute('viewBox', `0 0 ${width} ${strip.height}`)
  const image = svg.querySelector('image')!
  image.setAttribute('href', strip.src)
  image.setAttribute('width', String(strip.width))
  image.setAttribute('height', String(strip.height))
  image.setAttribute('x', String(-frame * width))
  svg.querySelector('g')!.setAttribute('transform', `scale(${width / 48} ${strip.height / 48})`)
  svg.querySelector('path')!.setAttribute('d', strip.hitPaths[frame])
}
