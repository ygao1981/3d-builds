import * as T from 'three';
import {amber,batch,conveyor,dark,fitted,frame,lerp,metal,mod,side,steel,unitBox} from './hardware.js';
import {scanner} from './induction.js';
import {riggedOperator,walkingRoute} from './worker.js';

const kraft=[metal('#bf9056',.91,0),metal('#ac7843',.91,0),metal('#cfaa78',.91,0)];
const tape=metal('#dbb980',.74,.02),paper=metal('#ede9db',.91,0),rubber=metal('#252d31'),wood=metal('#896545');
const paint=[metal('#366c75'),metal('#4e647c'),metal('#b79053')];
const net=metal('#34574c',.88,.02),body=metal('#e1e2d9',.67,.22);
const smooth=t=>{t=T.MathUtils.clamp(t,0,1);return t*t*(3-2*t);};
const phase=(t,a,b)=>smooth((t-a)/(b-a));

export function carton(b,x,y,z,w,h,d,i=0){
  b.box(x,y+h/2,z,w,h,d,kraft[i%kraft.length]);
  b.box(x,y+h+.003,z,w*.13,.007,d,tape);
  b.box(x,y+h*.57,z+d/2+.004,w*.24,h*.24,.009,paper);
}
export function palletBase(b,x,y,z,w,d){
  for(const k of [-.43,0,.43])b.box(x+k*w,y+.056,z,.09,.108,d,wood);
  for(let k=0;k<6;k++)b.box(x,y+.124,z+(k-2.5)*d/6,w,.035,d*.14,tape);
}

// A metal air-cargo board, cartons, and crossed restraint straps. y always denotes its support surface.
export function board(b,x,y,z,w,d,layers,strapped,seed=0){
  b.box(x,y+.025,z,w,.05,d,steel);
  for(const s of [-1,1])b.box(x,y+.058,z+s*(d/2-.027),w,.036,.052,dark);
  const cw=(w-.13)/3,cd=(d-.15)/3,h=.43,base=y+.06;
  for(let k=0;k<layers;k++){
    for(let i=0;i<3;i++)for(let j=0;j<3;j++){
      if(!strapped && k===layers-1 && (i*2+j+seed)%4===1)continue;
      carton(b,x+(i-1)*cw,base+h*k,z+(j-1)*cd,cw-.025,h-.009,cd-.026,seed+i+2*j+k);
    }
  }
  if(!strapped || !layers)return;
  const top=base+layers*h+.014,ww=w*.485,dd=d*.48;
  for(let i=0;i<5;i++){
    const dx=(i-2)*ww*.41;
    b.beam([x+dx,top,z-dd],[x+dx,top,z+dd],.038,.018,net);
    for(const sign of [-1,1])for(const dir of [-1,1]){
      const end=T.MathUtils.clamp(dx+dir*ww*.40,-ww,ww);
      b.beam([x+dx,top,z+sign*dd],[x+end,y+.075,z+sign*(dd+.035)],.027,.025,net);
    }
  }
  for(let i=-2;i<=2;i++){
    const dz=i*dd*.42;
    b.beam([x-ww,top+.008,z+dz],[x+ww,top+.008,z+dz],.03,.017,net);
    for(const sign of [-1,1])for(const dir of [-1,1]){
      b.beam([x+sign*ww,top,z+dz],[x+sign*(ww+.035),y+.075,z+T.MathUtils.clamp(dz+dir*dd*.40,-dd,dd)],.027,.025,net);
    }
  }
}

