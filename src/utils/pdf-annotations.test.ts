import assert from 'node:assert/strict'
import test from 'node:test'
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, decodePDFRawStream, degrees } from 'pdf-lib'
import { annotatePdf } from './pdf-annotations.ts'

test('standard Ink annotations retain original content, rotation, crop and foreign annotations', async () => {
  const original = await PDFDocument.create()
  const page = original.addPage([400, 600])
  page.setRotation(degrees(90)); page.setCropBox(25, 30, 300, 500)
  page.drawText('Selectable source text')
  page.node.addAnnot(original.context.register(original.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [20, 20, 40, 40] })))
  const bytes = await original.save()
  const saved = await annotatePdf(bytes, [{ id: 'test', page: 1, points: [[60, 75], [120, 130]], color: '#185abc', width: 2, opacity: .32 }])
  const document = await PDFDocument.load(saved)
  const annotated = document.getPage(0)
  assert.equal(annotated.getRotation().angle, 90)
  assert.deepEqual(annotated.getCropBox(), { x: 25, y: 30, width: 300, height: 500 })
  assert.equal(annotated.node.Annots()!.size(), 2)
  const ink = annotated.node.Annots()!.lookup(1, PDFDict)
  assert.equal(ink.get(PDFName.of('Subtype'))!.toString(), '/Ink')
  assert.deepEqual(ink.lookup(PDFName.of('InkList'), PDFArray).lookup(0, PDFArray).asArray().map(n => Number(n.toString())), [60, 75, 120, 130])
  const appearance = ink.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'), PDFRawStream)
  const content = new TextDecoder().decode(decodePDFRawStream(appearance).decode())
  assert.match(content, /60 75 m\n120 130 l\nS/)
  assert.ok(annotated.node.Contents())
  assert.deepEqual(await PDFDocument.load(bytes).then(doc => doc.getPage(0).node.Annots()!.size()), 1)
})

test('tap strokes have a visible appearance and invalid coordinates fail before saving', async () => {
  const original = await PDFDocument.create(); original.addPage()
  const bytes = await original.save()
  const tap = { id: 'tap', page: 1, points: [[20, 30] as [number, number]], color: '#202124', width: 2, opacity: 1 }
  const output = await PDFDocument.load(await annotatePdf(bytes, [tap]))
  const ink = output.getPage(0).node.Annots()!.lookup(0, PDFDict)
  assert.equal(ink.lookup(PDFName.of('InkList'), PDFArray).lookup(0, PDFArray).size(), 4)
  await assert.rejects(annotatePdf(bytes, [{ ...tap, points: [[NaN, 0]] }]), /Invalid ink/)
  await assert.rejects(annotatePdf(bytes, [{ ...tap, page: 2 }]), /Invalid ink/)
})

test('signed PDF bytes are never rewritten', async () => {
  const original = await PDFDocument.create(); original.addPage()
  original.context.register(original.context.obj({ Type: 'Sig', ByteRange: [0, 100, 200, 100] }))
  await assert.rejects(annotatePdf(await original.save(), []), /Signed or certified/)
})
