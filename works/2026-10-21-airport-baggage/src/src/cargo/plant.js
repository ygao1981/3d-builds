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
  function roller(a,b,r=.05) {
    const v=new T.Vector3().subVectors(new T.Vector3(...b),new T.Vector3(...a));
    part(drum,steel,a.map((v,i)=>(v+b[i])/2),[r,v.length(),r],new T.Quaternion().setFromUnitVectors(up,v.normalize()));
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
  } else if(kind==='chain') {
    for(const offset of [-.37,0,.37]) b.beam(xyz(0,-.02,offset*width),xyz(1,-.02,offset*width),.065,.04,steel);
  } else b.beam(xyz(0,-.03),xyz(1,-.03),width*.95,.06,belt);
  for(const sign of [-1,1]) b.beam(xyz(0,-.045,width*.50*sign),xyz(1,-.045,width*.50*sign),.055,.16,side);
  const pairs=Math.max(1,Math.ceil(len/2.8));
  for(let i=0;i<pairs;i++) for(const sign of [-1,1]) {
    const [x,y,z]=xyz((i+.42)/pairs,-.22,width*.39*sign);
    if(y>.05) {b.box(x,y/2,z,.09,y,.09,frame);b.box(x,.025,z,.21,.05,.21,steel);}
  }
}

