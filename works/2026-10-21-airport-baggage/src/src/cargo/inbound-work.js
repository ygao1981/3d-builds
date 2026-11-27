import * as T from 'three';
import {amber,batch,conveyor,dark,fitted,frame,metal,mod,panelSign,platform,side,steel} from './hardware.js';
import {board,carton,operator,palletBase} from './workcells.js';
import {insideFloor} from './floor-operations.js';

// Local demonstration coordinates relative to the named workface. These are material-handling
// examples. The equipment arrangement and batch sizes are not a survey of a specialist installation.
const benchX=-4.6,benchZ=-.8,deck=.84;
const storageX=7,heldZ=-7,overdueZ=12;
const card=metal('#ad8457',.94,.01),pale=metal('#e4e0ca',.76,.05);
const green=metal('#457b71',.57,.21),ochre=metal('#bc9759',.68,.17);
const blue=metal('#627e93',.63,.20),rubber=metal('#394244',.91,.02);
const surface=metal('#a8b9ad',.94,.01),stockFloor=metal('#b5b29c',.96,.01);
const smooth=T.MathUtils.smoothstep;

export const inboundDescription='进港快件在这里上线交接、查验。需要开箱的货件进入人工复核，暂扣和超期批次分别暂存，放行货物转往待提。区域用途按图，工位组合、人员和货载为示意。';

export function hallWorkViews({site,tables}){
  const base=site?.freight?.nodes.find(n=>n.key==='inWork');
  if(!base)return [];
  const near=(x,z)=>[base.at[0]+x,base.at[1]+z];
  const extra=[
    {key:'inReview',label:'进港查验与开箱复核',at:near(benchX,benchZ),width:12,depth:16,az:.86,elevation:.54,height:2.5,
      note:'示例货件从交接辊台送到工作台，停稳后由作业员复核，再送到出件台。旁边的物品开箱台用于展示待核实的货件。'},
    {key:'inHolding',label:'进口暂扣与超期暂存',at:near(storageX,(heldZ+overdueZ)/2),width:12,depth:28,az:.65,elevation:.68,height:2.8,
      note:'进口暂扣与快件进口超期分别存放。两类状态按业务条件发生，场内周转架、箱件和待处理批次为示意。'},
  ];
  const outline=site.floorOperations?.workAreas?.[0];
  if(outline && tables){
    const places=tables.places.map(({at,rotated},index)=>({index,at:at.map((v,i)=>v+tables.offset[i]),
      size:rotated?[...tables.size].reverse():tables.size,height:tables.height})).filter(p=>insideFloor(outline,...p.at));
    if(places.length){
      const xs=places.map(p=>p.at[0]),zs=places.map(p=>p.at[1]);
      const middle=values=>(Math.min(...values)+Math.max(...values))/2;
      extra.push({key:'inOnline',label:'进港快件上线交接',tables:places,at:[middle(xs),middle(zs)],width:15,depth:15,
        az:.32,elevation:.65,height:2.2,note:'原图将这里标为进港快件上线查验区。移动分解组合台按图定位，承接来板和散件的上线交接。'});
    }
  }
  for(const [key,area,label,width,depth,note] of [
    ['outPacking','出港快件作业','出港快件组板区',39,45,'按图查看出港快件的组板台和整托货位。两排台位之间留有转运通道，作业中的纸箱与航空板按示例批次展示。'],
    ['receiptWork','收货作业','收货作业区',62,25,'散件在收货工位卸下，按业务进入计量、人工分拣或跨境输送线。整板货物由交接工位接收。']
  ]){
    const zone=site.floorOperations?.names.find(n=>n.text===area);
    if(zone)extra.push({key,label,at:zone.at,width,depth,az:.14,elevation:.75,height:4,note,sheet:'PR0020-1001、1002、F1022'});
  }
  if(site.floorScales?.length)extra.push({key:'floorWeigh',label:'整托货物地磅称重',at:site.floorScales[Math.floor(site.floorScales.length/2)],
    width:12,depth:15,az:-.78,elevation:.53,height:3.2,sheet:'PR0020-1001、F1022',
    note:'叉车把整托货物放在秤面上，退出后称重，再取走货物。三个电子地磅按主平面定位，货载和叉车展示一个称货批次。'});
  return extra.map(n=>({sheet:base.sheet,...n}));
}

function floorBay(b,x,z,w,d,paint,edge){
  b.box(x,-.005,z,w,.010,d,paint);
  for(const s of [-1,1]){
    b.box(x,.004,z+s*(d/2-.07),w-.13,.008,.085,edge);
    b.box(x+s*(w/2-.07),.004,z,.085,.008,d-.12,edge);
  }
}

