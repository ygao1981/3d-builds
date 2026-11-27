import * as T from 'three';
import { amber, batch, dark, frame, metal, platform, side, steel } from './hardware.js';

const concrete=metal('#889894',.93,.03),trackSlab=metal('#7b8c88',.94,.03),bed=metal('#53676b',.79,.26),rim=metal('#385b59',.60,.46);
const pale=metal('#d6c9a0',.88,.04),cream=metal('#d6d4bf',.84,.09),glass=metal('#4b717b',.32,.47);
const rubber=metal('#2e393a',.93,.04),wagon=metal('#466c77');
const aprons={inbound:metal('#829791',.96,.02),outbound:metal('#9a9c8b',.96,.02),apron:metal('#889998',.96,.02),transfer:metal('#8da19f',.96,.02)};

function area(parent,points,y,material){
  const shape=new T.Shape(points.map(([x,z])=>new T.Vector2(x,-z)));
  const mesh=new T.Mesh(new T.ShapeGeometry(shape),material);
  mesh.rotation.x=-Math.PI/2;mesh.position.y=y;mesh.receiveShadow=true;parent.add(mesh);
}
function outline(b,points,y,width,material){
  points.forEach(([x,z],i)=>{
    const [xx,zz]=points[(i+1)%points.length];
    b.beam([x,y,z],[xx,y,zz],width,.012,material);
  });
}
function rectangle([[x,z],[xx,zz]]){return [[x,z],[xx,z],[xx,zz],[x,zz]];}

function trackPair(parent,b,{start:[x,z],end:[,zz],gauge}){
  const span=zz-z,mid=(z+zz)/2,lanes=[];
  b.box(x,.004,mid,gauge+.46,.023,span,trackSlab);
  for(const sign of [-1,1]){
    const cx=x+sign*gauge/2;
    b.box(cx,.016,mid,.43,.032,span,concrete);
    const rail=new T.Mesh(new T.BoxGeometry(.115,.055,span),bed);
    rail.position.set(cx,.049,mid);rail.name='交接地轨基础线';rail.receiveShadow=true;parent.add(rail);
    lanes.push(rail);
    for(let at=z+.55;at<zz-.18;at+=1.8)b.box(cx,.032,at,.32,.018,.13,bed);
  }
  return lanes;
}

// Removable stands have a clear space between their four feet for the under-riding vehicle.
function agvBank(b,{stands,handover,vehicles}){
  for(const {at:[x,z],turned} of stands){
    const w=turned?1.03:1.21,d=turned?1.21:1.03,top=.46;
    for(const sign of [-1,1]){
      b.box(x,top,z+sign*(d/2-.05),w,.10,.10,rim);
      b.box(x+sign*(w/2-.05),top,z,.09,.10,d,rim);
      for(const s of [-1,1])b.box(x+s*(w/2-.07),top/2,z+sign*(d/2-.07),.12,top,.12,steel);
    }
    for(const dx of [-.24,.24])b.box(x+dx,.49,z,.087,.055,d,platform);
  }
  for(const [x,z] of handover){
    b.box(x,.39,z,1.4,.12,2,frame);
    for(let i=0;i<10;i++)b.roller([x-.63,.47,z-.9+i*.2],[x+.63,.47,z-.9+i*.2],.045,steel);
    for(const dx of [-.55,.55])for(const dz of [-.82,.82])b.box(x+dx,.185,z+dz,.10,.37,.10,frame);
  }
  for(const {at:[x,z],alongZ} of vehicles){
    const point=(along,h,across)=>alongZ?[x+across,h,z+along]:[x+along,h,z+across];
    b.box(x,.13,z,alongZ?.72:.88,.19,alongZ?.88:.72,amber);
    b.box(x,.252,z,alongZ?.61:.72,.075,alongZ?.72:.61,dark);
    for(const along of [-.29,.29])for(const across of [-.32,.32])
      b.roller(point(along,.10,across-.045),point(along,.10,across+.045),.10,rubber);
    b.box(...point(.445,.16,0),alongZ?.33:.035,.042,alongZ?.035:.33,cream);
  }
}

