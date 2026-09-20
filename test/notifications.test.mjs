import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import {createECDH,randomBytes,hkdfSync,createDecipheriv,createPublicKey,verify} from 'node:crypto';
import {notificationRoute,scheduleNotifications,consumeNotifications,validEndpoint} from '../cloudflare/notifications.mjs';
import {createApp} from '../cloudflare/worker.mjs';

async function fixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 for(const name of (await readdir('cloudflare/migrations')).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(await readFile('cloudflare/migrations/'+name,'utf8'));
 const DB={prepare(sql){return {bind(...args){return {async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){return {meta:sqlite.prepare(sql).run(...args)};}};}};}};
 const vapid=createECDH('prime256v1');vapid.generateKeys();const jobs=[];
 const env={DB,VAPID_PUBLIC_KEY:vapid.getPublicKey().toString('base64url'),VAPID_PRIVATE_KEY:vapid.getPrivateKey().toString('base64url'),PUSH_QUEUE:{async send(body){jobs.push(body);},async sendBatch(batch){jobs.push(...batch.map(x=>x.body));}}};
 const now=Date.now();
 const browser=createECDH('prime256v1');browser.generateKeys();const auth=randomBytes(16);
 const subscription={endpoint:'https://web.push.apple.com/test-device',keys:{p256dh:browser.getPublicKey().toString('base64url'),auth:auth.toString('base64url')}};
 const app=createApp(async request=>({email:request.headers.get('x-test-email')||'reader@garrison.se'}));
 const req=(path,method='GET',body,owner='reader@garrison.se',origin='https://app.example')=>app.fetch(new Request('https://app.example'+path,{method,headers:{origin,'x-test-email':owner},...(body?{body:JSON.stringify(body)}:{})}),env);
 const post=(id,owner='author@garrison.se',demo=0)=>{sqlite.prepare('INSERT INTO posts(id,author,owner_email,caption,image,image_bytes,created_at,demo) VALUES(?,?,?,?,?,?,?,?)').run(id,'Author',owner,'private caption','/uploads/'+id+'.jpg',100,new Date().toISOString(),demo);sqlite.prepare('UPDATE push_events SET created_at=? WHERE post_id=?').run(now-180000,id);};
 const subscribe=async()=>{assert.equal((await req('/api/notifications','PUT',subscription)).status,200);return sqlite.prepare('SELECT id FROM push_subscriptions').get().id;};
 const batch=body=>{const result={ack:0,retry:0};return {messages:[{body,ack(){result.ack++;},retry(){result.retry++;}}],result};};
 // Independent RFC 8291 decryption, using Node crypto rather than the sender library.
 const decrypt=options=>{
  const body=Buffer.from(options.body),salt=body.subarray(0,16),keylen=body[20],sender=body.subarray(21,21+keylen);
  const shared=browser.computeSecret(sender);
  const ikm=Buffer.from(hkdfSync('sha256',shared,auth,Buffer.concat([Buffer.from('WebPush: info\0'),browser.getPublicKey(),sender]),32));
  const key=Buffer.from(hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16));
  const nonce=Buffer.from(hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: nonce\0'),12));
  const encrypted=body.subarray(21+keylen),decipher=createDecipheriv('aes-128-gcm',key,nonce);decipher.setAuthTag(encrypted.subarray(-16));
  const plain=Buffer.concat([decipher.update(encrypted.subarray(0,-16)),decipher.final()]);let end=plain.length;while(plain[end-1]===0)end--;assert.equal(plain[end-1],2);return JSON.parse(plain.subarray(0,end-1).toString());
 };
 const comment=(postId,owner='teammate@garrison.se')=>{const row=sqlite.prepare('INSERT INTO comments(post_id,owner_email,author,body,created_at) VALUES(?,?,?,?,?) RETURNING id').get(postId,owner,'Teammate','private comment',new Date().toISOString());sqlite.prepare('UPDATE push_comment_events SET created_at=? WHERE comment_id=?').run(now-180000,row.id);return row.id;};
 return {sqlite,env,jobs,now,subscription,req,post,comment,subscribe,batch,decrypt,vapid};
}

