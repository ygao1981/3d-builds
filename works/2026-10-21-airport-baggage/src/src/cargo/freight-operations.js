import * as T from 'three';
import {amber,batch,conveyor,dark,fitted,frame,metal,mod,panelSign,platform,side,steel} from './hardware.js';
import {apronTrain} from './floor-operations.js';
import {board,carton,dressStaging,forkTruck,operator,palletBase} from './workcells.js';
import {walkingRoute} from './worker.js';
import {createInboundWork,rollCage} from './inbound-work.js';

const roof=metal('#bac5c5',.70,.26),column=metal('#819b9c',.65,.38),concrete=metal('#a0aaa5',.95,.02);
const finish=metal('#c6d0c9',.87,.04),rubber=metal('#354346',.92,.04);
const roomFloor=metal('#c5bd9f',.95,.02);
const smooth=(t,a,b)=>T.MathUtils.smoothstep(t,a,b);

function canopyStructure(parent,survey){
  const b=batch(parent),{columns,back,front,eave}=survey;
  const left=columns[0][0],right=columns.at(-1)[0],span=right-left;
  for(const [x,z] of columns){
    b.box(x,.12,z,.82,.24,.88,concrete);
    for(const dx of [-.20,.20])b.box(x+dx,3.08,z,.075,6.12,.57,column);
    b.box(x,3.08,z,.42,6.12,.085,frame);
    b.box(x,.49,z,.52,.67,.61,amber);
    // Tapered framing follows section 1-1. A narrow eave strip leaves the activity below visible.
    b.beam([x,9.32,back],[x,6.53,front],.28,.34,column);
    b.beam([x,8.78,back],[x,6.08,front],.22,.22,frame);
    b.beam([x,6.53,front],[x,6.88,eave],.27,.30,column);
    for(let k=0;k<8;k++){
      const t=k/8,u=(k+1)/8;
      b.beam([x,8.83+(6.12-8.83)*t,back+(front-back)*t],[x,9.22+(6.46-9.22)*u,back+(front-back)*u],.08,.085,steel);
    }
  }
  for(const [z,y] of [[back,9.35],[front,6.61],[eave,6.96]])
    b.box((left+right)/2,y,z,span+.52,.22,.22,column);
  b.box((left+right)/2,7.04,eave-.36,span+.82,.095,.92,roof);
  b.finish();
}

// Cut both wings at the same display height. The drawing registers walls on the floor plane.
function sideRoom(group,room){
  const root=new T.Group(),b=batch(root);
  root.name=room.key;group.add(root);
  for(const polygon of room.floors){
    const shape=new T.Shape(polygon.map(([x,z])=>new T.Vector2(x,-z)));
    const slab=new T.Mesh(new T.ShapeGeometry(shape),roomFloor);
    slab.rotation.x=-Math.PI/2;slab.position.y=.035;slab.receiveShadow=true;root.add(slab);
  }
  function walls(paths,width,cap){
    for(const line of paths){
      for(let i=1;i<line.length;i++){
        const [x,z]=line[i-1],[xx,zz]=line[i],cx=(x+xx)/2,cz=(z+zz)/2;
        const w=Math.abs(xx-x)+width,d=Math.abs(zz-z)+width;
        b.box(cx,.765,cz,w,1.53,d,finish);
        b.box(cx,.116,cz,w+.018,.22,d+.018,concrete);
        b.box(cx,1.55,cz,w+.012,.04,d+.012,cap);
      }
    }
  }
  walls(room.shell,.27,frame);walls(room.partitions,.16,column);
  b.finish();
}

function flaredRollers(b,start,end,z,outerAtStart){
  const w=t=>1.30+.55*(outerAtStart?1-t:t),top=.80;
  b.beam([start,top-.18,z],[end,top-.18,z],1.20,.18,frame);
  for(let k=0;k<19;k++){
    const t=(k+.5)/19,x=T.MathUtils.lerp(start,end,t),half=w(t)/2-.032;
    b.roller([x,top-.038,z-half],[x,top-.038,z+half],.038,steel);
  }
  for(const s of [-1,1]){
    b.beam([start,top-.06,z+s*w(0)/2],[end,top-.06,z+s*w(1)/2],.055,.15,side);
    b.box((start+end)/2,.32,z+s*.52,.09,.64,.09,frame);
  }
}