function placard(group,b,text,x,z,width,color){
  const y=2.40,h=width*112/384;
  for(const s of [-1,1]){
    b.box(x+s*width*.38,y/2,z,.065,y,.065,side);
    b.box(x+s*width*.38,.037,z,.22,.074,.25,steel);
  }
  b.box(x,y,z,width+.065,h+.065,.09,color);
  const front=panelSign(text,width);front.material.side=T.FrontSide;
  front.position.set(x,y,z+.048);group.add(front);
  const reverse=front.clone();reverse.rotation.y=Math.PI;reverse.position.z=z-.048;group.add(reverse);
}

function table(b,x,z,w,d,y=deck){
  b.box(x,y-.032,z,w,.064,d,steel);
  for(const dx of [-1,1])for(const dz of [-1,1])
    b.box(x+dx*(w/2-.13),(y-.064)/2,z+dz*(d/2-.13),.07,y-.064,.07,frame);
  b.box(x,.24,z,w-.19,.045,d-.19,platform);
}

function openCarton(b,x,y,z){
  const w=.74,d=.55,h=.34,rim=y+h;
  b.box(x,y+.014,z,w,.028,d,card);
  for(const s of [-1,1]){
    b.box(x+s*w/2,y+h/2,z,.025,h,d,card);
    b.box(x,y+h/2,z+s*d/2,w,h,.025,card);
    b.beam([x-w/2,rim,z+s*d/2],[x+w/2,rim,z+s*d/2],.026,.025,pale);
    b.beam([x,rim,z+s*d/2],[x,rim+.09,z+s*(d/2+.23)],w,.023,card);
    b.beam([x+s*w/2,rim,z],[x+s*(w/2+.17),rim+.12,z],d,.023,card);
  }
  b.box(x,y+.14,z,.48,.23,.36,pale);
}

function tote(b,x,y,z,tint){
  const w=.76,d=.53,h=.38;
  b.box(x,y+h/2,z,w,h,d,tint);
  for(const s of [-1,1])b.box(x+s*(w/2-.018),y+h,z,.058,.048,d+.034,tint);
  for(const s of [-1,1])b.box(x,y+h,z+s*d/2,w+.04,.048,.035,tint);
  b.box(x,y+h*.60,z+d/2+.007,.22,.09,.014,pale);
}

// Wheeled roll cages and pallet lots illustrate the two different pending statuses.
function rollCage(b,x,z,tint){
  const w=1.07,d=.90;
  for(const dx of [-.4,.4])for(const dz of [-.31,.31])
    b.roller([x+dx-.04,.12,z+dz],[x+dx+.04,.12,z+dz],.115,rubber);
  b.box(x,.274,z,w,.082,d,steel);
  for(const dx of [-w/2,w/2])for(const dz of [-d/2,d/2])
    b.box(x+dx,1.01,z+dz,.047,1.48,.047,tint);
  for(const y of [.50,.77,1.04,1.31,1.69]){
    b.box(x,y,z-d/2,w,.029,.029,tint);
    for(const s of [-1,1])b.box(x+s*w/2,y,z,.029,.029,d,tint);
  }
  for(const dx of [-.28,0,.28])b.box(x+dx,.99,z-d/2,.022,1.38,.022,tint);
}