test('subscriptions are opt-in, authenticated, owner-scoped, bounded, and cannot target arbitrary servers',async()=>{
 const f=await fixture();try{
  assert.equal((await(await f.req('/api/notifications')).json()).available,true);
  assert.equal((await(await f.req('/api/notifications/status','POST',f.subscription)).json()).enabled,false);
  for(const url of ['http://web.push.apple.com/x','https://web.push.apple.com.evil.example/x','https://127.0.0.1','https://fcm.googleapis.com:8443/x','https://user:password@web.push.apple.com/x'])assert.equal(validEndpoint(url),false);
  assert.equal((await f.req('/api/notifications','PUT',{...f.subscription,endpoint:'https://example.com'})).status,400);
  assert.equal((await f.req('/api/notifications','PUT',{...f.subscription,keys:{p256dh:'bad',auth:'bad'}})).status,400);
  assert.equal((await f.req('/api/notifications','PUT',f.subscription,undefined,'https://evil.example')).status,403);
  const id=await f.subscribe();await f.subscribe();assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM push_subscriptions').get().n,1);
  assert.equal((await f.req('/api/notifications','PUT',f.subscription,'other@garrison.se')).status,409);
  await f.req('/api/notifications','DELETE',f.subscription,'other@garrison.se');assert.equal(f.sqlite.prepare('SELECT id FROM push_subscriptions').get().id,id);
  assert.equal((await(await f.req('/api/notifications/status','POST',f.subscription,'other@garrison.se')).json()).enabled,false);
  assert.equal((await f.req('/api/notifications/test','POST',f.subscription)).status,200);assert.equal((await f.req('/api/notifications/test','POST',f.subscription)).status,429);
  for(let i=1;i<10;i++)assert.equal((await f.req('/api/notifications','PUT',{...f.subscription,endpoint:f.subscription.endpoint+i})).status,200);
  assert.equal((await f.req('/api/notifications','PUT',{...f.subscription,endpoint:f.subscription.endpoint+'extra'})).status,429);
  await f.req('/api/notifications','DELETE',f.subscription);assert.equal((await(await f.req('/api/notifications/status','POST',f.subscription)).json()).enabled,false);
 }finally{f.sqlite.close();}
});

test('uploads are grouped, encrypted, signed, exclude old/own/deleted photos and deduplicate queue retries',async()=>{
 const f=await fixture();try{
  f.post('before-opt-in');const id=await f.subscribe();f.post('mine','reader@garrison.se');f.post('demo','author@garrison.se',1);f.post('deleted');f.sqlite.prepare('DELETE FROM posts WHERE id=?').run('deleted');
  await scheduleNotifications(f.env,f.now);assert.equal(f.jobs.length,0);
  f.post('first');f.post('second');await scheduleNotifications(f.env,f.now);assert.equal(f.jobs.length,1);
  let calls=0,payload;
  const transport=async(endpoint,options)=>{
   calls++;assert.equal(endpoint,f.subscription.endpoint);assert.equal(options.redirect,'manual');payload=f.decrypt(options);
   assert.ok(!JSON.stringify(payload).includes('private caption'));assert.equal(payload.body,'2 new photos from the team.');assert.equal(payload.url,'/#feed');
   const headers=new Headers(options.headers);assert.equal(headers.get('content-encoding'),'aes128gcm');
   const token=headers.get('authorization').match(/t=([^, ]+)/)[1],parts=token.split('.');
   const pub=f.vapid.getPublicKey();const key=createPublicKey({key:{kty:'EC',crv:'P-256',x:pub.subarray(1,33).toString('base64url'),y:pub.subarray(33).toString('base64url')},format:'jwk'});
   assert.ok(verify('sha256',Buffer.from(parts[0]+'.'+parts[1]),{key,dsaEncoding:'ieee-p1363'},Buffer.from(parts[2],'base64url')));
   assert.equal(JSON.parse(Buffer.from(parts[1],'base64url')).aud,'https://web.push.apple.com');return new Response(null,{status:201});
  };
  const b=f.batch({id});await consumeNotifications(b,f.env,transport,f.now);assert.equal(b.result.ack,1);assert.equal(calls,1);
  await consumeNotifications(f.batch({id}),f.env,transport,f.now);assert.equal(calls,1);
  await scheduleNotifications(f.env,f.now+60000);assert.equal(f.jobs.length,1);
 }finally{f.sqlite.close();}
});