// Each pair has two opposed flared entries converging on a perpendicular centre return.
function manualOutlets(root,info,receipts){
  const b=batch(root),width=1,top=.8,roll=.4,items=[];
  const centres=[];
  for(const [i,j] of [[0,1],[2,3]]){
    const [left,z]=info[i].wheel,right=info[j].wheel[0];
    const middle=(left+right)/2+(i===0?1:-1)*3.46/2,low=middle-.65,high=middle+.65;
    centres.push(middle);
    for(const [outer,inner,sign] of [[left+.50,low,1],[right-.50,high,-1]]){
      const nose=outer+sign*.13,flareEnd=nose+sign*1.49;
      conveyor(b,[outer,z],[nose,z],top,top,1.2,'roller',false);
      flaredRollers(b,Math.min(nose,flareEnd),Math.max(nose,flareEnd),z,sign===1);
      const queueStart=inner-sign*1.50;
      if(Math.abs(queueStart-flareEnd)>.02)conveyor(b,[flareEnd,z],[queueStart,z],top,top,1.3);
      conveyor(b,[queueStart,z],[inner,z],top,top,1.3);
    }
    // The cross inlet measures 1.30 m across. Its receiving edges must stay open.
    b.box(middle,top-.12,z,1.30,.18,1.30,frame);
    for(let k=0;k<10;k++)b.roller([low+.015,top-.049,z+(k-4.5)*.13],[high-.015,top-.049,z+(k-4.5)*.13],.049);
    conveyor(b,[middle,z-.65],[middle,z-.65-4],top,top,1.30);
    conveyor(b,[middle,z-.65-4],[middle,z-.65-4-7.24],top,top,1.30);
  }
  for(const [i,line] of info.entries()){
    const [x,z]=line.wheel,entry=receipts.find(r=>Math.abs(r.at[0]-x)<.035);
    if(!entry)continue;
    const start=entry.at[1]+entry.end,wheelEnd=z+.60,rollStart=wheelEnd+line.belt,end=rollStart+line.gravity;
    conveyor(b,[x,start],[x,z-.60],top,top,width);
    b.box(x,top-.13,z,width,.24,1.2,frame);
    for(let j=0;j<5;j++)for(let k=0;k<4;k++){
      const cx=x+(k-1.5)*.22,cz=z+(j-2)*.22;
      b.roller([cx-.073,top-.052,cz-.027],[cx+.073,top-.052,cz+.027],.052,rubber);
    }
    conveyor(b,[x,wheelEnd],[x,rollStart],top,top,width);
    conveyor(b,[x,rollStart],[x,end],top,roll,width,'roller');
    b.box(x,roll+.06,end,width,.12,.065,amber);
    const divert=i%2===0,exitX=divert?centres[Math.floor(i/2)]:x;
    const sideways=Math.abs(exitX-x),toWheel=z-start;
    const discharge=divert?z-.65-4-7.24:end;
    entry.outfeed={length:toWheel+sideways+Math.abs(discharge-z),update(parcel,distance){
      parcel.rotation.x=0;
      if(distance<=0)return;
      const lateral=T.MathUtils.clamp(distance-toWheel,0,sideways);
      const afterMerge=Math.max(0,distance-toWheel-sideways);
      const dz=start+distance-lateral-(divert?2*afterMerge:0),ontoSlope=Math.max(0,dz-rollStart);
      parcel.position.set(x+Math.sign(exitX-x)*lateral,top-(top-roll)*ontoSlope/line.gravity,dz);
      if(ontoSlope>0)parcel.rotation.x=Math.atan2(top-roll,line.gravity);
    }};
    items.push({entry,x,z,rollStart,end,exitX,divert,discharge,start});
  }
  b.finish();return items;
}

function stock(b,x,z,levels=2){
  palletBase(b,x,0,z,1.2,1);
  for(let k=0;k<levels;k++)for(const dx of [-.285,.285])for(const dz of [-.23,.23])
    carton(b,x+dx,.145+k*.38,z+dz,.54,.372,.43,k+(dx>0?1:0));
}

function palletJack(b,x,z){
  for(const dx of [-.245,.245]){
    b.box(x+dx,.095,z+.45,.155,.085,1.16,amber);
    b.roller([x+dx-.057,.067,z+.92],[x+dx+.057,.067,z+.92],.06,rubber);
  }
  b.box(x,.18,z-.25,.64,.25,.34,amber);
  b.roller([x-.13,.13,z-.29],[x+.13,.13,z-.29],.13,rubber);
  b.beam([x,.28,z-.25],[x,1.03,z-.66],.073,.072,frame);
  for(const dx of [-.17,.17])b.beam([x,1.03,z-.66],[x+dx,1.20,z-.74],.045,.045,rubber);
  b.roller([x-.17,1.20,z-.74],[x+.17,1.20,z-.74],.036,rubber);
}