export function forkTruck(assets){
  const vehicle=new T.Group();
  if(assets.vehicle_forklift_red_c01){
    const model=assets.vehicle_forklift_red_c01.clone(true);vehicle.add(model);
    // Match the low carrying position of the fork tines to the pallet openings.
    const forks=['sm_fork1_c01_obj_00','sm_fork2_c01_obj_00'].map(n=>model.getObjectByName(n));
    const floor=new T.Box3().setFromObject(model,true).min.y;model.position.y=-floor;
    model.updateWorldMatrix(true,true);
    const point=new T.Vector3(),calibrated=[];
    for(const f of forks.filter(Boolean)){
      let bladeTop=-Infinity;
      f.traverse(mesh=>{
        if(!mesh.isMesh)return;
        for(let i=0;i<mesh.geometry.attributes.position.count;i++){
          mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld);
          if(point.z>1.82 && point.z<2.50)bladeTop=Math.max(bladeTop,point.y);
        }
      });
      if(!Number.isFinite(bladeTop)){
        const bounds=new T.Box3().setFromObject(f,true);bladeTop=bounds.min.y+.05;
      }
      calibrated.push({node:f,rest:f.position.y,bladeTop});
    }
    vehicle.userData.setForkHeight=y=>{for(const {node,rest,bladeTop} of calibrated)node.position.y=rest+y-bladeTop;};
  }else{
    const b=batch(vehicle);
    b.box(0,.52,-.1,1.06,.73,1.75,amber);b.box(0,1.95,-.16,1.08,.10,1.38,frame);
    for(const x of [-.49,.49]){
      b.box(x,1.46,.46,.06,1.05,.06,frame);b.box(x,1.35,-.72,.06,1.22,.06,frame);
      b.box(x*.75,1.20,1.12,.09,2.30,.14,frame);
      for(const z of [-.65,.65])b.roller([x-.095,.25,z],[x+.095,.25,z],.25,rubber);
    }
    b.finish();
    const blades=new T.Group(),parts=batch(blades);
    for(const x of [-.29,.29])parts.box(x,-.025,1.9,.12,.05,1.45,dark);
    parts.finish();vehicle.add(blades);vehicle.userData.setForkHeight=y=>{blades.position.y=y;};
  }
  return vehicle;
}

function truck(b,x,y,tail,color,woodenPallet){
  // Cutaway on the loading side exposes the truck bed and the load.
  const bed=y+.04,depth=6.3,z=tail-depth/2;
  b.box(x,bed-.1,z,2.47,.2,depth,frame);b.box(x,bed+.012,z,2.42,.024,depth,wood);
  b.box(x-1.17,bed+1.22,z,.075,2.44,depth,body);
  b.box(x,bed+1.22,tail-depth,2.4,2.44,.08,body);
  for(const dz of [.14,1.55,3.12,4.7,6.18])b.box(x-1.22,bed+1.22,tail-dz,.045,2.42,.055,steel);
  for(const sign of [-1,1])b.box(x+sign*1.2,bed+2.45,z,.06,.08,depth,steel);
  b.box(x,bed+2.45,tail-depth+.42,2.47,.075,.85,body);
  const cab=tail-depth-1.26;
  b.box(x,bed+.23,cab,2.38,1.20,2.28,color);
  b.box(x,bed+1.26,cab+.1,2.31,1.12,1.95,color);
  b.box(x,bed+1.43,cab-.9,2.07,.62,.028,dark);
  for(const sign of [-1,1]){
    b.box(x+sign*1.163,bed+1.4,cab-.14,.023,.58,1.12,dark);
    b.box(x+sign*.82,bed+.06,cab-1.149,.39,.16,.037,paper);
    for(const dz of [1.12,2.31,depth+1.1]){
      const xx=x+sign*1.06;
      b.roller([xx-.15,bed-.64,tail-dz],[xx+.15,bed-.64,tail-dz],.43,rubber);
      b.roller([xx-.158,bed-.64,tail-dz],[xx+.158,bed-.64,tail-dz],.22,steel);
    }
  }
  for(const dx of [-.55,.55])for(const dz of [3.6,4.75]){
    if(woodenPallet && dx<0 && dz===3.6)woodenPallet.position.set(x+dx,bed+.025,tail-dz);
    else palletBase(b,x+dx,bed+.025,tail-dz,.99,1.05);
    for(let k=0;k<2;k++)carton(b,x+dx,bed+.167+k*.52,tail-dz,.93,.51,.96,k);
  }
}

