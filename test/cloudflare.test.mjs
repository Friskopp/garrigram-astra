import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { authenticate } from '../cloudflare/auth.mjs';
import worker from '../cloudflare/worker.mjs';

const authEnv = {ACCESS_TEAM_DOMAIN:'https://garrigram-test.cloudflareaccess.com',ACCESS_AUD:'test-app',ALLOWED_EMAIL_DOMAIN:'garrison.se'};

test('Access authentication rejects unsigned, expired, wrong-audience and outside-domain identities',async()=>{
 const {publicKey,privateKey}=await generateKeyPair('RS256');
 const jwk=await exportJWK(publicKey);jwk.kid='test-key';
 const keys=createLocalJWKSet({keys:[jwk]});
 const sign=async({email='member@garrison.se',aud='test-app',issuer=authEnv.ACCESS_TEAM_DOMAIN,expires='1h'}={})=>new SignJWT({email}).setProtectedHeader({alg:'RS256',kid:'test-key'}).setSubject('member-123').setIssuedAt().setIssuer(issuer).setAudience(aud).setExpirationTime(expires).sign(privateKey);
 const request=token=>new Request('https://app.example/api/posts',{headers:token?{'cf-access-jwt-assertion':token}:{}});
 assert.deepEqual(await authenticate(request(await sign()),authEnv,keys),{email:'member@garrison.se'});
 const attacker=await generateKeyPair('RS256');
 const forged=await new SignJWT({email:'member@garrison.se'}).setProtectedHeader({alg:'RS256',kid:'test-key'}).setSubject('attacker').setIssuedAt().setIssuer(authEnv.ACCESS_TEAM_DOMAIN).setAudience('test-app').setExpirationTime('1h').sign(attacker.privateKey);
 await assert.rejects(()=>authenticate(request(forged),authEnv,keys),e=>e.status===401);
 for(const token of [null,'forged',await sign({aud:'another-app'}),await sign({issuer:'https://other.cloudflareaccess.com'}),await sign({expires:'-1h'})]) {
  await assert.rejects(()=>authenticate(request(token),authEnv,keys),e=>e.status===401);
 }
 await assert.rejects(()=>authenticate(request(null),{},keys),e=>e.status===503);
 for(const email of ['member@gmail.com','member@garrison.se.evil.example']){
  const token=await sign({email});await assert.rejects(()=>authenticate(request(token),authEnv,keys),e=>e.status===403);
 }
});

test('Production rejects unauthenticated requests to pages, APIs, and photo files before storage access',async()=>{
 for(const pathname of ['/','/app.js','/api/posts','/uploads/example.jpg','/uploads/00000000-0000-0000-0000-000000000000.jpg?size=map','/api/posts/example/comments','/api/posts/example/like']){
  const response=await worker.fetch(new Request('https://app.example'+pathname),authEnv);
  assert.equal(response.status,401);assert.equal(response.headers.get('cache-control'),'private, no-store');
 }
 const spoofed=await worker.fetch(new Request('https://app.example/api/posts',{headers:{'cf-access-authenticated-user-email':'member@garrison.se','X-Visitor-Id':'pretend-member'}}),authEnv);
 assert.equal(spoofed.status,401);
});

