import * as T from 'three';
import {amber,batch,conveyor,dark,frame,lerp,metal,panelSign,side,steel,unitBox} from './hardware.js';
import {operator} from './workcells.js';

const paint=metal('#d8dcd5',.64,.23),trim=metal('#336462'),rubber=metal('#343b3c',.92,.02);
const kraft=metal('#bd9564',.92,.02),inside=metal('#775c40',1,0);

function reviewDisplay(desk){
  const canvas=document.createElement('canvas');canvas.width=448;canvas.height=128;
  const ctx=canvas.getContext('2d'),texture=new T.CanvasTexture(canvas);
  texture.colorSpace=T.SRGBColorSpace;
  const material=new T.MeshBasicMaterial({map:texture,toneMapped:false});
  for(let i=0;i<2;i++){
    const geom=new T.PlaneGeometry(.52,.30),uv=geom.attributes.uv;
    for(let k=0;k<uv.count;k++)uv.setX(k,(uv.getX(k)+i)/2);
    const screen=new T.Mesh(geom,material);
    screen.rotation.y=Math.PI;screen.position.set(i?-.32:.32,1.07,-.074);desk.add(screen);
  }
  let last;
  return active=>{
    if(active===last)return;
    last=active;ctx.fillStyle='#153237';ctx.fillRect(0,0,448,128);
    ctx.fillStyle='#2d6266';ctx.fillRect(12,13,200,4);ctx.fillRect(236,13,200,4);
    ctx.fillStyle='#d3eae5';ctx.font='bold 27px "Microsoft YaHei",sans-serif';
    ctx.fillText('货物影像',19,48);ctx.fillText('收货判图',245,48);
    if(active){
      // Abstract carton silhouettes for the demonstration screen.
      ctx.fillStyle='#d3a068';ctx.fillRect(57,60,98,49);
      ctx.fillStyle='#8a6c49';ctx.fillRect(63,76,39,29);ctx.fillRect(111,66,38,39);
    }
    ctx.fillStyle=active?'#acd7b4':'#94b3b6';ctx.font='22px "Microsoft YaHei",sans-serif';
    ctx.fillText(active?'影像示意':'等待来件',245,92);
    texture.needsUpdate=true;
  };
}

