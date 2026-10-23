import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { MOTIONS, RIG, poseAt, jointsFor } from './rig-motion.mjs';

const out=path.dirname(new URL(import.meta.url).pathname);

await fs.mkdir(out+'/strips',{recursive:true});
await fs.mkdir(out+'/previews',{recursive:true});

// This source is the editable character: rigid shapes and fixed-length bones.
export function drawCat(ctx,pose,legs){
 const palette={ink:'#080b10',edge:'#05070a',far:'#252a32',eye:'#e5dbaf'};
 const body=pose.body;
 const transform=(x,y)=>({x:body.x+(x-61.5)*Math.cos(body.angle)-(y-76)*Math.sin(body.angle),y:body.y+(x-61.5)*Math.sin(body.angle)+(y-76)*Math.cos(body.angle)});
 const line=(a,b,width,color)=>{ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.stroke();};
 const bone=(a,b,r1,r2,color)=>{const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy),nx=-dy/len,ny=dx/len;ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(a.x+nx*r1,a.y+ny*r1);ctx.lineTo(b.x+nx*r2,b.y+ny*r2);ctx.lineTo(b.x-nx*r2,b.y-ny*r2);ctx.lineTo(a.x-nx*r1,a.y-ny*r1);ctx.closePath();ctx.fill();for(const [p,r]of [[a,r1],[b,r2]]){ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();}};
 const leg=(l,index)=>{const far=index===1||index===3,color=far?palette.far:palette.ink;const hind=index>=2;bone(l.root,l.knee,hind?5.1:3.4,hind?3.1:2.55,color);bone(l.knee,l.ankle,hind?2.9:2.4,1.9,color);ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(l.ankle.x-1.9,l.ankle.y+1.25,far?2.5:3.2,1.75,-.03,0,2*Math.PI);ctx.fill();};
 // Nine tail joints keep the same contour length through every action.
 let p=transform(84,74);const tail=[];const phase=pose.tailPhase??0;
 for(let i=0;i<10;i++){const angles=[0,-.22,-.5,-.8,-1.12,-1.45,-1.78,-2.13,-2.52,-2.91];const angle=angles[i]+body.angle+.055*Math.sin(phase+i*.33)*(i/9);const q={x:p.x+5.8*Math.cos(angle),y:p.y+5.8*Math.sin(angle)};tail.push([p,q,6.3-i*.33]);p=q;}
 for(const [a,b,w]of tail)line(a,b,w,palette.ink);
 leg(legs[3],3);leg(legs[1],1);
 ctx.save();ctx.translate(body.x,body.y);ctx.rotate(body.angle);
 ctx.fillStyle=palette.ink;ctx.beginPath();ctx.moveTo(-23,-4);ctx.bezierCurveTo(-24,-12,-17,-14,-10,-12);ctx.bezierCurveTo(0,-10-(body.arch??0),13,-11-(body.arch??0),20,-9);ctx.bezierCurveTo(26,-5,26,7,21,11);ctx.bezierCurveTo(16,15,7,12,0,11);ctx.bezierCurveTo(-9,12,-20,13,-23,3);ctx.closePath();ctx.fill();
 // Breathing only changes this small thorax contour; the whole body is never scaled.
 ctx.beginPath();ctx.ellipse(-17.7,0,6.3+(pose.breath??0),11.1,0,0,2*Math.PI);ctx.fill();ctx.restore();
 leg(legs[2],2);leg(legs[0],0);
 const shoulder=transform(43,76);const tilt=(pose.head?.tilt??0)+body.angle;
 const hx=shoulder.x-12*Math.cos(tilt)+16*Math.sin(tilt),hy=shoulder.y-12*Math.sin(tilt)-16*Math.cos(tilt);
 ctx.fillStyle=palette.ink;ctx.beginPath();ctx.moveTo(shoulder.x-6,shoulder.y+3);ctx.bezierCurveTo(shoulder.x-10,shoulder.y-4,hx-4,hy+7,hx-3,hy);ctx.lineTo(hx+8,hy-2);ctx.bezierCurveTo(hx+13,hy+9,shoulder.x+8,shoulder.y-2,shoulder.x+5,shoulder.y+6);ctx.closePath();ctx.fill();
 ctx.save();ctx.translate(hx,hy);ctx.rotate((pose.head?.angle??0)+body.angle);
 ctx.beginPath();ctx.moveTo(10,7);ctx.bezierCurveTo(12,1,8,-7,3,-10);ctx.lineTo(1,-20+(pose.ear??0));ctx.quadraticCurveTo(-1,-19,-4,-11);ctx.lineTo(-9,-18-(pose.ear??0));ctx.quadraticCurveTo(-11,-15,-10,-7);ctx.bezierCurveTo(-15,-5,-15,-1,-18,1);ctx.quadraticCurveTo(-20,3,-16,6);ctx.bezierCurveTo(-15,10,-10,10,-5,10);ctx.bezierCurveTo(1,14,7,12,10,7);ctx.closePath();ctx.fill();
 const blink=Math.max(0,Math.min(1,pose.head?.blink??0));ctx.strokeStyle=palette.eye;ctx.fillStyle=palette.eye;
 if(blink>.72){ctx.lineWidth=1.05;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(-11,-1.6);ctx.quadraticCurveTo(-9.4,-.1,-7.6,-1.6);ctx.stroke();}
 else{ctx.beginPath();ctx.ellipse(-9.5,-2.2,1.45,1.5*(1-blink)+.12,0,0,2*Math.PI);ctx.fill();ctx.fillStyle=palette.ink;ctx.beginPath();ctx.ellipse(-9.85,-2.1,.42,.95*(1-blink),0,0,2*Math.PI);ctx.fill();}
 ctx.restore();
}

