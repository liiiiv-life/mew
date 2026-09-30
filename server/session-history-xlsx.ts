import { crc32 } from 'node:zlib'
import type { MewSessionRecord } from '../shared/active-sessions.ts'

// XML 1.0 cannot represent these control characters.
// eslint-disable-next-line no-control-regex
const xml = (value: string) => value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]!)
const column = (index: number) => String.fromCharCode(65 + index)
/** A small standards-based OOXML workbook. All user text is inline string data, never a formula. */
export function sessionHistoryXlsx(records: MewSessionRecord[]): Buffer {
  const rows: (string | number)[][] = [['User', 'Email', 'Browser', 'Device', 'Connected (UTC)', 'From (UTC)', 'To (UTC)', 'Observed minutes', 'Foreground', 'Running agents', 'Project', 'File', 'Disconnected (UTC)'],
    ...records.map(record => [record.displayName ?? 'Guest', record.email ?? '', record.browser ?? '', record.device ?? '',
      new Date(record.connectedAt).toISOString(), new Date(record.startedAt).toISOString(), new Date(record.endedAt).toISOString(),
      Math.round((record.endedAt - record.startedAt) / 600) / 100, record.visible ? 'Yes' : 'No', record.agents?.running ?? '',
      record.workspaceLabel ?? '', record.path ?? '', record.disconnectedAt === null ? '' : new Date(record.disconnectedAt).toISOString()])]
  const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="4" width="24" customWidth="1"/><col min="5" max="7" width="28" customWidth="1"/><col min="8" max="10" width="18" customWidth="1"/><col min="11" max="13" width="32" customWidth="1"/></cols><sheetData>${rows.map((row, index) => `<row r="${index + 1}">${row.map((cell, col) => typeof cell === 'number' ? `<c r="${column(col)}${index + 1}"><v>${cell}</v></c>` : `<c r="${column(col)}${index + 1}" t="inlineStr"${index === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${xml(cell)}</t></is></c>`).join('')}</row>`).join('')}</sheetData><autoFilter ref="A1:M${rows.length}"/></worksheet>`
  const files: [string, string][] = [
    ['[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sessions" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/styles.xml', '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0" fillId="0" borderId="0" xfId="0"/><xf fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>'],
    ['xl/worksheets/sheet1.xml', sheet],
  ]
  const local: Buffer[] = [], central: Buffer[] = []
  let offset = 0
  for (const [filename, text] of files) {
    const name = Buffer.from(filename), body = Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${text}`), checksum = crc32(body)
    const header = Buffer.alloc(30), entry = Buffer.alloc(46)
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(33, 12)
    header.writeUInt32LE(checksum, 14); header.writeUInt32LE(body.length, 18); header.writeUInt32LE(body.length, 22); header.writeUInt16LE(name.length, 26)
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x800, 8); entry.writeUInt16LE(33, 14)
    entry.writeUInt32LE(checksum, 16); entry.writeUInt32LE(body.length, 20); entry.writeUInt32LE(body.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42)
    local.push(header, name, body); central.push(entry, name); offset += header.length + name.length + body.length
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, directory, end])
}
