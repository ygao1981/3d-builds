import * as T from 'three';
import {amber,belt,dark,frame,side,steel,conveyor,distance,lerp} from './hardware.js';

function slab(group, corners, top, thickness, material) {
  const vertices=[];
  const push=(p,depth)=>vertices.push(p[0],(typeof top==='function'?top(p):top)-depth,p[1]);
  for(let i=1;i<corners.length-1;i++){
    for(const p of [corners[0],corners[i+1],corners[i]])push(p,0);
    for(const p of [corners[0],corners[i],corners[i+1]])push(p,thickness);
  }
  for(let i=0;i<corners.length;i++){
    const a=corners[i],b=corners[(i+1)%corners.length];
    for(const [p,depth] of [[a,0],[b,0],[a,thickness],[b,0],[b,thickness],[a,thickness]])push(p,depth);
  }
  const geo=new T.BufferGeometry();
  geo.setAttribute('position',new T.Float32BufferAttribute(vertices,3));geo.computeVertexNormals();
  const mesh=new T.Mesh(geo,material);mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);return mesh;
}

function supplyTiming(route,ringSpeed){
  const entrySpeed=.90,last=route.at(-1),prev=route.at(-2),finalRun=distance(prev,last);
  const length=route.slice(1).reduce((n,p,i)=>n+distance(p,route[i]),0);
  // Match the component along the main line while the angled belt delivers the carton.
  const exitSpeed=ringSpeed*finalRun/Math.abs(last[0]-prev[0]);
  const cruise=Math.min(1.4,finalRun*.30),ramp=Math.min(1.6,finalRun*.38),lead=length-ramp-cruise;
  const t0=lead/entrySpeed,accel=(exitSpeed*exitSpeed-entrySpeed*entrySpeed)/(2*ramp);
  const t1=t0+2*ramp/(entrySpeed+exitSpeed),duration=t1+cruise/exitSpeed;
  return {length,entrySpeed,exitSpeed,duration,timeAt(s){
    if(s<=lead)return s/entrySpeed;
    if(s<=lead+ramp)return t0+2*(s-lead)/(entrySpeed+Math.sqrt(entrySpeed**2+2*accel*(s-lead)));
    return t1+(s-lead-ramp)/exitSpeed;
  },distanceAt(t){
    if(t<=t0)return t*entrySpeed;
    if(t<=t1){const dt=t-t0;return lead+dt*(entrySpeed+accel*dt/2);}
    return lead+ramp+(t-t1)*exitSpeed;
  }};
}

