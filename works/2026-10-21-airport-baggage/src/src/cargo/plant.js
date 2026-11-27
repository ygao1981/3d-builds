import * as T from 'three';
import {buildInduction,pathAt,scanner} from './induction.js';
import {makeChainBank} from './chain.js';
import {createDockOperations,createPackingOperations,createChutePacking} from './workcells.js';
import { palletCycle } from './pallet-motion.js';
import { measureRollers } from '../simready-rollers.js';

import {frame,belt,steel,side,amber,platform,unitBox,lerp,mod,distance,batch,conveyor,fitted,metal} from './hardware.js';
// Rest the rigid carton on the slope, including when its front and back cross a change of grade.
function chutePose(box,head,tail,u,spec){
  const run=distance(head,tail),s=u*run,knee=run-(spec.chuteFlat??.50);
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

function sorterPlant(spec,scenes,site) {
  const group=new T.Group(), b=batch(group), loop=loopGeometry(spec), {deck,width}=spec;
  const spans=148;
  for(let i=0;i<spans;i++){
    const a=loop.at(i*loop.length/spans), c=loop.at((i+1)*loop.length/spans);
    for(const sign of [-1,1]){
      const pos=(p,off,y)=>[p[0]-p[3]*off*sign,y,p[1]+p[2]*off*sign];
      b.beam(pos(a,width*.47,deck-.26),pos(c,width*.47,deck-.26),.16,.30,frame);
      const walkway=sign===1?1.18:.88;
      const opening=sign===1 && (spec.feeds.some(([,j])=>Math.abs(a[1]-j[1])<.5 && Math.abs(a[0]-j[0]-1.45)<2.8) ||
        spec.chutes.some(([h])=>Math.abs(a[1]-spec.radius)<.4 && Math.abs(a[0]-h[0])<spec.chuteWidth*.8));
      if(!opening)b.beam(pos(a,width*.50+walkway/2,deck-.69),pos(c,width*.50+walkway/2,deck-.69),walkway,.12,platform);
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
  const speed=1.48,induction=buildInduction(b,group,spec,site,speed);
  const chuteSections=[new T.Group(),new T.Group()],chuteSteel=chuteSections.map(batch);
  group.add(...chuteSections);
  for(const [i,[a,c]] of spec.chutes.entries()) {
    const cb=chuteSteel[Math.abs(i-(spec.chutes.length-1)/2)<=2?0:1];
    const knee=1-(spec.chuteFlat??.50)/distance(a,c);
    const mid=[lerp(a[0],c[0],knee),lerp(a[1],c[1],knee)];
    conveyor(cb,a,mid,spec.chuteTop,spec.chuteBottom,spec.chuteWidth,'roller');
    conveyor(cb,mid,c,spec.chuteBottom,spec.chuteBottom,spec.chuteWidth,'roller');
    cb.box(c[0],spec.chuteBottom+.054,c[1]+.021,spec.chuteWidth,.108,.04,side);
  }
  chuteSteel.forEach(s=>s.finish());
  const translucent=new Map(),chuteParts=chuteSections.map(g=>g.children.map(mesh=>{
    const solid=mesh.material;
    if(!translucent.has(solid)){
      const ghost=solid.clone();ghost.transparent=true;ghost.opacity=.16;ghost.depthWrite=false;
      translucent.set(solid,ghost);
    }
    return {mesh,solid,ghost:translucent.get(solid)};
  }));
  function section(level){
    chuteParts.forEach((parts,i)=>parts.forEach(({mesh,solid,ghost})=>{
      mesh.material=level>i?ghost:solid;mesh.castShadow=level<=i;
    }));
  }
  for(const path of spec.returns) for(let i=1;i<path.length;i++){
    const a=path[i-1],c=path[i];conveyor(b,a,c,a[2],c[2],1.2,'belt',distance(a,c)>.8 || i%8===0);
  }
  const [sx,sz]=spec.scanner;
  scanner(b,sx,sz,deck,width,false,true);
  b.finish();
  const cartons=Object.entries(scenes).filter(([id])=>id.startsWith('box_cardboard_')).map(([id,scene])=>{
    const model=fitted(scene,.54,.36,.47,true);model.name=id;return model;
  });
  const loads=Array.from({length:Math.min(18,spec.carts)},(_,i)=>{
    const box=cartons[(i+Math.floor(i/spec.chutes.length))%cartons.length].clone(true);group.add(box);
    return {box,slot:Math.floor(i*spec.carts/18),inlet:i%spec.feeds.length,outlet:i%spec.chutes.length};
  });
  const tmp=new T.Object3D(),phase=.55;
  const transit=induction.through.map((route,i)=>{
    const length=route.slice(1).reduce((sum,p,j)=>sum+distance(route[j],p),0);
    const box=cartons[i%cartons.length].clone(true);group.add(box);
    return {route,length,box,offset:i?11:3};
  });
  const cycle=loop.length/speed, chosen=loads.find(l=>l.outlet===Math.floor(spec.chutes.length/2)) || loads[0];
  const [,join]=spec.feeds[chosen.inlet],head=spec.chutes[chosen.outlet][0];
  const when=s=>mod((s-chosen.slot*loop.length/spec.carts)/speed,cycle);
  const cues={
    feed:{view:'sorting',focus:chosen.inlet,time:mod(when(spec.right-join[0])-3.7,cycle)},
    unload:{view:'chutes',focus:chosen.outlet,time:mod(when(loop.straight+loop.arc+head[0]-spec.left-speed*phase)-.8,cycle)},
  };
  function update(t) {
    for(const {route,length,box,offset} of transit){
      const half=box.userData.size[0]/2,u=mod(t*.78+offset,length+5);
      box.visible=u<length+2;
      const s=Math.min(length-half,Math.max(half,u));
      const [x,z,yaw,y]=pathAt(route,s/length);
      const before=pathAt(route,(s-half)/length),after=pathAt(route,(s+half)/length);
      const tilt=Math.atan2(after[3]-before[3],2*half);
      box.rotation.set(0,yaw,tilt,'YXZ');box.position.set(x,Math.max(y,(before[3]+after[3])/2),z);
    }
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
      const profile=induction.profiles[inlet],carry=(releaseS-feedS)/speed,incoming=profile.duration;
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
        const u=profile.distanceAt(age+incoming-cycle)/profile.length,[x,z,yaw,height]=pathAt(induction.routes[inlet],u);
        box.position.set(x,height,z);box.rotation.y=yaw;
      } else box.visible=false;
    }
  }
  cells.frustumCulled=edges.frustumCulled=false;
  if(site?.distribution)cues.distribute={view:'sorting',focus:spec.feeds.length+1,
    time:mod(when(spec.right-join[0])-induction.profiles[chosen.inlet].duration+1.1,cycle)};
  if(site)cues.meter={view:'sorting',focus:spec.feeds.length,time:2.6};
  const arrivals=loads.map(({box,slot,outlet})=>{
    const release=loop.straight+loop.arc+spec.chutes[outlet][0][0]-spec.left-speed*phase;
    return {box,outlet,period:cycle,at:mod((release-slot*loop.length/spec.carts)/speed+phase+4.8,cycle)};
  });
  function disposeSection(){section(0);translucent.forEach(m=>m.dispose());}
  update(0);return {group,update,loop,loads,cues,induction,arrivals,transit,section,chuteSections,disposeSection};
}

function flatPlasticPallet(){
  const model=new T.Group(),b=batch(model);
  const pp=metal('#527884',.73,.015),grip=metal('#486b76',.86,.01);
  model.name='N04 平面塑料托盘';
  b.box(0,.1275,0,1.20,.035,1.00,pp);
  for(const z of [-.422,0,.422]){
    b.box(0,.011,z,1.2,.022,.156,pp);
    for(const x of [-.523,0,.523])b.box(x,.066,z,.154,.088,.156,pp);
  }
  for(const z of [-.35,0,.35])b.box(0,.1445,z,.90,.001,.022,grip);
  b.finish();
  return model;
}

function palletPlant(s,scenes) {
  const group=new T.Group(), b=batch(group), wheels=[], movers=[],banks=[];
  const emptyPallet=flatPlasticPallet();
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
    banks.push(makeChainBank(group,b,s,ports));
    for(const [dx,dz] of [[-.68,-.64],[-.68,.64],[.68,-.64],[.68,.64]])b.box(stack[0]+dx,1.25,stack[1]+dz,.10,2.5,.10,side);
    b.box(stack[0],2.46,stack[1]-.64,1.46,.10,.12,amber);b.box(stack[0],2.46,stack[1]+.64,1.46,.10,.12,amber);
    const jaws=[-1,1].map(side=>{
      const jaw=new T.Group(),steelwork=batch(jaw);
      steelwork.box(0,0,side*.09,1.06,.095,.12,amber);
      for(const x of [-.39,.39])steelwork.box(x,0,-side*.035,.09,.045,.28,steel);
      steelwork.finish();group.add(jaw);return jaw;
    });
    const loads=ports.map(()=>emptyPallet.clone(true));group.add(...loads);
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
    movers.forEach((machine,i)=>{machine.update(t);banks[i].update(t,machine);});
  }
  const first=movers[0].trips[0];
  const cues={
    release:{view:'pallet',focus:0,time:first.begin-.25},
    turn:{view:'pallet',focus:s.stackers.length,time:first.turnAt-1},
    chain:{view:'pallet',focus:s.stackers.length+s.turns.length+s.transfers.length,time:(first.chainAt+first.outletAt)/2-1},
    transfer:{view:'pallet',focus:s.stackers.length+s.turns.length+first.outlet,time:first.outletAt-1.5},
  };
  update(0);return {group,update,movers,cues,wheels,banks};
}

