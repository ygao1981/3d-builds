import * as T from 'three';
import { palletCycle } from './pallet-motion.js';
import { measureRollers } from '../simready-rollers.js';

const metal = (color, roughness=.56, metalness=.35) => new T.MeshStandardMaterial({ color, roughness, metalness });
const frame=metal('#375162'), belt=metal('#343f43',.83,.07), steel=metal('#adb9b9',.36,.72);
const side=metal('#63888c'), dark=metal('#354c50'), amber=metal('#c99639'), platform=metal('#788a8b');
const unitBox=new T.BoxGeometry(1,1,1), drum=new T.CylinderGeometry(1,1,1,10);
const up=new T.Vector3(0,1,0);
const lerp=T.MathUtils.lerp, mod=T.MathUtils.euclideanModulo;
const distance=(a,b)=>Math.hypot(b[0]-a[0],b[1]-a[1]);

// Static machine parts sharing a material are drawn together. Coordinates are x, height, z in metres.
function batch(parent) {
  const batches = new Map(), ref=new T.Object3D();
  function part(geom,mat,xyz,size,q) {
    const key=geom.uuid+mat.uuid;
    if(!batches.has(key)) batches.set(key,{geom,mat,matrices:[]});
    ref.position.fromArray(xyz); ref.scale.fromArray(size); ref.quaternion.copy(q || identity);
    ref.updateMatrix(); batches.get(key).matrices.push(ref.matrix.clone());
  }
  function box(x,y,z,w,h,d,mat=frame) { part(unitBox,mat,[x,y,z],[w,h,d]); }
  function beam(a,b,w,h,mat) {
    const v=new T.Vector3().subVectors(new T.Vector3(...b),new T.Vector3(...a));
    const yaw=Math.atan2(v.x,v.z), pitch=-Math.atan2(v.y,Math.hypot(v.x,v.z));
    const q=new T.Quaternion().setFromEuler(new T.Euler(pitch,yaw,0,'YXZ'));
    part(unitBox,mat,a.map((v,i)=>(v+b[i])/2),[w,h,v.length()],q);
  }
  function roller(a,b,r=.05) {
    const v=new T.Vector3().subVectors(new T.Vector3(...b),new T.Vector3(...a));
    part(drum,steel,a.map((v,i)=>(v+b[i])/2),[r,v.length(),r],new T.Quaternion().setFromUnitVectors(up,v.normalize()));
  }
  function finish() {
    for(const {geom,mat,matrices} of batches.values()) {
      const m=new T.InstancedMesh(geom,mat,matrices.length);
      matrices.forEach((x,i)=>m.setMatrixAt(i,x)); m.castShadow=true; m.receiveShadow=true; parent.add(m);
    }
  }
  return {part,box,beam,roller,finish};
}
const identity=new T.Quaternion();

function conveyor(b,a,c,y0,y1,width,kind='belt') {
  const len=distance(a,c); if(len<.01) return;
  const nx=(c[1]-a[1])/len,nz=-(c[0]-a[0])/len;
  const xyz=(t,lift,off=0)=>[lerp(a[0],c[0],t)+nx*off,lerp(y0,y1,t)+lift,lerp(a[1],c[1],t)+nz*off];
  b.beam(xyz(0,-.15),xyz(1,-.15),width,.19,frame);
  if(kind==='roller') {
    const n=Math.max(2,Math.round(len/.16));
    for(let i=0;i<n;i++) b.roller(xyz((i+.5)/n,-.048,-width*.47),xyz((i+.5)/n,-.048,width*.47),.048);
  } else if(kind==='chain') {
    for(const offset of [-.37,0,.37]) b.beam(xyz(0,-.02,offset*width),xyz(1,-.02,offset*width),.065,.04,steel);
  } else b.beam(xyz(0,-.03),xyz(1,-.03),width*.95,.06,belt);
  const railOffset=width*.5+(kind==='roller'?.032:0);
  for(const sign of [-1,1]) b.beam(xyz(0,-.045,railOffset*sign),xyz(1,-.045,railOffset*sign),.055,.16,side);
  const pairs=Math.max(1,Math.ceil(len/2.8));
  for(let i=0;i<pairs;i++) for(const sign of [-1,1]) {
    const [x,y,z]=xyz((i+.42)/pairs,-.22,width*.39*sign);
    if(y>.05) {b.box(x,y/2,z,.09,y,.09,frame);b.box(x,.025,z,.21,.05,.21,steel);}
  }
}

