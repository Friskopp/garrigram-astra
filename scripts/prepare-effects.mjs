import { mkdir, cp, writeFile, access } from 'node:fs/promises';
const target=new URL('../public/vendor/mediapipe/',import.meta.url);
await mkdir(target,{recursive:true});
await cp(new URL('../MEDIAPIPE-LICENSE',import.meta.url),new URL('LICENSE',target));
await cp(new URL('../node_modules/@mediapipe/tasks-vision/vision_bundle.mjs',import.meta.url),new URL('vision_bundle.mjs',target));
await cp(new URL('../node_modules/@mediapipe/tasks-vision/wasm/',import.meta.url),new URL('wasm/',target),{recursive:true});
const model=new URL('face_landmarker.task',target);
try{await access(model);}catch{
  const response=await fetch('https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task');
  if(!response.ok)throw new Error('Unable to download the face landmark model: '+response.status);
  await writeFile(model,new Uint8Array(await response.arrayBuffer()));
}
console.log('Local face-effect assets ready.');
