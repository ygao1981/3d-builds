import * as T from 'three';
import {belt,frame,side,steel,distance,lerp} from './hardware.js';

export function direction(a,b){
  const length=distance(a,b);
  return [(b[0]-a[0])/length,(b[1]-a[1])/length];
}
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
const normal=([x,z])=>[-z,x];

// The full cross-section meets the mating face, including at an oblique transfer.
function sections(path,firstFace,lastFace){
  return path.map((p,i)=>{
    const prev=i>0?direction(path[i-1],p):null;
    const next=i+1<path.length?direction(p,path[i+1]):null;
    const along=next || prev, across=normal(along);
    const face=!prev?firstFace:!next?lastFace:null;
    let offset=across;
    if(face){
      const shift=dot(across,face)/dot(along,face);
      offset=[across[0]-along[0]*shift,across[1]-along[1]*shift];
    }else if(prev && next){
      const n=normal(prev),factor=1/(1+dot(prev,next));
      offset=[(n[0]+across[0])*factor,(n[1]+across[1])*factor];
    }
    return {p,at:(v,h)=>[p[0]+v*offset[0],p[2]+h,p[1]+v*offset[1]]};
  });
}

function ribbon(group,rows,lo,hi,level,thickness,material){
  const vertices=[];
  function quad(a,b,c,d){vertices.push(...a,...b,...c,...a,...c,...d);}
  for(let i=1;i<rows.length;i++){
    const a=rows[i-1],b=rows[i],bottom=level-thickness;
    const l=a.at(lo,level),r=a.at(hi,level),s=b.at(lo,level),t=b.at(hi,level);
    const L=a.at(lo,bottom),R=a.at(hi,bottom),S=b.at(lo,bottom),U=b.at(hi,bottom);
    quad(l,r,t,s);quad(L,S,U,R);quad(l,s,S,L);quad(r,R,U,t);
    if(i===1)quad(l,L,R,r);
    if(i===rows.length-1)quad(s,t,U,S);
  }
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));geometry.computeVertexNormals();
  const mesh=new T.Mesh(geometry,material);mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);
  return mesh;
}

export function beltRun(group,b,points,width,options={}){
  const path=points.filter((p,i)=>!i || distance(p,points[i-1])>.0001);
  const rows=sections(path,options.firstFace,options.lastFace),half=width/2;
  ribbon(group,rows,-half-.025,half+.025,-.065,.17,frame);
  const surface=ribbon(group,rows,-half,half,0,.065,options.material || belt);
  surface.name='输送承载面';
  for(const sign of [-1,1]){
    // Leave an opening in the rail where a side transfer actually enters the belt.
    let start=0;
    for(let i=1;i<=rows.length;i++){
      const cut=i===rows.length || options.openSide?.(path[i-1],path[i],sign);
      if(!cut)continue;
      if(i-start>=2){
        const offset=sign*(half+.018);
        ribbon(group,rows.slice(start,i),offset-.017,offset+.017,.024,.138,side);
      }
      start=i;
    }
  }
  let travelled=0,leg=.37;
  for(let i=1;i<path.length;i++){
    const a=path[i-1],c=path[i],length=distance(a,c),n=normal(direction(a,c));
    for(;leg<=travelled+length;leg+=2.65){
      const u=(leg-travelled)/length,h=lerp(a[2],c[2],u)-.235;
      if(h<.05)continue;
      for(const offset of [-width*.40,width*.40]){
        const x=lerp(a[0],c[0],u)+n[0]*offset,z=lerp(a[1],c[1],u)+n[1]*offset;
        b.box(x,h/2,z,.095,h,.095,frame);b.box(x,.025,z,.21,.05,.21,steel);
      }
    }
    travelled+=length;
  }
  return surface;
}

// Intersect two centre lines in plan. Some transitions end on the receiving belt's side face.
export function meetLine(a,along,point,face){
  const step=dot([point[0]-a[0],point[1]-a[1]],face)/dot(along,face);
  return [a[0]+step*along[0],a[1]+step*along[1]];
}

export function alongTrunk(group,b,points,width,ports){
  const expanded=[points[0]],half=width/2;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],c=points[i];
    if(Math.abs(c[1]-a[1])<.001){
      const cuts=ports.filter(v=>Math.abs(a[1]+v.bank*half-v.mid[1])<.015)
        .flatMap(v=>[v.min,v.max]).filter(x=>(x-a[0])*(x-c[0])<-.00001)
        .sort((p,q)=>(p-q)*Math.sign(c[0]-a[0]));
      for(const x of cuts)expanded.push([x,a[1],lerp(a[2],c[2],(x-a[0])/(c[0]-a[0]))]);
    }
    expanded.push(c);
  }
  return beltRun(group,b,expanded,width,{openSide:(a,c,sign)=>{
    const x=(a[0]+c[0])/2,z=(a[1]+c[1])/2;
    const bank=sign*Math.sign(c[0]-a[0]);
    return ports.some(v=>bank===v.bank && Math.abs(z+bank*half-v.mid[1])<.015 && x>=v.min && x<=v.max);
  }});
}

export function sidePort(a,along,trunkZ,width,bank,branchWidth=width){
  const mid=meetLine(a,along,[0,trunkZ+bank*width/2],[0,1]);
  const reach=branchWidth/(2*Math.abs(along[1]));
  return {mid,min:mid[0]-reach,max:mid[0]+reach,bank};
}