function fitted(scene, xSize, ySize, zSize, uniform=false) {
  const model=scene.clone(true), raw=new T.Box3().setFromObject(model,true);
  const size=raw.getSize(new T.Vector3()), mid=raw.getCenter(new T.Vector3());
  model.position.set(-mid.x,-raw.min.y,-mid.z);
  const inner=new T.Group(); inner.scale.set(xSize/size.x,ySize/size.y,zSize/size.z);
  if(uniform)inner.scale.setScalar(Math.min(1,inner.scale.x,inner.scale.y,inner.scale.z));
  inner.add(model);
  const g=new T.Group();g.add(inner);g.userData.size=size.multiply(inner.scale).toArray();return g;
}

// Rest the rigid carton on the slope, including when its front and back cross a change of grade.
function chutePose(box,head,tail,u,spec){
  const run=distance(head,tail),s=u*run,knee=.80*run;
  const surface=x=>lerp(spec.chuteTop,spec.chuteBottom,T.MathUtils.clamp(x/knee,0,1));
  const half=box.userData.size[2]/2;
  let tilt=0,reach=half;
  for(let i=0;i<2;i++){
    tilt=Math.atan2(surface(s-reach)-surface(s+reach),2*reach);
    reach=half*Math.cos(tilt);
  }
  const tan=Math.tan(tilt);
  let height=Math.max(surface(s-reach)-reach*tan,surface(s+reach)+reach*tan);
  if(s-reach<0 && s+reach>0)height=Math.max(height,spec.chuteTop-s*tan);
  box.rotation.set(tilt,Math.atan2(tail[0]-head[0],tail[1]-head[1]),0,'YXZ');
  box.position.set(lerp(head[0],tail[0],u),height,lerp(head[1],tail[1],u));
}

function loopGeometry(spec) {
  const {left,right,radius:r}=spec, straight=right-left, arc=Math.PI*r;
  const length=2*(straight+arc);
  function at(value) {
    let s=mod(value,length);
    if(s<straight) return [right-s,-r,-1,0];
    s-=straight;
    if(s<arc){const angle=-Math.PI/2-s/r;return [left+r*Math.cos(angle),r*Math.sin(angle),Math.sin(angle),-Math.cos(angle)];}
    s-=arc;if(s<straight) return [left+s,r,1,0];
    const angle=Math.PI/2-(s-straight)/r;
    return [right+r*Math.cos(angle),r*Math.sin(angle),Math.sin(angle),-Math.cos(angle)];
  }
  return {at,length,straight,arc};
}

