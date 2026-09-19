import { validateEffect } from './effects.mjs';
let detectorPromise;
export async function detectCigarettes(canvas){
  if(!detectorPromise)detectorPromise=(async()=>{
    const {FaceLandmarker,FilesetResolver}=await import('/vendor/mediapipe/vision_bundle.mjs');
    const files=await FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
    return FaceLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:'/vendor/mediapipe/face_landmarker.task',delegate:'CPU'},runningMode:'IMAGE',numFaces:50,minFaceDetectionConfidence:.4,minFacePresenceConfidence:.5});
  })().catch(error=>{detectorPromise=null;throw error;});
  const detector=await detectorPromise;
  const {faceLandmarks}=detector.detect(canvas);
  const width=canvas.width,height=canvas.height;
  const faces=faceLandmarks.map(points=>{
    const left=points[61],right=points[291],upper=points[13],lower=points[14];
    const mouthWidth=Math.hypot((right.x-left.x)*width,(right.y-left.y)*height);
    const angle=Math.atan2((right.y-left.y)*height,(right.x-left.x)*width)*180/Math.PI+12;
    return {x:Math.max(0,Math.min(width,((upper.x+lower.x)/2)*width)),y:Math.max(0,Math.min(height,((upper.y+lower.y)/2)*height)),angle:((angle+540)%360)-180,length:Math.min(width/2,Math.max(4,mouthWidth*1.45))};
  });
  return validateEffect({width,height,faces});
}
