import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { defaultDebugConfig } from '../shared/debugger.ts'
const exec = promisify(execFile)

test('managed js-debug installs and repairs a CommonJS boundary inside an ESM project', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-debugger-esm-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  process.env.MEW_DATA_DIR = path.join(root, '.data')
  await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}')
  const { jsDebugEntry, installJsDebug, prepareJsDebugPackage } = await import('./debugger-install.ts')
  const directory = path.dirname(path.dirname(jsDebugEntry))
  await fs.mkdir(path.dirname(jsDebugEntry), { recursive: true })
  await fs.writeFile(path.join(directory, 'src', 'worker.js'), "exports.name = require('node:path').basename(__filename);\n")
  await fs.writeFile(jsDebugEntry, `
const net = require('node:net');
const worker = require('./worker.js');
if (worker.name !== 'worker.js') throw new Error('worker scope');
const server = net.createServer(socket => {
  let buffer = Buffer.alloc(0);
  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length) {
      const end = buffer.indexOf('\\r\\n\\r\\n');
      if (end < 0) break;
      const length = Number(/Content-Length:\\s*(\\d+)/i.exec(buffer.subarray(0, end).toString())[1]);
      if (buffer.length < end + 4 + length) break;
      const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString());
      buffer = buffer.subarray(end + 4 + length);
      const response = Buffer.from(JSON.stringify({ seq: 1, type: 'response', request_seq: message.seq, command: message.command, success: true, body: {} }));
      socket.write(Buffer.concat([Buffer.from('Content-Length: ' + response.length + '\\r\\n\\r\\n'), response]));
    }
  });
});
server.listen(0, '127.0.0.1', () => console.log('Debug server listening at 127.0.0.1:' + server.address().port));
`)
  await assert.rejects(exec(process.execPath, [jsDebugEntry], { timeout: 2000 }), /require is not defined/)
  assert.equal(await installJsDebug(), jsDebugEntry, 'existing install is repaired without downloading')
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8')).type, 'commonjs')
  await fs.writeFile(path.join(directory, 'package.json'), '{"name":"fixture","version":"1.0.0","type":"module"}')
  await prepareJsDebugPackage()
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8')), { name: 'fixture', version: '1.0.0', type: 'commonjs' })
  await fs.rm(path.join(directory, 'package.json'))
  const { DebugSession } = await import('./debugger.ts')
  const config = { ...defaultDebugConfig('js-debug', root), command: process.execPath, args: [jsDebugEntry, '0', '127.0.0.1'] }
  const session = new DebugSession(config, root)
  t.after(() => session.stop())
  await session.start(true)
  assert.equal(session.snapshot.state, 'terminated')
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8')).type, 'commonjs', 'session start repairs legacy installs too')
})
