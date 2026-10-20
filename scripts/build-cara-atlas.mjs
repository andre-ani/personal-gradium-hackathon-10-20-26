// Packs generated expression art onto one immutable head. No runtime image processing.
// Use an installed @napi-rs/canvas through CARA_CANVAS_MODULE when it is not local.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require(process.env.CARA_CANVAS_MODULE || '@napi-rs/canvas');
const image = await loadImage('static/cara/cara-expression-art-v2.png');
const source = createCanvas(image.width, image.height), sc = source.getContext('2d');
sc.drawImage(image, 0, 0);
const pixels = sc.getImageData(0,0,image.width,image.height).data;
const canvas = () => createCanvas(256,256);
// The generated art is visually gridded, but its row spacing is not uniform.
// Locate the empty gutters instead of assuming equal source cells.
function bands(length, count) {
  const values=[];
  for(let p=0;p<length;p++)values.push(count(p)>30);
  const runs=[];let start=null;
  for(let p=0;p<=length;p++){if(values[p]&&start===null)start=p;if(!values[p]&&start!==null){runs.push([start,p]);start=null;}}
  return runs;
}
const rows=bands(image.height,y=>{let n=0;for(let x=0;x<image.width;x++)if(pixels[(y*image.width+x)*4+3]>230)n++;return n;});
const columns=bands(image.width,x=>{let n=0;for(let y=0;y<image.height;y++)if(pixels[(y*image.width+x)*4+3]>230)n++;return n;});
if(rows.length!==6||columns.length!==4)throw Error('Cannot identify the 24 source cells safely');
const edges=(runs,size)=>[0,...runs.slice(1).map((r,i)=>Math.round((runs[i][1]+r[0])/2)),size];
const xs=edges(columns,image.width),ys=edges(rows,image.height);
const boxes = [];
for (let row=0;row<6;row++) for (let col=0;col<4;col++) {
  const x0=xs[col], x1=xs[col+1];
  const y0=ys[row], y1=ys[row+1];
  let left=x1,top=y1,right=x0,bottom=y0;
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
    const i=(y*image.width+x)*4;
    if(pixels[i+3]>230){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);}
  }
  if(right<=left)throw Error(`Missing frame ${row*4+col}`);
  boxes.push([left,top,right-left,bottom-top]);
}
const normalized=boxes.map(box=>{const c=canvas();c.getContext('2d').drawImage(image,...box,24,44,208,168);return c;});
const blank=normalized[20], blankData=blank.getContext('2d').getImageData(0,0,256,256).data;
const inside=(x,y)=>{const i=(y*256+x)*4;return x>=0&&x<256&&y>=0&&y<256&&blankData[i]>180&&blankData[i+1]>180&&blankData[i+3]>230;};
const safe=(x,y)=> x>=52&&x<=204&&y>=78&&y<=196 && [[0,0],[-14,0],[14,0],[0,-14],[0,14]].every(([dx,dy])=>inside(x+dx,y+dy));
function features(index, region='all') {
  const c=canvas(), ctx=c.getContext('2d');
  const data=normalized[index].getContext('2d').getImageData(0,0,256,256);
  for(let y=0;y<256;y++)for(let x=0;x<256;x++){
    const i=(y*256+x)*4, r=data.data[i],g=data.data[i+1],b=data.data[i+2];
    const area=true;
    const ink=Math.min(1,Math.max(0,(b-r)/75))*Math.min(1,Math.max(0,(b-g)/50));
    data.data[i+3]=safe(x,y)&&area?Math.round(data.data[i+3]*ink):0;
    data.data[i]=12;data.data[i+1]=70;data.data[i+2]=176;
  }
  if(region!=='all') {
    // A tilted smile can share a scanline with an eye. Separate connected ink
    // components instead of slicing across the face and clipping the smile.
    const labels=new Int32Array(256*256),groups=[];let id=0;
    for(let pixel=0;pixel<256*256;pixel++)if(data.data[pixel*4+3]>8&&!labels[pixel]){
      id++;const stack=[pixel];labels[pixel]=id;let count=0,sumY=0;
      while(stack.length){const p=stack.pop(),x=p%256,y=Math.floor(p/256);count++;sumY+=y;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy,n=ny*256+nx;if(nx>=0&&nx<256&&ny>=0&&ny<256&&!labels[n]&&data.data[n*4+3]>8){labels[n]=id;stack.push(n);}}
      }
      groups.push({id,count,y:sumY/count});
    }
    const mouth=groups.filter(g=>g.count>=16).sort((a,b)=>b.y-a.y)[0]?.id;
    for(let p=0;p<labels.length;p++)if(region==='mouth'?labels[p]!==mouth:labels[p]===mouth)data.data[p*4+3]=0;
  }
  ctx.putImageData(data,0,0);return c;
}
function pose(eyes,mouth=eyes) { const c=canvas(),ctx=c.getContext('2d');ctx.drawImage(blank,0,0);ctx.drawImage(features(eyes,'eyes'),0,0);ctx.drawImage(features(mouth,'mouth'),0,0);return c; }
const frames=[];
for(let n=0;n<12;n++)frames.push(pose(n));
frames[1]=pose(1,0);frames[3]=pose(3,2);frames[6]=pose(6,5);
for(let n=12;n<16;n++)frames.push(pose(0,n));
for(let n=16;n<19;n++){
  const ink=features(n), data=ink.getContext('2d').getImageData(0,0,256,256).data;
  let left=256,right=0,top=256,bottom=0;
  for(let y=0;y<256;y++)for(let x=0;x<256;x++)if(data[(y*256+x)*4+3]>20){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  const c=canvas();c.getContext('2d').drawImage(ink,128-(left+right)/2,128-(top+bottom)/2);frames.push(c);
}
frames.push(normalized[19],blank,pose(21),pose(22),frames[0]);
const sheet=createCanvas(1024,1536), ctx=sheet.getContext('2d');
frames.forEach((frame,i)=>ctx.drawImage(frame,(i%4)*256,Math.floor(i/4)*256));
writeFileSync('static/cara/cara-registered-v2.png',sheet.toBuffer('image/png'));
// These assertions protect the actual pixels, not just metadata.
const reference=frames[0].getContext('2d').getImageData(0,0,256,256).data;
const mouthMasks=[0,12,13,14,15].map(i=>features(i,'mouth').getContext('2d').getImageData(0,0,256,256).data);
for(let n=0;n<16;n++){
  const data=frames[n].getContext('2d').getImageData(0,0,256,256).data;
  for(let y=0;y<256;y++)for(let x=0;x<256;x++)if(!safe(x,y)){
    const i=(y*256+x)*4;for(let channel=0;channel<4;channel++)if(data[i+channel]!==reference[i+channel])throw Error(`Head moved in frame ${n}`);
  }
  if(n>=12)for(let y=0;y<256;y++)for(let x=0;x<256;x++){
    const i=(y*256+x)*4;if(mouthMasks.some(mask=>mask[i+3]>0))continue;for(let channel=0;channel<4;channel++)if(data[i+channel]!==reference[i+channel])throw Error(`Eyes moved during speech ${n}`);
  }
}
const meta={image:'/static/cara/cara-registered-v2.png',width:1024,height:1536,fps:10,cell:256,pivot:[128,128],viewport:[12,28,232,200],frames:frames.map((_,i)=>[(i%4)*256,Math.floor(i/4)*256,256,256]),states:{idle:0,blink:1,listening:2,listeningBlink:3,thinking:4,drawing:5,drawingBlink:6,pleased:7,delighted:8,curious:9,puzzled:10,recovering:11,mouthSmall:12,mouthMedium:13,mouthRound:14,mouthWide:15,reveal:[16,17,18,19,20,21,22,23]},mouthRegion:[52,158,152,38],sourceBoxes:boxes};
writeFileSync('frontend/cara-atlas.json',JSON.stringify(meta,null,2)+'\n');
writeFileSync('static/cara/cara-registered-v2.json',JSON.stringify(meta,null,2)+'\n');
console.log('24 frames packed in 256px cells; identical silhouettes verified in all 16 poses; only mouth pixels differ during speech.');