function liftingHandoff(group,path,s,index){
  const [a,c]=path, mid=(a[1]+c[1])/2, width=s.rollerWidth;
  const table=new T.Group(), deck=batch(table);
  table.position.set(a[0],0,mid);table.name='整板箱升降交接辊道 '+(index+1);
  const half=(c[1]-a[1])/2;
  conveyor(deck,[0,-half],[0,half],0,0,width,'roller',false);
  for(const sign of [-1,1])deck.box(sign*(width/2-.045),-.20,0,.09,.19,half*2,side);
  deck.finish();group.add(table);
  const base=-1.48, armLength=3.16;
  const arms=[-1,1].flatMap(side=>[-1,1].map(diagonal=>{
    const arm=new T.Mesh(unitBox,steel);arm.scale.set(.095,.13,armLength);
    arm.position.set(a[0]+side*(width*.33+diagonal*.052),0,mid);group.add(arm);
    return {arm,diagonal};
  }));
  const uld=new T.Group(),unit=batch(uld);board(unit,0,0,0,2.43,3.16,index?2:3,true,index*4);unit.finish();group.add(uld);
  const low=-.492,high=s.deck,verticalSpeed=.05,beltSpeed=.30;
  const z0=a[1]+1.63,z1=path.at(-1)[1]-1.63;
  const liftTime=(high-low)/verticalSpeed,moveAt=2+liftTime+1;
  const lowerAt=moveAt+(c[1]+1.58+.05-z0)/beltSpeed;
  const delivered=moveAt+(z1-z0)/beltSpeed;
  const period=Math.max(lowerAt+liftTime,delivered+3)+3;
  function update(time){
    const t=mod(time+index*period*.48,period);
    const y=low+Math.min(high-low,Math.max(0,t-2)*verticalSpeed)-Math.min(high-low,Math.max(0,t-lowerAt)*verticalSpeed);
    table.position.y=y;
    const rise=y-.245-base;
    for(const {arm,diagonal} of arms){
      arm.position.y=base+rise/2;arm.rotation.x=diagonal*Math.asin(rise/armLength);
    }
    const z=Math.min(z1,z0+Math.max(0,t-moveAt)*beltSpeed);
    uld.position.set(a[0],z<c[1]?y:high,z);uld.visible=t<delivered+3;
  }
  return {table,uld,update,moveAt,lowerAt,period};
}

export function createDockOperations(group,s,assets){
  const b=batch(group);
  const used=s.levellers.map((p,i)=>({p,i})).filter(({i})=>i%3===1);
  // Choose a dock close to the actual whole-board handoff lines for the opening shot.
  const hx=s.handoffs[0][0][0];
  const active=s.levellers.reduce((best,p,i)=>Math.abs(p.at[0]-hx)<Math.abs(s.levellers[best].at[0]-hx)?i:best,0);
  if(!used.some(u=>u.i===active))used.push({p:s.levellers[active],i:active});
  const truckPallet=fitted(assets.pallet_a01,.99,.142,1.05);group.add(truckPallet);
  for(const {p:{at:[x,z]},i} of used)truck(b,x,0,z-s.levelSize[1]/2-.18,paint[i%3],i===active?truckPallet:null);
  const [x,z]=s.levellers[active].at, vehicle=forkTruck(assets);group.add(vehicle);
  const cargo=new T.Group();cargo.name='货车卸下的托货';group.add(cargo);
  const pack=batch(cargo);palletBase(pack,0,0,0,1.02,1.08);
  for(let j=0;j<3;j++)for(const sign of [-1,1])carton(pack,sign*.245,.145+j*.37,0,.478,.36,.96,j);
  pack.finish();vehicle.rotation.y=Math.PI;
  const lifts=s.handoffs.map((path,i)=>liftingHandoff(group,path,s,i));
  b.finish();
  const drop=z+5.5,pick=z-3.35;
  function update(time,dispatch=false){
    const t=mod(dispatch?-time:time,30);
    let loadZ=pick, forkZ;
    if(t<6){forkZ=lerp(z+5.6,pick+1.94,phase(t,0,6));}
    else if(t<17){loadZ=lerp(pick,drop,phase(t,6,17));forkZ=loadZ+1.94;}
    else{loadZ=drop;forkZ=lerp(drop+1.94,drop+4.3,phase(t,17,22));}
    const lift=.065*phase(t,5.6,6.6)*(1-phase(t,16.3,17.3));
    vehicle.position.set(x,0,forkZ);cargo.position.set(x,lerp(.065,.004,phase(loadZ,pick,drop))+lift,loadZ);
    vehicle.userData.setForkHeight(cargo.position.y+.1065-.035*(1-phase(t,5.5,6)+phase(t,17,18)));
    for(const lift of lifts)lift.update(time);
    if(t>23)vehicle.position.z=lerp(drop+4.3,z+5.6,phase(t,23,29));
  }
  return {active,vehicle,cargo,uld:lifts[0].uld,lifts,update,cues:{truck:{view:'dock',focus:active,time:5.8},
    raise:{view:'dock',focus:s.levellers.length,time:5},handoff:{view:'dock',focus:s.levellers.length,time:lifts[0].moveAt+15}}};
}