export function createInboundWork(fixed,goods,at,assets,online){
  const stations=new T.Group(),batchLoads=new T.Group();
  stations.name='进港快件查验作业面';batchLoads.name='进港在场批次';
  const finishHeight=.04;
  stations.position.set(at[0],finishHeight,at[1]);batchLoads.position.copy(stations.position);
  fixed.add(stations);goods.add(batchLoads);
  const b=batch(stations),loads=batch(batchLoads);
  floorBay(b,-3.5,-.8,13.1,20.4,surface,pale);
  placard(stations,b,'快件查验交接',benchX-1.4,-9.8,3.2,green);

  // Both roller beds meet the central work surface at the same top elevation.
  const start=benchZ-6,end=benchZ+6,half=1.15;
  conveyor(b,[benchX,start],[benchX,benchZ-half],deck,deck,1.12,'roller');
  // Exterior of a generic parcel-processing module, with its belt open along the travel axis.
  const hoodZ=benchZ-3.9;
  for(const s of [-1,1]){
    b.box(benchX+s*.76,1.35,hoodZ,.27,2.34,2.38,side);
    b.box(benchX+s*.906,1.43,hoodZ,.035,1.32,1.76,pale);
    for(let j=0;j<5;j++)b.box(benchX+s*.929,1.63,hoodZ-.49+j*.17,.018,.39,.047,frame);
    b.box(benchX+s*.76,.15,hoodZ,.49,.22,2.47,frame);
  }
  b.box(benchX,2.38,hoodZ,1.77,.30,2.38,pale);
  for(const s of [-1,1])b.box(benchX,2.18,hoodZ+s*1.18,1.55,.10,.065,amber);
  table(b,benchX,benchZ,1.12,half*2);
  conveyor(b,[benchX,benchZ+half],[benchX,end],deck,deck,1.12,'roller');
  table(b,benchX,start-.72,1.12,1.44);table(b,benchX,end+.72,1.12,1.44);
  // A low end stop prevents a stationary item from rolling off the handover deck.
  b.box(benchX,deck+.043,end+1.40,1.16,.086,.057,amber);
  for(const dz of [-6.45,6.45])carton(loads,benchX,deck,benchZ+dz,.58,.40,.46);
  const deskX=.8,deskZ=2.25;
  table(b,deskX,deskZ,1.46,3.0);table(b,deskX,deskZ-3.8,1.46,2.4);
  conveyor(b,[deskX,deskZ-2.6],[deskX,deskZ-1.5],deck,deck,1.14,'roller',false);
  placard(stations,b,'物品开箱复核',deskX,deskZ-6.1,2.65,green);
  openCarton(loads,deskX,deck,deskZ+.55);
  tote(loads,deskX,deck,deskZ-.62,green);
  b.box(deskX,deck+.17,deskZ-4.1,.08,.34,.08,frame);
  b.box(deskX,deck+.49,deskZ-4.1,.62,.36,.065,dark);
  b.box(deskX,deck+.49,deskZ-4.06,.55,.29,.015,blue);
  b.box(deskX,deck+.022,deskZ-3.67,.46,.044,.19,dark);
  for(const dz of [-5.9,3.3]){
    rollCage(loads,-8,dz,green);
    tote(loads,-8,.315,dz,green);
    if(dz<0)tote(loads,-8,.729,dz,green);
  }
  palletBase(loads,-7.8,0,6.5,1.3,1.1);
  for(const side of [-1,1])carton(loads,-7.8,.142,6.5+side*.25,1.17,.48,.48);

  for(const [z,label,tint] of [[heldZ,'进口暂扣',ochre],[overdueZ,'快件进口超期',blue]]){
    floorBay(b,storageX,z,6.8,8.6,stockFloor,tint);
    placard(stations,b,label,storageX,z-3.66,3.25,tint);
    for(const dx of [-1.62,.15,1.9]){
      const x=storageX+dx;
      rollCage(loads,x,z-1.50,tint);
      for(let i=0;i<(dx<1?2:1);i++)tote(loads,x,.315+i*.414,z-1.5,tint);
      palletBase(loads,x,0,z+1.38,1.30,1.08);
      for(const dz of [-.25,.25]){
        carton(loads,x,.142,z+1.38+dz,1.17,.46,.47,dx<0?2:1);
        if(dx!==.15)carton(loads,x,.604,z+1.38+dz,1.14,.38,.46);
      }
    }
  }
  if(online){
    const right=Math.max(...online.tables.map(t=>t.at[0]+t.size[0]/2));
    placard(stations,b,'上线交接',right+1.6-at[0],online.at[1]-at[1],2.75,green);
    online.tables.forEach((t,i)=>{
      const state=i%4,[w,d]=t.size,x=t.at[0]-at[0],z=t.at[1]-at[1];
      if(state===3)return;
      const y=t.height-finishHeight;
      board(loads,x,y,z,w*.92,d*.92,state===0?2:state===1?1:0,state===0);
      if(state===2)for(const dz of [-.37,.37])carton(loads,x,y+.06,z+dz,.69,.41,.63);
    });
  }
  const worker=operator(batchLoads,assets.worker);
  worker.figure.position.set(benchX+.76,0,benchZ);worker.figure.rotation.y=-Math.PI/2;
  const parcel=fitted(assets.box_cardboard_a01,.55,.42,.46,true);
  batchLoads.add(parcel);b.finish();loads.finish();
  function update(time){
    const t=mod(time,24),arrival=smooth(t,0,7),departure=smooth(t,14,21);
    const lift=.105*(smooth(t,8.5,10)-smooth(t,11.5,13));
    parcel.position.set(benchX,deck+lift,benchZ-5.8+5.8*arrival+5.8*departure);
    parcel.visible=t<23.6;
    worker.pose({time,height:parcel.position.y+parcel.userData.size[1]*.47,reach:.76-.08,
      halfWidth:parcel.userData.size[2]/2,grip:smooth(t,7,8.5)*(1-smooth(t,13,14))});
  }
  update(0);
  return {stations,batchLoads,parcel,worker,deck,start,end,update};
}
