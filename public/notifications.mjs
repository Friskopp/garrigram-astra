export function initNotifications({api}){
  const section=document.createElement('section');section.className='notification-settings';
  section.innerHTML=`<h3>Notifications</h3><div class="notification-row"><label for="photo-notifications">New photos on this device</label><button type="button" id="photo-notifications" role="switch" aria-checked="false" aria-describedby="notification-help" disabled><span></span></button></div><p id="notification-help" class="file-help" role="status">Checking notification support…</p><button type="button" class="text-button" id="notification-test" hidden>Send test notification</button>`;
  document.getElementById('profile-save').before(section);
  const toggle=section.querySelector('[role=switch]'),help=section.querySelector('#notification-help'),test=section.querySelector('#notification-test');
  let config=null,registration=null,enabled=false,busy=false;
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const installed=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  function paint(){toggle.setAttribute('aria-checked',String(enabled));test.hidden=!enabled;toggle.disabled=busy||!config?.available;}
  function guidance(){
    if(ios&&!installed)return 'On iPhone or iPad: open Garrigram in Safari, tap Share → Add to Home Screen, then open that app to enable notifications.';
    if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window))return 'Push notifications aren’t supported in this browser. Try Safari on iPhone or Chrome on Android.';
    if(Notification.permission==='denied')return 'Notifications are blocked. Allow them in your browser or device settings, then return here.';
    return null;
  }
  async function refresh(){
    if(busy)return;busy=true;toggle.disabled=true;
    try{
      config=await api('/api/notifications');
      if(!config.available){help.textContent='Push notifications are available on the deployed app.';enabled=false;return;}
      const hint=guidance();
      if(hint&&(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)||(ios&&!installed))){help.textContent=hint;toggle.disabled=true;return;}
      registration=await navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'});
      // Do not prompt here. Permission is requested only from the toggle click.
      const subscription=await registration.pushManager.getSubscription();
      enabled=!!subscription&&(await api('/api/notifications/status',{method:'POST',body:JSON.stringify({endpoint:subscription.endpoint})})).enabled;
      help.textContent=hint||(enabled?'On for this device. Uploads close together are grouped; your own photos won’t notify you.':'Off. Turn on to hear when the team shares photos, even when Garrigram is closed.');
    }catch{config=null;help.textContent='Couldn’t load notification settings. Close and reopen your profile to retry.';}
    finally{busy=false;paint();if(guidance()&&!enabled)toggle.disabled=true;}
  }
  toggle.onclick=async()=>{
    if(busy)return;busy=true;paint();help.textContent=enabled?'Turning notifications off…':'Enabling notifications…';
    try{
      if(enabled){
        const sub=await registration.pushManager.getSubscription();
        if(sub){await api('/api/notifications',{method:'DELETE',body:JSON.stringify({endpoint:sub.endpoint})});try{await sub.unsubscribe();}catch{/* Server removal already stops delivery. */}}
        enabled=false;help.textContent='Off for this device. Your other devices are unchanged.';
      }else{
        // Keep this call before any await: Safari requires direct user interaction.
        const permission=await Notification.requestPermission();
        if(permission!=='granted'){help.textContent=permission==='denied'?'Notifications are blocked. You can allow them in your device settings.':'Notifications remain off. You can enable them whenever you like.';return;}
        registration=await navigator.serviceWorker.ready;
        const previous=await registration.pushManager.getSubscription();
        if(previous)await previous.unsubscribe();
        const key=Uint8Array.from(atob(config.publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
        const sub=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
        try{await api('/api/notifications',{method:'PUT',body:JSON.stringify(sub.toJSON())});}
        catch(error){await sub.unsubscribe();throw error;}
        enabled=true;help.textContent='On for this device. New photos are grouped into a short update.';
      }
    }catch(error){help.textContent=error.message||'Couldn’t update notifications. Try again.';}
    finally{busy=false;paint();if(guidance()&&!enabled)toggle.disabled=true;}
  };
  test.onclick=async()=>{
    test.disabled=true;
    try{const sub=await registration.pushManager.getSubscription();if(!sub)throw new Error('Turn notifications off and on again to reconnect this device.');await api('/api/notifications/test',{method:'POST',body:JSON.stringify({endpoint:sub.endpoint})});help.textContent='Test queued. A notification should arrive shortly, subject to your device’s notification settings.';}
    catch(error){help.textContent=error.message;}
    finally{test.disabled=false;}
  };
  document.getElementById('profile-button').addEventListener('click',()=>void refresh());
  return {refresh};
}