function dockPlant(s) {
  const group=new T.Group(),b=batch(group);
  for(const {at:[x,z]} of s.levellers){
    const [w,d]=s.levelSize;
    b.box(x,.009,z,w+.08,.017,d+.06,frame);b.box(x,.028,z,w,.026,d,platform);
    b.box(x,.048,z-d*.5-.14,w,.050,.36,steel);
    for(const side of [-1,1])b.box(x+side*(w/2-.04),.047,z,.065,.012,d,amber);
  }
  for(const path of s.handoffs) for(let i=2;i<path.length;i++)conveyor(b,path[i-1],path[i],s.deck,s.deck,s.rollerWidth,'roller');
  b.finish();return group;
}

function breakdownTables(spec) {
  const group=new T.Group(),b=batch(group);
  for(const {at:[x,z],rotated} of spec.places){
    const [w,d]=rotated?[...spec.size].reverse():spec.size;
    b.box(x,spec.height*.40,z,w,spec.height*.8,d,frame);
    const [fullW,fullD]=spec.size,cw=(fullW-2*.24)/3,cd=(fullD-2*.13)/3;
    const at=(u,v)=>rotated?[x-v,spec.height-.035,z+u]:[x+u,spec.height-.035,z+v];
    for(let i=-1;i<=1;i++) for(let j=-1;j<=1;j++){
      const cx=i*(cw+.24),cz=j*(cd+.13);
      for(let k=-2;k<=2;k++)b.roller(at(cx-cw*.47,cz+k*cd*.19),at(cx+cw*.47,cz+k*cd*.19),.035);
    }
  }
  b.finish();return group;
}

export function createCargoPlant(data,scenes) {
  const sorting=sorterPlant(data.sorter,scenes,data.site),pallet=palletPlant(data.pallet,scenes);
  const dock=dockPlant(data.dock),tables=breakdownTables(data.tables);
  const nearChute=data.sorter.chutes[Math.floor(data.sorter.chutes.length/2)][1];
  const chutePacking=createChutePacking(sorting,pallet,data);
  sorting.cues.stack={view:'chutes',focus:data.sorter.chutes.length,time:chutePacking.firstArrival-.8};
  return {sorting,pallet,dock,tables,chutePacking,dockOps:createDockOperations(dock,data.dock,scenes),
    packing:createPackingOperations(tables,data.tables,scenes,nearChute)};
}
