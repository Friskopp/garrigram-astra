import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

async function ui({permission='default',ios=false,installed=false,available=true,active=false,failDelete=false}={}){
 const toggle={disabled:true,setAttribute(k,v){this[k]=v;}},help={},testButton={},handlers={};
 const section={querySelector(s){return s==='[role=switch]'?toggle:s==='#notification-help'?help:testButton;}};
 const document={createElement(){return section;},getElementById(id){return id==='profile-save'?{before(){}}:{addEventListener(type,fn){handlers[type]=fn;}};}};
 let server=active,sub=active?subscription():null,prompts=0;
 function subscription(){return {endpoint:'https://web.push.apple.com/test',toJSON(){return {endpoint:this.endpoint,keys:{p256dh:'test',auth:'test'}};},async unsubscribe(){sub=null;return true;}};}
 const registration={pushManager:{async getSubscription(){return sub;},async subscribe(){sub=subscription();return sub;}}};
 const Notification={permission,requestPermission(){prompts++;this.permission='granted';return Promise.resolve('granted');}};
 const context=vm.createContext({document,navigator:{userAgent:ios?'iPhone':'Chrome',platform:'',maxTouchPoints:0,serviceWorker:{async register(){return registration;},ready:Promise.resolve(registration)}},window:{PushManager:{},Notification},Notification,matchMedia:()=>({matches:installed}),atob,Uint8Array});
 const source=(await readFile('public/notifications.mjs','utf8')).replace('export function','function');vm.runInContext(source,context);
 const controls=context.initNotifications({api:async(path,options)=>{
  if(!options)return {available,publicKey:'AQ'};
  if(path.endsWith('/status'))return {enabled:server};
  if(options.method==='PUT')server=true;
  if(options.method==='DELETE'){if(failDelete)throw new Error('Offline');server=false;}
  return {};
 }});
 return {toggle,help,testButton,controls,get prompts(){return prompts;},get server(){return server;}};
}

test('profile notification toggle never prompts on open, persists opt-in, and turns server delivery off',async()=>{
 const f=await ui();await f.controls.refresh();assert.equal(f.prompts,0);assert.equal(f.toggle['aria-checked'],'false');assert.equal(f.toggle.disabled,false);
 await f.toggle.onclick();assert.equal(f.prompts,1);assert.equal(f.server,true);assert.equal(f.testButton.hidden,false);
 await f.controls.refresh();assert.equal(f.toggle['aria-checked'],'true');assert.equal(f.prompts,1);
 await f.toggle.onclick();assert.equal(f.server,false);assert.equal(f.toggle['aria-checked'],'false');
});

test('unsupported/local/iPhone states explain setup and disabling does not falsely succeed offline',async()=>{
 const iphone=await ui({ios:true});await iphone.controls.refresh();assert.equal(iphone.toggle.disabled,true);assert.match(iphone.help.textContent,/Home Screen/);assert.equal(iphone.prompts,0);
 const local=await ui({available:false});await local.controls.refresh();assert.equal(local.toggle.disabled,true);assert.match(local.help.textContent,/deployed app/);
 const offline=await ui({active:true,permission:'granted',failDelete:true});await offline.controls.refresh();await offline.toggle.onclick();assert.equal(offline.server,true);assert.equal(offline.toggle['aria-checked'],'true');assert.equal(offline.help.textContent,'Offline');
 const blocked=await ui({active:true,permission:'denied'});await blocked.controls.refresh();assert.equal(blocked.toggle.disabled,false);await blocked.toggle.onclick();assert.equal(blocked.server,false);
});

test('service worker shows alerts without network access and constrains notification navigation to Garrigram',async()=>{
 const events={},notifications=[],navigations=[];
 const self={location:{origin:'https://app.example'},addEventListener(name,fn){events[name]=fn;},registration:{async showNotification(title,options){notifications.push({title,...options});}},clients:{async matchAll(){return [];},async openWindow(url){navigations.push(url);}}};
 vm.runInNewContext(await readFile('public/sw.js','utf8'),{self,URL});
 let pending;events.push({data:{json:()=>({body:'A new photo from the team.',url:'https://evil.example',tag:'bad'})},waitUntil(p){pending=p;}});await pending;
 assert.equal(notifications[0].data.url,'/#feed');assert.equal(notifications[0].tag,'garrigram-photos');assert.equal(events.fetch,undefined);
 events.notificationclick({notification:{close(){},data:{url:'/?post=abc#feed'}},waitUntil(p){pending=p;}});await pending;assert.equal(navigations[0],'https://app.example/?post=abc#feed');
});
