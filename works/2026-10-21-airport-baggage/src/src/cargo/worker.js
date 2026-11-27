import * as T from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';

const {clamp,lerp,smoothstep}=T.MathUtils;
const up=new T.Vector3(0,1,0),across=new T.Vector3(-1,0,0);
const point=(x,y,z)=>new T.Vector3(x,y,z);

// A rounded aisle path drives both the body and its planted footsteps, including reverse playback.
export function walkingRoute(points){
  const route=new T.CurvePath(),corners=points.map(([x,z])=>point(x,0,z));
  let from=corners[0];
  for(let i=1;i<corners.length-1;i++){
    const corner=corners[i],prev=corners[i-1],next=corners[i+1];
    const radius=Math.min(.20,corner.distanceTo(prev)*.25,corner.distanceTo(next)*.25);
    const enter=corner.clone().lerp(prev,radius/corner.distanceTo(prev));
    const leave=corner.clone().lerp(next,radius/corner.distanceTo(next));
    route.add(new T.LineCurve3(from,enter));route.add(new T.QuadraticBezierCurve3(enter,corner,leave));from=leave;
  }
  route.add(new T.LineCurve3(from,corners.at(-1)));
  return route;
}

export function riggedOperator(parent,template){
  const figure=new T.Group(),model=clone(template);
  figure.name='货站作业员';figure.add(model);parent.add(figure);
  const mesh=model.getObjectByProperty('isSkinnedMesh',true),skeleton=mesh.skeleton;
  mesh.castShadow=mesh.receiveShadow=true;mesh.frustumCulled=false;
  const bone=name=>skeleton.getBoneByName(name);
  const hips=bone('hips'),spine=bone('spine'),chest=bone('chest'),neck=bone('neck'),head=bone('head');
  const rest=new Map(skeleton.bones.map(b=>[b,b.quaternion.clone()])),hipHome=hips.position.clone();
  const inverse=new T.Matrix4(),basis=new T.Matrix4(),rootQ=new T.Quaternion(),parentInv=new T.Quaternion();
  const origin=point(),axis=point(),perp=point(),joint=point(),direction=point(),goal=point(),footOffset=point();
  const palm=point(),fingerDir=point(),thumbDir=point(),swing=new T.Quaternion(),handQ=new T.Quaternion();

  function updateRoot(){
    figure.updateWorldMatrix(true,false);inverse.copy(figure.matrixWorld).invert();figure.getWorldQuaternion(rootQ);
  }
  function location(node,out){
    node.updateWorldMatrix(true,false);
    return out.setFromMatrixPosition(node.matrixWorld).applyMatrix4(inverse);
  }
  function orientation(node,rotation){
    node.parent.getWorldQuaternion(parentInv).invert();
    node.quaternion.copy(parentInv.multiply(rootQ).multiply(rotation));
  }
  function bindRotation(node){
    return rootQ.clone().invert().multiply(node.getWorldQuaternion(new T.Quaternion()));
  }
  updateRoot();
  function chain(first,second,last){
    const a=bone(first),b=bone(second),end=bone(last);
    const qa=bindRotation(a),qb=bindRotation(b);
    return {a,b,end,qa,qb,qe:bindRotation(end),lengthA:b.position.length(),lengthB:end.position.length(),
      aDir:b.position.clone().applyQuaternion(qa).normalize(),bDir:end.position.clone().applyQuaternion(qb).normalize(),
      home:location(end,point())};
  }
  // Two fixed bone lengths, with a pole guiding the elbow down or the knee forward.
  function solve(c,target,pole,endRotation){
    location(c.a,origin);axis.copy(target).sub(origin);
    const distance=Math.max(.0001,axis.length());axis.multiplyScalar(1/distance);
    const span=clamp(distance,Math.abs(c.lengthA-c.lengthB)+.00001,c.lengthA+c.lengthB-.00001);
    const along=(c.lengthA**2-c.lengthB**2+span**2)/(2*span);
    perp.copy(pole).addScaledVector(axis,-axis.dot(pole)).normalize();
    joint.copy(origin).addScaledVector(axis,along).addScaledVector(perp,Math.sqrt(Math.max(0,c.lengthA**2-along**2)));
    swing.setFromUnitVectors(c.aDir,direction.copy(joint).sub(origin).normalize()).multiply(c.qa);
    orientation(c.a,swing);
    direction.copy(origin).addScaledVector(axis,span).sub(joint).normalize();
    swing.setFromUnitVectors(c.bDir,direction).multiply(c.qb);orientation(c.b,swing);
    orientation(c.end,endRotation);
  }
  const limbs=['L','R'].map((side,index)=>{
    const sign=index?-1:1;
    const arm=chain('upperarm_'+side,'forearm_'+side,'hand_'+side);
    const leg=chain('thigh_'+side,'calf_'+side,'foot_'+side);
    const fingers=skeleton.bones.filter(b=>/^(index|middle|ring|pinky)_0[23]_/.test(b.name)&&b.name.endsWith('_'+side));
    return {arm,leg,fingers,sign,index,elbow:point(sign*.40,-1,-.39),knee:point(sign*.07,0,1),
      pad:point(sign*.016,.064,.006),ankle:point()};
  });

  const footfalls=new WeakMap();
  function planSteps(path){
    if(footfalls.has(path))return footfalls.get(path);
    const count=Math.max(3,Math.ceil(path.getLength()/.26)),yaw=figure.rotation.y;
    const lateral=point(Math.cos(yaw),0,-Math.sin(yaw)),anchors=[];
    function landing(limb,fraction){
      const {home}=limb.leg;
      const offset=point(home.x+limb.sign*.025,0,home.z+limb.sign*.025).applyAxisAngle(up,yaw);
      const anchor={at:path.getPoint(fraction).add(offset),outward:0,sign:limb.sign};
      anchors.push(anchor);return anchor;
    }
    const pairs=[limbs.map(limb=>landing(limb,0))];
    for(let i=0;i<count;i++){
      const pair=pairs[i].slice(),moving=i%2;
      pair[moving]=landing(limbs[moving],i>=count-2?1:(i+1)/count);pairs.push(pair);
    }
    // Reserve boot width also on side steps. Adjust landings once so the planted sole never slides.
    for(const [left,right] of pairs){
      const separation=left.at.dot(lateral)-right.at.dot(lateral);
      const margin=Math.max(0,(.165-separation)/2);
      left.outward=Math.max(left.outward,margin);right.outward=Math.max(right.outward,margin);
    }
    for(const a of anchors)a.at.addScaledVector(lateral,a.sign*a.outward);
    footfalls.set(path,pairs);return pairs;
  }

  function pose({time=0,height=1,reach=.4,halfWidth=.20,grip=0,path,progress=0}){
    updateRoot();
    const low=clamp((1.09-height)/.73,0,1)*grip,stretch=clamp((reach-.39)/.30,0,1)*grip;
    const pairs=path && planSteps(path),steps=pairs?pairs.length-1:1;
    const station=clamp(progress,0,1)*steps,step=Math.min(steps-1,Math.floor(station));
    const blend=smoothstep(station-step,.045,.955),lift=pairs?Math.sin(Math.PI*blend):0;
    const sway=.007*Math.sin(time*1.75),lean=.11*grip+.42*stretch+.52*low;
    hips.position.copy(hipHome);
    const walking=smoothstep(progress,0,.12)*(1-smoothstep(progress,.88,1));
    hips.position.y-=.012+.023*grip+.455*low+.055*stretch+.024*walking+.014*lift;
    hips.position.z+=.105*stretch-.12*low;
    for(const [node,angle] of [[hips,lean*.18],[spine,lean*.50],[chest,lean*.32],[neck,.23*grip-.63*lean],[head,.12*grip+sway]]){
      node.quaternion.copy(rest.get(node));node.rotateX(angle);
    }
    let lowerHips=0;
    for(const {leg,ankle,sign,index} of limbs){
      const moving=pairs && (step+index)%2===0;
      footOffset.set(leg.home.x+sign*.025,0,leg.home.z+sign*.025);
      if(pairs){
        footOffset.copy(pairs[step][index].at).lerp(pairs[step+1][index].at,blend);
        footOffset.sub(figure.position).applyAxisAngle(up,-figure.rotation.y);
      }
      ankle.copy(footOffset);ankle.y=leg.home.y+(moving?.070*lift:0);
      location(leg.a,origin);
      const lateralSq=(origin.x-ankle.x)**2+(origin.z-ankle.z)**2;
      const vertical=Math.sqrt(Math.max(0,(leg.lengthA+leg.lengthB-.003)**2-lateralSq));
      lowerHips=Math.max(lowerHips,origin.y-ankle.y-vertical);
    }
    hips.position.y-=lowerHips;
    const palmAngle=lerp(.13,1.54,grip);
    fingerDir.set(0,-Math.cos(palmAngle),Math.sin(palmAngle));thumbDir.crossVectors(across,fingerDir);
    handQ.setFromRotationMatrix(basis.makeBasis(across,fingerDir,thumbDir));
    for(const limb of limbs){
      const {leg,arm,ankle,sign}=limb;
      solve(leg,ankle,limb.knee,leg.qe);
      // The contact point is the inner palm. Placing the wrist itself on the carton would bury the fingers.
      palm.set(sign*lerp(.256,halfWidth,grip),lerp(.845+sway,height,grip),lerp(.055-.34*ankle.z,reach,grip));
      goal.copy(limb.pad).applyQuaternion(handQ).negate().add(palm);
      solve(arm,goal,limb.elbow,handQ);
      for(const finger of limb.fingers){
        finger.quaternion.copy(rest.get(finger));finger.rotateX(-sign*lerp(.24,.035,grip));
      }
    }
  }
  pose({});
  return {figure,pose,mesh,limbs};
}
