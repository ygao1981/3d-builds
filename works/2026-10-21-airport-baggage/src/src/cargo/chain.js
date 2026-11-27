import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {amber,dark,frame,metal,side,steel,mod} from './hardware.js';

const plateMetal=metal('#343e45',.49,.72), pinMetal=metal('#abb1a7',.42,.65);
const radius=.102, pitch=.11, pinRadius=.021, railOffsets=[-.365,.365];
const plateHeight=.048;
const plateGeometry=mergeGeometries([-.050,.050].map(z=>new T.BoxGeometry(.095,plateHeight,.018).translate(0,0,z)));
const pinGeometry=new T.CylinderGeometry(pinRadius,pinRadius,.132,8).rotateX(Math.PI/2);
function sprocket(){
  const outline=new T.Shape();
  const steps=48;
  for(let i=0;i<steps;i++){
    const a=i*Math.PI*2/steps,r=i%4===1 || i%4===2?radius+.006:radius-.016;
    if(i)outline.lineTo(r*Math.cos(a),r*Math.sin(a));else outline.moveTo(r,0);
  }
  outline.closePath();
  return new T.ExtrudeGeometry(outline,{depth:.059,bevelEnabled:false}).translate(0,0,-.0295);
}
const gear=sprocket();

export function makeChainBank(parent,b,s,ports){
  const coords=ports.map(i=>s.transfers[i]),z=coords[0][1];
  const x0=Math.min(...coords.map(p=>p[0]))-.48,x1=Math.max(...coords.map(p=>p[0]))+.48;
  const axisY=s.chainDeck-plateHeight/2-radius,run=x1-x0,arc=Math.PI*radius,circuit=2*(run+arc);
  const count=Math.round(circuit/pitch),spacing=circuit/count;
  const plates=new T.InstancedMesh(plateGeometry,plateMetal,count*2),pins=new T.InstancedMesh(pinGeometry,pinMetal,count*2);
  plates.name='输送链侧板';pins.name='输送链销轴';parent.add(plates,pins);
  const wheels=[];
  for(const offset of railOffsets){
    for(const x of [x0,x1]){
      const wheel=new T.Mesh(gear,steel);wheel.position.set(x,axisY,z+offset);parent.add(wheel);wheels.push(wheel);
    }
    b.box((x0+x1)/2,axisY+.044,z+offset,run,.045,.075,dark);
    b.box((x0+x1)/2,axisY-.07,z+offset,run,.025,.062,side);
  }
  for(const sign of [-1,1])b.box((x0+x1)/2,axisY-.14,z+sign*.52,run+.25,.16,.062,frame);
  for(const [x] of coords){
    b.box(x,axisY-.23,z,.12,.09,1.12,frame);
    for(const offset of [-.50,.50]){
      b.box(x,(axisY-.27)/2,z+offset,.09,axisY-.27,.09,side);
      b.box(x,.027,z+offset,.18,.054,.18,steel);
    }
  }
  for(const x of [x0,x1])b.roller([x,axisY,z-.56],[x,axisY,z+.56],.045);
  const motorX=ports[0]<ports.at(-1)?x0:x1;
  b.box(motorX,axisY,z-.585,.25,.22,.16,amber);b.roller([motorX,axisY,z-.65],[motorX,axisY,z-.94],.106,dark);
  for(let i=0;i<5;i++)b.roller([motorX,axisY,z-.68-i*.048],[motorX,axisY,z-.69-i*.048],.118,side);
  const ref=new T.Object3D();
  function populate(travel){
    for(let j=0;j<count;j++){
      const d=mod(j*spacing+travel,circuit);
      let x,y,angle;
      if(d<run){x=x0+d;y=axisY+radius;angle=0;}
      else if(d<run+arc){const a=(d-run)/radius;x=x1+radius*Math.sin(a);y=axisY+radius*Math.cos(a);angle=-a;}
      else if(d<2*run+arc){x=x1-(d-run-arc);y=axisY-radius;angle=Math.PI;}
      else{const a=(d-2*run-arc)/radius;x=x0-radius*Math.sin(a);y=axisY-radius*Math.cos(a);angle=Math.PI-a;}
      ref.rotation.set(0,0,angle);
      railOffsets.forEach((offset,strand)=>{
        const index=j+strand*count;
        ref.position.set(x,y,z+offset);ref.updateMatrix();plates.setMatrixAt(index,ref.matrix);
        ref.position.x+=.042*Math.cos(angle);ref.position.y+=.042*Math.sin(angle);
        ref.updateMatrix();pins.setMatrixAt(index,ref.matrix);
      });
    }
    plates.instanceMatrix.needsUpdate=pins.instanceMatrix.needsUpdate=true;
    for(const wheel of wheels)wheel.rotation.z=-travel/radius;
  }
  populate(0);plates.computeBoundingSphere();pins.computeBoundingSphere();
  let previous=0;
  return {plates,pins,wheels,update(time,machine){
    const t=mod(time+machine.offset,machine.cycle);
    const direction=Math.sign(s.transfers[ports[0]][0]-s.transfers[machine.nearest][0]);
    let travel=0;
    for(const trip of machine.trips)if(trip.cross)travel+=Math.max(0,Math.min(t,trip.outletAt)-trip.chainAt)*.26;
    travel*=direction;if(Math.abs(travel-previous)>1e-7){populate(travel);previous=travel;}
  }};
}