function existingDeck(b,{deck,ballDeck,positions}){
  const [[x,z],[xx,zz]]=deck,[[edge],[right]]=ballDeck;
  b.box((x+xx)/2,.21,(z+zz)/2,xx-x,.38,zz-z,platform);
  b.box((edge+right)/2,.423,(z+zz)/2,right-edge,.046,zz-z,bed);
  for(let pz=z+.27;pz<zz-.14;pz+=.39)for(let px=edge+.24;px<right-.10;px+=.39)
    b.roller([px,.44,pz],[px,.49,pz],.082,steel);
  for(const r of positions)outline(b,rectangle(r),.504,.072,pale);
  for(let i=0;i<=6;i++)b.box((x+edge)/2,.412,z+(zz-z)*i/6,edge-x,.025,.055,bed);
  b.box(edge-.19,.42,(z+zz)/2,.29,.036,zz-z,rim);
}
function booth(b,[[a,c],[v,f]]){
  const x=(a+v)/2,z=(c+f)/2,w=v-a,d=f-c,h=2.72;
  b.box(x,.10,z,w+.15,.20,d+.15,concrete);
  b.box(x,h/2+.17,z,w,h,d,cream);
  for(const sign of [-1,1]){
    b.box(x+sign*(w/2+.015),.46,z,.08,.43,d,rim);
    for(const dz of [-.23,.23]){
      const opening=z+dz*d;
      b.box(x+sign*(w/2+.045),1.76,opening,.096,.91,d*.31,glass);
      b.box(x+sign*(w/2+.07),1.25,opening,.17,.09,d*.32,steel);
      b.box(x+sign*(w/2+.10),1.76,opening,.036,1,.08,cream);
    }
  }
  b.box(x,h+.23,z,w+.34,.16,d+.36,rim);
  b.box(x,h+.328,z,w+.06,.036,d+.08,concrete);
}
function apronTrain(b,{tractor:[tx,z],dollies}){
  const wheels=(x,cz,width,length)=>{
    for(const sign of [-1,1])for(const dx of [-length/2,length/2]){
      const side=cz+sign*width/2;
      b.roller([x+dx,.34,side-.115],[x+dx,.34,side+.115],.31,rubber);
      b.roller([x+dx,.34,side+sign*.11],[x+dx,.34,side+sign*.14],.14,steel);
    }
  };
  b.box(tx,.52,z,4.35,.49,2.48,wagon);b.box(tx+.66,.97,z,2.47,.52,2.25,cream);
  b.box(tx-1.38,1.41,z,1.38,1.14,2.23,glass);b.box(tx-1.38,2.02,z,1.54,.15,2.38,cream);
  for(const s of [-1,1])b.box(tx-1.4,1.25,z+s*1.122,1.44,.17,.048,wagon);
  wheels(tx,z,2.2,2.85);
  let tail=tx+2.175;
  for(const [x,cz] of dollies){
    const length=3.45,w=3.22,front=x-length/2;
    for(const s of [-1,1])b.beam([tail,.41,z],[front,.41,cz+s*.65],.087,.085,frame);
    b.box(x,.49,cz,length,.23,w,wagon);
    for(const dz of [-w/2,0,w/2])b.box(x,.67,cz+dz,length,.14,.093,frame);
    for(let i=0;i<13;i++)for(const s of [-1,1]){
      const px=front+.17+i*.26;
      b.roller([px,.68,cz+s*.08],[px,.68,cz+s*(w/2-.10)],.067,steel);
    }
    wheels(x,cz,w-.25,2.45);tail=x+length/2;
  }
}
function groundLabel(parent,{text,at:[x,z],width}){
  const c=document.createElement('canvas');c.width=640;c.height=128;
  const ctx=c.getContext('2d');ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.font='600 84px "Microsoft YaHei",sans-serif';ctx.fillStyle='#364e4b';ctx.fillText(text,320,67,600);
  const map=new T.CanvasTexture(c);map.colorSpace=T.SRGBColorSpace;map.anisotropy=4;
  const g=new T.PlaneGeometry(width,width/5);g.rotateX(-Math.PI/2);
  const label=new T.Mesh(g,new T.MeshBasicMaterial({map,transparent:true,depthWrite:false,toneMapped:false}));
  label.position.set(x,.11,z);label.renderOrder=1;parent.add(label);return label;
}
export function createFloorOperations(parent,b,data,bounds){
  const [[left],[right,back]]=bounds;
  area(parent,rectangle([[left,data.hallEnd],[right,back]]),-.008,concrete);
  for(const bay of data.apronBays){
    area(parent,bay.outline,-.002,aprons[bay.kind]);
    outline(b,bay.outline,.026,.105,pale);
  }
  // Hatch the general-purpose workface at overview scale; the linework is clipped to its surveyed outline.
  for(const poly of data.workAreas||[]){
    area(parent,poly,-.007,aprons.apron);
    const sums=poly.map(([x,z])=>x+z);
    for(let k=Math.ceil(Math.min(...sums));k<Math.max(...sums);k+=2.0){
      const hits=[];
      poly.forEach(([x,z],i)=>{
        const [xx,zz]=poly[(i+1)%poly.length],a=x+z,c=xx+zz;
        if((a<=k)===(c<=k))return;
        const t=(k-a)/(c-a);hits.push([x+t*(xx-x),.022,z+t*(zz-z)]);
      });
      hits.sort((a,b)=>a[0]-b[0]);
      for(let i=1;i<hits.length;i+=2)b.beam(hits[i-1],hits[i],.07,.008,concrete);
    }
  }
  const tracks=data.tracks.map(lane=>trackPair(parent,b,lane));
  agvBank(b,data.agv);existingDeck(b,data.existing);
  data.booths.forEach(r=>booth(b,r));apronTrain(b,data.tow);
  const lettering=new T.Group();parent.add(lettering);
  const labels=data.names.map(entry=>groundLabel(lettering,entry));
  const eyeSpace=new T.Vector3();
  return {tracks,lettering,orientLabels(camera,yaw,tilt,pixels){
    const pixelAngle=2*Math.tan(T.MathUtils.degToRad(camera.fov/2))/pixels;
    for(const label of labels){
      label.rotation.y=yaw;
      const depth=-eyeSpace.copy(label.position).applyMatrix4(camera.matrixWorldInverse).z;
      const glyph=label.geometry.parameters.height*.65*Math.max(.43,tilt);
      label.scale.setScalar(T.MathUtils.clamp(11*depth*pixelAngle/glyph,1,2.25));
    }
  }};
}
