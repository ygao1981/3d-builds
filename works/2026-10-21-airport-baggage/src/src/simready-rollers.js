import * as T from 'three';

// SimReady joint axes are expressed in the authored scene frame.
export function measureRollers(scene){
  scene.updateMatrixWorld(true);
  const rollers=[];
  scene.traverse(node=>{
    if(!/^sm_roller\d+_.*_obj_00$/.test(node.name))return;
    const joint=node.userData.joints?.find(item=>item.type==='revolute');
    if(!joint)throw new Error('Missing revolute joint on '+node.name);
    const pivot=node.getWorldPosition(new T.Vector3());
    const top=new T.Box3().setFromObject(node,true).max.y;
    const axis=new T.Vector3(...joint.axis).applyQuaternion(node.parent.getWorldQuaternion(new T.Quaternion()).invert()).normalize();
    rollers.push({name:node.name,axis,rest:node.quaternion.clone(),top,radius:top-pivot.y});
  });
  if(!rollers.length || rollers.some(r=>r.radius<.02 || r.radius>.04))throw new Error('Unexpected roller geometry in '+scene.name);
  return rollers;
}
