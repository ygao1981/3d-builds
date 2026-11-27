import * as T from 'three';
import {amber,belt,dark,frame,side,steel,distance,lerp} from './hardware.js';
import {alongTrunk,beltRun,direction,meetLine,sidePort} from './belt-path.js';

function slabVertices(vertices,corners,top,thickness) {
  const push=(p,depth)=>vertices.push(p[0],(typeof top==='function'?top(p):top)-depth,p[1]);
  for(let i=1;i<corners.length-1;i++){
    for(const p of [corners[0],corners[i+1],corners[i]])push(p,0);
    for(const p of [corners[0],corners[i],corners[i+1]])push(p,thickness);
  }
  for(let i=0;i<corners.length;i++){
    const a=corners[i],b=corners[(i+1)%corners.length];
    for(const [p,depth] of [[a,0],[b,0],[a,thickness],[b,0],[b,thickness],[a,thickness]])push(p,depth);
  }
}

function solid(group,vertices,material){
  const geo=new T.BufferGeometry();
  geo.setAttribute('position',new T.Float32BufferAttribute(vertices,3));geo.computeVertexNormals();
  const mesh=new T.Mesh(geo,material);mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);return mesh;
}

function slab(group,corners,top,thickness,material){
  const vertices=[];slabVertices(vertices,corners,top,thickness);
  return solid(group,vertices,material);
}

// One moving rubber splice and a fine weave. U increases in the direction of freight travel.
function feedRubber(){
  const width=128,height=32,pixels=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const seam=(x+Math.floor(y/8))%width;
    const shade=seam<3?144:seam===3?247:219+((x*13+y*17+x*y)%15);
    pixels.set([shade,shade,shade,255],4*(y*width+x));
  }
  const texture=new T.DataTexture(pixels,width,height);
  texture.colorSpace=T.SRGBColorSpace;texture.wrapS=texture.wrapT=T.RepeatWrapping;
  texture.generateMipmaps=true;texture.minFilter=T.LinearMipmapLinearFilter;texture.magFilter=T.LinearFilter;
  texture.anisotropy=4;texture.needsUpdate=true;
  const material=belt.clone();material.color.set('#566466');material.map=texture;
  return material;
}

