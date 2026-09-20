import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import {createApp} from '../cloudflare/worker.mjs';
import production from '../cloudflare/worker.mjs';
import {cleanSocial} from '../social.mjs';

async function fixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 for(const name of (await readdir('cloudflare/migrations')).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(await readFile('cloudflare/migrations/'+name,'utf8'));
 const DB={prepare(sql){return {bind(...args){return {async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){return {meta:sqlite.prepare(sql).run(...args)};}};}};}};
 const objects=new Map();
 const env={DB,PHOTOS:{async put(key,bytes,options){objects.set(key,{bytes:new Uint8Array(bytes),type:options.httpMetadata.contentType});},async delete(key){objects.delete(key);},async get(key){const o=objects.get(key);return o?{body:o.bytes,writeHttpMetadata(h){h.set('content-type',o.type);}}:null;}}};
 const app=createApp(async req=>({email:req.headers.get('x-test-email')||'anton@garrison.se'}));
 const req=(route,method='GET',data,who='anton',extra={})=>app.fetch(new Request('https://app.example'+route,{method,headers:{origin:'https://app.example','content-type':'application/json','x-test-email':who+'@garrison.se',...extra},...(data===undefined?{}:{body:JSON.stringify(data)})}),env);
 const profile=async who=>{const r=await req('/api/profile','PUT',{name:who},who);assert.equal(r.status,200);return r.json();};
 return {sqlite,DB,objects,env,req,profile};
}

test('check-ins are voluntary, isolated by identity, bounded to one hour and purged on expiry',async()=>{
 const f=await fixture();try{
  const anton=await f.profile('anton'),sara=await f.profile('sara');
  assert.notEqual(anton.id,sara.id);assert.deepEqual(Object.keys(anton).sort(),['avatar','id','name']);
  assert.equal((await(await f.req('/api/people')).json()).people.length,0);
  for(const coords of [{lat:91,lng:0},{lat:0,lng:181},{lat:'41',lng:19},{lat:null,lng:19}])assert.equal((await f.req('/api/check-in','PUT',{...coords,message:''})).status,400);
  assert.equal((await f.req('/api/check-in','PUT',{lat:41.327,lng:19.818,message:'Coffee',profile_id:sara.id,expires_at:9999999999999})).status,200);
  let state=await(await f.req('/api/people')).json();assert.equal(state.people.length,1);assert.equal(state.people[0].id,anton.id);assert.equal(state.people[0].expires_at-state.people[0].shared_at,3600000);assert.ok(!JSON.stringify(state).includes('@garrison.se'));
  await f.req('/api/check-in','PUT',{lat:41.328,lng:19.82,message:'Moved'});
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM check_ins').get().n,1);
  await f.req('/api/check-in','PUT',{lat:41.33,lng:19.83,message:'Here'},'sara');
  await f.req('/api/check-in','DELETE',undefined,'sara');
  state=await(await f.req('/api/people')).json();assert.equal(state.people.length,1);assert.equal(state.people[0].id,anton.id);
  f.sqlite.prepare('UPDATE check_ins SET expires_at=?').run(Date.now()-1);
  assert.equal((await(await f.req('/api/people')).json()).people.length,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM check_ins').get().n,0);
 }finally{f.sqlite.close();}
});

test('location requests never share a position, respect cooldown and remember per-person dismissal',async()=>{
 const f=await fixture();try{
  await f.profile('anton');await f.profile('sara');await f.profile('martin');
  const attempts=await Promise.all([f.req('/api/location-requests','POST',{message:'Meet in 15 minutes'}),f.req('/api/location-requests','POST',{message:'Again'})]);
  assert.deepEqual(attempts.map(r=>r.status).sort(),[201,429]);
  const mine=await(await f.req('/api/people')).json();assert.equal(mine.requests.length,0);assert.ok(mine.next_request_at>Date.now());assert.equal(mine.people.length,0);
  const sara=await(await f.req('/api/people','GET',undefined,'sara')).json();assert.equal(sara.requests.length,1);const id=sara.requests[0].id;
  await f.req(`/api/location-requests/${id}/dismiss`,'POST',{},'sara');
  assert.equal((await(await f.req('/api/people','GET',undefined,'sara')).json()).requests.length,0);
  assert.equal((await(await f.req('/api/people','GET',undefined,'martin')).json()).requests.length,1);
  f.sqlite.prepare('UPDATE location_requests SET expires_at=?').run(Date.now()-1);await cleanSocial(f.DB);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM location_requests').get().n,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM request_dismissals').get().n,0);
 }finally{f.sqlite.close();}
});

test('profiles and avatars persist by account, reject unsafe uploads, clean up replaced files and stay private',async()=>{
 const f=await fixture();try{
  const me=await f.profile('anton');const image=await readFile('public/images/fika.jpg');const avatar='data:image/jpeg;base64,'+image.toString('base64');
  const saved=await(await f.req('/api/profile','PUT',{name:'Anton Friskopp',avatar,owner_id:'sara@garrison.se'})).json();
  assert.equal(saved.id,me.id);assert.match(saved.avatar,/^\/avatars\//);assert.equal(f.objects.size,1);
  assert.equal((await(await f.req('/api/profile')).json()).avatar,saved.avatar);
  assert.equal((await(await f.req('/api/profile','GET',undefined,'sara')).json()).avatar,null);
  assert.equal((await f.req(saved.avatar)).headers.get('cache-control'),'private, no-store');
  assert.equal((await f.req('/api/profile','PUT',{name:'Bad',avatar:'data:image/svg+xml;base64,PHN2Zz4='})).status,400);
  assert.equal((await f.req('/api/profile','PUT',{name:'Bad',avatar:'data:image/jpeg;base64,'+Buffer.from('not a photo').toString('base64')})).status,400);
  assert.equal((await f.req('/api/profile','PUT',{name:'Cross origin' },'anton',{origin:'https://evil.example'})).status,403);
  const replacement=await(await f.req('/api/profile','PUT',{name:'Anton',avatar})).json();assert.notEqual(replacement.avatar,saved.avatar);assert.equal(f.objects.size,1);assert.equal((await f.req(saved.avatar)).status,404);
  assert.equal(f.sqlite.prepare('SELECT bytes FROM storage_usage').get().bytes,image.byteLength);
  const concurrent=await Promise.all([f.req('/api/profile','PUT',{name:'Anton',avatar}),f.req('/api/profile','PUT',{name:'Anton',avatar})]);
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);assert.equal(f.objects.size,1);
  await f.req('/api/profile','PUT',{name:'Anton',avatar:null});assert.equal(f.objects.size,0);assert.equal(f.sqlite.prepare('SELECT bytes FROM storage_usage').get().bytes,0);
  const auth={ACCESS_TEAM_DOMAIN:'https://test.cloudflareaccess.com',ACCESS_AUD:'test',ALLOWED_EMAIL_DOMAIN:'garrison.se'};
  for(const route of ['/api/profile','/api/people','/api/check-in','/api/location-requests',replacement.avatar]){
   assert.equal((await production.fetch(new Request('https://app.example'+route),auth)).status,401);
  }
 }finally{f.sqlite.close();}
});
