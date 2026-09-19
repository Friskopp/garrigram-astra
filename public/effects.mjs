// Only small, validated overlay positions are saved; original photo pixels stay intact.
export function validateEffect(value){
  if(value===null||value===undefined||value==='')return null;
  if(typeof value==='string'){try{value=JSON.parse(value);}catch{throw new Error('Invalid photo effect.');}}
  const fail=()=>{throw new Error('Invalid photo effect.');};
  if(!value||!Number.isInteger(value.width)||!Number.isInteger(value.height)||value.width<1||value.height<1||value.width>2400||value.height>2400||!Array.isArray(value.faces)||value.faces.length>50)fail();
  const faces=value.faces.map(face=>{
    if(!face||!['x','y','angle','length'].every(key=>Number.isFinite(face[key])))fail();
    if(face.x<0||face.x>value.width||face.y<0||face.y>value.height||Math.abs(face.angle)>180||face.length<1||face.length>value.width/2)fail();
    return {x:face.x,y:face.y,angle:face.angle,length:face.length};
  });
  return faces.length?{width:value.width,height:value.height,faces}:null;
}
export function effectSvg(effect){
  try{effect=validateEffect(effect);}catch{return '';}
  if(!effect)return '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${effect.width} ${effect.height}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${effect.faces.map(({x,y,angle,length})=>{
    const h=length*.105;
    return `<g transform="translate(${x} ${y}) rotate(${angle})"><rect x="0" y="${-h/2}" width="${length}" height="${h}" rx="${h*.2}" fill="#f5efe1" stroke="#40362b" stroke-width="${h*.12}"/><rect x="0" y="${-h/2}" width="${length*.27}" height="${h}" rx="${h*.15}" fill="#c28a48"/><path d="M${length*.3} ${-h*.27}H${length*.91}" stroke="#fff" stroke-width="${h*.15}"/><rect x="${length*.94}" y="${-h/2}" width="${length*.06}" height="${h}" fill="#d2602a"/><path d="M${length} ${-h}q${h*2} ${-h*3} 0 ${-h*5}t${h} ${-h*5}" fill="none" stroke="#e0e4df" opacity=".45" stroke-width="${h*.24}" stroke-linecap="round"/></g>`;
  }).join('')}</svg>`;
}
