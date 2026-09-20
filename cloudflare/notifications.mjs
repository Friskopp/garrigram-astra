import {buildPushPayload} from '@block65/webcrypto-web-push';

const DAY=86400000, GROUP=120000;
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const preferences=row=>({photos:!!row?.photos_enabled,comments:!!row?.comments_enabled});
const configured=env=>!!(env.PUSH_QUEUE&&env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY);

// Push endpoints are supplied by browsers, but must never become an arbitrary fetch proxy.
export function validEndpoint(value){
  if(typeof value!=='string'||value.length>2048)return false;
  try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash&&
    (['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(u.hostname)||
      u.hostname.endsWith('.notify.windows.com'));}catch{return false;}
}
async function readBody(request){
  if(Number(request.headers.get('content-length'))>4096)fail(413,'Notification settings are too large.');
  const reader=request.body?.getReader();if(!reader)fail(400,'Missing notification settings.');
  const chunks=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();fail(413,'Notification settings are too large.');}chunks.push(value);}}
  finally{reader.releaseLock();}
  try{return await new Response(new Blob(chunks)).json();}catch{fail(400,'Invalid notification settings.');}
}
function decode(value,length){
  if(typeof value!=='string'||!/^[\w-]+$/.test(value))fail(400,'Invalid browser subscription.');
  let bytes;try{bytes=Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}catch{fail(400,'Invalid browser subscription.');}
  if(bytes.length!==length)fail(400,'Invalid browser subscription.');return bytes;
}
export async function notificationRoute(request,env,owner){
  const path=new URL(request.url).pathname,method=request.method;
  if(!['/api/notifications','/api/notifications/status','/api/notifications/test'].includes(path))return null;
  if(path==='/api/notifications'&&method==='GET')return json({available:configured(env),publicKey:configured(env)?env.VAPID_PUBLIC_KEY:null});
  if(!configured(env))fail(503,'Push notifications are available on the deployed app.');
  const data=await readBody(request),endpoint=data?.endpoint;
  if(!validEndpoint(endpoint))fail(400,'This browser’s notification service is not supported.');
  const db=env.DB,now=Date.now();
  if(path==='/api/notifications/status'&&method==='POST'){
    const row=await db.prepare('SELECT photos_enabled,comments_enabled FROM push_subscriptions WHERE endpoint=? AND owner_id=?').bind(endpoint,owner).first();
    const settings=preferences(row);return json({registered:!!row,enabled:settings.photos||settings.comments,preferences:settings});
  }
  if(path==='/api/notifications'&&['PUT','PATCH'].includes(method)){
    const settings=data.preferences;
    if(settings!==undefined&&(settings===null||typeof settings!=='object'||Array.isArray(settings)||!Object.keys(settings).length||Object.entries(settings).some(([k,v])=>!['photos','comments'].includes(k)||typeof v!=='boolean')))fail(400,'Choose valid notification preferences.');
    if(method==='PATCH'&&settings===undefined)fail(400,'Choose a notification preference to update.');
    const photos=settings?.photos===undefined?null:Number(settings.photos),comments=settings?.comments===undefined?null:Number(settings.comments);
    if(method==='PUT'){
      const key=decode(data.keys?.p256dh,65);decode(data.keys?.auth,16);
      try{await crypto.subtle.importKey('raw',key,{name:'ECDH',namedCurve:'P-256'},false,[]);}catch{fail(400,'Invalid browser subscription.');}
      try{
        // Legacy clients opt into photos only; new clients explicitly choose both.
        const result=await db.prepare(`INSERT INTO push_subscriptions(id,owner_id,endpoint,p256dh,auth,cursor,comment_cursor,photos_enabled,comments_enabled,updated_at)
          VALUES(?,?,?,?,?,(SELECT COALESCE(MAX(seq),0) FROM push_events),(SELECT COALESCE(MAX(seq),0) FROM push_comment_events),?,?,?)
          ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,updated_at=excluded.updated_at
          WHERE push_subscriptions.owner_id=excluded.owner_id`).bind(crypto.randomUUID(),owner,endpoint,data.keys.p256dh,data.keys.auth,photos??1,comments??0,now).run();
        if(!result.meta.changes)fail(409,'This browser is subscribed with another account. Turn off its notifications first.');
      }catch(error){if(String(error).includes('too_many_devices'))fail(429,'Notifications are already enabled on 10 devices. Turn one off first.');throw error;}
    }
    const row=await db.prepare(`UPDATE push_subscriptions SET
      cursor=CASE WHEN photos_enabled=0 AND ?=1 THEN (SELECT COALESCE(MAX(seq),0) FROM push_events) ELSE cursor END,
      comment_cursor=CASE WHEN comments_enabled=0 AND ?=1 THEN (SELECT COALESCE(MAX(seq),0) FROM push_comment_events) ELSE comment_cursor END,
      photos_enabled=COALESCE(?,photos_enabled),comments_enabled=COALESCE(?,comments_enabled),updated_at=?
      WHERE endpoint=? AND owner_id=? RETURNING photos_enabled,comments_enabled`).bind(photos,comments,photos,comments,now,endpoint,owner).first();
    if(!row)fail(404,'Enable notifications on this device first.');
    const saved=preferences(row);return json({enabled:saved.photos||saved.comments,preferences:saved});
  }
  if(path==='/api/notifications'&&method==='DELETE'){
    await db.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND owner_id=?').bind(endpoint,owner).run();return json({enabled:false});
  }
  if(path==='/api/notifications/test'&&method==='POST'){
    const row=await db.prepare('UPDATE push_subscriptions SET test_at=? WHERE endpoint=? AND owner_id=? AND test_at<? AND (photos_enabled=1 OR comments_enabled=1) RETURNING id').bind(now,endpoint,owner,now-60000).first();
    if(!row)fail(429,'Enable notifications first, or wait a minute before another test.');
    await env.PUSH_QUEUE.send({id:row.id,test:true});return json({queued:true});
  }
  fail(405,'Method not allowed.');
}

