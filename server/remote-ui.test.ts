import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
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