// Each mobile lot represents a batch. Keep the middle of the dispatch lane open for the loading forklift.
function handlingBatch(parent,{type,at:[x,z],area}){
  const group=new T.Group(),b=batch(group);
  group.name=area;group.position.set(x,0,z);parent.add(group);
  if(type==='hold'){
    for(const offset of [-3.05,0,3.05])stock(b,offset,0,offset===0?3:2);
    for(const offset of [-3.05,0])stock(b,offset,1.55,2);
  }else{
    for(const side of [-1,1])for(const dz of [-1.55,0,1.55]){
      const dx=side*(type==='send'?3.15:2.4);
      if(type==='send' || (type==='receive' && side<0)){
        stock(b,dx,dz,dz===0?3:2);
      }else{
        rollCage(b,dx,dz,column);
        for(let level=0;level<(dz===0?1:3);level++)carton(b,dx,.315+level*.355,dz,.86,.35,.72,level);
      }
    }
    palletJack(b,type==='send'?5.05:4.05,1.08);
  }
  b.finish();
}

function dolly(b,x,z,loaded,seed=0){
  b.box(x,.365,z,3.22,.17,2.48,frame);
  for(const side of [-1,1])for(const end of [-1,1]){
    const xx=x+end*1.10,zz=z+side*1.08;
    b.roller([xx,.18,zz-.085],[xx,.18,zz+.085],.175,rubber);
  }
  for(let i=0;i<12;i++){
    const xx=x+(i-5.5)*.252;
    b.roller([xx,.47,z-1.14],[xx,.47,z+1.14],.055,steel);
  }
  b.beam([x-1.57,.36,z],[x-2.2,.24,z],.085,.10,frame);
  if(loaded)board(b,x,.525,z,3.08,2.32,loaded,true,seed);
}

function storageRack(group,rack){
  const b=batch(group),[w,d,h]=rack.size;
  for(const dx of [-1,1])for(const dz of [-1,1]){
    b.box(dx*(w/2-.06),h/2,dz*(d/2-.06),.12,h,.12,frame);
    b.box(dx*(w/2-.06),.035,dz*(d/2-.06),.24,.07,.23,steel);
  }
  for(const y of [.13,1.23,2.33]){
    for(const z of [-1,1])b.box(0,y,z*(d/2-.06),w,.16,.12,side);
    for(const x of [-1,0,1])b.box(x*(w/2-.06),y,0,.12,.13,d,steel);
    for(let i=0;i<4;i++)b.box(0,y+.115+i*.059,0,w-.24,.047,d-.23,i%2?steel:column);
  }
  b.finish();
}

function breakdown(group,b,x,z,assets,offset){
  dolly(b,x,z,0);board(b,x,.525,z,3.08,2.32,0,false);
  for(const dx of [-.98,-.27,.44])for(const dz of [-.61,0,.61])
    carton(b,x+dx,.585,z+dz,.67,.39,.56,dx<0?1:0);
  const from=[x+1.24,z+.64],to=[x+1.24,z+3.14],footX=from[0]+.65;
  palletBase(b,to[0],0,to[1],1.2,1.0);
  carton(b,to[0],.145,to[1],1.13,.38,.92);
  const worker=operator(group,assets.worker),box=fitted(assets.box_cardboard_a01,.47,.36,.40,true);
  const path=walkingRoute([[footX,from[1]],[footX+.31,z+1.46],[footX+.31,z+2.50],[footX,to[1]]]);
  const carrying=new T.Vector3(),size=box.userData.size;
  group.add(box);worker.figure.rotation.y=-Math.PI/2;
  function update(time){
    const t=mod(time+offset,23),walk=smooth(t,4,11),back=smooth(t,16,22);
    const reach=.65-.15*Math.sin(Math.PI*walk);
    path.getPoint(walk,carrying);
    box.position.set(carrying.x-reach,.585+.41*smooth(t,2,4)-.47*smooth(t,11,14),carrying.z);
    const progress=walk-back,grip=smooth(t,.5,2)*(1-smooth(t,14,15));
    path.getPoint(progress,worker.figure.position);
    worker.pose({time,height:box.position.y+.47*size[1],reach:reach-Math.min(.09,size[0]*.22),
      halfWidth:size[2]/2,grip,path,progress});
  }
  return {box,worker,from,to,update};
}

