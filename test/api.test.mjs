import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';

test('photo upload, feed, reaction isolation, validation, and restart persistence',async()=>{
 const data=await mkdtemp(path.join(tmpdir(),'garrigram-test-'));
 let child,base;
 async function start(){child=spawn(process.execPath,['server.mjs'],{cwd:process.cwd(),env:{...process.env,PORT:'0',DATA_DIR:data,SEED_DEMO:'0'},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>reject(new Error('Server exited: '+code)));child.stdout.on('data',chunk=>{const match=String(chunk).match(/http:\/\/127.0.0.1:(\d+)/);if(match){base=match[0];resolve();}});});}
 async function stop(){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}
 const request=(url,method='GET',body,who='test-visitor-one',extra={})=>fetch(base+url,{method,headers:{'content-type':'application/json','x-visitor-id':who,...extra},body:body===undefined?undefined:JSON.stringify(body)});
 try{
  await start();
  assert.deepEqual(await(await request('/api/posts')).json(),[]);
  const image='data:image/jpeg;base64,'+(await readFile('public/images/fika.jpg')).toString('base64');
  const effect={width:1200,height:800,faces:[{x:500,y:300,angle:12,length:80}]};
  const payload={effect,author:'Test Person',caption:'Saved through restart',image,location:'Stockholm',lat:59.3293,lng:18.0686};
  assert.equal((await request('/api/posts','POST',{...payload,author:''})).status,400);
  assert.equal((await request('/api/posts','POST',{...payload,lat:190})).status,400);
  assert.equal((await request('/api/posts','POST',{...payload,image:'data:image/jpeg;base64,bm90LWEtcGhvdG8='})).status,400);
  assert.equal((await request('/api/posts','POST',payload,'test-visitor-one',{origin:'https://other.example'})).status,403);
  const created=await request('/api/posts','POST',payload);assert.equal(created.status,201);const {id}=await created.json();
  let rows=await(await request('/api/posts')).json();assert.equal(rows.length,1);assert.equal(rows[0].caption,payload.caption);assert.equal(rows[0].lat,payload.lat);
  const photo=await fetch(base+rows[0].image);assert.equal(photo.status,200);assert.equal(photo.headers.get('content-type'),'image/jpeg');assert.ok((await photo.arrayBuffer()).byteLength>1000);
  await request(`/api/posts/${id}/like`,'PUT',{liked:true});await request(`/api/posts/${id}/like`,'PUT',{liked:true});
  rows=await(await request('/api/posts')).json();assert.equal(rows[0].likes,1);assert.equal(rows[0].liked,1);
  assert.equal((await(await request('/api/posts','GET',undefined,'test-visitor-two')).json())[0].liked,0);
  assert.equal((await request(`/api/posts/${id}/comments`,'POST',{author:'Team',body:'   '})).status,400);
  assert.equal((await request(`/api/posts/${id}/comments`,'POST',{author:'Team',body:'x'.repeat(1001)})).status,400);
  assert.equal((await request('/api/posts/missing/comments','POST',{author:'Team',body:'Hello'})).status,404);
  assert.equal((await request(`/api/posts/${id}/comments`,'POST',{author:'Team',body:'Hello'},'test-visitor-one',{origin:'https://evil.example'})).status,403);
  for(let i=0;i<23;i++)assert.equal((await request(`/api/posts/${id}/comments`,'POST',{author:'Teammate',body:`Comment ${i}`})).status,201);
  let page=await(await request(`/api/posts/${id}/comments`)).json();assert.equal(page.comments.length,20);assert.equal(page.hasMore,true);
  const older=await(await request(`/api/posts/${id}/comments?before=${page.nextCursor}`)).json();assert.equal(older.comments.length,3);assert.equal(older.hasMore,false);assert.equal(older.comments[0].body,'Comment 0');
  await request(`/api/posts/${id}/like`,'PUT',{liked:true,author:'Named Teammate'});
  assert.deepEqual(await(await request(`/api/posts/${id}/like`)).json(),[{author:'Named Teammate'}]);
  await stop();await start();
  rows=await(await request('/api/posts')).json();assert.equal(rows.length,1);assert.equal(rows[0].caption,payload.caption);assert.equal(rows[0].likes,1);assert.equal((await fetch(base+rows[0].image)).status,200);
  assert.deepEqual(JSON.parse(rows[0].effect),effect);assert.equal(rows[0].comment_count,23);assert.equal((await(await request(`/api/posts/${id}/comments`)).json()).comments.length,20);
  await request(`/api/posts/${id}/like`,'PUT',{liked:false});assert.equal((await(await request('/api/posts')).json())[0].likes,0);
  assert.equal((await request('/api/posts/missing-id/like','PUT',{liked:true})).status,404);
  const form=new FormData();form.set('author','Multipart tester');form.set('caption','Browser upload format');form.set('photo',new Blob([await readFile('public/images/fika.jpg')],{type:'image/jpeg'}),'fika.jpg');
  assert.equal((await fetch(base+'/api/posts',{method:'POST',headers:{'x-visitor-id':'test-visitor-one'},body:form})).status,201);
 }finally{if(child?.exitCode===null)await stop();await rm(data,{recursive:true,force:true});}
});