const browser=await chromium.launch({headless:true});
const page=await browser.newPage();await page.evaluate('window.drawCat='+drawCat.toString());
const metadata=[];const qa=[];
for(const motion of MOTIONS){
 const poses=Array.from({length:motion.frames},(_,i)=>{const t=i/motion.frames;const p=poseAt(motion.name,t);return{pose:p,legs:jointsFor(p)}});
 const rendered=await page.evaluate(({poses})=>{
  const c=document.createElement('canvas');c.width=poses.length*128;c.height=128;const ctx=c.getContext('2d');
  for(let f=0;f<poses.length;f++){ctx.save();ctx.translate(f*128+128,0);ctx.scale(-1,1);window.drawCat(ctx,poses[f].pose,poses[f].legs);ctx.restore();}
  const frames=[];
  for(let f=0;f<poses.length;f++){const pixels=ctx.getImageData(f*128,0,128,128).data;let bounds=[128,128,-1,-1],count=0;for(let y=0;y<128;y++)for(let x=0;x<128;x++){if(pixels[(y*128+x)*4+3]>16){bounds=[Math.min(bounds[0],x),Math.min(bounds[1],y),Math.max(bounds[2],x),Math.max(bounds[3],y)];count++;}}frames.push({bounds,pixels:count});}
  return{png:c.toDataURL().split(',')[1],frames};
 },{poses});
 await fs.writeFile(out+'/strips/'+motion.name+'.png',Buffer.from(rendered.png,'base64'));
 metadata.push({...motion,frameWidth:128,frameHeight:128,strip:'strips/'+motion.name+'.png'});
 for(const [i,frame]of rendered.frames.entries()){const [x0,y0,x1,y1]=frame.bounds;if(x0<4||y0<4||x1>123||y1>123||!frame.pixels)throw Error(motion.name+' frame '+i+' clips canvas: '+frame.bounds);}
 qa.push({name:motion.name,...rendered,poses});delete qa.at(-1).png;
 console.log(motion.name,motion.frames+' frames',motion.durationMs+'ms');
}
const skin={id:'mew-silhouette-cat-v2',name:'까만 고양이 · 관절 모션',order:10,motion:{durations:Object.fromEntries(metadata.map(m=>[m.name,m.durationMs])),enabled:Object.fromEntries(metadata.map(m=>[m.name,true])),movementSpeed:.5,stride:{walk:40.96,run:49.06666666666667}},sprites:Object.fromEntries(metadata.map(m=>[m.name,{file:m.strip,frames:m.frames}]))};
await fs.writeFile(out+'/skin.json',JSON.stringify(skin,null,2)+'\n');
await fs.writeFile(out+'/manifest.json',JSON.stringify({description:'공통 관절 리그로 제작한 검은 고양이 16개 모션. 128px 투명 셀·고정 체격·관절 길이와 재생·접지 정보.',version:2,sourceDirection:'right',frameSize:128,groundLine:110,rig:RIG,motions:metadata},null,2)+'\n');
await fs.writeFile(out+'/pose-qa.json',JSON.stringify(qa,null,2)+'\n');
for(let part=0;part<2;part++){
 const inputs=[];for(const m of metadata.slice(part*8,part*8+8))inputs.push({...m,uri:'data:image/png;base64,'+(await fs.readFile(out+'/'+m.strip)).toString('base64')});
 const png=await page.evaluate(async inputs=>{const c=document.createElement('canvas');c.width=1024;c.height=8*154;const ctx=c.getContext('2d');ctx.fillStyle='#e7e8e7';ctx.fillRect(0,0,c.width,c.height);for(let r=0;r<inputs.length;r++){const m=inputs[r],im=new Image();im.src=m.uri;await im.decode();ctx.fillStyle='#222';ctx.font='13px sans-serif';ctx.fillText(m.name+' · '+m.frames+'f · '+m.durationMs+'ms',8,r*154+18);for(let f=0;f<8;f++){const n=Math.round(f*(m.frames-1)/7);ctx.drawImage(im,n*128,0,128,128,f*128,r*154+24,128,128);ctx.strokeStyle='#c6c8c7';ctx.strokeRect(f*128,r*154+24,128,128);}ctx.strokeStyle='#bd8585';ctx.beginPath();ctx.moveTo(0,r*154+134);ctx.lineTo(1024,r*154+134);ctx.stroke();}return c.toDataURL().split(',')[1]},inputs);
 await fs.writeFile(out+'/previews/contact-'+(part+1)+'.png',Buffer.from(png,'base64'));
}
await browser.close();
console.log('Rendered in project asset directory:',out);