function fitted(scene, xSize, ySize, zSize) {
  const model=scene.clone(true), raw=new T.Box3().setFromObject(model,true);
  const size=raw.getSize(new T.Vector3()), mid=raw.getCenter(new T.Vector3());
  model.position.set(-mid.x,-raw.min.y,-mid.z);
  const inner=new T.Group(); inner.scale.set(xSize/size.x,ySize/size.y,zSize/size.z); inner.add(model);
  const g=new T.Group();g.add(inner);return g;
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

function sorterPlant(spec,scenes) {
  const group=new T.Group(), b=batch(group), loop=loopGeometry(spec), {deck,width}=spec;
  const spans=148;
  for(let i=0;i<spans;i++){
    const a=loop.at(i*loop.length/spans), c=loop.at((i+1)*loop.length/spans);
    for(const sign of [-1,1]){
      const pos=(p,off,y)=>[p[0]-p[3]*off*sign,y,p[1]+p[2]*off*sign];
      b.beam(pos(a,width*.47,deck-.26),pos(c,width*.47,deck-.26),.16,.30,frame);
      const walkway=sign===1?1.18:.88;
      b.beam(pos(a,width*.50+walkway/2,deck-.69),pos(c,width*.50+walkway/2,deck-.69),walkway,.12,platform);
      const opening=sign===1 && (spec.feeds.some(([,j])=>Math.abs(a[1]-j[1])<.36 && Math.abs(a[0]-j[0])<1.25) ||
        spec.chutes.some(([h])=>Math.abs(a[1]-spec.radius)<.35 && Math.abs(a[0]-h[0])<spec.chuteWidth*.58));
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
  for(const [a,c] of spec.feeds) {
    for(let i=0;i<5;i++){
      const point=t=>[lerp(a[0],c[0],t),lerp(a[1],c[1],t)];
      // The final part of the path runs over the sorter cart, past the physical induction nose.
      const nose=1-(width*.5/Math.abs(c[1]-a[1]));
      conveyor(b,point(i/5*nose),point((i+.985)/5*nose),deck,deck,spec.feedWidth);
    }
  }
  for(const [a,c] of spec.chutes) {
    const mid=[lerp(a[0],c[0],.80),lerp(a[1],c[1],.80)];
    conveyor(b,a,mid,spec.chuteTop,spec.chuteBottom,spec.chuteWidth,'roller');
    conveyor(b,mid,c,spec.chuteBottom,spec.chuteBottom,spec.chuteWidth,'roller');
  }
  for(const path of spec.returns) for(let i=1;i<path.length;i++){
    const a=path[i-1],c=path[i];conveyor(b,a,c,a[2],c[2],1.2);
  }
  const [sx,sz]=spec.scanner;
  for(const dz of [-1,1]) b.box(sx,deck+.55,sz+dz,.16,1.35,.13,dark);
  b.box(sx,deck+1.23,sz,.40,.18,2.12,dark);
  b.box(sx+.21,deck+1.25,sz,.035,.09,.55,amber);
  b.finish();
  const body=fitted(scenes.box_cardboard_a01,.51,.32,.39);
  const loads=Array.from({length:Math.min(18,spec.carts)},(_,i)=>{
    const box=body.clone(true);group.add(box);return {box,slot:Math.floor(i*spec.carts/18),inlet:i%spec.feeds.length,outlet:i%spec.chutes.length};
  });
  const tmp=new T.Object3D(),speed=1.48,phase=.55;
  function update(t) {
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
      const carry=(releaseS-feedS)/speed, cycle=loop.length/speed, incoming=distance(entry,join)/1.2;
      box.visible=true;box.rotation.set(0,0,0);
      if(age<carry){
        const [x,z,dx,dz]=loop.at(feedS+age*speed);box.position.set(x,deck+.003,z);box.rotation.y=-Math.atan2(dz,dx);
      } else if(age<carry+phase){
        const u=(age-carry)/phase;box.position.set(head[0]-speed*phase*(1-u),lerp(deck,spec.chuteTop,u),lerp(spec.radius,head[1],u));
      } else if(age<carry+phase+4.8){
        const u=(age-carry-phase)/4.8;
        box.position.set(lerp(head[0],tail[0],u),lerp(spec.chuteTop,spec.chuteBottom,Math.min(1,u/.8)),lerp(head[1],tail[1],u));
      } else if(age>cycle-incoming){
        const u=1-(cycle-age)/incoming;box.position.set(lerp(entry[0],join[0],u),deck,lerp(entry[1],join[1],u));
        box.rotation.y=-Math.atan2(join[1]-entry[1],join[0]-entry[0]);
      } else box.visible=false;
    }
  }
  cells.frustumCulled=edges.frustumCulled=false;
  update(0);return {group,update,loop,loads};
}

function palletPlant(s,scenes) {
  const group=new T.Group(), b=batch(group), wheels=[], movers=[], turns=[];
  const wooden=fitted(scenes.pallet_a01,1.2,.145,1.0);
  for(let i=0;i<s.turns.length;i++){
    const entry=s.inlets[i],turn=s.turns[i],stack=s.stackers[i];
    const sign=Math.sign(turn[0]-entry[0]), start=[entry[0]+1.5*sign,entry[1]];
    const kit=scenes.conveyor_belt_a05.clone(true), swivel=new T.Group();
    kit.traverse(n=>{if(/^sm_roller\d+_.*_obj_00$/.test(n.name))wheels.push({n,rest:n.quaternion.clone(),sign:1});});
    kit.position.x=-.5014;swivel.add(kit);swivel.scale.set(s.width/.903,s.deck/.7693,1.5/2);
    swivel.rotation.y=sign*Math.PI/2;swivel.position.set(entry[0],0,entry[1]);group.add(swivel);
    conveyor(b,start,[turn[0]-sign*.94,turn[1]],s.deck,s.deck,s.width,'roller');
    const base=new T.Mesh(new T.CylinderGeometry(.92,.94,s.deck-.10,48),frame);
    base.position.set(turn[0],(s.deck-.10)/2,turn[1]);group.add(base);
    const table=new T.Group(),tb=batch(table);
    for(let j=-5;j<=5;j++){
      const dx=j*.145,half=Math.sqrt(.88*.88-dx*dx);
      tb.roller([dx,-.055,-half],[dx,-.055,half],.055);
    }
    tb.finish();table.position.set(turn[0],s.deck,turn[1]);group.add(table);turns.push(table);
    const row=s.transfers.filter(p=>i===0?p[0]<(s.turns[0][0]+s.turns[1][0])/2:p[0]>(s.turns[0][0]+s.turns[1][0])/2);
    const tz=row[0][1], far=row.reduce((m,p)=>Math.abs(p[0]-turn[0])>Math.abs(m[0]-turn[0])?p:m,row[0]);
    conveyor(b,[turn[0],turn[1]+.92],[turn[0],tz-.52],s.deck,s.deck,s.width,'roller');
    conveyor(b,[turn[0],tz],[far[0],tz],s.chainDeck,s.chainDeck,1.2,'chain');
    for(const [dx,dz] of [[-.68,-.64],[-.68,.64],[.68,-.64],[.68,.64]])b.box(stack[0]+dx,1.25,stack[1]+dz,.10,2.5,.10,side);
    b.box(stack[0],2.46,stack[1]-.64,1.46,.10,.12,amber);b.box(stack[0],2.46,stack[1]+.64,1.46,.10,.12,amber);
    for(let j=0;j<5;j++){const obj=wooden.clone(true);obj.position.set(stack[0],s.deck+.30+j*.15,stack[1]);group.add(obj);}
    const load=wooden.clone(true);group.add(load);movers.push({load,entry,turn,row,index:i});
  }
  s.transfers.forEach((a,i)=>conveyor(b,a,s.tails[i],s.deck,s.deck,s.width,'roller'));
  b.finish();
  const spin=new T.Quaternion(),axis=new T.Vector3(1,0,0);
  function update(t){
    for(const {n,rest} of wheels)n.quaternion.copy(rest).multiply(spin.setFromAxisAngle(axis,t*.26/.029));
    for(const {load,entry,turn,row,index} of movers){
      const tripTimes=row.map(out=>(distance(entry,turn)+Math.abs(out[1]-turn[1])+Math.abs(out[0]-turn[0])
        +distance(out,s.tails[s.transfers.indexOf(out)]))/.26+4);
      let local=mod(t+index*23,tripTimes.reduce((sum,tr)=>sum+tr,0)), trip=0;
      while(trip<row.length-1 && local>=tripTimes[trip]){local-=tripTimes[trip];trip++;}
      const out=row[trip],tail=s.tails[s.transfers.indexOf(out)];
      const path=[entry,turn,turn,[turn[0],out[1]],out,tail];
      const periods=[distance(entry,turn)/.26,2,distance(turn,path[3])/.26,distance(path[3],out)/.26,distance(out,tail)/.26];
      let age=local,leg=0;
      while(leg<periods.length && age>=periods[leg]){age-=periods[leg];leg++;}
      load.visible=leg<periods.length;
      const rotation=leg===0?0:leg===1?(age/2)*Math.PI/2:Math.PI/2;
      turns[index].rotation.y=leg<3?rotation:0;
      if(!load.visible)continue;
      const u=periods[leg]?age/periods[leg]:1,a=path[leg],c=path[leg+1];
      load.position.set(lerp(a[0],c[0],u),leg===3?s.chainDeck:s.deck,lerp(a[1],c[1],u));load.rotation.y=rotation;
    }
  }
  update(0);return {group,update,movers};
}

function dockPlant(s) {
  const group=new T.Group(),b=batch(group);
  for(const {at:[x,z]} of s.levellers){
    const [w,d]=s.levelSize;
    b.box(x,.23,z,w,.46,d,frame);b.box(x,.49,z,w,.06,d,platform);
    b.box(x,.52,z+d*.5-.08,w,.025,.14,amber);
  }
  for(const path of s.handoffs) for(let i=1;i<path.length;i++)conveyor(b,path[i-1],path[i],s.deck,s.deck,s.rollerWidth,'roller');
  b.finish();return group;
}

function breakdownTables(spec) {
  const group=new T.Group(),b=batch(group);
  for(const {at:[x,z],rotated} of spec.places){
    const [w,d]=rotated?[...spec.size].reverse():spec.size;
    b.box(x,spec.height*.40,z,w,spec.height*.8,d,frame);
    const cw=w/3,cd=d/3;
    for(let i=-1;i<=1;i++) for(let j=-1;j<=1;j++){
      const cx=x+i*cw,cz=z+j*cd;
      for(let k=-2;k<=2;k++) b.roller([cx-cw*.43,spec.height-.035,cz+k*cd*.17],[cx+cw*.43,spec.height-.035,cz+k*cd*.17],.035);
    }
  }
  b.finish();return group;
}

export function createCargoPlant(data,scenes) {
  return {sorting:sorterPlant(data.sorter,scenes),pallet:palletPlant(data.pallet,scenes),dock:dockPlant(data.dock),tables:breakdownTables(data.tables)};
}