function representativeStation(group,isShed){
  const b=batch(group),x=isShed?.3:0;
  if(isShed){
    for(const side of [-1,1])for(const end of [-1,1])
      b.box(side*5.6,2.2,end*4.2,.23,4.4,.23,column);
    for(const z of [-4.2,4.2])b.box(0,4.32,z,11.5,.24,.19,column);
    for(const dx of [-5.6,0,5.6]){
      b.beam([dx,4.40,-4.35],[dx,4.76,0],.18,.18,frame);
      b.beam([dx,4.76,0],[dx,4.40,4.35],.18,.18,frame);
    }
    b.box(0,4.44,-3.93,11.7,.11,1.05,roof);
  }
  // Generic work cell for the process view. It has its own local origin and no airport-wide registration.
  conveyor(b,[x,-3.10],[x,-.98],.80,.8,1.15,'roller');
  conveyor(b,[x,.98],[x,3.10],.80,.8,1.15,'roller');
  b.box(x,.50,0,1.75,.80,2.05,side);
  b.box(x,1.60,0,1.74,1.46,1.97,finish);
  for(const z of [-.995,.995]){
    b.box(x,1.36,z,1.19,.97,.033,dark);
    b.box(x,.815,z,1.13,.065,.07,steel);
  }
  b.box(x+2.54,.97,-.26,1.62,.12,.88,platform);
  for(const a of [-.68,.68])for(const c of [-.33,.33])b.box(x+2.54+a,.48,-.26+c,.075,.95,.075,frame);
  carton(b,x+2.46,1.03,-.22,.49,.36,.45);
  b.finish();
}

function specialLoads(b,key){
  if(key==='specialStock'){
    for(const x of [-1.85,.25])stock(b,x,.34,1);
    for(const x of [-3,1.6])b.box(x,.015,.34,.075,.025,2.65,amber);
    for(const z of [-.98,1.66])b.box(-.7,.015,z,4.67,.025,.075,amber);
  }else{
    for(const x of [-1.8,0,1.8])b.box(x,.11,0,.27,.21,2.42,frame);
    b.box(0,.25,0,4.42,.10,2.42,woodCrate);
    b.box(0,1.18,0,4.08,1.76,2.13,woodCrate);
    for(const x of [-1.36,1.36]){
      b.box(x,2.077,0,.105,.034,2.18,dark);
      for(const z of [-1.075,1.075])b.box(x,1.18,z,.105,1.79,.033,dark);
    }
  }
}
const woodCrate=metal('#ad8e66',.91,.03);

function floorWeighing(fixed,goods,scales,assets){
  if(!scales?.length)return null;
  const b=batch(fixed),active=Math.floor(scales.length/2),[x,z]=scales[active];
  const words=['待称','称重中','可取货'],activeScreens=[];
  scales.forEach(([cx,cz],i)=>{
    const px=cx-2.32,pz=cz+1.30;
    b.box(px,.59,pz,.095,1.18,.095,frame);
    b.box(px,.04,pz,.32,.08,.32,steel);b.box(px,1.29,pz,.77,.41,.18,side);
    b.box(px,.86,pz+.17,.58,.055,.42,steel);
    b.box(px,.97,pz+.20,.43,.17,.31,finish);
    b.box(px,.99,pz+.363,.32,.032,.012,dark);
    b.box(px,.964,pz+.393,.27,.012,.068,finish);
    for(const dx of [-1,0,1])for(const dz of [-1,1])b.box(cx+dx*1.7,.025,cz+dz*1.83,.09,.018,.09,steel);
    for(const text of i===active?words:['待称']){
      const face=panelSign(text,.68);face.position.set(px,1.29,pz+.095);fixed.add(face);
      if(i===active){face.visible=text==='待称';activeScreens.push(face);}
    }
  });
  b.finish();
  const forklift=forkTruck(assets),load=new T.Group(),lot=batch(load);
  palletBase(lot,0,0,0,1.22,1.04);
  for(let level=0;level<2;level++)for(const side of [-1,1])
    carton(lot,0,.142+level*.425,side*.252,1.10,.419,.49,level);
  lot.finish();goods.add(forklift,load);
  const deckTop=.021,travelHeight=.18;
  let status=0;
  function setStatus(index){status=index;activeScreens.forEach((m,i)=>{m.visible=i===index;});}
  function update(t){
    const phase=mod(t,32),arrival=smooth(phase,0,5),depart=smooth(phase,26,32);
    const distance=4*(1-arrival+depart);
    const settled=smooth(phase,5,8)-smooth(phase,23,26);
    const y=T.MathUtils.lerp(travelHeight,deckTop,settled);
    const retreat=smooth(phase,9,13)-smooth(phase,19,22);
    const forkClear=smooth(phase,8,9)-smooth(phase,22,23);
    load.position.set(x,y,z-distance);
    forklift.position.set(x,0,z-distance-1.94-4*retreat);
    forklift.userData.setForkHeight(y+.1065-.035*forkClear);
    const index=phase>=13 && phase<16?1:phase>=16 && phase<19?2:0;
    if(index!==status)setStatus(index);
  }
  return {load,forklift,update,idle:()=>setStatus(0),get status(){return words[status];}};
}