function sorterPlant(spec,scenes) {
  const group=new T.Group(), b=batch(group), loop=loopGeometry(spec), {deck,width}=spec;
  const spans=148;
  for(let i=0;i<spans;i++){
    const a=loop.at(i*loop.length/spans), c=loop.at((i+1)*loop.length/spans);
    for(const sign of [-1,1]){
      const pos=(p,off,y)=>[p[0]-p[3]*off*sign,y,p[1]+p[2]*off*sign];
      b.beam(pos(a,width*.47,deck-.26),pos(c,width*.47,deck-.26),.16,.30,frame);
      const walkway=sign===1?1.18:.88;
      b.beam(pos(a,width*.50+walkway/2,deck-.69),pos(c,width*.50+walkway/2,deck-.69),walkway,.12,platform);
      const opening=sign===1 && (spec.feeds.some(([,j])=>Math.abs(a[1]-j[1])<.36 && Math.abs(a[0]-j[0])<1.25) ||
        spec.chutes.some(([h])=>Math.abs(a[1]-spec.radius)<.35 && Math.abs(a[0]-h[0])<spec.chuteWidth*.58));
      const curve=a[0]<spec.left-.3 || a[0]>spec.right+.3;
      if(sign===1 && curve && !opening){
        for(const lift of [.08,.46])b.beam(pos(a,width*.50+walkway-.06,deck+lift),pos(c,width*.50+walkway-.06,deck+lift),.036,.038,amber);
        if(i%3===0){const [x,,z]=pos(a,width*.50+walkway-.06,0);b.box(x,deck-.10,z,.042,1.13,.042,frame);}
      }
      if(i%5===0){const [x,,z]=pos(a,width*.47,0);b.box(x,(deck-.39)/2,z,.15,deck-.39,.15,frame);b.box(x,.035,z,.30,.07,.3,steel);}
    }
  }
  const cells=new T.InstancedMesh(unitBox,belt,spec.carts);
  const edges=new T.InstancedMesh(unitBox,side,spec.carts);
  cells.castShadow=true;cells.receiveShadow=true;group.add(cells,edges);
  for(const [a,c] of spec.feeds) {
    for(let i=0;i<5;i++){
      const point=t=>[lerp(a[0],c[0],t),lerp(a[1],c[1],t)];
      // The final part of the path runs over the sorter cart, past the physical induction nose.
      const nose=1-(width*.5/Math.abs(c[1]-a[1]));
      conveyor(b,point(i/5*nose),point((i+.985)/5*nose),deck,deck,spec.feedWidth);
    }
  }
  for(const [a,c] of spec.chutes) {
    const mid=[lerp(a[0],c[0],.80),lerp(a[1],c[1],.80)];
    conveyor(b,a,mid,spec.chuteTop,spec.chuteBottom,spec.chuteWidth,'roller');
    conveyor(b,mid,c,spec.chuteBottom,spec.chuteBottom,spec.chuteWidth,'roller');
  }
  for(const path of spec.returns) for(let i=1;i<path.length;i++){
    const a=path[i-1],c=path[i];conveyor(b,a,c,a[2],c[2],1.2);
  }
  const [sx,sz]=spec.scanner;
  for(const dz of [-1,1]) b.box(sx,deck+.55,sz+dz,.16,1.35,.13,dark);
  b.box(sx,deck+1.23,sz,.40,.18,2.12,dark);
  b.box(sx+.21,deck+1.25,sz,.035,.09,.55,amber);
  b.finish();
  const cartons=Object.entries(scenes).filter(([id])=>id.startsWith('box_cardboard_')).map(([id,scene])=>{
    const model=fitted(scene,.54,.36,.47,true);model.name=id;return model;
  });
  const loads=Array.from({length:Math.min(18,spec.carts)},(_,i)=>{
    const box=cartons[(i+Math.floor(i/spec.chutes.length))%cartons.length].clone(true);group.add(box);
    return {box,slot:Math.floor(i*spec.carts/18),inlet:i%spec.feeds.length,outlet:i%spec.chutes.length};
  });
  const tmp=new T.Object3D(),speed=1.48,phase=.55;
  const cycle=loop.length/speed, chosen=loads.find(l=>l.outlet===Math.floor(spec.chutes.length/2)) || loads[0];
  const [from,join]=spec.feeds[chosen.inlet],head=spec.chutes[chosen.outlet][0];
  const when=s=>mod((s-chosen.slot*loop.length/spec.carts)/speed,cycle);
  const cues={
    feed:{view:'sorting',focus:chosen.inlet,time:mod(when(spec.right-join[0])-Math.min(4,distance(from,join)/1.2),cycle)},
    unload:{view:'chutes',focus:chosen.outlet,time:mod(when(loop.straight+loop.arc+head[0]-spec.left-speed*phase)-.8,cycle)},
  };
  function update(t) {
    for(let i=0;i<spec.carts;i++){
      const [x,z,dx,dz]=loop.at(t*speed+i*loop.length/spec.carts);
      tmp.position.set(x,deck-.07,z);tmp.rotation.set(0,-Math.atan2(dz,dx),0);tmp.scale.set(spec.cartLength,.14,width);
      tmp.updateMatrix();cells.setMatrixAt(i,tmp.matrix);
      tmp.position.y=deck-.17;tmp.scale.set(spec.cartLength+.045,.08,width+.06);tmp.updateMatrix();edges.setMatrixAt(i,tmp.matrix);
    }
    cells.instanceMatrix.needsUpdate=edges.instanceMatrix.needsUpdate=true;
    for(const {box,slot,inlet,outlet} of loads){
      const [entry,join]=spec.feeds[inlet],[head,tail]=spec.chutes[outlet];
      const feedS=spec.right-join[0], releaseS=loop.straight+loop.arc+head[0]-spec.left-speed*phase;
      const age=mod(t*speed+slot*loop.length/spec.carts-feedS,loop.length)/speed;
      const carry=(releaseS-feedS)/speed, incoming=distance(entry,join)/1.2;
      box.visible=true;box.rotation.set(0,0,0);
      if(age<carry){
        const [x,z,dx,dz]=loop.at(feedS+age*speed);box.position.set(x,deck+.003,z);box.rotation.y=-Math.atan2(dz,dx);
      } else if(age<carry+phase){
        const u=(age-carry)/phase,x=head[0]-speed*phase*(1-u),z=lerp(spec.radius,head[1],u);
        const dx=tail[0]-head[0],dz=tail[1]-head[1];
        chutePose(box,head,tail,((x-head[0])*dx+(z-head[1])*dz)/(dx*dx+dz*dz),spec);
        box.position.set(x,box.position.y+(deck-spec.chuteTop)*(1-u),z);
      } else if(age<carry+phase+5.65){
        const u=Math.min(1,(age-carry-phase)/4.8);
        chutePose(box,head,tail,u*(1-box.userData.size[2]/(2*distance(head,tail))),spec);
      } else if(age>cycle-incoming){
        const u=1-(cycle-age)/incoming;box.position.set(lerp(entry[0],join[0],u),deck,lerp(entry[1],join[1],u));
        box.rotation.y=-Math.atan2(join[1]-entry[1],join[0]-entry[0]);
      } else box.visible=false;
    }
  }
  cells.frustumCulled=edges.frustumCulled=false;
  update(0);return {group,update,loop,loads,cues};
}

