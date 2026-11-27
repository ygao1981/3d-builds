import * as T from 'three';

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
  function roller(a,b,r=.05,material=steel) {
    const v=new T.Vector3().subVectors(new T.Vector3(...b),new T.Vector3(...a));
    part(drum,material,a.map((v,i)=>(v+b[i])/2),[r,v.length(),r],new T.Quaternion().setFromUnitVectors(up,v.normalize()));
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

export {metal,frame,belt,steel,side,dark,amber,platform,unitBox,drum,up,lerp,mod,distance,batch,conveyor,fitted};