export function operator(parent,model){
  if(model)return riggedOperator(parent,model);
  // Older, offline companion packs can still show the activity with a simplified figure.
  const figure=new T.Group(),coat=metal('#df9e32',.83,0),trousers=metal('#344956',.88,0),skin=metal('#b98867',.85,0);
  const b=batch(figure);b.box(0,1.09,0,.37,.55,.24,coat);b.box(0,1.02,.003,.378,.061,.246,paper);
  for(const x of [-.105,.105]){b.box(x,.45,0,.155,.80,.185,trousers);b.box(x,.085,.03,.17,.13,.26,rubber);}
  b.roller([0,1.39,0],[0,1.61,0],.117,skin);b.roller([0,1.60,0],[0,1.68,0],.144,amber);b.finish();
  const arms=[-1,1].map(sign=>{
    const shoulder=new T.Vector3(sign*.17,1.29,0);
    const joints=[new T.Mesh(new T.CapsuleGeometry(.072,.12,3,8),coat),new T.Mesh(new T.CapsuleGeometry(.056,.12,3,8),skin)];
    figure.add(...joints);return {sign,shoulder,joints};
  });
  parent.add(figure);
  return {figure,pose({height,reach,halfWidth,grip}){
    const y=lerp(.83,height,grip),forward=lerp(.10,reach,grip);
    for(const {sign,shoulder,joints} of arms){
      const elbow=new T.Vector3(sign*.234,(1.19+y)/2,forward*.42),hand=new T.Vector3(sign*lerp(.24,halfWidth,grip),y,forward);
      [elbow,hand].forEach((to,i)=>{const from=i?elbow:shoulder,obj=joints[i],delta=to.clone().sub(from);
        obj.position.copy(from).lerp(to,.5);obj.scale.y=delta.length()/.24;
        obj.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize());});
    }
  }};
}

export function createChutePacking(sorting,pallet,data,workerModel){
  const group=new T.Group();sorting.group.add(group);
  const machine=pallet.movers[0],trip=machine.trips[0],port=trip.outlet;
  const tail=data.sorter.chutes[port][1],at=trip.stop.map((v,i)=>v+data.pallet.offset[i]);
  const top=data.pallet.deck+.145,destination=[at[0],top,at[1]];
  const candidates=sorting.arrivals.filter(e=>e.outlet===port).map(e=>{
    const parcel=e.box.clone(true);parcel.rotation.set(0,0,0);parcel.visible=false;group.add(parcel);
    const path=walkingRoute([[tail[0]+.76,tail[1]-e.box.userData.size[2]/2],[at[0]+.76,at[1]]]);
    return {...e,parcel,path};
  });
  function next(start){
    let chosen,best=Infinity;
    for(const e of candidates){
      const time=start+mod(e.at-start,e.period);
      if(time<best){chosen=e;best=time;}
    }
    return {event:chosen,at:best};
  }
  const worker=operator(group,workerModel);worker.figure.rotation.y=-Math.PI/2;
  function update(time){
    const local=mod(time+machine.offset,machine.cycle);
    const {event,at:arrival}=next(time-local+trip.finish+.20);
    const age=time-arrival,sz=event.box.userData.size;
    const startZ=tail[1]-sz[2]/2;
    const ready=local>=trip.finish && local<trip.end && age>=0;
    const carry=ready?phase(age,1,5):0,lower=ready?phase(age,5,6.4):0;
    const x=lerp(tail[0],at[0],carry),z=lerp(startZ,at[1],carry);
    const y=lerp(data.sorter.chuteBottom,top,lower)+(ready?.055*phase(age,0,1)*(1-lower):0);
    for(const e of candidates)e.parcel.visible=ready && e===event;
    if(ready){
      // The sorter recycles its display object on the next lap. Transfer its identical carton at rest.
      if(age<.86)event.box.visible=false;
      event.parcel.position.set(x,y,z);
    }
    const progress=ready?carry*(1-phase(age,6.6,10)):0;
    event.path.getPoint(progress,worker.figure.position);
    const grip=ready?phase(age,0,.45)*(1-phase(age,6.4,7.1)):0;
    worker.pose({time,height:y+sz[1]*.48,reach:.76-Math.min(.095,sz[0]*.23),halfWidth:sz[2]/2,
      grip,path:event.path,progress});
  }
  const firstArrival=next(trip.finish-machine.offset+.20).at;
  return {group,worker,update,firstArrival,port,candidates,destination};
}

