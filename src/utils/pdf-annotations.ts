import { PDFDocument, PDFDict, PDFName, PDFString } from 'pdf-lib'
import type { InkStroke } from './pdf-geometry.ts'

/** Standard Ink annotations with vector appearance streams, visible in readers and in print. */
export async function annotatePdf(bytes: Uint8Array, strokes: readonly InkStroke[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
  const pages = pdf.getPages(), context = pdf.context
  if (pdf.catalog.has(PDFName.of('Perms')) || context.enumerateIndirectObjects().some(([, object]) => object instanceof PDFDict && (object.get(PDFName.of('Type')) === PDFName.of('Sig') || object.get(PDFName.of('FT')) === PDFName.of('Sig')))) {
    throw new Error('Signed or certified PDF cannot be rewritten')
  }
  for (const stroke of strokes) {
    const page = pages[stroke.page - 1]
    if (!page || !stroke.points.length || !/^#[\da-f]{6}$/i.test(stroke.color) || !Number.isFinite(stroke.width) || stroke.width <= 0 || !Number.isFinite(stroke.opacity) || stroke.opacity <= 0 || stroke.opacity > 1 || stroke.points.some(p => p.length !== 2 || p.some(n => !Number.isFinite(n)))) throw new Error('Invalid ink stroke')
    const points = stroke.points.length === 1 ? [stroke.points[0], [stroke.points[0][0] + 0.01, stroke.points[0][1]]] : stroke.points
    let left = Infinity, bottom = Infinity, right = -Infinity, top = -Infinity
    for (const [x, y] of points) { left = Math.min(left, x); bottom = Math.min(bottom, y); right = Math.max(right, x); top = Math.max(top, y) }
    const pad = stroke.width / 2 + 1
    const rect = [left - pad, bottom - pad, right + pad, top + pad]
    const color = [1, 3, 5].map(i => parseInt(stroke.color.slice(i, i + 2), 16) / 255)
    const n = (value: number) => Number(value.toFixed(4)).toString()
    const commands = ['q', '/GS gs', `${color.map(n).join(' ')} RG`, `${n(stroke.width)} w`, '1 J 1 j', ...points.map(([x, y], i) => `${n(x)} ${n(y)} ${i ? 'l' : 'm'}`), 'S', 'Q'].join('\n')
    const appearance = context.register(context.flateStream(commands, {
      Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: rect,
      Resources: { ExtGState: { GS: { Type: 'ExtGState', CA: stroke.opacity, ca: stroke.opacity, BM: stroke.opacity < 1 ? 'Multiply' : 'Normal' } } },
    }))
    const annotation = context.register(context.obj({
      Type: 'Annot', Subtype: 'Ink', Rect: rect, InkList: [points.flat()], C: color,
      BS: { W: stroke.width, S: 'S' }, CA: stroke.opacity, F: 4,
      NM: PDFString.of(`mew-ink:${stroke.id}`), M: PDFString.fromDate(new Date()),
      AP: { N: appearance }, P: page.ref,
    }))
    page.node.addAnnot(annotation)
  }
  // Preserve existing page content, links, forms and annotations; never rasterize the source.
  return pdf.save({ objectsPerTick: 50 })
}