// A representative cargo X-ray workstation uses the existing logistics interfaces as its display area.
export function createReceivingInspection(parent,receipts,sources,furniture){
  const index=Math.floor(receipts.length/2),line=receipts[index],exit=sources?.[index]?.[0];
  if(!line || !exit)return null;
  const x0=line.at[0],z0=line.at[1]+line.end,dx=exit[0]-x0,dz=exit[1]-z0;
  const length=Math.hypot(dx,dz);
  if(length<5)return null;
  const ux=dx/length,uz=dz/length,yaw=Math.atan2(dx,dz);
  const group=new T.Group();group.name='收货安检工位示意';group.position.set(x0,0,z0);group.rotation.y=yaw;parent.add(group);
  const b=batch(group),deck=.8,centre=length*.42,half=Math.min(1.65,length*.16),rise=centre+half+.48;
  const heightAt=d=>lerp(deck,exit[2],T.MathUtils.clamp((d-rise)/(length-rise),0,1));
  conveyor(b,[0,0],[0,centre-half],deck,deck,.8);
  conveyor(b,[0,centre-half],[0,centre+half],deck,deck,.8,'belt',false);
  conveyor(b,[0,centre+half],[0,rise],deck,deck,.8,'roller',false);
  conveyor(b,[0,rise],[0,length],deck,exit[2],1.2);
  const machine=new T.Group();machine.name='货物 X 光安检机';machine.position.z=centre;group.add(machine);
  const shell=batch(machine),opening=.57,hinge=1.78;
  shell.box(0,.36,0,1.94,.72,half*2,paint);shell.box(0,.15,0,2.02,.19,half*2+.12,frame);
  shell.box(0,2.02,0,1.96,.5,half*2,paint);
  for(const s of [-1,1]){
    shell.box(s*.79,1.24,0,.42,1.07,half*2,paint);
    shell.box(s*.982,1.63,0,.035,.12,half*2-.12,trim);
    for(const k of [-1,0,1]){
      shell.box(s*.998,.68,k*half*.6,.026,.76,half*.51,side);
      shell.box(s*1.016,.93,k*half*.6,.023,.035,.18,dark);
    }
    const end=s*(half+.02);
    shell.box(0,1.88,end,1.48,.19,.105,trim);
    for(const sideSign of [-1,1]){
      shell.box(sideSign*(opening+.08),1.29,end,.135,.98,.105,trim);
      shell.box(sideSign*.79,.83,end,.095,.21,.12,amber);
    }
  }
  for(let i=0;i<8;i++)shell.box(.48,2.28,-.52+i*.138,.49,.025,.055,side);
  const plate=panelSign('货物安检',1.06);plate.position.set(0,2.065,-half-.034);plate.rotation.y=Math.PI;machine.add(plate);
  const badge=panelSign('X 光机',1.04);badge.position.set(1.012,1.32,.08);badge.rotation.y=Math.PI/2;machine.add(badge);
  shell.finish();
  const strips=9,stripWidth=2*opening/strips,drop=hinge-deck-.04,pose=new T.Object3D();
  const curtains=new T.InstancedMesh(unitBox,rubber,2*strips);
  curtains.name='进出料软帘';curtains.instanceMatrix.setUsage(T.DynamicDrawUsage);curtains.frustumCulled=false;machine.add(curtains);
  let lastCurtainPose;

  // The other visible logistics ends are drawn as section cuts with a supported hand-off surface.
  for(const [i,r] of receipts.entries()){
    if(i===index)continue;
    const exitPoint=sources?.[i]?.[0];if(!exitPoint)continue;
    for(const [x,z,y,width,dir] of [[r.at[0],r.at[1]+r.end,deck,.8,1],[exitPoint[0],exitPoint[1],exitPoint[2],1.2,-1]]){
      const a=(x-x0)*uz-(z-z0)*ux,c=(x-x0)*ux+(z-z0)*uz,end=c+dir*1.35;
      conveyor(b,[a,c],[a,end],y,y,width,'roller');
      b.box(a,y+.065,end,width,.13,.10,amber);
    }
  }

  function bench(node,x,z,title){
    const furnitureModel=furniture?.getObjectByName(node);
    const station=furnitureModel?furnitureModel.clone(true):new T.Group();
    station.name=title;station.position.set(x,0,z);group.add(station);
    if(furnitureModel){
      station.traverse(m=>{if(m.isMesh){m.castShadow=true;m.receiveShadow=true;}});
    }else{
      const pieces=batch(station),review=node==='review_desk',top=review?.75:.90,w=review?1.6:2.4;
      pieces.box(0,top,0,w,.05,.92,steel);
      for(const sx of [-1,1])for(const sz of [-1,1])pieces.box(sx*(w/2-.09),top/2,sz*.38,.075,top,.075,frame);
      if(review)for(const sx of [-1,1]){
        pieces.box(sx*.32,.88,0,.055,.22,.055,frame);pieces.box(sx*.32,1.07,-.05,.55,.34,.04,dark);
      }
      pieces.finish();
    }
    const postX=x+(node==='review_desk'?-.99:1.13),postZ=z-.70;
    const sign=panelSign(title,1.05);sign.material.side=T.FrontSide;
    sign.position.set(postX,1.49,postZ-.03);sign.rotation.y=Math.PI;
    const reverse=sign.clone();reverse.position.z=postZ+.03;reverse.rotation.y=0;group.add(sign,reverse);
    b.box(postX,.70,postZ,.052,1.40,.052,frame);b.box(postX,.04,postZ,.34,.08,.28,frame);
    return station;
  }
  const desk=bench('review_desk',-2.78,centre-.48,'判图台'),display=reviewDisplay(desk);
  const table=bench('search_table',3.55,centre+.98,'人工复核台');
  const worker=operator(group);worker.figure.position.set(table.position.x,0,table.position.z+.77);
  worker.figure.rotation.y=Math.PI;
  // An open carton on the work surface distinguishes manual checking from reading an image.
  const bx=table.position.x,bz=table.position.z+.10,base=.925;
  b.box(bx,base+.015,bz,.49,.03,.40,inside);
  for(const s of [-1,1]){
    b.box(bx+s*.234,base+.15,bz,.022,.30,.40,kraft);
    b.box(bx,base+.15,bz+s*.19,.49,.30,.02,kraft);
    b.beam([bx,base+.30,bz+s*.20],[bx,base+.37,bz+s*.34],.49,.018,kraft);
  }
  b.finish();

  // A separate carton stays at the manual bench while the through parcel keeps moving.
  const checkedItem=line.item.clone(true),size=line.item.userData.size;
  checkedItem.scale.set(.40/size[0],.20/size[1],.24/size[2]);
  checkedItem.position.set(bx,base+.03,bz+.015);group.add(checkedItem);
  let lastLift;
  function update(item,d,time){
    // The receipt line owns this carton throughout the hand-off and passage through the housing.
    const halfParcel=item.userData.size[2]/2;
    const trailing=heightAt(d-halfParcel),leading=heightAt(d+halfParcel);
    if(d>0)item.position.set(x0+ux*d,(trailing+leading)/2,z0+uz*d);
    item.rotation.set(-Math.atan2(leading-trailing,2*halfParcel),d>0?yaw:0,0,'YXZ');
    display(d>=centre-halfParcel && d<=centre+half+1.1);
    const cycle=T.MathUtils.euclideanModulo(time,10);
    const lift=T.MathUtils.smoothstep(cycle,1.1,3.2)*(1-T.MathUtils.smoothstep(cycle,4.8,6.9));
    if(lift!==lastLift){
      checkedItem.position.y=base+.03+.36*lift;
      worker.hold(checkedItem.position.y+.10,worker.figure.position.z-checkedItem.position.z);
      lastLift=lift;
    }
    const angles=[-half,half].map(z=>{
      const delta=d-centre-z;
      return 1.16*T.MathUtils.smoothstep(delta,-halfParcel-.33,-halfParcel)*(1-T.MathUtils.smoothstep(delta,halfParcel,halfParcel+.48));
    });
    if(lastCurtainPose && angles.every((a,i)=>a===lastCurtainPose[i]))return;
    for(const [j,angle] of angles.entries())for(let i=0;i<strips;i++){
      const x=(i-(strips-1)/2)*stripWidth,tilt=Math.abs(x)<(item.userData.size[0]+stripWidth)/2?angle:0;
      pose.rotation.x=-tilt;pose.position.set(x,hinge-drop*.5*Math.cos(tilt),(j?half:-half)+drop*.5*Math.sin(tilt));
      pose.scale.set(stripWidth-.008,drop,.027);pose.updateMatrix();curtains.setMatrixAt(j*strips+i,pose.matrix);
    }
    curtains.instanceMatrix.needsUpdate=true;lastCurtainPose=angles;
  }
  line.outfeed={length,update};update(line.item,-1,0);
  const at=[x0+ux*centre+.45*uz,z0+uz*centre-.45*ux];
  return {group,machine,desk,table,checkedItem,curtains,line,length,centre,half,heightAt,
    target:{label:'收货安检',at,width:11.3,depth:7.3,height:2.65,az:yaw+2.84,elevation:.47},
    time:line.timeAt(line.end+centre-half-1.35)};
}