export function createPackingOperations(group,s,assets,nearChute,inboundTables=[]){
  const b=batch(group);
  const world=(p)=>[p.at[0]+s.offset[0],p.at[1]+s.offset[1]];
  const active=s.places.reduce((best,p,i)=>{
    const cost=p=>{const [x,z]=world(p);return z>nearChute[1]+4?Math.hypot(x-nearChute[0],z-nearChute[1]):Infinity;};
    return cost(p)<cost(s.places[best])?i:best;
  },0);
  const [ax,az]=s.places[active].at;
  s.places.forEach(({at:[x,z],rotated},i)=>{
    if(inboundTables.includes(i))return;
    const [w,d]=rotated?[...s.size].reverse():s.size;
    if(i===active){
      b.box(x,s.height+.025,z,w*.92,.05,d*.92,steel);
      // Leave the near corner open for the carton carried by the operator.
      for(const dx of [-.72,0,.72])for(const dz of [-.78,0])for(let k=0;k<2;k++)carton(b,x+dx,s.height+.05+k*.38,z+dz,.69,.37,.74,i+k);
    }else if(i%5!==2)board(b,x,s.height,z,w*.92,d*.92,1+i%4,i%3!==0,i);
  });
  const supply=[ax+2.65,az+.77],landing=[ax+1.02,az+.79],surface=s.height+.05;
  const delivery=new T.Group(),pallet=batch(delivery);
  palletBase(pallet,0,0,0,.97,1.10);
  for(let k=0;k<2;k++)carton(pallet,0,.145+k*.35,0,.82,.34,.83,k);
  pallet.finish();group.add(delivery);
  const worker=operator(group,assets.worker),box=fitted(assets.box_cardboard_a01,.49,.39,.42,true);
  group.add(box);
  const vehicle=forkTruck(assets);
  vehicle.position.set(supply[0],0,supply[1]-1.96);group.add(vehicle);
  b.finish();
  const yaw=-Math.PI/2,size=box.userData.size;
  // Step around the delivery pallet, then approach the open corner of the build-up table.
  const pickReach=.76,placeReach=.68;
  const aisle=walkingRoute([[supply[0]+pickReach,supply[1]],[supply[0]+pickReach,supply[1]+.91],
    [landing[0]+placeReach,landing[1]+.91],[landing[0]+placeReach,landing[1]]]);
  const carryingPoint=new T.Vector3();worker.figure.rotation.y=yaw;
  const pickupZ=Math.min(supply[1]-1.8,nearChute[1]-s.offset[1]+2.15);
  function update(time){
    const cycle=mod(time,35),t=T.MathUtils.clamp(cycle-9,0,18);
    const approach=phase(cycle,.5,7.5),retreat=phase(cycle,8,13);
    delivery.position.set(supply[0],.004+.054*(1-phase(cycle,7.2,8)),lerp(pickupZ,supply[1],approach));
    vehicle.position.set(supply[0],0,delivery.position.z-1.94-2.05*retreat);
    vehicle.userData.setForkHeight(delivery.position.y+.1065-.035*retreat);
    const walk=phase(t,3,9),back=phase(t,12.5,17.9);
    const reach=lerp(pickReach,placeReach,walk)-.18*Math.sin(Math.PI*walk);
    aisle.getPoint(walk,carryingPoint);
    const y=lerp(.845,1.01,phase(t,1.2,3))+(surface-1.01)*phase(t,9,11.5);
    box.position.set(carryingPoint.x-reach,y+(1-walk)*delivery.position.y,
      carryingPoint.z+(cycle<9?delivery.position.z-supply[1]:0));
    const progress=walk-back;
    aisle.getPoint(progress,worker.figure.position);
    const grip=phase(cycle,8.0,10.15)*(1-phase(t,11.55,12.5));
    worker.pose({time,height:box.position.y+size[1]*.47,reach:reach-Math.min(.09,size[0]*.22),
      halfWidth:size[2]/2,grip,path:aisle,progress});
  }
  return {active,supply,landing,vehicle,delivery,box,worker,update,cues:{supply:{view:'tables',focus:active,time:.7},build:{view:'tables',focus:active,time:11.1}}};
}