// D1's post trigger records events in the same transaction as each upload. A periodic
// sweep means queue/provider outages never break uploads or lose the pending work.
export async function scheduleNotifications(env,now=Date.now()){
  if(!configured(env))return;
  await env.DB.prepare('DELETE FROM push_events WHERE created_at<?').bind(now-DAY).run();
  await env.DB.prepare('DELETE FROM push_subscriptions WHERE updated_at<?').bind(now-90*DAY).run();
  await env.DB.prepare('DELETE FROM push_comment_events WHERE created_at<?').bind(now-DAY).run();
  const {results}=await env.DB.prepare(`SELECT s.id,'photos' AS kind,s.last_sent AS sent FROM push_subscriptions s
    WHERE s.photos_enabled=1 AND s.lease_until<=? AND s.last_sent<=?
    AND EXISTS(SELECT 1 FROM push_events e JOIN posts p ON p.id=e.post_id WHERE e.seq>s.cursor AND e.created_at<=? AND p.owner_email!=s.owner_id)
    UNION ALL
    SELECT s.id,'comments' AS kind,s.comment_last_sent AS sent FROM push_subscriptions s
    WHERE s.comments_enabled=1 AND s.lease_until<=? AND s.comment_last_sent<=?
    AND EXISTS(SELECT 1 FROM push_comment_events e JOIN comments c ON c.id=e.comment_id JOIN posts p ON p.id=c.post_id
      WHERE e.seq>s.comment_cursor AND e.created_at<=? AND p.owner_email=s.owner_id AND c.owner_email!=s.owner_id)
    ORDER BY sent LIMIT 100`).bind(now,now-GROUP,now-GROUP,now,now-GROUP,now-GROUP).all();
  if(results.length)await env.PUSH_QUEUE.sendBatch(results.map(({id,kind})=>({body:{id,kind}})));

}
export async function sendPush(env,sub,data,transport=fetch){
  if(!validEndpoint(sub.endpoint))throw new Error('Unsupported stored push endpoint');
  let payload;
  try{payload=await buildPushPayload({data:JSON.stringify(data),options:{ttl:3600}},
    {endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},
    {subject:'https://garrigram.garrigram.workers.dev',publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY});}
  catch(error){error.pushStage='encryption';throw error;}
  // workerd supports only follow/manual. Manual never forwards signing headers
  // to redirect destinations; the consumer rejects every non-2xx response.
  try{return await transport(sub.endpoint,{...payload,redirect:'manual',signal:AbortSignal.timeout(15000)});}
  catch(error){error.pushStage='provider-request';throw error;}
}
export async function consumeNotifications(batch,env,transport=fetch,now=Date.now()){
  for(const message of batch.messages){
    const {id,test=false,kind='photos'}=message.body||{};
    if(typeof id!=='string'||!['photos','comments'].includes(kind)){message.ack();continue;}
    const comments=kind==='comments',cursor=comments?'comment_cursor':'cursor',lastSent=comments?'comment_last_sent':'last_sent',flag=comments?'comments_enabled':'photos_enabled',events=comments?'push_comment_events':'push_events';
    let leased=false;
    try{
      const sub=await env.DB.prepare('UPDATE push_subscriptions SET lease_until=? WHERE id=? AND lease_until<=? RETURNING *').bind(now+60000,id,now).first();
      if(!sub){if(await env.DB.prepare('SELECT id FROM push_subscriptions WHERE id=?').bind(id).first())message.retry({delaySeconds:60});else message.ack();continue;}leased=true;
      let end=sub[cursor],data={title:'Garrigram',body:'Notifications are on for this device.',url:'/#feed',tag:'garrigram-test'};
      if(!test){
        if(!sub[flag]){await env.DB.prepare('UPDATE push_subscriptions SET lease_until=0 WHERE id=?').bind(id).run();message.ack();continue;}
        end=(await env.DB.prepare(`SELECT COALESCE(MAX(seq),?) AS seq FROM ${events} WHERE created_at<=?`).bind(sub[cursor],now-GROUP).first()).seq;
        const query=comments?`SELECT p.id FROM push_comment_events e JOIN comments c ON c.id=e.comment_id JOIN posts p ON p.id=c.post_id
          WHERE e.seq>? AND e.seq<=? AND e.created_at>? AND p.owner_email=? AND c.owner_email!=p.owner_email ORDER BY e.seq DESC`
          :`SELECT p.id FROM push_events e JOIN posts p ON p.id=e.post_id WHERE e.seq>? AND e.seq<=? AND e.created_at>? AND p.owner_email!=? ORDER BY e.seq DESC`;
        const {results}=await env.DB.prepare(query).bind(sub[cursor],end,now-DAY,sub.owner_id).all();
        if(!results.length||sub[lastSent]>now-GROUP){
          await env.DB.prepare('UPDATE push_subscriptions SET lease_until=0 WHERE id=?').bind(id).run();message.ack();continue;
        }
        data=comments
          ?{title:'Garrigram',body:results.length===1?'Someone commented on your post.':`${results.length} new comments on your ${new Set(results.map(p=>p.id)).size===1?'post':'posts'}.`,url:`/?post=${results[0].id}#feed`,tag:'garrigram-comments'}
          :{title:'Garrigram',body:results.length===1?'A new photo from the team.':`${results.length} new photos from the team.`,url:results.length===1?`/?post=${results[0].id}#feed`:'/#feed',tag:'garrigram-photos'};
      }
      // Recheck the topic preference immediately before sending, including queued tests.
      const current=await env.DB.prepare('SELECT photos_enabled,comments_enabled FROM push_subscriptions WHERE id=?').bind(id).first();
      if(!current||!(test?(current.photos_enabled||current.comments_enabled):current[flag])){
        await env.DB.prepare('UPDATE push_subscriptions SET lease_until=0 WHERE id=?').bind(id).run();message.ack();continue;
      }
      const response=await sendPush(env,sub,data,transport);
      if(response.status===404||response.status===410){await env.DB.prepare('DELETE FROM push_subscriptions WHERE id=?').bind(id).run();message.ack();continue;}
      if(!response.ok)throw Object.assign(new Error('Push provider rejected delivery'),{pushStage:'provider-response',pushStatus:response.status});
      await env.DB.prepare(`UPDATE push_subscriptions SET ${cursor}=MAX(${cursor},?),lease_until=0,${lastSent}=?,updated_at=? WHERE id=?`).bind(end,test?sub[lastSent]:now,now,id).run();
      message.ack();
    }catch(error){
      // Never log endpoints, subscription secrets, identities or photo contents.
      console.warn('Notification delivery will retry',{stage:error.pushStage||'database',status:error.pushStatus||null,error:['TypeError','OperationError','DataError','AbortError','TimeoutError'].includes(error.name)?error.name:'Error'});
      if(leased)await env.DB.prepare('UPDATE push_subscriptions SET lease_until=0 WHERE id=?').bind(id).run();
      message.retry({delaySeconds:120});
    }
  }
}