export function buildInduction(b,group,spec,site,ringSpeed) {
  const deck=spec.deck, span=spec.feedWidth;
  const noseLimit=-spec.radius-(spec.width+.06)/2-.055;
  const noses=[],routes=[];
  if(site?.distribution)site.distribution.slice(1).forEach((p,i)=>{
    const a=site.distribution[i];conveyor(b,a,p,a[2],p[2],span);
  });
  else if(site)conveyor(b,...site.feederTrunk,deck+.02,deck+.02,span);
  for(const [i,[start,join]] of spec.feeds.entries()){
    const len=distance(start,join),dx=(join[0]-start[0])/len,dz=(join[1]-start[1])/len;
    const point=(s,offset)=>[start[0]+s*dx-offset*dz,start[1]+s*dz+offset*dx];
    const end=offset=>(noseLimit-start[1]-offset*dx)/dz;
    const noseLength=end(0), solids=[];
    const top=p=>deck+.02*(1-T.MathUtils.clamp((p[1]-start[1])/(noseLimit-start[1]),0,1));
    function strip(s0,s1,lo,hi,y,thick,material){
      const section=[[s0,lo],[s1,lo],[s1,hi],[s0,hi]].map(([s,n])=>point(s,n));
      const corners=[];
      section.forEach((a,j)=>{
        const next=section[(j+1)%4],inside=a[1]<=noseLimit;
        if(inside)corners.push(a);
        if(inside!==(next[1]<=noseLimit)){
          const u=(noseLimit-a[1])/(next[1]-a[1]);
          corners.push([lerp(a[0],next[0],u),noseLimit]);
        }
      });
      if(corners.length<3)return null;
      return slab(group,corners,p=>top(p)+y-deck,thick,material);
    }
    for(let n=0;n<5;n++){
      const a=n*noseLength/5,c=n===4?len+.85:(n+1)*noseLength/5-.025;
      solids.push(strip(a,c,-span/2,span/2,deck-.075,.18,frame),
        strip(a,c,-span*.47,span*.47,deck,.075,belt));
      for(const sign of [-1,1]){
        const offset=sign*span*.49;
        solids.push(strip(a,c,offset-.018,offset+.018,deck-.012,.12,side));
        const p=point(a+.15,sign*span*.4);
        b.box(p[0],(deck-.25)/2,p[1],.10,deck-.25,.10,frame);
        b.box(p[0],.035,p[1],.22,.07,.22,steel);
      }
    }
    const lead0=point(end(-span*.47),-span*.47),lead1=point(end(span*.47),span*.47);
    b.roller([lead0[0],deck-.032,noseLimit-.032],[lead1[0],deck-.032,noseLimit-.032],.032);
    const bevelOffset=.115/dz;
    const cap=[point(end(-span*.47)-bevelOffset,-span*.47),lead0,lead1,point(end(span*.47)-bevelOffset,span*.47)];
    solids.push(slab(group,cap,deck+.001,.018,steel));
    noses.push(solids.filter(Boolean));
    const branch=site?.branches?.[i];
    if(branch){
      for(let j=1;j<branch.length;j++)conveyor(b,branch[j-1],branch[j],deck+.02,deck+.02,span);
      const last=branch.at(-1),along=(last[0]-start[0])*dx+(last[1]-start[1])*dz;
      const handoff=point(Math.max(0,along+.3),0);
      if(site.distribution){
        const trunk=site.distribution.at(-1),split=branch[0];
        // Keep the same carton on the registered common belt until its branch takes it.
        const entry=[Math.max(site.distribution.at(-2)[0]-6,split[0]-6.0),trunk[1]];
        routes.push([entry,[split[0]-.8,trunk[1]],...branch].map(p=>[...p,deck+.02]).concat([[...handoff,top(handoff)],[...join,deck]]));
      }else routes.push([...branch.map(p=>[...p,deck+.02]),[...handoff,top(handoff)],[...join,deck]]);
    }else routes.push([[...start,top(start)],[...join,deck]]);
  }
  return {noses,routes,profiles:routes.map(route=>supplyTiming(route,ringSpeed))};
}

export function pathAt(route,fraction){
  const lengths=route.slice(1).map((p,i)=>distance(route[i],p));
  let left=fraction*lengths.reduce((a,b)=>a+b,0);
  for(let i=0;i<lengths.length;i++){
    if(left<=lengths[i] || i===lengths.length-1){
      const a=route[i],b=route[i+1],u=T.MathUtils.clamp(left/Math.max(.001,lengths[i]),0,1);
      return [lerp(a[0],b[0],u),lerp(a[1],b[1],u),-Math.atan2(b[1]-a[1],b[0]-a[0]),lerp(a[2],b[2],u)];
    }
    left-=lengths[i];
  }
}

// Scan heads are separate from the support bridge. One reads from above, the others from the sides.
export function scanner(b,x,z,height,width,alongZ=false,five=false){
  const place=(offset,y,along,w,h,d,material)=>alongZ?b.box(x+offset,y,z+along,w,h,d,material):b.box(x+along,y,z+offset,d,h,w,material);
  for(const sign of [-1,1]){
    const edge=sign*(width/2+.17);
    place(edge,height+.57,0,.11,1.43,.15,side);
    place(edge,height-.12,0,.22,.05,.30,steel);
    for(const forward of five?[-.18,.18]:[0]){
      place(edge-sign*.09,height+.46,forward,.14,.15,.17,dark);
      place(edge-sign*.165,height+.46,forward,.025,.07,.10,amber);
    }
  }
  place(0,height+1.25,0,width+.46,.19,.38,side);
  place(0,height+1.12,0,.22,.09,.18,dark);
  place(0,height+1.232,.197,width*.67,.06,.014,amber);
}