export function fitReceipt(group,at,assets,extension=0,index=0,dockZ=0,parkedTruck=true){
  const b=batch(group),[x,z]=at,w=.8,h=.8;
  const start=extension?-11.8-extension:-3.3,end=extension?2.4:3.2;
  const spans=extension?[[-11.8,-4.8],[-4.8,-2.8],[-2.8,-.8],[-.8,.8],[.8,end]]:[[-3.3,-1],[-1,-.8],[-.8,.8],[.8,end]];
  for(const [a,c] of spans)conveyor(b,[x,z+a],[x,z+c],h,h,w);
  if(extension){
    // Three nested stages extend the fixed receiving body toward the dock.
    const step=extension/3;
    for(let j=0;j<3;j++){
      const nose=-11.8-(j+1)*step;
      conveyor(b,[x,z+nose],[x,z+nose+step],h,h,w,'belt',false);
      for(const sign of [-1,1])b.box(x+sign*(.55-.04*j),h-.17+.035*j,z+nose+step/2,.061,.14,step,steel);
    }
    for(const sign of [-1,1])b.box(x+sign*.58,h-.20,z-8.3,.115,.23,7,side);
    b.roller([x-.39,h-.034,z+start+.033],[x+.39,h-.034,z+start+.033],.034);
    if(parkedTruck && z+start<dockZ-.35)truck(b,x,0,dockZ-.18,paint[index%paint.length]);
  }
  scanner(b,x,z-.82,h,w,true);
  for(const sign of [-1,1]){
    b.box(x+sign*.52,h-.15,z,.10,.15,1.6,amber);
    for(const dz of [-.63,.63])b.box(x+sign*.43,h-.24,z+dz,.15,.10,.19,steel);
  }
  b.box(x+.82,.64,z,.068,1.28,.068,frame);b.box(x+.82,1.45,z,.67,.39,.14,dark);
  const screen=document.createElement('canvas');screen.width=256;screen.height=104;
  const ctx=screen.getContext('2d'),tex=new T.CanvasTexture(screen);tex.colorSpace=T.SRGBColorSpace;
  const display=new T.Mesh(new T.PlaneGeometry(.595,.30),new T.MeshBasicMaterial({map:tex,toneMapped:false}));
  display.position.set(x+.82,1.45,z+.071);group.add(display);
  b.finish();const item=fitted(assets.box_cardboard_a01,.45,.36,.44,true);group.add(item);
  const speed=.5,phaseOffset=-2.9+index*2.7;
  let last;
  const line={item,start,end,at,outfeed:null,timeAt:offset=>(offset-phaseOffset)/speed,update(t){
    const reach=end+(line.outfeed?.length || 0);
    const offset=extension?start+.24+mod(t*speed+phaseOffset-start-.24,reach-start-.48):-2.9+mod(t,11.5)*speed;
    item.position.set(x,h,z+offset);
    if(line.outfeed)line.outfeed.update(item,offset-end,t);
    const state=Math.abs(offset)<.65?'称重中':offset>=-1.2 && offset<-.65?'读码中':'待料';
    if(last===state)return;
    ctx.fillStyle='#183731';ctx.fillRect(0,0,256,104);ctx.fillStyle='#b6e1b3';ctx.textAlign='center';
    ctx.font='bold 45px "Microsoft YaHei",sans-serif';ctx.fillText(state,128,68);tex.needsUpdate=true;last=state;
  }};
  return line;
}