test('Cloudflare runtime persists multipart uploads and reactions in D1/R2 across restart',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'garrigram-cf-'));
 let mf;
 try{
  const bundled=await build({stdin:{contents:`import {createApp} from './cloudflare/worker.mjs';
const app=createApp(async request=>({email:request.headers.get('x-test-email')||'local-preview@garrison.se'}));
export default {fetch(request,env){
  if(request.headers.has('x-test-images'))env.IMAGES={input(){return {transform(options){
    if(options.fit!=='scale-down'||options.width!==options.height)throw new Error('Unexpected crop');
    return {async output(output){if(request.headers.get('x-test-images')==='fail')throw new Error('Quota exceeded');return {response:()=>new Response('webp-fixture-'+options.width,{headers:{'content-type':'image/webp'}})};}};
  }}}};
  return app.fetch(request,env);
}};`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',write:false});
  const start=()=>new Miniflare({...convertV4MiniflareOptions({name:'garrigram-test',modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-09-19',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'test-db'},d1Persist:path.join(dir,'d1'),r2Buckets:{PHOTOS:'test-photos'},r2Persist:path.join(dir,'r2')}),resourcePersistencePath:path.join(dir,'resources')});
  mf=start();let db=await mf.getD1Database('DB');
  // D1 exec parses by line. Flatten each migration statement, preserving trigger blocks.
  for(const file of (await readdir('cloudflare/migrations')).filter(name=>name.endsWith('.sql')).sort()){
    const sql=await readFile('cloudflare/migrations/'+file,'utf8');
    const statements=sql.match(/CREATE TRIGGER[\s\S]*?END;|(?:CREATE|INSERT|ALTER)[\s\S]*?;/g);
    for(const statement of statements)await db.prepare(statement).run();
  }
  const req=async(route,options={})=>{
   const headers={origin:'https://local.example',...options.headers};
   // Serialize native Node FormData before crossing Miniflare's undici boundary.
   if(options.body instanceof FormData){const encoded=new Response(options.body);headers['content-type']=encoded.headers.get('content-type');options={...options,body:await encoded.arrayBuffer()};}
   return mf.dispatchFetch('https://local.example'+route,{...options,headers});
  };
  assert.deepEqual(await(await req('/api/posts')).json(),[]);
  const image=await readFile('public/images/fika.jpg');
  const effect={width:1200,height:800,faces:[{x:500,y:300,angle:12,length:80}]};
  const payload=()=>{const form=new FormData();form.set('effect',JSON.stringify(effect));form.set('author','Cloudflare test');form.set('caption','Saved to D1 and R2');form.set('photo',new Blob([image],{type:'image/jpeg'}),'fika.jpg');form.set('lat','59.32');form.set('lng','18.07');form.set('location','Stockholm');return form;};
  const response=await req('/api/posts',{method:'POST',body:payload()});assert.equal(response.status,201,await response.clone().text());
  const {id}=await response.json();let posts=await(await req('/api/posts')).json();assert.equal(posts.length,1);assert.equal(posts[0].location,'Stockholm');assert.equal(posts[0].owner_email,undefined);
  assert.equal(posts[0].can_edit,1);
  const mutate=(route,method,body,email='local-preview@garrison.se')=>req(route,{method,headers:{'content-type':'application/json','x-test-email':email},...(body===undefined?{}:{body:JSON.stringify(body)})});
  assert.equal((await mutate(`/api/posts/${id}`,'PATCH',{caption:'forged',owner_email:'other@garrison.se'},'other@garrison.se')).status,403);
  assert.equal((await mutate(`/api/posts/${id}`,'DELETE',undefined,'other@garrison.se')).status,403);
  assert.equal((await(await req('/api/posts',{headers:{'x-test-email':'other@garrison.se'}})).json())[0].can_edit,0);
  assert.equal((await mutate(`/api/posts/${id}`,'PATCH',{caption:'Edited caption'})).status,200);
  assert.equal((await mutate(`/api/posts/${id}`,'PATCH',{caption:'x'.repeat(1001)})).status,400);
  await db.prepare('UPDATE posts SET effect=NULL WHERE id=?').bind(id).run();
  assert.equal((await mutate(`/api/posts/${id}/effect`,'PUT',{effect})).status,200);
  assert.equal((await mutate(`/api/posts/${id}/effect`,'PUT',{effect:{bad:true}})).status,400);
  assert.equal((await mutate('/api/posts/missing/effect','PUT',{effect})).status,404);
  const photo=await req(posts[0].image);assert.equal(photo.status,200);assert.equal(photo.headers.get('content-type'),'image/jpeg');assert.equal((await photo.arrayBuffer()).byteLength,image.byteLength);assert.equal(photo.headers.get('cache-control'),'private, max-age=0, must-revalidate');
  assert.equal((await req(posts[0].image,{headers:{'if-none-match':photo.headers.get('etag')}})).status,304);
  assert.equal((await req(posts[0].image+'?size=arbitrary')).status,404);
  for(let i=0;i<2;i++)assert.equal((await req(`/api/posts/${id}/like`,{method:'PUT',headers:{'content-type':'application/json','x-visitor-id':'fake-'+i},body:JSON.stringify({liked:true,author:'Test Teammate'})})).status,200);
  assert.equal((await(await req('/api/posts')).json())[0].likes,1);
  assert.deepEqual(await(await req(`/api/posts/${id}/like`)).json(),[{author:'Test Teammate'}]);
  const commentRequest=(body,route=`/api/posts/${id}/comments`,extra={})=>req(route,{method:'POST',headers:{'content-type':'application/json',...extra},body:JSON.stringify(body)});
  assert.equal((await commentRequest({author:'Team',body:'   '})).status,400);
  assert.equal((await commentRequest({author:'Team',body:'x'.repeat(1001)})).status,400);
  assert.equal((await commentRequest(null)).status,400);
  assert.equal((await commentRequest({author:'Team',body:'Hello'},'/api/posts/missing/comments')).status,404);
  assert.equal((await commentRequest({author:'Team',body:'Hello'},undefined,{origin:'https://evil.example'})).status,403);
  for(let i=0;i<23;i++){
    const response=await commentRequest({author:'A teammate',body:i===0?'<script>alert(1)</script>':`Comment ${i}`,owner_email:'forged@evil.example'});
    assert.equal(response.status,201);const result=await response.json();assert.equal(result.owner_email,undefined);
  }
  let page=await(await req(`/api/posts/${id}/comments`)).json();assert.equal(page.comments.length,20);assert.equal(page.hasMore,true);assert.equal(page.comments[0].body,'Comment 3');
  const older=await(await req(`/api/posts/${id}/comments?before=${page.nextCursor}`)).json();assert.equal(older.comments.length,3);assert.equal(older.hasMore,false);assert.equal(older.comments[0].body,'<script>alert(1)</script>');
  assert.equal((await req(`/api/posts/${id}/comments?before=nope`)).status,400);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM comments WHERE owner_email=?').bind('local-preview@garrison.se').first()).count,23);
  assert.equal((await(await req('/api/posts')).json())[0].comment_count,23);

  assert.equal((await req('/api/posts',{method:'POST',body:payload(),headers:{origin:'https://evil.example'}})).status,403);
  const invalid=payload();invalid.set('photo',new Blob(['not a photo'],{type:'image/jpeg'}),'fake.jpg');assert.equal((await req('/api/posts',{method:'POST',body:invalid})).status,400);
  assert.equal((await db.prepare('SELECT bytes FROM storage_usage WHERE id=1').first()).bytes,image.byteLength);
  await mf.dispose();mf=start();db=await mf.getD1Database('DB');posts=await(await req('/api/posts')).json();assert.equal(posts.length,1);assert.equal(posts[0].likes,1);assert.equal((await req(posts[0].image)).status,200);assert.deepEqual(JSON.parse(posts[0].effect),effect);assert.equal(posts[0].comment_count,23);assert.equal((await(await req(`/api/posts/${id}/comments`)).json()).comments.length,20);assert.deepEqual(await(await req(`/api/posts/${id}/like`)).json(),[{author:'Test Teammate'}]);
  await db.prepare('UPDATE storage_usage SET bytes=7999999999 WHERE id=1').run();assert.equal((await req('/api/posts',{method:'POST',body:payload()})).status,507);
  assert.equal((await(await mf.getR2Bucket('PHOTOS')).list()).objects.length,1);
  await db.prepare('UPDATE storage_usage SET bytes=? WHERE id=1').bind(image.byteLength).run();
  const insert=()=>db.prepare('INSERT INTO posts (id,author,owner_email,caption,image,image_bytes,created_at) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(),'Quota fixture','local-preview@garrison.se','','/quota-fixture.jpg',1,new Date().toISOString());
  for(let i=0;i<29;i++)await insert().run();
  assert.equal((await req('/api/posts',{method:'POST',body:payload()})).status,429);
  await assert.rejects(()=>insert().run(),/daily_upload_limit_exceeded/);
  assert.equal((await(await mf.getR2Bucket('PHOTOS')).list()).objects.length,1);
  // Existing images get bounded variants on demand; concurrent requests share generation.
  const mapUrl=posts[0].image+'?size=map',feedUrl=posts[0].image+'?size=feed';
  const thumbs=await Promise.all([req(mapUrl,{headers:{'x-test-images':'ok'}}),req(mapUrl,{headers:{'x-test-images':'ok'}})]);
  for(const thumb of thumbs){assert.equal(thumb.headers.get('content-type'),'image/webp');assert.equal(await thumb.text(),'webp-fixture-160');}
  const feed=await req(feedUrl,{headers:{'x-test-images':'ok'}});assert.equal(await feed.text(),'webp-fixture-960');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM photo_variants').first()).n,2);
  assert.equal((await db.prepare('SELECT bytes FROM storage_usage WHERE id=1').first()).bytes,image.byteLength+29+32);
  await mf.dispose();mf=start();db=await mf.getD1Database('DB');
  // With no processor configured after restart, the persisted variant is still served.
  const cached=await req(mapUrl);assert.equal(await cached.text(),'webp-fixture-160');
  const etag=cached.headers.get('etag');
  assert.equal((await req(mapUrl,{headers:{'if-none-match':'W/'+etag}})).status,304);
  assert.equal((await req(mapUrl,{method:'HEAD'})).headers.get('content-length'),'16');
  // A transformation failure falls back to the intact original without saving a bad variant.
  const extra=await req('/api/posts',{method:'POST',body:payload(),headers:{'x-test-email':'second@garrison.se'}});
  const extraId=(await extra.json()).id;
  const extraPhoto=(await(await req('/api/posts')).json()).find(p=>p.id===extraId).image;
  const fallback=await req(extraPhoto+'?size=map',{headers:{'x-test-images':'fail'}});
  assert.equal(fallback.headers.get('content-type'),'image/jpeg');assert.equal((await fallback.arrayBuffer()).byteLength,image.byteLength);
  await mutate('/api/posts/'+extraId,'DELETE',undefined,'second@garrison.se');
  const comments=await(await req(`/api/posts/${id}/comments`)).json(),commentId=comments.comments[0].id;
  assert.equal(comments.comments[0].can_edit,1);
  const otherComments=await(await req(`/api/posts/${id}/comments`,{headers:{'x-test-email':'other@garrison.se'}})).json();assert.equal(otherComments.comments[0].can_edit,0);
  for(const method of ['PATCH','DELETE'])assert.equal((await mutate(`/api/posts/${id}/comments/${commentId}`,method,{body:'forged'},'other@garrison.se')).status,403);
  assert.equal((await mutate(`/api/posts/${id}/comments/${commentId}`,'PATCH',{body:'Edited comment'})).status,200);
  assert.equal((await mutate(`/api/posts/${id}/comments/${commentId}`,'PATCH',{body:' '})).status,400);
  assert.equal((await mutate(`/api/posts/${id}/comments/${commentId}`,'DELETE')).status,200);
  assert.equal((await mutate(`/api/posts/${id}/comments/${commentId}`,'DELETE')).status,404);
  assert.equal((await mutate(`/api/posts/${id}`,'DELETE')).status,200);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM comments WHERE post_id=?').bind(id).first()).n,0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM likes WHERE post_id=?').bind(id).first()).n,0);
  assert.equal((await(await mf.getR2Bucket('PHOTOS')).list()).objects.length,0);
  assert.equal((await db.prepare('SELECT bytes FROM storage_usage WHERE id=1').first()).bytes,29);
  assert.equal((await req(mapUrl,{headers:{'if-none-match':etag}})).status,404);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM photo_variants').first()).n,0);
 }finally{if(mf)await mf.dispose();await rm(dir,{recursive:true,force:true});}
});