function palletPlant(s,scenes) {
  const group=new T.Group(), b=batch(group), wheels=[], movers=[];
  const wooden=fitted(scenes.pallet_a01,1.2,.145,1.0);
  const rollerJoints=measureRollers(scenes.conveyor_belt_a05);
  const lifts=s.transfers.map(([x,z],i)=>{
    const cassette=new T.Group(),bed=batch(cassette);
    cassette.name='移载滚筒 '+(i+1);cassette.position.set(x,s.deck-.06,z);
    for(const dz of [-.45,-.28,-.17,-.085,.085,.17,.28,.45])bed.roller([-.48,-.033,dz],[.48,-.033,dz],.033);
    for(const dx of [-.49,.49])bed.box(dx,-.073,0,.045,.085,1,amber);
    bed.finish();group.add(cassette);return cassette;
  });
  for(let i=0;i<s.turns.length;i++){
    const entry=s.inlets[i],turn=s.turns[i],stack=s.stackers[i];
    const sign=Math.sign(turn[0]-entry[0]), start=[entry[0]+1.5*sign,entry[1]];
    const kit=scenes.conveyor_belt_a05.clone(true), swivel=new T.Group();
    kit.position.x=-.5014;swivel.add(kit);swivel.scale.set(s.width/.903,s.deck/rollerJoints[0].top,1.5/2);
    for(const joint of rollerJoints)wheels.push({...joint,node:kit.getObjectByName(joint.name),lengthScale:swivel.scale.z});
    swivel.rotation.y=sign*Math.PI/2;swivel.position.set(entry[0],0,entry[1]);group.add(swivel);
    conveyor(b,start,[turn[0]-sign*.94,turn[1]],s.deck,s.deck,s.width,'roller');
    const base=new T.Mesh(new T.CylinderGeometry(.92,.94,s.deck-.10,48),frame);
    base.position.set(turn[0],(s.deck-.10)/2,turn[1]);group.add(base);
    const table=new T.Group(),tb=batch(table);
    for(let j=-5;j<=5;j++){
      const dx=j*.145,half=Math.sqrt(.88*.88-dx*dx);
      tb.roller([dx,-.055,-half],[dx,-.055,half],.055);
    }
    tb.finish();table.position.set(turn[0],s.deck,turn[1]);group.add(table);
    const ports=s.transfers.map((_,port)=>port).filter(port=>{
      const nearest=s.turns.reduce((best,at,j)=>distance(s.transfers[port],at)<distance(s.transfers[port],s.turns[best])?j:best,0);
      return nearest===i;
    });
    ports.sort((a,c)=>distance(s.transfers[c],turn)-distance(s.transfers[a],turn));
    const far=s.transfers[ports[0]],tz=far[1];
    conveyor(b,[turn[0],turn[1]+.92],[turn[0],tz-.52],s.deck,s.deck,s.width,'roller');
    conveyor(b,[turn[0],tz],[far[0],tz],s.chainDeck,s.chainDeck,1.2,'chain');
    for(const [dx,dz] of [[-.68,-.64],[-.68,.64],[.68,-.64],[.68,.64]])b.box(stack[0]+dx,1.25,stack[1]+dz,.10,2.5,.10,side);
    b.box(stack[0],2.46,stack[1]-.64,1.46,.10,.12,amber);b.box(stack[0],2.46,stack[1]+.64,1.46,.10,.12,amber);
    const jaws=[-1,1].map(side=>{
      const jaw=new T.Group(),steelwork=batch(jaw);
      steelwork.box(0,0,side*.09,1.06,.095,.12,amber);
      for(const x of [-.39,.39])steelwork.box(x,0,-side*.035,.09,.045,.28,steel);
      steelwork.finish();group.add(jaw);return jaw;
    });
    const loads=ports.map(()=>wooden.clone(true));group.add(...loads);
    movers.push(palletCycle(s,i,{loads,ports,jaws,turntable:table,lifts}));
  }
  s.transfers.forEach((a,i)=>{
    const tail=s.tails[i], inset=.52/distance(a,tail);
    conveyor(b,[lerp(a[0],tail[0],inset),lerp(a[1],tail[1],inset)],tail,s.deck,s.deck,s.width,'roller');
  });
  b.finish();
  const spin=new T.Quaternion();
  function update(t){
    for(const {node,rest,axis,radius,lengthScale} of wheels){
      const angle=mod(t*.26/(radius*lengthScale),2*Math.PI);
      node.quaternion.copy(rest).premultiply(spin.setFromAxisAngle(axis,angle));
    }
    movers.forEach(machine=>machine.update(t));
  }
  const first=movers[0].trips[0];
  const cues={
    release:{view:'pallet',focus:0,time:first.begin-.25},
    turn:{view:'pallet',focus:s.stackers.length,time:first.turnAt-1},
    transfer:{view:'pallet',focus:s.stackers.length+s.turns.length+first.outlet,time:first.outletAt-1.5},
  };
  update(0);return {group,update,movers,cues,wheels};
}

