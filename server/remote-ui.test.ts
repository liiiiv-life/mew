import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import express from 'express'
import { createRemoteUiRouter } from './remote-ui.ts'
import { remoteDispatcher } from './remote-access-dispatch.ts'
import type { AuthenticatedSession } from './auth.ts'
import type { RemoteFrame } from '../shared/remote-access.ts'
const owner:AuthenticatedSession={email:'owner@example.test',user:{hash:'',role:'owner',mustChangePassword:false,createdAt:1,passwordChangedAt:0}}
test('installed UI travels through the authenticated dispatcher and cannot read traversal, secrets or external symlinks',async t=>{
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'mew-ui-test-')),dist=path.join(temporary,'dist')
  await fs.mkdir(path.join(dist,'assets'),{recursive:true});await fs.writeFile(path.join(dist,'index.html'),'<html><head><meta name="mew-p2p-bootstrap" content="1"></head><body><script src="/assets/app.js"></script></body></html>');await fs.writeFile(path.join(dist,'assets/app.js'),'window.p2pUI=true');await fs.writeFile(path.join(temporary,'private.js'),'secret');await fs.symlink(path.join(temporary,'private.js'),path.join(dist,'assets/escape.js'))
  const app=express(),server=http.createServer(app);app.use('/api/remote-ui',createRemoteUiRouter(dist))
  let current:AuthenticatedSession|null=owner,counter=0
  const frames=new Map<string,{status?:number;headers?:Record<string,string>;body:Buffer[];resolve(value:{status:number;headers:Record<string,string>;body:string}):void}>()
  const dispatcher=remoteDispatcher(server,{send:async raw=>{const value=JSON.parse(raw) as RemoteFrame,pending=frames.get(value.id);if(!pending)return;if(value.type==='response'){pending.status=value.status;pending.headers=value.headers}if(value.type==='chunk')pending.body.push(Buffer.from(value.data,'base64'));if(value.type==='end'){pending.resolve({status:pending.status!,headers:pending.headers!,body:Buffer.concat(pending.body).toString()});frames.delete(value.id)}if(value.type==='response'||value.type==='chunk')queueMicrotask(()=>void dispatcher.receive(JSON.stringify({type:'credit',id:value.id})))},close(){}},()=>current,'https://mew.invalid')
  t.after(async()=>{dispatcher.close();await fs.rm(temporary,{recursive:true,force:true})})
  const get=(file:string)=>new Promise<{status:number;headers:Record<string,string>;body:string}>(resolve=>{const id=String(++counter);frames.set(id,{body:[],resolve});void dispatcher.receive(JSON.stringify({type:'request',id,method:'GET',path:'/api/remote-ui/file?path='+encodeURIComponent(file),headers:{}}))})
  const index=await get('/index.html');assert.equal(index.status,200);assert.match(index.body,/mew-p2p-app/);assert.match(index.body,/\/assets\/app.js/)
  assert.equal((await get('/assets/app.js')).body,'window.p2pUI=true')
  assert.equal((await get('/../private.js')).status,400);assert.equal((await get('/assets/escape.js')).status,403);assert.equal((await get('/.env')).status,400)
  assert.equal(index.headers['cache-control'],'no-store')
  server.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())))
  const response=await fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}/api/remote-ui/file?path=/index.html`);assert.equal(response.status,403)
  await fs.writeFile(path.join(dist,'index.html'),'<html><head></head><body>old app</body></html>')
  assert.equal((await get('/index.html')).status,409)
  current=null
  await dispatcher.receive(JSON.stringify({type:'request',id:'revoked',method:'GET',path:'/api/remote-ui/file?path=/index.html',headers:{}}))
})

test('static UI gzip is opt-in, preserves bootstrap and limits, and keeps HEAD, ranges and binaries raw', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-ui-gzip-')), dist = path.join(temporary, 'dist')
  await fs.mkdir(path.join(dist, 'assets'), { recursive: true })
  const script = 'export const repeated="static UI module";\n'.repeat(5000)
  await fs.writeFile(path.join(dist, 'assets/app.js'), script)
  await fs.writeFile(path.join(dist, 'assets/font.woff2'), Buffer.alloc(2048, 23))
  await fs.writeFile(path.join(dist, 'index.html'), '<html><head><meta name="mew-p2p-bootstrap" content="1"></head><body>Login</body></html>')
  const app = express(), server = http.createServer(app)
  app.use('/api/remote-ui', createRemoteUiRouter(dist))
  type Response = { status: number; headers: Record<string, string>; body: Buffer }
  const pending = new Map<string, { status?: number; headers?: Record<string, string>; chunks: Buffer[]; resolve(value: Response): void }>()
  let counter = 0, closed = false
  const dispatcher = remoteDispatcher(server, { send: async raw => {
    const frame = JSON.parse(raw) as RemoteFrame, response = pending.get(frame.id)
    if (!response) return
    if (frame.type === 'response') { response.status = frame.status; response.headers = frame.headers }
    if (frame.type === 'chunk') response.chunks.push(Buffer.from(frame.data, 'base64'))
    if (frame.type === 'end') { pending.delete(frame.id); response.resolve({ status: response.status!, headers: response.headers!, body: Buffer.concat(response.chunks) }) }
    if (frame.type === 'response' || frame.type === 'chunk') queueMicrotask(() => void dispatcher.receive(JSON.stringify({ type: 'credit', id: frame.id })))
  }, close() { closed = true } }, () => owner, 'https://mew.invalid')
  t.after(async () => { dispatcher.close(); await fs.rm(temporary, { recursive: true, force: true }) })
  const get = (file: string, gzip = true, method = 'GET', headers = {}) => new Promise<Response>(resolve => {
    const id = String(++counter)
    pending.set(id, { chunks: [], resolve })
    void dispatcher.receive(JSON.stringify({ type: 'request', id, method, path: '/api/remote-ui/file?path=' + encodeURIComponent(file) + (gzip ? '&encoding=gzip' : ''), headers }))
  })
  const compressed = await get('/assets/app.js')
  assert.equal(compressed.status, 200)
  assert.equal(compressed.headers['content-encoding'], 'gzip')
  assert.match(compressed.headers['content-type'], /javascript/)
  assert.equal(compressed.headers['cache-control'], 'no-store')
  assert.equal(gunzipSync(compressed.body).toString(), script)
  const rawEtag = `"sha256-${createHash('sha256').update(script).digest('base64url')}"`
  const etag = rawEtag.replace(/"$/, '-gzip"')
  assert.equal(compressed.headers.etag, etag)
  const unchanged = await get('/assets/app.js', true, 'GET', { 'if-none-match': etag })
  assert.equal(unchanged.status, 304)
  assert.equal(unchanged.headers.etag, etag)
  assert.equal(unchanged.body.length, 0)
  assert.equal(unchanged.headers['content-encoding'], undefined)
  assert.ok(compressed.body.length < Buffer.byteLength(script) / 10)
  const raw = await get('/assets/app.js', false)
  assert.equal(raw.headers['content-encoding'], undefined)
  assert.equal(raw.body.toString(), script)
  assert.equal(raw.headers.etag, rawEtag, 'raw and gzip representations have distinct validators')
  const index = await get('/index.html')
  assert.match(gunzipSync(index.body).toString(), /mew-p2p-app/)
  const head = await get('/assets/app.js', true, 'HEAD')
  assert.equal(head.status, 200)
  assert.equal(head.headers['content-encoding'], undefined)
  assert.equal(head.body.length, 0)
  const range = await get('/assets/app.js', true, 'GET', { range: 'bytes=7-20' })
  assert.equal(range.status, 206)
  assert.equal(range.headers['content-encoding'], undefined)
  assert.equal(range.body.toString(), script.slice(7, 21))
  const changed = script.replace('static UI module', 'edited UI module')
  await fs.writeFile(path.join(dist, 'assets/app.js'), changed)
  const refreshed = await get('/assets/app.js', false, 'GET', { 'if-none-match': rawEtag })
  assert.equal(refreshed.status, 200)
  assert.notEqual(refreshed.headers.etag, rawEtag)
  assert.equal(refreshed.body.toString(), changed)
  const font = await get('/assets/font.woff2')
  assert.equal(font.headers['content-encoding'], undefined)
  assert.deepEqual(font.body, Buffer.alloc(2048, 23))
  assert.equal((await get('/../outside.js')).status, 400)
  await fs.writeFile(path.join(temporary, 'outside.js'), 'secret')
  await fs.symlink(path.join(temporary, 'outside.js'), path.join(dist, 'assets/escape.js'))
  assert.equal((await get('/assets/escape.js')).status, 403)
  const oversized = await fs.open(path.join(dist, 'assets/large.js'), 'w')
  await oversized.truncate(32 * 1024 * 1024 + 1)
  await oversized.close()
  assert.equal((await get('/assets/large.js')).status, 413)
  await fs.writeFile(path.join(dist, 'index.html'), '<html><head></head><body>old app</body></html>')
  assert.equal((await get('/index.html')).status, 409)
  assert.equal(closed, false)
})
