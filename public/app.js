import { effectSvg } from './effects.mjs';
import { mapPosts, createHeatLayer } from './heatmap.mjs';
let heatLayer, mapMode = 'photos';
const icons={grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',map:'<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15"/>',plus:'<path d="M12 5v14M5 12h14"/>',camera:'<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="4"/>',heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',pin:'<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',locate:'<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',spark:'<path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z"/>'};
icons.comment='<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H6l-4 2 1.5-5A8.5 8.5 0 1 1 21 11.5Z"/>';
const icon=name=>`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||''}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
const $=id=>document.getElementById(id);
function openCompose(){ $('author').value=displayName; $('compose-error').textContent=''; $('compose-dialog').showModal(); }
['share-button','mobile-share','first-share'].forEach(id=>$(id)?.addEventListener('click',openCompose));
document.querySelectorAll('.close-dialog').forEach(el=>el.onclick=()=>el.closest('dialog').close());
$('profile-button').onclick=()=>{ $('display-name').value=displayName; $('profile-dialog').showModal(); };

const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
let visitorId,displayName='';
try { visitorId=localStorage.getItem('garrigram-visitor')||crypto.randomUUID(); localStorage.setItem('garrigram-visitor',visitorId); displayName=localStorage.getItem('garrigram-name')||''; } catch { visitorId=crypto.randomUUID(); }
let posts=[],map,pickerMap,pickerMarker,markers=[],selectedLocation=null,photoData=null,photoEffect=null,photoTask=0,toastTimer,refreshing=false;
const commentStates=new Map();
const effectLevels=new Map();
const effectJobs=new Map();

const places={office:{location:'Garrison HQ · Södermalmstorg',lat:59.3198,lng:18.0716},stockholm:{location:'Stockholm',lat:59.3293,lng:18.0686},gothenburg:{location:'Gothenburg',lat:57.7089,lng:11.9746},malmo:{location:'Malmö',lat:55.605,lng:13.0038}};
const credits={'demo-stockholm':['Elijah Cobb','https://unsplash.com/photos/EAe_AWX92ds'],'demo-fika':['Mikael Stenberg','https://unsplash.com/photos/QL9AkXhjJuA'],'demo-archipelago':['Max van den Oetelaar','https://unsplash.com/photos/UTAoG0oeXew']};
const initials=name=>name.trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
function saveName(name){displayName=name.trim();try{localStorage.setItem('garrigram-name',displayName);}catch{}renderName();}
function renderName(){$('profile-initials').textContent=displayName?initials(displayName):'Y';$('profile-name').textContent=displayName?displayName.split(' ')[0]:'Your name';}
renderName();
$('profile-form').onsubmit=e=>{e.preventDefault();const name=$('display-name').value.trim();if(!name)return;saveName(name);$('profile-dialog').close();toast('Nice to see you, '+displayName.split(' ')[0]+'.');};
function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
async function api(url,options={}){const headers={'X-Visitor-Id':visitorId,...options.headers};if(!(options.body instanceof FormData))headers['Content-Type']='application/json';let response;try{response=await fetch(url,{...options,headers});}catch{throw new Error('Couldn’t connect. Check your connection, or sign in again in a new tab. Your draft is still here.');}if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('Please sign in again in a new tab, then retry. Your draft is still here.');const body=await response.json();if(!response.ok)throw new Error(body.error||'Something went wrong. Please try again.');return body;}
function relativeDate(date){const days=Math.floor((Date.now()-new Date(date).getTime())/86400000);if(days===0)return'Today';if(days===1)return'Yesterday';return new Date(date).toLocaleDateString('en-GB',{day:'numeric',month:'short'});}
function card(post){const credit=credits[post.id];return `<article class="post" data-post="${escapeHTML(post.id)}"><header class="post-header"><span class="avatar" style="background:${post.demo?'#414937':'#344a40'}">${escapeHTML(initials(post.author))}</span><div><div class="post-author">${escapeHTML(post.author)}</div><div class="post-meta"><span>${post.demo?'A little inspiration':escapeHTML(relativeDate(post.created_at))}</span>${post.location?`<span>·</span><span>${escapeHTML(post.location.split(' · ')[0])}</span>`:''}</div></div>${post.demo?'<span class="demo-label">EXAMPLE</span>':''}${post.can_edit?'<div class="owner-actions"><button class="text-button" data-action="edit-post" aria-label="Edit post">Edit</button><button class="text-button" data-action="delete-post" aria-label="Delete post">Delete</button></div>':''}</header>${photoMarkup(post)}<div class="post-content"><div class="post-actions"><button class="like-button ${post.liked?'liked':''}" data-action="like" aria-label="${post.liked?'Unlike':'Like'} moment by ${escapeHTML(post.author)}" aria-pressed="${Boolean(post.liked)}">${icon('heart')}<span>${post.liked?'Liked':'Like'}</span></button><button class="like-count text-button" data-action="likers" aria-label="Who liked this moment" ${post.likes?'':'hidden'}>${post.likes} ${post.likes===1?'like':'likes'}</button><button class="comment-toggle text-button" data-action="comments" aria-expanded="${Boolean(commentStates.get(post.id)?.open)}">${icon('comment')}<span>${commentLabel(post)}</span></button>${post.location?`<button class="location-link" data-action="map">${icon('pin')}${escapeHTML(post.location.split(' · ')[0])}</button>`:''}</div>${post.caption?`<p class="post-caption">${escapeHTML(post.caption)}</p>`:''}<div class="post-footer"><span>${post.demo?'EXAMPLE MOMENT':escapeHTML(new Date(post.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'long'})).toUpperCase()}</span>${credit?`<a href="${credit[1]}" target="_blank" rel="noopener noreferrer">PHOTO: ${escapeHTML(credit[0].toUpperCase())} ↗</a>`:`<time datetime="${escapeHTML(post.created_at)}" title="${escapeHTML(new Date(post.created_at).toLocaleString())}">${escapeHTML(new Date(post.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}))}</time>`}</div><div class="comments-container">${commentsMarkup(post)}</div></div></article>`;}
function photoMarkup(post,full=false){
  const svg=effectSvg(post.effect).replace('xMidYMid slice',full?'xMidYMid meet':'xMidYMid slice'),level=effectLevels.get(post.id)||0,job=effectJobs.get(post.id);
  const image=`<img class="post-photo" src="${escapeHTML(post.image)}" alt="${escapeHTML(post.caption||'Photo shared by '+post.author)}" ${full?'':'loading="lazy"'}>`;
  return `<div class="photo-stage ${svg?'has-effect':''} ${full?'full-stage':''}" data-effect-id="${post.id}">${full?image:`<button class="photo-button" data-action="photo" aria-label="View photo by ${escapeHTML(post.author)}">${image}</button>`}${svg?`<div class="photo-effect" style="clip-path:inset(0 ${100-level}% 0 0)">${svg}</div><span class="effect-status">${level?'Cig version':'Original'}</span>`:''}</div><div class="effect-controls" data-effect-id="${post.id}"><button type="button" class="effect-toggle text-button" data-action="effect" role="switch" aria-checked="${level>0}" ${job?.busy?'disabled':''}>ge ciggen en chans</button>${!svg?`<span class="effect-feedback" role="status">${escapeHTML(job?.message||'')}</span>`:''}</div>`;
}
function refreshPhoto(post){
  document.querySelectorAll(`.photo-stage[data-effect-id="${post.id}"]`).forEach(stage=>{
    const controls=stage.nextElementSibling;
    controls?.remove();stage.outerHTML=photoMarkup(post,stage.classList.contains('full-stage'));
  });
}
async function togglePhotoEffect(id){
  const post=posts.find(p=>p.id===id);if(!post||effectJobs.get(id)?.busy)return;
  if(effectSvg(post.effect)){setEffectLevel(id,(effectLevels.get(id)||0)>0?0:100);return;}
  effectJobs.set(id,{busy:true,message:'Making cig version…'});refreshPhoto(post);
  try{
    const img=new Image();img.src=post.image;await img.decode();
    const scale=Math.min(1,2400/Math.max(img.naturalWidth,img.naturalHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.round(img.naturalWidth*scale);canvas.height=Math.round(img.naturalHeight*scale);canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
    const {detectCigarettes}=await import('./effect-processor.mjs');
    const effect=await Promise.race([detectCigarettes(canvas),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Processing timed out. Tap to retry.')),30000))]);
    if(!effect)throw new Error('No faces found. Try a clearer, front-facing photo.');
    const saved=await api(`/api/posts/${id}/effect`,{method:'PUT',body:JSON.stringify({effect})});
    post.effect=saved.effect;const current=posts.find(p=>p.id===id);if(current)current.effect=saved.effect;
    effectLevels.set(id,100);effectJobs.delete(id);
  }catch(error){effectJobs.set(id,{busy:false,message:error.message||'Couldn’t make the cig version. Tap to retry.'});}
  refreshPhoto(post);
}

function setEffectLevel(id,value){
  const level=Math.max(0,Math.min(100,value));effectLevels.set(id,level);
  document.querySelectorAll(`[data-effect-id="${id}"]`).forEach(el=>{
    const overlay=el.querySelector('.photo-effect');if(overlay)overlay.style.clipPath=`inset(0 ${100-level}% 0 0)`;
    const status=el.querySelector('.effect-status');if(status)status.textContent=level?'Cig version':'Original';
    el.querySelector('.effect-toggle')?.setAttribute('aria-checked',String(level>0));
  });
}
document.addEventListener('click',event=>{const button=event.target.closest('.effect-toggle');if(button)void togglePhotoEffect(button.closest('[data-effect-id]').dataset.effectId);});
function renderFeed(){ $('moment-count').textContent=`${posts.length} moment${posts.length===1?'':'s'}`; $('sample-note').hidden=!posts.some(p=>p.demo); if(posts.length)$('feed').innerHTML=posts.map(card).join(''); else {$('feed').innerHTML=`<div class="empty-state">${icon('camera')}<h3>Your everyday belongs here.</h3><p>Share a photo from the office, a coffee break,<br>or wherever the day takes you.</p><button class="primary" id="empty-share">Share the first moment</button></div>`;$('empty-share').onclick=openCompose;} }
async function loadPosts({quiet=false}={}){if(refreshing||(quiet&&document.activeElement?.closest('.comment-form')))return;refreshing=true;try{posts=await api('/api/posts');$('status').textContent='';renderFeed();if(map)renderMarkers();}catch(e){if(!quiet){$('status').textContent='We couldn’t load the feed. '+e.message+' ';const retry=document.createElement('button');retry.className='text-button';retry.textContent='Try again';retry.onclick=()=>loadPosts();$('status').append(retry);}}finally{refreshing=false;}}
async function postAction(e){const button=e.target.closest('[data-action]');if(!button)return;const article=button.closest('[data-post]');const post=posts.find(p=>p.id===article?.dataset.post);if(!post)return;
  if(['edit-post','delete-post','edit-comment','delete-comment'].includes(button.dataset.action)){openManage(post,button.dataset.action,button.dataset.commentId);return;}
  if(button.dataset.action==='photo'){$('full-photo-view').innerHTML=photoMarkup(post,true);$('full-caption').textContent=post.caption;$('photo-dialog').showModal();}
  if(button.dataset.action==='comments'){
    const state=commentState(post.id);state.open=!state.open;updateComments(post);
    if(state.open)await loadComments(post);
  }
  if(button.dataset.action==='older-comments')await loadComments(post,true);
  if(button.dataset.action==='retry-comments')await loadComments(post);
  if(button.dataset.action==='likers'){
    $('likes-content').textContent='Loading…';$('likes-dialog').showModal();
    try{const people=await api(`/api/posts/${post.id}/like`);$('likes-content').innerHTML=people.length?people.map(person=>`<li><span class="avatar">${escapeHTML(initials(person.author))}</span><span>${escapeHTML(person.author)}</span></li>`).join(''):'<li>No likes yet. Be the first.</li>';}
    catch(error){$('likes-content').textContent=error.message;}
  }
  if(button.dataset.action==='like'){
    if(!displayName&&!post.liked){$('profile-button').click();toast('Add your name so the team knows it’s you.');return;}
    button.disabled=true;
    try{
      const result=await api(`/api/posts/${post.id}/like`,{method:'PUT',body:JSON.stringify({liked:!post.liked,author:displayName||'A teammate'})});Object.assign(post,result);
      document.querySelectorAll(`[data-post="${post.id}"]`).forEach(article=>{
        const b=article.querySelector('.like-button');b.classList.toggle('liked',post.liked);b.setAttribute('aria-pressed',String(post.liked));b.setAttribute('aria-label',`${post.liked?'Unlike':'Like'} moment by ${post.author}`);b.innerHTML=icon('heart')+`<span>${post.liked?'Liked':'Like'}</span>`;
        const count=article.querySelector('.like-count');count.hidden=!post.likes;count.textContent=`${post.likes} ${post.likes===1?'like':'likes'}`;
      });
    }catch(error){toast(error.message);}finally{button.disabled=false;}
  }
  if(button.dataset.action==='map'){$('map-period').value='all';setMapMode('photos');location.hash='map';showView();map?.setView([post.lat,post.lng],15);showMapDetail(post);}
}
$('feed').addEventListener('click',postAction);$('map-detail').addEventListener('click',postAction);
let manageTarget=null,manageBusy=false;
function openManage(post,action,commentId){
  const isComment=action.endsWith('comment'),deleting=action.startsWith('delete');
  const comment=isComment?commentState(post.id).comments.find(c=>String(c.id)===String(commentId)):null;
  if(isComment?!comment?.can_edit:!post.can_edit)return;
  manageTarget={post,comment,deleting};
  $('manage-title').textContent=`${deleting?'Delete':'Edit'} ${isComment?'comment':'post'}`;
  $('manage-description').textContent=deleting?(isComment?'Delete this comment? This cannot be undone.':'Delete this post and its photo, comments, and likes? This cannot be undone.'):'';
  $('manage-label').textContent=isComment?'Comment':'Caption';$('manage-label').hidden=deleting;
  $('manage-text').hidden=deleting;$('manage-text').value=isComment?comment.body:post.caption;$('manage-text').required=isComment&&!deleting;
  $('manage-error').textContent='';$('manage-save').textContent=deleting?'Delete':'Save changes';$('manage-save').classList.toggle('danger',deleting);
  $('manage-dialog').showModal();
}
$('manage-dialog').addEventListener('cancel',event=>{if(manageBusy)event.preventDefault();});
$('manage-form').onsubmit=async event=>{
  event.preventDefault();if(!manageTarget||manageBusy)return;
  const {post,comment,deleting}=manageTarget;
  if(!deleting&&comment&&!$('manage-text').value.trim()){$('manage-error').textContent='Write a comment first.';return;}
  manageBusy=true;const buttons=$('manage-form').querySelectorAll('button');buttons.forEach(button=>button.disabled=true);$('manage-error').textContent='';
  try{
    const endpoint=`/api/posts/${post.id}${comment?'/comments/'+comment.id:''}`;
    await api(endpoint,{method:deleting?'DELETE':'PATCH',...(!deleting?{body:JSON.stringify(comment?{body:$('manage-text').value}:{caption:$('manage-text').value})}:{})});
    if(comment){if(deleting)post.comment_count=Math.max(0,(post.comment_count||0)-1);await loadComments(post);}
    else{if(deleting){commentStates.delete(post.id);$('map-detail').innerHTML='';$('photo-dialog').close();}await loadPosts();if(!deleting&&$('map-detail').querySelector(`[data-post="${post.id}"]`))showMapDetail(posts.find(p=>p.id===post.id));}
    $('manage-dialog').close();toast(deleting?'Deleted.':'Changes saved.');
  }catch(error){$('manage-error').textContent=error.message;}
  finally{manageBusy=false;buttons.forEach(button=>button.disabled=false);}
};
function commentState(id){
  if(!commentStates.has(id))commentStates.set(id,{open:false,comments:[],draft:'',loading:false,sending:false,error:'',hasMore:false,nextCursor:null});
  return commentStates.get(id);
}
function commentLabel(post){return post.comment_count?`${post.comment_count} ${post.comment_count===1?'comment':'comments'}`:'Comment';}
function commentsMarkup(post){
  const state=commentState(post.id);if(!state.open)return '';
  return `<section class="comments" aria-label="Comments on moment by ${escapeHTML(post.author)}">
    ${state.hasMore?`<button type="button" class="text-button older-comments" data-action="older-comments" ${state.loading?'disabled':''}>Show earlier comments</button>`:''}
    <ul class="comment-list">${state.comments.map(comment=>`<li><span class="avatar">${escapeHTML(initials(comment.author))}</span><div><div class="comment-meta"><strong>${escapeHTML(comment.author)}</strong><time datetime="${escapeHTML(comment.created_at)}">${escapeHTML(relativeDate(comment.created_at))}</time></div><p>${escapeHTML(comment.body)}</p>${comment.can_edit?`<div class="comment-owner-actions"><button type="button" class="text-button" data-action="edit-comment" data-comment-id="${comment.id}" aria-label="Edit comment">Edit</button><button type="button" class="text-button" data-action="delete-comment" data-comment-id="${comment.id}" aria-label="Delete comment">Delete</button></div>`:''}</div></li>`).join('')}</ul>
    ${state.loading?'<p class="file-help" role="status">Loading comments…</p>':!state.comments.length&&!state.error?'<p class="file-help">Start the conversation.</p>':''}
    ${state.error?`<p class="error" role="alert">${escapeHTML(state.error)}</p>${!state.sending?'<button type="button" class="text-button" data-action="retry-comments">Refresh comments</button>':''}`:''}
    <form class="comment-form"><label>Leave a comment<textarea name="comment" rows="2" maxlength="1000" placeholder="Say something nice…" required ${state.sending?'disabled':''}>${escapeHTML(state.draft)}</textarea></label><div class="comment-form-footer"><span class="file-help">${displayName?'As '+escapeHTML(displayName):'Add your name before commenting'}</span><button type="submit" class="primary" ${state.sending?'disabled':''}>${state.sending?'Posting…':'Post comment'}</button></div></form>
  </section>`;
}
function updateComments(post){document.querySelectorAll(`[data-post="${post.id}"]`).forEach(article=>{article.querySelector('.comments-container').innerHTML=commentsMarkup(post);const button=article.querySelector('.comment-toggle');button.setAttribute('aria-expanded',String(commentState(post.id).open));button.querySelector('span').textContent=commentLabel(post);});}
async function loadComments(post,older=false){
  const state=commentState(post.id);if(state.loading)return;state.loading=true;state.error='';updateComments(post);
  try{const page=await api(`/api/posts/${post.id}/comments${older&&state.nextCursor?'?before='+state.nextCursor:''}`);state.comments=older?[...page.comments,...state.comments]:page.comments;state.hasMore=page.hasMore;state.nextCursor=page.nextCursor;}
  catch(error){state.error=error.message;}finally{state.loading=false;updateComments(post);}
}
for(const parent of [$('feed'),$('map-detail')]){
  parent.addEventListener('input',event=>{if(event.target.matches('.comment-form textarea'))commentState(event.target.closest('[data-post]').dataset.post).draft=event.target.value;});
  parent.addEventListener('submit',async event=>{
    const form=event.target.closest('.comment-form');if(!form)return;event.preventDefault();
    const post=posts.find(post=>post.id===form.closest('[data-post]').dataset.post);if(!post)return;
    const state=commentState(post.id);if(state.sending||!state.draft.trim())return;
    if(!displayName){$('profile-button').click();toast('Add your name before posting your comment.');return;}
    state.sending=true;state.error='';updateComments(post);
    try{await api(`/api/posts/${post.id}/comments`,{method:'POST',body:JSON.stringify({author:displayName,body:state.draft})});state.draft='';post.comment_count=(post.comment_count||0)+1;await loadComments(post);toast('Comment shared.');}
    catch(error){state.error=error.message;}finally{state.sending=false;updateComments(post);}
  });
}
function makeMap(id,center,zoom){const instance=L.map(id,{zoomControl:false}).setView(center,zoom);L.control.zoom({position:'bottomright'}).addTo(instance);L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',maxZoom:19,className:'map-tiles'}).on('tileerror',()=>{if(id==='map')$('map-note').textContent='Map tiles are unavailable. Check your connection; photo pins still work.';}).addTo(instance);return instance;}
// Center new maps without interrupting a place the user has already chosen.
function centerOnUserLocation(instance,{onSettled=()=>{},notify=false}={}){
  if(!navigator.geolocation){if(notify)toast('Location is unavailable in this browser.');onSettled();return;}
  let untouched=true;
  const cancel=()=>{untouched=false;};
  const cleanup=()=>{instance.off('movestart zoomstart click',cancel);onSettled();};
  instance.on('movestart zoomstart click',cancel);
  navigator.geolocation.getCurrentPosition(position=>{
    cleanup();
    if(untouched)instance.setView([position.coords.latitude,position.coords.longitude],15);
  },()=>{cleanup();if(notify)toast('Location wasn’t available. You can still explore the map.');},{timeout:10000,maximumAge:60000});
}
function initMap(){if(map)return;if(!window.L){$('map-note').textContent='The map couldn’t load. Refresh the page to try again.';return;}const nearby=posts.find(post=>post.lat!==null&&post.lng!==null)||places.office;map=makeMap('map',[nearby.lat,nearby.lng],15);renderMarkers();centerOnUserLocation(map);}
function renderMarkers(){markers.forEach(m=>m.remove());markers=[];const located=mapPosts(posts,$('map-period').value);
  if(mapMode==='heat'){
    heatLayer ||= createHeatLayer(L);
    heatLayer.setPosts(located.filter(post=>!post.demo));
    if(!map.hasLayer(heatLayer))heatLayer.addTo(map);
  }else if(heatLayer&&map.hasLayer(heatLayer))map.removeLayer(heatLayer);
  for(const post of mapMode==='photos'?located:[]){const pin=L.divIcon({className:'photo-pin',html:`<img src="${escapeHTML(post.image)}" alt="${escapeHTML(post.author)}">`,iconSize:[49,54],iconAnchor:[24,54]});const marker=L.marker([post.lat,post.lng],{icon:pin,title:`${post.author} — ${post.location}`,alt:`Open moment by ${post.author}`,keyboard:true}).addTo(map);marker.bindPopup(`<img class="popup-photo" src="${escapeHTML(post.image)}" alt=""><div class="popup-author">${escapeHTML(post.author)}</div><div class="popup-place">${escapeHTML(post.location)}</div>`);marker.on('click',()=>showMapDetail(post));markers.push(marker);}const shown=mapMode==='heat'?located.filter(post=>!post.demo):located;
  const withoutLocation=posts.filter(post=>!Number.isFinite(post.lat)||!Number.isFinite(post.lng)).length;
  $('map-note').textContent=shown.length
    ? `${shown.length} located photo${shown.length===1?'':'s'} · ${mapMode==='heat'?'Warmer areas mean more photos together. Zoom in to separate places. Examples excluded.':'Select a photo pin to see the moment.'}`
    : `No photos with a location in this period. Try a longer time range or share a located photo.${mapMode==='heat'?' Examples are excluded.':''}`;
  if(withoutLocation)$('map-note').textContent+=` ${withoutLocation} unlocated photo${withoutLocation===1?' is':'s are'} not shown.`;
  $('fit-map').disabled=!shown.length;
}
function fitMap(){if(!map)return;const located=mapPosts(posts,$('map-period').value).filter(post=>mapMode!=='heat'||!post.demo);if(located.length)map.fitBounds(L.latLngBounds(located.map(post=>[post.lat,post.lng])).pad(.25),{maxZoom:15});}
function setMapMode(mode){
  mapMode=mode;
  $('map-photos').setAttribute('aria-pressed',String(mode==='photos'));
  $('map-heat').setAttribute('aria-pressed',String(mode==='heat'));
  $('heat-legend').hidden=mode!=='heat';
  $('map-detail').innerHTML='';
  if(map)renderMarkers();
}
$('map-photos').onclick=()=>setMapMode('photos');
$('map-heat').onclick=()=>setMapMode('heat');
$('map-period').onchange=()=>{$('map-detail').innerHTML='';if(map)renderMarkers();};
function showMapDetail(post){$('map-detail').innerHTML=card(post);}
$('fit-map').onclick=fitMap;
$('locate-map').onclick=()=>{if(!map)return;const button=$('locate-map');button.disabled=true;button.innerHTML=icon('locate')+' Locating…';centerOnUserLocation(map,{notify:true,onSettled:()=>{button.disabled=false;button.innerHTML=icon('locate')+' Near me';}});};
function showView(){const isMap=location.hash==='#map';document.querySelector('.app-layout').classList.toggle('map-layout',isMap);$('feed-view').hidden=isMap;$('map-view').hidden=!isMap;$('view-title').innerHTML=(isMap?'The map':'The feed')+'<span class="orange-dot">.</span>';$('view-eyebrow').textContent=isMap?'HERE, THERE & EVERYWHERE':'LIFE, LATELY';for(const [id,active]of[['feed-tab',!isMap],['map-tab',isMap],['mobile-feed',!isMap],['mobile-map',isMap]]){$(id).classList.toggle('active',active);if(active)$(id).setAttribute('aria-current','page');else $(id).removeAttribute('aria-current');}if(isMap){initMap();requestAnimationFrame(()=>map?.invalidateSize({pan:false}));}}
window.addEventListener('hashchange',showView);
async function choosePhoto(file){if(!file)return;const task=++photoTask;photoData=null;photoEffect=null;$('effect-progress').textContent='';$('publish-button').disabled=true;$('compose-error').textContent='';$('photo-preview').hidden=true;$('upload-prompt').hidden=false;try{if(file.size>15*1024*1024)throw new Error('That photo is a bit big. Please choose one under 15 MB.');if(!file.type.startsWith('image/'))throw new Error('Please choose a photo.');const url=URL.createObjectURL(file);const img=new Image();try{img.src=url;await img.decode();const scale=Math.min(1,2400/Math.max(img.width,img.height));const canvas=document.createElement('canvas');canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(img,0,0,canvas.width,canvas.height);if(task!==photoTask)return;photoData=canvas.toDataURL('image/jpeg',.88);$('photo-preview').src=photoData;$('photo-preview').hidden=false;$('upload-prompt').hidden=true;
$('effect-progress').textContent='Making the cig version…';
try{
  const {detectCigarettes}=await import('./effect-processor.mjs');
  const effect=await Promise.race([detectCigarettes(canvas),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Effect timed out')),30000))]);
  if(task!==photoTask)return;photoEffect=effect;
  $('effect-progress').textContent=effect?`Cig version ready · ${effect.faces.length} ${effect.faces.length===1?'face':'faces'}. The original stays too.`:'No faces found. Your original is ready to share.';
}catch{if(task===photoTask)$('effect-progress').textContent='Cig version couldn’t be made. Your original is ready to share.';}}finally{URL.revokeObjectURL(url);}}catch(e){if(task===photoTask)$('compose-error').textContent=e.message.includes('decode')?'This photo format isn’t supported here. Please choose a JPG, PNG or WebP version.':e.message;}finally{if(task===photoTask)$('publish-button').disabled=false;}}
$('photo-input').onchange=e=>choosePhoto(e.target.files[0]);$('camera-input').onchange=e=>choosePhoto(e.target.files[0]);
['dragenter','dragover'].forEach(name=>$('upload-area').addEventListener(name,e=>{e.preventDefault();$('upload-area').classList.add('dragging');}));
$('upload-area').addEventListener('dragleave',()=>$('upload-area').classList.remove('dragging'));
$('upload-area').addEventListener('drop',e=>{e.preventDefault();$('upload-area').classList.remove('dragging');choosePhoto(e.dataTransfer.files[0]);});
function showPicker(){ $('location-picker').hidden=false;if(!window.L){$('compose-error').textContent='The map is unavailable. Choose a city from the list instead.';return;}if(!pickerMap){pickerMap=makeMap('picker-map',[places.office.lat,places.office.lng],15);pickerMap.on('click',e=>setCustomPin(e.latlng.lat,e.latlng.lng));if(!selectedLocation)centerOnUserLocation(pickerMap);}requestAnimationFrame(()=>{pickerMap.invalidateSize({pan:false});if(selectedLocation){setCustomPin(selectedLocation.lat,selectedLocation.lng);pickerMap.setView([selectedLocation.lat,selectedLocation.lng],15);}});}
function setCustomPin(lat,lng){selectedLocation={location:$('location-name').value.trim()||'Pinned moment',lat,lng};if(pickerMarker)pickerMarker.setLatLng([lat,lng]);else pickerMarker=L.circleMarker([lat,lng],{radius:9,color:'#a3f8d2',fillColor:'#a3f8d2',fillOpacity:.9}).addTo(pickerMap);}
$('location').onchange=()=>{const value=$('location').value;selectedLocation=places[value]||null;$('location-picker').hidden=value!=='custom';if(value==='custom')showPicker();};
$('use-location').onclick=()=>{if(!navigator.geolocation){$('compose-error').textContent='Your browser doesn’t support location. Choose a spot manually.';return;}$('use-location').disabled=true;$('compose-error').textContent='';navigator.geolocation.getCurrentPosition(position=>{$('use-location').disabled=false;selectedLocation={location:'My location',lat:position.coords.latitude,lng:position.coords.longitude};$('location').value='custom';$('location-name').value='My location';showPicker();},()=>{$('use-location').disabled=false;$('compose-error').textContent='Location wasn’t available. You can choose a place or pin a spot instead.';},{timeout:10000,maximumAge:60000});};
$('compose-form').onsubmit=async e=>{e.preventDefault();$('compose-error').textContent='';if(!photoData){$('compose-error').textContent='Choose a photo first.';return;}if(!$('author').value.trim()){$('compose-error').textContent='Please enter your name.';return;}if($('location').value==='custom'&&!selectedLocation){$('compose-error').textContent='Tap a spot on the map, or choose “No location”.';return;}const button=$('publish-button');button.disabled=true;button.textContent='Sharing…';try{const place=selectedLocation?{...selectedLocation,location:$('location').value==='custom'?($('location-name').value.trim()||'Pinned moment'):selectedLocation.location}:{location:null,lat:null,lng:null};const upload=new FormData();upload.set('photo',await(await fetch(photoData)).blob(),'moment.jpg');upload.set('author',$('author').value.trim());upload.set('caption',$('caption').value);if(photoEffect)upload.set('effect',JSON.stringify(photoEffect));if(place.lat!==null){upload.set('lat',String(place.lat));upload.set('lng',String(place.lng));upload.set('location',place.location);}await api('/api/posts',{method:'POST',body:upload});saveName($('author').value);$('compose-dialog').close();$('compose-form').reset();photoData=null;photoEffect=null;photoTask++;$('effect-progress').textContent='';selectedLocation=null;if(pickerMarker){pickerMarker.remove();pickerMarker=null;}$('photo-preview').hidden=true;$('upload-prompt').hidden=false;$('location-picker').hidden=true;location.hash='feed';showView();await loadPosts();window.scrollTo({top:0,behavior:'smooth'});toast('A little moment, shared. ✨');}catch(e){$('compose-error').textContent=e.message;}finally{button.disabled=false;button.innerHTML='Post moment '+icon('arrow');}};
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}}));
try{const session=await api('/api/session');if(session.hosted){document.querySelector('#profile-form .file-help').textContent='Your display name on the feed.';document.querySelector('.local-badge').textContent='GARRISON ONLY';const info=document.createElement('p');info.className='file-help';info.textContent='Signed in as '+session.email;$('profile-form').append(info);const logout=document.createElement('a');logout.href='/cdn-cgi/access/logout';logout.className='text-button';logout.textContent='Sign out';$('profile-form').append(logout);}}catch{}
await loadPosts();showView();
window.addEventListener('focus',()=>{if(!document.querySelector('dialog[open]'))loadPosts({quiet:true});});
setInterval(()=>{if(!document.hidden&&!document.querySelector('dialog[open]'))loadPosts({quiet:true});},30000);
// Progressive WebMCP support. Opening the map may request location permission; these tools never post data.
if(navigator.modelContext?.registerTool){
  navigator.modelContext.registerTool({name:'show_moments',description:'Show the Garrigram feed or map.',inputSchema:{type:'object',properties:{view:{type:'string',enum:['feed','map']}},required:['view']},execute:async({view})=>{location.hash=view==='map'?'map':'feed';showView();return{content:[{type:'text',text:`Showing ${view}.`}]};}});
  navigator.modelContext.registerTool({name:'list_moments',description:'Read the moments currently visible to this local Garrigram app.',inputSchema:{type:'object',properties:{}},execute:async()=>({content:[{type:'text',text:JSON.stringify(posts.map(({id,author,caption,location,demo})=>({id,author,caption,location,demo})))}]})});
}