export function dressStaging(batch,site){
  site.staging.forEach(({at:[x,z],size:[w,d]},i)=>{
    for(const sign of [-1,1]){
      batch.box(x,.007,z+sign*d/2,w,.014,.043,amber);batch.box(x+sign*w/2,.007,z,.043,.014,d,amber);
    }
    if(i%4===1)return;
    const count=w>3?3:2,depth=d>3?2:1,pw=(w-.16)/count,pd=Math.min(1.15,(d-.12)/depth);
    for(let a=0;a<count;a++)for(let j=0;j<depth;j++){
      const cx=x+(a-(count-1)/2)*pw,cz=z+(j-(depth-1)/2)*pd;
      palletBase(batch,cx,.009,cz,pw-.08,pd-.06);
      const n=1+(a+j+i)%3;
      for(let k=0;k<n;k++)carton(batch,cx,.15+k*.48,cz,pw-.11,.47,pd-.10,i+k);
    }
  });
}

// Four accumulation lanes with bidirectional roller transfers at their drawn ends.
export function parcelBuffer(group,b,site,sorter,assets){
  const eq=site.distributionEquipment,bank=eq.buffer;
  const [left]=bank.left,[right]=bank.right,h=.80,centres=[];
  function transfer(x,z){
    b.box(x,h-.15,z,1.44,.19,1.16,frame);
    for(let j=0;j<10;j++){
      const xx=x+(j-4.5)*.143;
      b.roller([xx,h-.045,z-.56],[xx,h-.045,z+.56],.045);
    }
    for(const off of [-.36,.36])b.box(x+off,h-.012,z,.058,.030,1.12,dark);
    for(const dx of [-.54,.54])for(const dz of [-.41,.41])b.box(x+dx,.30,z+dz,.075,.60,.075,frame);
    centres.push([x,z]);
  }
  for(const [i,z] of bank.rows.entries()){
    const end=i===3?bank.returnEnd:right;
    transfer(left,z);transfer(end,z);
    const mid=(left+end)/2;
    conveyor(b,[left+.72,z],[mid-.006,z],h,h,1);
    conveyor(b,[mid+.006,z],[end-.72,z],h,h,1);
    for(let j=0;j<3+i%2;j++)carton(b,left+2.1+j*2.2+i*.51,h,z,.48,.33,.39,j+i);
    if(i){
      const prev=bank.rows[i-1];
      conveyor(b,[left,prev+.58],[left,z-.58],h,h,1.36,'roller',false);
      if(i<3)conveyor(b,[right,prev+.58],[right,z-.58],h,h,1.36,'roller',false);
    }
  }
  // The lower return meets the bank at two transfers, below the raised D02 crossing.
  const tail=sorter.returns[1].at(-1),z=tail[1];
  for(const x of [right,bank.returnEnd])transfer(x,z);
  conveyor(b,[right,bank.rows[2]+.58],[right,z-.58],h,h,1.2);
  conveyor(b,[bank.returnEnd,bank.rows[3]+.58],[bank.returnEnd,z-.58],h,h,1.36,'roller',false);
  conveyor(b,tail,[right+.72,z],h,h,1.2);
  conveyor(b,[right-.72,z],[bank.returnEnd+.72,z],h,h,1);
  const vehicle=forkTruck(assets);
  vehicle.position.set(eq.forklift[0],0,eq.forklift[1]);vehicle.rotation.y=-Math.PI/2;group.add(vehicle);
  return {rows:bank.rows,transfers:centres};
}