const entrySpeed=.90;
function supplyTiming(route,ringSpeed){
  const last=route.at(-1),prev=route.at(-2),finalRun=distance(prev,last);
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
  const deck=spec.deck,queueWidth=spec.feedWidth,survey=spec.feedDeck;
  const width=survey?.width??queueWidth,half=width/2,frameHalf=survey?survey.frameWidth/2:half+.02;
  const rubber=survey?feedRubber():null;
  const noseLimit=-spec.radius-(spec.width+.06)/2-.055;
  const noses=[],routes=[],profiles=[],ports=[],branches=[],through=[];
  const equipment=site?.distributionEquipment;
  const trunk=site?.distribution || site?.feederTrunk?.map(p=>[...p,deck+.02]);
  const mainZ=trunk?.at(-1)[1];
  for(const [i,[start,join]] of spec.feeds.entries()){
    const len=distance(start,join),dx=(join[0]-start[0])/len,dz=(join[1]-start[1])/len;
    const point=(s,offset)=>[start[0]+s*dx-offset*dz,start[1]+s*dz+offset*dx];
    const end=offset=>(noseLimit-start[1]-offset*dx)/dz;
    const noseLength=end(0), solids=[];
    const breaksOnPlan=survey?[survey.rows[0][0],survey.noseStart]:equipment?.feedBreaks;
    const top=p=>{
      const s=(p[0]-start[0])*dx+(p[1]-start[1])*dz;
      const grade=breaksOnPlan?(s-breaksOnPlan[0])/(breaksOnPlan.at(-1)-breaksOnPlan[0]):
        (p[1]-start[1])/(noseLimit-start[1]);
      return deck+.02*(1-T.MathUtils.clamp(grade,0,1));
    };
    const normal=[-dz,dx],branch=site?.branches?.[i],railOffset=survey?frameHalf-.018:half+.018;
    let opening=null;
    if(branch && trunk){
      const tail=branch.at(-1),travel=direction(branch.at(-2),tail);
      const edge=point(0,half),seam=meetLine(tail,travel,edge,normal);
      const centre=meetLine(tail,travel,start,normal);
      const railHit=meetLine(tail,travel,point(0,railOffset),normal);
      const along=(railHit[0]-start[0])*dx+(railHit[1]-start[1])*dz;
      const headWidth=survey?width:queueWidth;
      const reach=headWidth/2/Math.abs(travel[0]*normal[0]+travel[1]*normal[1]);
      opening=[along-reach-.035,along+reach+.035];
      const departure=direction(branch[0],branch[1]);
      const port=sidePort(branch[0],departure,mainZ,queueWidth,1);
      ports.push(port);
      const mid=meetLine(branch[0],departure,[0,mainZ],[0,1]);
      const inside=(p,at,vec)=>(p[0]-at[0])*vec[0]+(p[1]-at[1])*vec[1];
      // Old layout packs carried their last square-ended queue past the intended bevel.
      const room=branch.filter(p=>inside(p,port.mid,departure)>.001 && inside(p,seam,travel)<-.001);
      const path=[port.mid,...room,seam].map(p=>[...p,deck+.02]);
      // Keep the scheduled queue separate from the wider, square-backed transfer head.
      const exit=path.findIndex(p=>distance(p,branch.at(-2))<.002);
      if(survey && exit>0 && exit<path.length-1){
        beltRun(group,b,path.slice(0,exit+1),queueWidth,{firstFace:[0,1]});
        beltRun(group,b,path.slice(exit),headWidth,{lastFace:normal});
      }else beltRun(group,b,path,queueWidth,{firstFace:[0,1],lastFace:normal});
      const edgeEnds=[-headWidth/2,headWidth/2].map(off=>meetLine([tail[0]-travel[1]*off,tail[1]+travel[0]*off],travel,edge,normal));
      b.beam([edgeEnds[0][0],deck+.021,edgeEnds[0][1]],[edgeEnds[1][0],deck+.021,edgeEnds[1][1]],.029,.009,steel);
      const entry=[mid[0]-6,mainZ,deck+.02];
      const route=site.distribution?[entry,[...mid,deck+.02],...path]:path.slice();
      const queueEnd=route.slice(1).reduce((s,p,j)=>s+distance(route[j],p),0);
      branches.push({path,seam,centre,normal,travel,port,queueEnd});
      if(survey){
        const panels=[],uv=[],count=survey.noseEnds.length;
        const at=(s,n)=>[seam[0]+travel[0]*s-travel[1]*n,seam[1]+travel[1]*s+travel[0]*n];
        for(let lane=0;lane<count;lane++){
          const lo=-headWidth/2+lane*(headWidth-survey.noseWidth)/(count-1);
          const hi=lo+survey.noseWidth,mid=at(0,(lo+hi)/2);
          const tip=inside(meetLine(mid,travel,edge,normal),mid,travel)-survey.queueNoseSetback;
          const first=panels.length,back=-survey.queueNoseRun;
          slabVertices(panels,[at(back,lo),at(tip,lo),at(tip,hi),at(back,hi)],deck+.023,.009);
          for(let v=first;v<panels.length;v+=3){
            const x=panels[v]-seam[0],z=panels[v+2]-seam[1];
            uv.push((queueEnd+x*travel[0]+z*travel[1])/entrySpeed+lane*.29,(-x*travel[1]+z*travel[0]-lo)/survey.noseWidth);
          }
        }
        const head=solid(group,panels,rubber);head.name='排队末端窄带';
        head.geometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
      }else for(let k=1;k<=11;k++){
        const off=(k/12-.5)*queueWidth,track=[tail[0]-travel[1]*off,tail[1]+travel[0]*off];
        const tip=meetLine(track,travel,edge,normal),h=deck+.023;
        const run=Math.min(.77,Math.max(.14,inside(tip,room.at(-1)||path[0],travel)-.05));
        b.beam([tip[0]-travel[0]*run,h,tip[1]-travel[1]*run],
          [tip[0]-travel[0]*.012,h,tip[1]-travel[1]*.012],.013,.006,side);
      }
      // Round the carton trajectory inside the supported intersection of the two decks.
      const a=[centre[0]-travel[0]*.22,centre[1]-travel[1]*.22];
      const c=[centre[0]+dx*.38,centre[1]+dz*.38];
      for(let n=0;n<=6;n++){
        const u=n/6,v=1-u,p=[0,1].map(j=>v*v*a[j]+2*v*u*centre[j]+u*u*c[j]);
        route.push([...p,top(p)]);
      }
      if(breaksOnPlan)for(const station of [breaksOnPlan[0],breaksOnPlan.at(-1)]){
        const p=point(station,0);route.push([...p,top(p)]);
      }
      route.push([...join,deck]);routes.push(route);
    }else routes.push([[...start,top(start)],[...join,deck]]);
    const profile=supplyTiming(routes.at(-1),ringSpeed);profiles.push(profile);
    function strip(s0,s1,lo,hi,y,thick,material,vertices){
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
      const level=p=>top(p)+y-deck;
      if(vertices){slabVertices(vertices,corners,level,thick);return;}
      return slab(group,corners,level,thick,material);
    }
    const firstStage=Math.min(noseLength*.55,Math.max(noseLength/5,(opening?.[1] || 0)+.12));
    const breaks=survey?[survey.intakeStart,survey.rows[0][0],survey.rows.at(-1)[0],survey.noseStart]:
      breaksOnPlan || Array.from({length:4},(_,n)=>firstStage+n*(noseLength-firstStage)/4);
    const stations=[0,...breaks,len+.85];
    for(let n=0;n<5;n++){
      const a=stations[n],c=stations[n+1]-(n===4?0:.008);
      if(!survey){
        const skin=strip(a,c,-half,half,deck,.075,belt);skin.name='输送承载面';solids.push(skin);
      }
      solids.push(strip(a,c,-frameHalf,frameHalf,deck-.075,.18,frame));
      for(const sign of [-1,1]){
        const offset=sign*railOffset;
        const spans=opening && sign===1?[[a,Math.min(c,opening[0])],[Math.max(a,opening[1]),c]]:[[a,c]];
        for(const [begin,end] of spans)if(end>begin)
          solids.push(strip(begin,end,offset-.018,offset+.018,deck-.012,.12,side));
        const p=point(a+.15,sign*width*.4);
        b.box(p[0],(deck-.25)/2,p[1],.10,deck-.25,.10,frame);
        b.box(p[0],.035,p[1],.22,.07,.22,steel);
      }
    }
    if(survey){
      const makeRow=(a,ends,stripWidth,name)=>{
        const vertices=[],uv=[],pitch=ends.length>1?(width-stripWidth)/(ends.length-1):0;
        ends.forEach((finish,lane)=>{
          const lo=-half+lane*pitch,first=vertices.length;
          strip(a,finish,lo,lo+stripWidth,deck,.045,rubber,vertices);
          for(let v=first;v<vertices.length;v+=3){
            const x=vertices[v]-start[0],z=vertices[v+2]-start[1],s=x*dx+z*dz;
            // Feed time at this station maps a rubber splice to the same forward travel as a carton.
            uv.push(profile.timeAt(profile.length-len+s)+lane*.29,(-x*dz+z*dx-lo)/stripWidth);
          }
        });
        const skin=solid(group,vertices,rubber);skin.geometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
        skin.name='输送承载面';skin.userData.feedPart=name;solids.push(skin);
      };
      solids.push(strip(0,survey.intakeStart,-half,half,deck-.024,.055,steel));
      makeRow(survey.intakeStart,[survey.rows[0][0]-.055],width,'接包面');
      survey.rows.forEach(([a,c],row)=>{
        makeRow(a,Array(survey.strips).fill(c),survey.stripWidth,'短带 '+(row+1));
        const next=survey.rows[row+1]?.[0]??survey.noseStart;
        const station=(c+next)/2,r=(next-c)*.45;
        const pins=[-half,half].map(n=>{const p=point(station,n);return [p[0],top(p)-r-.002,p[1]];});
        b.roller(...pins,r,steel);
      });
      makeRow(survey.noseStart,survey.noseEnds,survey.noseWidth,'斜口窄带');
    }
    const ends=[-half,half].map(off=>point(.06,off));
    b.roller([ends[0][0],top(ends[0])-.046,ends[0][1]],[ends[1][0],top(ends[1])-.046,ends[1][1]],.054,steel);
    const lead0=point(end(-half),-half),lead1=point(end(half),half);
    b.roller([lead0[0],deck-.032,noseLimit-.032],[lead1[0],deck-.032,noseLimit-.032],.032);
    const bevelOffset=(survey ? .022 : .115)/dz;
    const cap=[point(end(-half)-bevelOffset,-half),lead0,lead1,point(end(half)-bevelOffset,half)];
    solids.push(slab(group,cap,deck+(survey?-.008:.001),.018,steel));
    noses.push(solids.filter(Boolean));
  }
  if(equipment){
    function merge(path,z,bank){
      const start=path.at(-2),vec=direction(start,path.at(-1));
      const port=sidePort(start,vec,z,queueWidth,bank),end=[...port.mid,path.at(-1)[2]];
      const clipped=path.slice(0,-1).filter(p=>(p[0]-end[0])*vec[0]+(p[1]-end[1])*vec[1]<-.001);
      beltRun(group,b,[...clipped,end],queueWidth,{lastFace:[0,1]});ports.push(port);
      return [...clipped,end,path.at(-1)];
    }
    const sources=equipment.sources.map(path=>merge(path,trunk[0][1],-1));
    const secondary=merge(equipment.merge,mainZ,1);
    beltRun(group,b,equipment.slide,queueWidth,{material:steel});
    const first=sources.at(-1),out=equipment.slide.at(-1);
    const tail=path=>path.filter(p=>p[0]>secondary.at(-1)[0] && Math.abs(p[1]-mainZ)<.001);
    // Follow the lower incoming run west, round the U, then all the way to the terminal slide.
    const lower=trunk.slice(trunk.findIndex(p=>p[0]<first.at(-1)[0] && Math.abs(p[1]-trunk[0][1])<.001));
    through.push([...first,...lower,out],[...secondary,...tail(trunk),out]);
    for(const x of equipment.wheels){
      b.box(x,deck+.023,mainZ,1.18,.006,queueWidth-.06,dark);
      for(let row=0;row<5;row++)for(let col=0;col<6;col++){
        const xx=x+(col-2.5)*.187,zz=mainZ+(row-2)*.224;
        b.roller([xx-.026,deck-.012,zz-.074],[xx+.026,deck-.012,zz+.074],.046,steel);
      }
    }
  }
  if(trunk)alongTrunk(group,b,trunk,queueWidth,ports);
  return {noses,routes,branches,through,profiles,updateBelts(time){
    if(rubber)rubber.map.offset.x=-T.MathUtils.euclideanModulo(time,1);
  }};
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
