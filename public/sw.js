// No fetch handler or offline cache: private photos and Access login responses are
// always fetched normally. Push delivery works without an active login session.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
  let data={};try{data=event.data?.json()||{};}catch{}
  let url='/#feed';
  try{const target=new URL(data.url,self.location.origin);if(target.origin===self.location.origin&&target.pathname==='/')url=target.pathname+target.search+target.hash;}catch{}
  event.waitUntil(self.registration.showNotification('Garrigram',{
    body:typeof data.body==='string'?data.body.slice(0,200):'New photos from the team.',
    tag:['garrigram-test','garrigram-comments'].includes(data.tag)?data.tag:'garrigram-photos',
    renotify:false,data:{url},
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const url=new URL(event.notification.data?.url||'/#feed',self.location.origin);
    if(url.origin!==self.location.origin)return;
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const existing=windows.find(client=>new URL(client.url).origin===self.location.origin);
    if(existing){await existing.navigate(url.href);await existing.focus();}
    else await self.clients.openWindow(url.href);
  })());
});
