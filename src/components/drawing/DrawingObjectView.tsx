import { memo } from 'react'
import type { DrawingObject } from './model'
import { pathData } from './geometry'

export const DrawingObjectView = memo(function DrawingObjectView({ object }: { object: DrawingObject }) {
  const { x, y, width, height, rotation } = object
  const paint = { fill: object.fill, stroke: object.stroke, strokeWidth: object.strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return <g data-drawing-object={object.id} transform={`translate(${x} ${y}) rotate(${rotation} ${width / 2} ${height / 2})`}>
    {object.type === 'rect' && <rect width={width} height={height} {...paint} />}
    {object.type === 'ellipse' && <ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} {...paint} />}
    {object.type === 'line' && <path d={object.points?.length ? pathData(object.points) : `M0 0 L${width} ${height}`} {...paint} fill="none" />}
    {object.type === 'path' && <path d={pathData(object.points ?? [], object.closed)} {...paint} />}
    {object.type === 'image' && <image href={object.src} width={width} height={height} preserveAspectRatio="none" />}
    {object.type === 'text' && <g transform={`scale(${object.textScaleX ?? 1} ${object.textScaleY ?? 1})`}><text {...paint} xmlSpace="preserve" fontFamily={object.fontFamily} fontSize={object.fontSize} fontWeight={object.fontWeight}>
      {(object.text ?? '').split('\n').map((line, index) => <tspan key={index} x={0} y={(index + 1) * (object.fontSize ?? 24) * 1.2 - (object.fontSize ?? 24) * .2}>{line || '\u00a0'}</tspan>)}
    </text></g>}
  </g>
})