function dockPlant(s) {
  const group=new T.Group(),b=batch(group);
  for(const {at:[x,z]} of s.levellers){
    const [w,d]=s.levelSize;
    b.box(x,.23,z,w,.46,d,frame);b.box(x,.49,z,w,.06,d,platform);
    b.box(x,.52,z+d*.5-.08,w,.025,.14,amber);
  }
  for(const path of s.handoffs) for(let i=1;i<path.length;i++)conveyor(b,path[i-1],path[i],s.deck,s.deck,s.rollerWidth,'roller');
  b.finish();return group;
}

function breakdownTables(spec) {
  const group=new T.Group(),b=batch(group);
  for(const {at:[x,z],rotated} of spec.places){
    const [w,d]=rotated?[...spec.size].reverse():spec.size;
    b.box(x,spec.height*.40,z,w,spec.height*.8,d,frame);
    const cw=w/3,cd=d/3;
    for(let i=-1;i<=1;i++) for(let j=-1;j<=1;j++){
      const cx=x+i*cw,cz=z+j*cd;
      for(let k=-2;k<=2;k++) b.roller([cx-cw*.43,spec.height-.035,cz+k*cd*.17],[cx+cw*.43,spec.height-.035,cz+k*cd*.17],.035);
    }
  }
  b.finish();return group;
}

export function createCargoPlant(data,scenes) {
  return {sorting:sorterPlant(data.sorter,scenes),pallet:palletPlant(data.pallet,scenes),dock:dockPlant(data.dock),tables:breakdownTables(data.tables)};
}
