export function initNotifications({api}){
  const section=document.createElement('section');section.className='notification-settings';
  section.innerHTML=`<h3>Notifications</h3><div class="notification-row"><label for="photo-notifications">New photos on this device</label><button type="button" id="photo-notifications" role="switch" aria-checked="false" aria-describedby="notification-help" disabled><span></span></button></div><div class="notification-row"><label for="comment-notifications">Comments on my posts</label><button type="button" id="comment-notifications" role="switch" aria-checked="false" aria-describedby="notification-help" disabled><span></span></button></div><p id="notification-help" class="file-help" role="status">Checking notification support…</p><button type="button" class="text-button" id="notification-test" hidden>Send test notification</button>`;
  document.getElementById('profile-save').before(section);
  const toggles={photos:section.querySelector('#photo-notifications'),comments:section.querySelector('#comment-notifications')},help=section.querySelector('#notification-help'),test=section.querySelector('#notification-test');
  let config=null,registration=null,registered=false,settings={photos:false,comments:false},busy=false;
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const installed=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  function paint(){
    for(const [kind,toggle]of Object.entries(toggles)){toggle.setAttribute('aria-checked',String(settings[kind]));toggle.disabled=busy||!config?.available||(!!guidance()&&!settings[kind]);}
    test.hidden=!(settings.photos||settings.comments);test.disabled=busy;
  }
  function guidance(){
    if(ios&&!installed)return 'On iPhone or iPad: open Garrigram in Safari, tap Share → Add to Home Screen, then open that app to enable notifications.';
    if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window))return 'Push notifications aren’t supported in this browser. Try Safari on iPhone or Chrome on Android.';
    if(Notification.permission==='denied')return 'Notifications are blocked. Allow them in your browser or device settings, then return here.';
    return null;
  }
  function summary(){return settings.photos||settings.comments?'Saved for this device. Alerts are grouped; your own uploads and comments won’t notify you.':'Off for this device. Choose what you’d like to hear about. Your other devices are unchanged.';}
  function readSettings(result){return result.preferences||{photos:!!result.enabled,comments:false};}
  async function refresh(){
    if(busy)return;busy=true;paint();
    try{
      config=await api('/api/notifications');
      if(!config.available){help.textContent='Push notifications are available on the deployed app.';settings={photos:false,comments:false};return;}
      const hint=guidance();
      if(hint&&(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)||(ios&&!installed))){help.textContent=hint;return;}
      registration=await navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'});
      // No permission prompt on open: only a toggle click can request permission.
      const sub=await registration.pushManager.getSubscription();
      const result=sub?await api('/api/notifications/status',{method:'POST',body:JSON.stringify({endpoint:sub.endpoint})}):{enabled:false,registered:false};
      registered=result.registered??result.enabled;settings=readSettings(result);help.textContent=hint||summary();
    }catch{config=null;help.textContent='Couldn’t load notification settings. Close and reopen your profile to retry.';}
    finally{busy=false;paint();}
  }
  for(const [kind,toggle]of Object.entries(toggles))toggle.onclick=async()=>{
    if(busy)return;const turnOn=!settings[kind];busy=true;paint();help.textContent='Saving notification preference…';
    try{
      // Safari requires this permission request directly inside the user gesture.
      if(turnOn&&Notification.permission!=='granted'){
        const permission=await Notification.requestPermission();
        if(permission!=='granted'){help.textContent=permission==='denied'?'Notifications are blocked. You can allow them in your device settings.':'Your notification preferences are unchanged.';return;}
      }
      registration=await navigator.serviceWorker.ready;
      let sub=await registration.pushManager.getSubscription(),result;
      if(registered&&sub){
        // Update just this topic so another tab's preferences aren't overwritten.
        result=await api('/api/notifications',{method:'PATCH',body:JSON.stringify({endpoint:sub.endpoint,preferences:{[kind]:turnOn}})});
      }else if(turnOn){
        if(sub)await sub.unsubscribe();
        const key=Uint8Array.from(atob(config.publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
        sub=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
        try{result=await api('/api/notifications',{method:'PUT',body:JSON.stringify({...sub.toJSON(),preferences:{...settings,[kind]:true}})});}
        catch(error){await sub.unsubscribe();throw error;}
        registered=true;
      }else{result={enabled:false};registered=false;}
      settings=readSettings(result);help.textContent=summary();
    }catch(error){help.textContent=error.message||'Couldn’t update notifications. Try again.';}
    finally{busy=false;paint();}
  };
  test.onclick=async()=>{
    test.disabled=true;
    try{const sub=await registration.pushManager.getSubscription();if(!sub)throw new Error('Close and reopen your profile to reconnect this device.');await api('/api/notifications/test',{method:'POST',body:JSON.stringify({endpoint:sub.endpoint})});help.textContent='Test queued. A notification should arrive shortly, subject to your device’s notification settings.';}
    catch(error){help.textContent=error.message;}
    finally{test.disabled=false;}
  };
  document.getElementById('profile-button').addEventListener('click',()=>void refresh());
  return {refresh};
}
