const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials=name=>name.trim().split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase()||'Y';
export function avatarMarkup(name,url){return url?`<img src="${esc(url)}" alt="" loading="lazy" decoding="async">`:esc(initials(name||''));}

export function initPeople({api,toast,getMap,isPeople,onProfile,getName}){
  let me=null,state={people:[],requests:[],self:null,next_request_at:0},offset=0,selected=null,refreshing=false,profileBusy=false,locationBusy=false,requestBusy=false;
  let avatarChange, cropImage=null,cropURL=null,cropTask=0,requestToAnswer=null,lastError='';
  const pins=new Map(),now=()=>Date.now()+offset;
  const active=()=>state.people.filter(p=>p.expires_at>now());
  const own=()=>active().find(p=>p.id===state.self);
  const minutesLeft=p=>Math.max(1,Math.ceil((p.expires_at-now())/60000));
  const age=p=>Math.max(0,Math.floor((now()-p.shared_at)/60000));
  const ageText=p=>age(p)<1?'Location shared just now':`Location shared ${age(p)} min ago`;
  const markup=(id,html)=>{if($(id).innerHTML!==html)$(id).innerHTML=html;};
  const closeIcon='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="m6 6 12 12M6 18 18 6"/></svg>';
  const closeButton=label=>`<button type="button" class="icon-button" data-people-close aria-label="${label}">${closeIcon}</button>`;
  $('profile-button').setAttribute('aria-label','Edit profile');
  $('profile-form').innerHTML=`<div class="dialog-heading"><h2>Edit profile</h2>${closeButton('Close profile')}</div>
    <div id="avatar-preview" class="avatar profile-avatar" aria-label="Profile photo"></div>
    <div class="avatar-actions"><label class="secondary file-label">Choose photo<input id="avatar-input" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif"></label><button type="button" class="text-button" id="avatar-remove">Remove photo</button></div>
    <section id="avatar-crop" hidden><p class="file-help">Drag to position your photo, then adjust the zoom.</p><canvas id="avatar-canvas" width="320" height="320" aria-label="Square photo crop preview"></canvas>
      <label class="crop-control">Zoom<input id="avatar-zoom" type="range" min="1" max="3" step=".01" value="1"></label>
      <label class="crop-control">Left / right<input id="avatar-x" type="range" min="0" max="100" value="50"></label>
      <label class="crop-control">Up / down<input id="avatar-y" type="range" min="0" max="100" value="50"></label></section>
    <label class="field-label" for="display-name">Display name</label><input id="display-name" maxlength="60" required autocomplete="name">
    <p id="profile-description" class="file-help">Your name and photo appear on posts, comments and the People map.</p><p id="profile-error" class="error" role="alert"></p><button class="primary" id="profile-save" type="submit">Save profile</button>`;
  $('status').insertAdjacentHTML('afterend','<div id="location-notices" aria-live="polite"></div>');
  document.querySelector('.map-frame').insertAdjacentHTML('beforeend','<div id="sharing-status" class="sharing-status" hidden></div><section id="person-sheet" class="person-sheet" aria-label="Selected colleague" hidden></section>');
  $('map-note').insertAdjacentHTML('beforebegin',`<div id="people-actions" class="people-actions" hidden><button class="primary" id="share-location">Share my location</button><button class="secondary" id="ask-location">Where is everyone?</button></div><p id="people-error" class="error" role="status" hidden></p>`);
  document.body.insertAdjacentHTML('beforeend',`<dialog id="checkin-dialog"><form id="checkin-form"><div class="dialog-heading"><h2>Share where you are</h2>${closeButton('Close location sharing')}</div><p>Your current location will appear for the team for <strong>one hour</strong>. It won’t follow you as you move. You can update it or stop sharing anytime.</p><label class="field-label" for="checkin-message">A little message <span>optional</span></label><textarea id="checkin-message" maxlength="200" rows="2" placeholder="Coffee here—come join us!"></textarea><p id="checkin-error" class="error" role="alert"></p><button id="checkin-save" class="primary" type="submit">Share for 1 hour</button></form></dialog>
    <dialog id="request-dialog"><form id="request-form"><div class="dialog-heading"><h2>Where is everyone?</h2>${closeButton('Close location request')}</div><p>Ask the team to check in. They’ll see your request when they open Garrigram, and choose whether to share.</p><label class="field-label" for="request-message">Add a message <span>optional</span></label><textarea id="request-message" maxlength="200" rows="3" placeholder="Meeting at the restaurant in 15 minutes."></textarea><p class="file-help">Requests last an hour. You can send one every 10 minutes.</p><p id="request-error" class="error" role="alert"></p><button id="request-send" class="primary" type="submit">Ask the team</button></form></dialog>`);
  for(const dialog of [$('profile-dialog'),$('checkin-dialog'),$('request-dialog')]){
    dialog.querySelector('[data-people-close]').onclick=()=>{if(!profileBusy&&!locationBusy&&!requestBusy)dialog.close();};
    dialog.addEventListener('cancel',e=>{if(profileBusy||locationBusy||requestBusy)e.preventDefault();});
  }
  function profilePreview(){const name=$('display-name').value||me?.name||getName();$('avatar-preview').innerHTML=avatarMarkup(name,avatarChange===null?null:typeof avatarChange==='string'?avatarChange:me?.avatar);$('avatar-remove').hidden=avatarChange===null||(!cropImage&&!me?.avatar&&typeof avatarChange!=='string');}
  function discardCrop(){if(!profileBusy)$('profile-save').disabled=false;cropTask++;cropImage=null;if(cropURL)URL.revokeObjectURL(cropURL);cropURL=null;$('avatar-crop').hidden=true;$('avatar-input').value='';}
  $('profile-button').onclick=()=>{if(profileBusy)return;discardCrop();avatarChange=undefined;$('display-name').value=me?.name||getName();$('profile-error').textContent='';profilePreview();$('profile-dialog').showModal();};
  $('profile-dialog').addEventListener('close',()=>{if(!profileBusy)discardCrop();});
  $('display-name').oninput=profilePreview;
  $('avatar-remove').onclick=()=>{discardCrop();avatarChange=null;profilePreview();};
  function drawCrop(){if(!cropImage)return;const canvas=$('avatar-canvas'),ctx=canvas.getContext('2d'),side=Math.min(cropImage.naturalWidth,cropImage.naturalHeight)/Number($('avatar-zoom').value),x=(cropImage.naturalWidth-side)*Number($('avatar-x').value)/100,y=(cropImage.naturalHeight-side)*Number($('avatar-y').value)/100;ctx.fillStyle='#fff';ctx.fillRect(0,0,320,320);ctx.drawImage(cropImage,x,y,side,side,0,0,320,320);avatarChange=canvas.toDataURL('image/jpeg',.85);profilePreview();}
  for(const id of ['avatar-zoom','avatar-x','avatar-y'])$(id).oninput=drawCrop;
  $('avatar-input').onchange=async e=>{
    const file=e.target.files[0];if(!file)return;discardCrop();const task=cropTask;
    $('profile-error').textContent='';$('profile-save').disabled=true;
    try{if(file.size>15*1024*1024)throw new Error('Choose a photo under 15 MB.');const url=URL.createObjectURL(file);cropURL=url;const image=new Image();image.src=url;await image.decode();if(task!==cropTask)return;cropImage=image;$('avatar-zoom').value=1;$('avatar-x').value=50;$('avatar-y').value=50;$('avatar-crop').hidden=false;drawCrop();}
    catch{if(task===cropTask)$('profile-error').textContent='That photo couldn’t be opened. Try a JPG, PNG or WebP under 15 MB.';}
    finally{if(task===cropTask)$('profile-save').disabled=false;}
  };
  let drag=null;
  $('avatar-canvas').onpointerdown=e=>{if(!cropImage)return;drag={x:e.clientX,y:e.clientY,px:Number($('avatar-x').value),py:Number($('avatar-y').value)};e.currentTarget.setPointerCapture(e.pointerId);};
  $('avatar-canvas').onpointermove=e=>{if(!drag)return;const side=Math.min(cropImage.naturalWidth,cropImage.naturalHeight)/Number($('avatar-zoom').value),scale=side/e.currentTarget.clientWidth;for(const [id,d,origin,total]of[['avatar-x',e.clientX-drag.x,drag.px,cropImage.naturalWidth-side],['avatar-y',e.clientY-drag.y,drag.py,cropImage.naturalHeight-side]])$(id).value=Math.max(0,Math.min(100,origin-(total?d*scale/total*100:0)));drawCrop();};
  $('avatar-canvas').onpointerup=$('avatar-canvas').onpointercancel=()=>{drag=null;};
  function header(){if(!me)return;$('author').readOnly=!!me.name;$('author').title=me.name?'Change your name in your profile':'';$('profile-initials').innerHTML=avatarMarkup(me.name||getName(),me.avatar);$('profile-name').textContent=(me.name||getName()).split(' ')[0]||'Your name';}
  $('profile-form').onsubmit=async e=>{
    e.preventDefault();if(profileBusy)return;profileBusy=true;$('profile-save').disabled=true;$('profile-error').textContent='';
    try{me=await api('/api/profile',{method:'PUT',body:JSON.stringify({name:$('display-name').value,...(avatarChange!==undefined?{avatar:avatarChange}:{})})});await onProfile(me);header();$('profile-dialog').close();discardCrop();await refresh();toast('Profile saved.');}
    catch(error){$('profile-error').textContent=error.message;}
    finally{profileBusy=false;$('profile-save').disabled=false;}
  };
  function named(){if(me?.name)return true;$('profile-button').click();toast('Save your name first so the team knows it’s you.');return false;}
  function openShare(requestId=null){if(!named())return;requestToAnswer=requestId;$('checkin-message').value=own()?.message||'';$('checkin-error').textContent='';$('checkin-dialog').showModal();}
  $('share-location').onclick=()=>openShare();
  $('checkin-form').onsubmit=async e=>{
    e.preventDefault();if(locationBusy)return;locationBusy=true;$('checkin-save').disabled=true;$('checkin-save').textContent='Finding your location…';$('checkin-error').textContent='';
    try{
      if(!navigator.geolocation)throw new Error('Location isn’t supported in this browser.');
      const position=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,()=>reject(new Error('Location wasn’t available. Allow location for this site in your browser settings, then try again.')),{enableHighAccuracy:true,timeout:12000,maximumAge:0}));
      await api('/api/check-in',{method:'PUT',body:JSON.stringify({lat:position.coords.latitude,lng:position.coords.longitude,message:$('checkin-message').value})});
      if(requestToAnswer)await api(`/api/location-requests/${requestToAnswer}/dismiss`,{method:'POST',body:'{}'});
      $('checkin-dialog').close();await refresh();toast('Location shared for one hour.');
    }catch(error){$('checkin-error').textContent=error.message;}
    finally{locationBusy=false;$('checkin-save').disabled=false;$('checkin-save').textContent='Share for 1 hour';}
  };
  async function stopSharing(button){button.disabled=true;try{await api('/api/check-in',{method:'DELETE'});await refresh();toast('You’ve stopped sharing.');}catch(error){lastError=error.message;render();}finally{button.disabled=false;}}
  $('ask-location').onclick=()=>{if(!named())return;$('request-error').textContent='';$('request-message').value='';$('request-dialog').showModal();};
  $('request-form').onsubmit=async e=>{e.preventDefault();if(requestBusy)return;requestBusy=true;$('request-send').disabled=true;$('request-error').textContent='';try{await api('/api/location-requests',{method:'POST',body:JSON.stringify({message:$('request-message').value})});$('request-dialog').close();await refresh();toast('Request sent. The team will see it in Garrigram.');}catch(error){$('request-error').textContent=error.message;}finally{requestBusy=false;$('request-send').disabled=false;}};
  $('location-notices').onclick=async e=>{const button=e.target.closest('[data-request]');if(!button)return;const id=button.dataset.request;if(button.dataset.action==='share'){openShare(id);return;}button.disabled=true;try{await api(`/api/location-requests/${id}/dismiss`,{method:'POST',body:'{}'});await refresh();}catch(error){toast(error.message);button.disabled=false;}};
  $('sharing-status').onclick=e=>{const button=e.target.closest('button');if(button?.dataset.action==='stop')void stopSharing(button);};
  $('person-sheet').onclick=e=>{if(e.target.closest('[data-close-person]')){selected=null;renderMap();}};
  function render(){
    const mine=own(),cooldown=Math.max(0,Math.ceil((state.next_request_at-now())/60000));
    $('people-actions').hidden=!isPeople();$('people-error').hidden=!isPeople()||!lastError;$('people-error').textContent=lastError;
    $('share-location').textContent=mine?'Update my location':'Share my location';$('ask-location').disabled=!!cooldown;$('ask-location').textContent=cooldown?`Ask again in ${cooldown} min`:'Where is everyone?';
    $('sharing-status').hidden=!isPeople();markup('sharing-status',mine?`<div><span class="sharing-symbol">⌖</span><strong>Sharing for another <span>${minutesLeft(mine)} min</span></strong></div><button type="button" class="text-button" data-action="stop">Stop sharing</button>`:`<strong>${active().length?'Find your people':'Nobody has shared their location yet.'}</strong><p>${active().length?'Pins show a shared moment, not a live position.':'Be the first to check in. Sharing is always optional.'}</p>`);
    const requests=state.requests.filter(r=>r.expires_at>now());
    markup('location-notices',requests.slice(0,3).map(r=>`<section class="location-request"><div class="request-title"><span class="avatar">${avatarMarkup(r.name,r.avatar)}</span><strong>${esc(r.name)} is asking where everyone is</strong></div>${r.message?`<p>“${esc(r.message)}”</p>`:''}<div class="request-buttons"><button class="primary" data-request="${r.id}" data-action="share">Share my location</button><button class="secondary" data-request="${r.id}" data-action="dismiss">Dismiss</button></div><p class="file-help">Sharing is optional. Your location disappears after one hour.</p></section>`).join(''));
    renderMap();
  }
  function renderMap(){
    const map=getMap();if(!map)return;
    if(!isPeople()){for(const marker of pins.values())marker.remove();pins.clear();$('person-sheet').hidden=true;return;}
    const people=active(),ids=new Set(people.map(p=>p.id));
    for(const [id,marker]of pins)if(!ids.has(id)){marker.remove();pins.delete(id);}
    for(const p of people){const html=`<span class="person-avatar ${p.id===selected?'selected':''}">${avatarMarkup(p.name,p.avatar)}</span>${p.id===state.self?'<span class="person-you">You</span>':''}`;
      let marker=pins.get(p.id);if(!marker){marker=L.marker([p.lat,p.lng],{keyboard:true,title:p.name,alt:`${p.name} — shared location`}).addTo(map);marker.on('click',()=>{selected=p.id;renderMap();});pins.set(p.id,marker);}
      marker.setLatLng([p.lat,p.lng]);if(marker._peopleHTML!==html){marker.setIcon(L.divIcon({className:'person-pin',html,iconSize:[48,58],iconAnchor:[24,24]}));marker._peopleHTML=html;}marker.getElement()?.setAttribute('aria-label',p.name+' — '+ageText(p));marker.setZIndexOffset(p.id===selected?1000:0);
    }
    const person=people.find(p=>p.id===selected);if(!person)selected=null;$('person-sheet').hidden=!person;
    if(person)markup('person-sheet',`<div class="person-sheet-heading"><span class="avatar">${avatarMarkup(person.name,person.avatar)}</span><div><h3>${esc(person.name)}${person.id===state.self?' · You':''}</h3><p>${ageText(person)}</p></div><button type="button" class="icon-button" data-close-person aria-label="Close colleague">${closeIcon}</button></div>${person.message?`<p class="checkin-note">${esc(person.message)}</p>`:''}<div class="person-sheet-footer"><span>Visible for ${minutesLeft(person)} more min</span><a class="primary" href="https://www.google.com/maps/dir/?api=1&destination=${person.lat},${person.lng}" target="_blank" rel="noopener noreferrer">Get directions ↗</a></div>`);
    $('fit-map').disabled=!people.length;$('map-note').textContent=`${people.length} ${people.length===1?'person has':'people have'} shared a location · Pins expire after one hour. Tap a person for the time shared.`;
  }
  async function refresh(){if(refreshing)return;refreshing=true;try{const result=await api('/api/people');offset=result.server_time-Date.now();state=result;lastError='';}catch(error){lastError=error.message;}finally{refreshing=false;render();}}
  function fit(){const points=active();if(getMap()&&points.length)getMap().fitBounds(L.latLngBounds(points.map(p=>[p.lat,p.lng])).pad(.3),{maxZoom:16});}
  async function start(){try{me=await api('/api/profile');if(me.name)await onProfile(me);header();}catch(error){lastError=error.message;}await refresh();}
  let firstPeople=true;
  function modeChanged(){document.querySelector('.map-frame').classList.toggle('people-mode',isPeople());render();if(isPeople()){void refresh();if(firstPeople&&active().length){fit();firstPeople=false;}}}
  setInterval(()=>{if(!document.hidden)void refresh();},15000);
  setInterval(()=>{if(!document.hidden)render();},10000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
  return {start,refresh,renderMap,modeChanged,fit,header};
}