test('failed deliveries retry, revoked subscriptions stop delivery, and missing subscriptions are acknowledged',async()=>{
 const f=await fixture();try{
  const id=await f.subscribe();f.post('new');const b=f.batch({id});
  await consumeNotifications(b,f.env,async()=>new Response(null,{status:503}),f.now);assert.equal(b.result.retry,1);assert.equal(f.sqlite.prepare('SELECT cursor FROM push_subscriptions').get().cursor,0);
  let single;await consumeNotifications(f.batch({id}),f.env,async(_,options)=>{single=f.decrypt(options);return new Response(null,{status:201});},f.now);
  assert.equal(single.url,'/?post=new#feed');
  await consumeNotifications(f.batch({id,test:true}),f.env,async()=>new Response(null,{status:410}),f.now+120001);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM push_subscriptions').get().n,0);
  const missing=f.batch({id});await consumeNotifications(missing,f.env,()=>{throw new Error('must not send');},f.now);assert.equal(missing.result.ack,1);
  const id2=await f.subscribe();f.post('after');await f.req('/api/notifications','DELETE',f.subscription);
  await consumeNotifications(f.batch({id:id2}),f.env,()=>{throw new Error('must not send');},f.now);
 }finally{f.sqlite.close();}
});

test('Web Push encryption and dispatch work inside the actual Cloudflare runtime',async()=>{
 const {Miniflare,convertV4MiniflareOptions}=await import('miniflare');const {build}=await import('esbuild');const f=await fixture();let mf,providerRedirect=false,outboundCalls=0;
 try{
  const bundled=await build({stdin:{contents:`import {sendPush} from './cloudflare/notifications.mjs'; export default {async fetch(request,env){const sub=await request.json();try{return await sendPush(env,sub,{body:'Runtime test'});}catch(error){return new Response(error.name+': '+error.message,{status:500});}}};`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',write:false});
  mf=new Miniflare({...convertV4MiniflareOptions({name:'push-runtime-test',outboundService:async request=>{outboundCalls++;if(providerRedirect)return new Response(null,{status:302,headers:{location:'https://evil.example/'}});return Response.json({url:request.url,headers:Object.fromEntries(request.headers),body:Array.from(new Uint8Array(await request.arrayBuffer()))});},modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-09-19',compatibilityFlags:['nodejs_compat'],bindings:{VAPID_PUBLIC_KEY:f.env.VAPID_PUBLIC_KEY,VAPID_PRIVATE_KEY:f.env.VAPID_PRIVATE_KEY}})});
  const response=await mf.dispatchFetch('https://app.example/',{method:'POST',body:JSON.stringify({endpoint:f.subscription.endpoint,...f.subscription.keys})});assert.equal(response.status,200,await response.clone().text());
  const sent=await response.json();assert.deepEqual(f.decrypt({...sent,body:Buffer.from(sent.body)}),{body:'Runtime test'});assert.equal(outboundCalls,1);
  providerRedirect=true;const redirect=await mf.dispatchFetch('https://app.example/',{method:'POST',redirect:'manual',body:JSON.stringify({endpoint:f.subscription.endpoint,...f.subscription.keys})});assert.equal(redirect.status,302);assert.equal(outboundCalls,2,'Redirect destination must never receive the signed push request');
 }finally{await mf?.dispose();f.sqlite.close();}
});


test('comment alerts are opt-in, go only to the post owner, omit self/deleted comments and open the correct post',async()=>{
 const f=await fixture();try{
  f.post('mine','reader@garrison.se');f.post('theirs');const id=await f.subscribe();
  f.comment('mine');await scheduleNotifications(f.env,f.now);assert.equal(f.jobs.length,0,'Existing photo subscribers must not get comment alerts automatically');
  const change=await f.req('/api/notifications','PATCH',{endpoint:f.subscription.endpoint,preferences:{photos:false,comments:true}});assert.equal(change.status,200);
  assert.deepEqual((await change.json()).preferences,{photos:false,comments:true});
  f.comment('mine','reader@garrison.se');f.comment('theirs');const deleted=f.comment('mine');f.sqlite.prepare('DELETE FROM comments WHERE id=?').run(deleted);
  const kept=f.comment('mine');f.sqlite.prepare('UPDATE comments SET body=? WHERE id=?').run('Edited private comment',kept);
  await scheduleNotifications(f.env,f.now);assert.deepEqual(f.jobs,[{id,kind:'comments'}]);
  let payload,calls=0;const transport=async(_,options)=>{calls++;payload=f.decrypt(options);return new Response(null,{status:201});};
  await consumeNotifications(f.batch(f.jobs[0]),f.env,transport,f.now);
  assert.equal(payload.body,'Someone commented on your post.');assert.equal(payload.url,'/?post=mine#feed');assert.equal(payload.tag,'garrigram-comments');assert.ok(!JSON.stringify(payload).includes('private comment'));
  await consumeNotifications(f.batch(f.jobs[0]),f.env,transport,f.now);assert.equal(calls,1,'duplicate queue attempts must not repeat delivered comments');
 }finally{f.sqlite.close();}
});

test('topic toggles stay independent, re-enabling skips old activity, and queued alerts honor disabled preferences',async()=>{
 const f=await fixture();try{
  f.post('mine','reader@garrison.se');const id=await f.subscribe();
  const prefs=preferences=>f.req('/api/notifications','PATCH',{endpoint:f.subscription.endpoint,preferences});
  assert.equal((await prefs({comments:'true'})).status,400);assert.equal((await prefs({anything:true})).status,400);
  assert.equal((await f.req('/api/notifications','PATCH',{endpoint:f.subscription.endpoint,preferences:{comments:true}},'someoneelse@garrison.se')).status,404);
  await prefs({comments:true});f.post('new-photo');f.comment('mine');
  await scheduleNotifications(f.env,f.now);assert.equal(f.jobs.length,2);
  await prefs({photos:false});let comments=0;
  await consumeNotifications(f.batch({id,kind:'photos'}),f.env,()=>{throw new Error('Disabled photo alerts must not send');},f.now);
  await consumeNotifications(f.batch({id,kind:'comments'}),f.env,async(_,options)=>{comments++;assert.equal(f.decrypt(options).tag,'garrigram-comments');return new Response(null,{status:201});},f.now);
  assert.equal(comments,1);
  await prefs({comments:false});f.comment('mine');await consumeNotifications(f.batch({id,kind:'comments'}),f.env,()=>{throw new Error('Disabled comment alerts must not send');},f.now+180000);
  assert.equal((await f.req('/api/notifications/test','POST',f.subscription)).status,429,'Both topics off means no test alerts');
  await prefs({comments:true});f.jobs.length=0;await scheduleNotifications(f.env,f.now+180000);assert.equal(f.jobs.length,0,'Re-enable must not replay comments from while disabled');
  f.comment('mine');f.comment('mine');await scheduleNotifications(f.env,f.now+180000);assert.equal(f.jobs[0].kind,'comments');
  await consumeNotifications(f.batch(f.jobs[0]),f.env,async(_,options)=>{assert.equal(f.decrypt(options).body,'2 new comments on your post.');return new Response(null,{status:201});},f.now+180000);
  assert.deepEqual((await(await prefs({photos:true})).json()).preferences,{photos:true,comments:true});
  // Old clients refreshing subscriptions must not silently reset new preferences.
  await f.req('/api/notifications','PUT',f.subscription);assert.deepEqual((await(await f.req('/api/notifications/status','POST',f.subscription)).json()).preferences,{photos:true,comments:true});
 }finally{f.sqlite.close();}
});