// The mobile inventory depicts one batch on each named apron; it can be hidden independently of surveyed equipment.
export function createFreightOperations(hall,site,receipts,assets,views){
  const info=site.freight, fixed=new T.Group(), goods=new T.Group(),canopy=new T.Group(),studio=new T.Group();
  fixed.name='全流程固定设施';goods.name='周转货载示例';canopy.name='空侧作业棚剖面';
  hall.add(fixed,goods);fixed.add(canopy);canopyStructure(canopy,info.canopy);
  const b=batch(fixed),loads=batch(goods),nodes=Object.fromEntries(info.nodes.map(v=>[v.key,v]));
  const stagingLots=new T.Group();stagingLots.name='图示货位上的示例货载';goods.add(stagingLots);
  const stockMeshes=batch(stagingLots);dressStaging(b,site,stockMeshes);stockMeshes.finish();
  const [[left,front],[right,back]]=info.perimeter,[[oldLeft],[oldRight,oldBack]]=site.bounds;
  b.box((left+right)/2,-.145,(back+oldBack)/2,right-left,.27,back-oldBack,concrete);
  for(const [a,c] of [[left,oldLeft],[oldRight,right]])b.box((a+c)/2,-.15,(oldBack+front)/2,c-a,.27,oldBack-front,concrete);
  for(const room of info.sideRooms||[])sideRoom(fixed,room);
  const manual=manualOutlets(fixed,info.manual,receipts);
  const floorWeigh=floorWeighing(fixed,goods,site.floorScales,assets);
  const [ix,iz]=nodes.inbound.at,[tx,tz]=nodes.transfer.at;
  dolly(loads,ix-4,iz-.9,3);
  const handlers=[breakdown(goods,loads,ix,iz-.9,assets,0),breakdown(goods,loads,tx+2.5,tz,assets,4)];
  for(const dx of [-4,-2.2,0])stock(loads,ix+dx,iz+2.9,dx===0?1:2);
  for(const key of ['crossWait','expressWait']){
    const [x,z]=nodes[key].at;
    for(const dx of [-4.3,.3,4.9])for(const dz of [-1.7,2.1])
      if(dx<4 || dz<0)dolly(loads,x+dx,z+dz,dx<0?2:3,dx<0?2:1);
  }
  dolly(loads,tx-3.2,tz,2);
  for(const dx of [-2.3,-.9,.5,1.9])stock(loads,tx+dx,tz+3,dx>0?1:2);
  const f=site.floorOperations;
  const handlingLots=new T.Group();goods.add(handlingLots);
  for(const lot of f.handling?.lots||[])handlingBatch(handlingLots,lot);
  const onDeck=new T.Group();onDeck.name='平台周转板货';goods.add(onDeck);
  const deckGoods=batch(onDeck),line=f.existing.straight,parcels=[];
  if(line){
    for(const [i,slot] of f.existing.positions.entries()){
      if(i%3===1)continue;
      const [[a,c],[v,h]]=slot;
      board(deckGoods,(a+v)/2,.49,(c+h)/2,v-a-.10,h-c-.10,i%2+1,true,i);
    }
    deckGoods.finish();
    for(let i=0;i<3;i++){
      const carton=fitted(assets.box_cardboard_a01,.58,.43,.52,true);
      goods.add(carton);parcels.push(carton);
    }
  }
  f.tow.dollies.forEach(([x,z],i)=>{if(i!==2)board(loads,x,.747,z,3.12,2.38,2,true,i);});
  const second=new T.Group(),train=batch(second),[qx,qz]=info.secondTrain.tractor;
  second.position.set(qx,0,qz);second.rotation.y=Math.PI/2;
  apronTrain(train,{tractor:[0,0],dollies:info.secondTrain.dollies.map(([,z])=>[qz-z,0])});
  train.finish();fixed.add(second);
  info.secondTrain.dollies.forEach(([x,z],i)=>board(loads,x,.747,z,2.37,3.07,i+1,true,i));
  const weigh=new T.Group(),scaleLoad=batch(weigh),[sx,sz]=site.reweigh[0];
  apronTrain(scaleLoad,{tractor:[-5.23,0],dollies:[[0,0]]});
  board(scaleLoad,0,.747,0,3.10,2.38,3,true,1);scaleLoad.finish();
  weigh.rotation.y=-Math.PI/2;goods.add(weigh);
  f.agv.stands.forEach(({at:[x,z],turned},i)=>{
    if(i%4!==0 || turned)return;
    carton(loads,x,.518,z,.86,.42,.78,i%3);
  });
  const inboundWork=nodes.inWork && createInboundWork(fixed,goods,nodes.inWork.at,assets,views.find(n=>n.key==='inOnline'));
  const [px,pz]=nodes.pickup.at;
  const lift=forkTruck(assets),carried=new T.Group(),load=batch(carried);
  palletBase(load,0,0,0,1.2,1.0);carton(load,0,.145,0,1.11,.56,.90);load.finish();goods.add(lift,carried);
  // Staging aisle adjacent to the registered pickup symbols.
  const supplyX=px+2.65,stockZ=pz+3.45;
  const rooms=new Map();
  for(const target of info.nodes.filter(x=>x.independent)){
    const group=new T.Group(),ground=batch(group),w=target.width,d=target.depth;
    group.name=target.label;ground.box(0,-.115,0,w,.23,d,concrete);
    if(target.key==='equipment')storageRack(group,info.rack);
    else if(['special','specialStock'].includes(target.key))specialLoads(ground,target.key);
    else representativeStation(group,target.key==='shed');
    ground.finish();group.visible=false;studio.add(group);rooms.set(target.key,group);
  }
  b.finish();loads.finish();studio.visible=false;
  function update(t){
    floorWeigh?.update(t);
    for(const [i,parcel] of parcels.entries()){
      const travel=line.end[1]-line.start[1]-.72;
      parcel.position.set(line.start[0],.80,line.start[1]+.36+mod(t*.48+i*travel/parcels.length,travel));
    }
    inboundWork?.update(t);
    for(const handler of handlers)handler.update(t);
    const crossing=mod(t,32);
    weigh.position.set(sx,.025,sz+8*(1-smooth(crossing,0,10))-8*smooth(crossing,19,29));
    weigh.visible=crossing<30;
    const phase=mod(t,24),approach=smooth(phase,0,4),move=smooth(phase,7,14),leave=smooth(phase,17,22);
    const height=.16*(smooth(phase,4,6)-smooth(phase,14,16));
    const returnTrip=phase>=16,retreat=4.5*move;
    carried.position.set(supplyX,height,stockZ-retreat);
    lift.position.set(supplyX,0,stockZ-2.13-1.90*(1-approach)-retreat-1.67*leave);
    if(returnTrip)lift.userData.setForkHeight(.105-.035*leave);else lift.userData.setForkHeight(.105+height);
    // The empty return leaves the scene before the next incoming batch appears.
    lift.visible=phase<22.7;carried.visible=phase<22.7;
  }
  function setView(node,isHall){
    const selected=rooms.get(node?.key);
    studio.visible=!!selected;
    for(const room of rooms.values())room.visible=room===selected;
    canopy.visible=isHall && (!node?.key || node.key==='canopy');
  }
  function setBatchVisible(visible){
    goods.visible=visible;
    if(!visible)floorWeigh?.idle();
  }
  update(0);
  return {goods,canopy,fixed,studio,manual,nodes,rooms,carried,lift,weigh,handlers,inboundWork,floorWeigh,
    handlingLots,stagingLots,onDeck,parcels,setBatchVisible,setView,update};
}
