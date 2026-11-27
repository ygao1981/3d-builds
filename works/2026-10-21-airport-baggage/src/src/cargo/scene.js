import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { createCargoPlant } from './plant.js';
import manifest from '../simready-assets.json';

const rootUrl='/project-layout/';
const cargoModels=manifest.models.filter(model=>model.projects.includes('cargo'));
const refs=(d)=>({sorting:d.sorter.reference,pallet:d.pallet.reference,dock:d.dock.reference,tables:d.tables.reference});
const middle=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2];

function floorTexture() {
  const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d');
  g.fillStyle='#c9ceca';g.fillRect(0,0,256,256);
  let seed=73;
  for(let i=0;i<9000;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const x=seed&255,y=(seed>>>14)&255;
    g.fillStyle=i%2?'rgba(90,97,89,.075)':'rgba(255,255,255,.12)';g.fillRect(x,y,1.5,1);}
  g.fillStyle='#aab3ad';g.fillRect(0,0,1,256);g.fillRect(0,0,256,1);
  const tex=new T.CanvasTexture(c);tex.wrapS=tex.wrapT=T.RepeatWrapping;tex.repeat.set(64,52);tex.colorSpace=T.SRGBColorSpace;return tex;
}

function traces(data,plant) {
  const groups={sorting:new T.Group(),pallet:new T.Group(),dock:new T.Group(),tables:new T.Group()};
  const mat=new LineMaterial({color:'#008179',linewidth:2.6,depthTest:false,depthWrite:false,toneMapped:false});
  const lowerMat=mat.clone();lowerMat.color.set('#a94416');
  function trace(key,line) {
    const geo=new LineGeometry();geo.setPositions(line.flatMap(([x,z])=>[x,.02,z]));
    const obj=new Line2(geo,key==='pallet'?lowerMat:mat);obj.renderOrder=10;groups[key].add(obj);
  }
  const loop=plant.sorting.loop,s=data.sorter,p=data.pallet;
  trace('sorting',Array.from({length:241},(_,i)=>loop.at(i*loop.length/240)));
  [...s.feeds,...s.chutes,...s.returns].forEach(path=>trace('sorting',path));
  p.turns.forEach((t,i)=>{
    trace('pallet',[p.inlets[i],t,[t[0],p.transfers[0][1]]]);
    const edge=i===0?p.transfers[0]:p.transfers.at(-1);
    trace('pallet',[[t[0],edge[1]],edge]);
  });
  p.transfers.forEach((t,i)=>trace('pallet',[t,p.tails[i]]));
  const [w,d]=data.dock.levelSize;
  data.dock.levellers.forEach(({at:[x,z]})=>trace('dock',[[x-w/2,z-d/2],[x+w/2,z-d/2],[x+w/2,z+d/2],[x-w/2,z+d/2],[x-w/2,z-d/2]]));
  data.dock.handoffs.forEach(points=>trace('dock',points));
  data.tables.places.forEach(({at:[x,z],rotated})=>{
    const [a,b]=(rotated?[...data.tables.size].reverse():data.tables.size).map(v=>v/2);
    trace('tables',[[x-a,z-b],[x+a,z-b],[x+a,z+b],[x-a,z+b],[x-a,z-b]]);
  });
  return groups;
}

// All navigation targets come from the locally registered plan.
export function targets(data) {
  const sort=data.sorter, p=data.pallet, d=data.dock;
  return {
    sorting:sort.feeds.map(([a,c],i)=>({label:'供包台 '+(i+1),at:middle(a,c),height:sort.deck})),
    chutes:sort.chutes.map(([a,c],i)=>({label:'滚筒滑槽 '+(i+1),at:middle(a,c),height:(sort.chuteTop+sort.chuteBottom)/2})),
    pallet:[...p.stackers.map((at,i)=>({label:'拆盘机 '+(i+1),at,height:p.deck})),
      ...p.turns.map((at,i)=>({label:'旋转台 '+(i+1),at,height:p.deck})),
      ...p.transfers.map((at,i)=>({label:'移载支路 '+(i+1),at,height:p.deck}))],
    dock:[...d.levellers.map(item=>({label:item.id+' 调平台',at:item.at,height:.5})),
      ...d.handoffs.map((row,i)=>({label:'整板箱交接 '+(i+1),at:row[1],height:d.deck}))],
    tables:data.tables.places.map(({at},i)=>({label:'图示台位 '+String(i+1).padStart(2,'0'),at,height:data.tables.height})),
    overview:[],
  };
}

export async function openCargo(canvas, onStatus) {
  const response=await fetch(rootUrl+'layout.json',{cache:'no-store'});
  if(!response.ok || !response.headers.get('content-type')?.includes('json')) throw new Error('本机尚未配置项目工艺图纸，请载入本项目的布局资料后重试。');
  const data=await response.json();
  if(data.schema!==2 || !data.sorter?.chutes?.length || !data.pallet?.tails?.length || !Array.isArray(data.pallet.offset) ||
    data.pallet.offset.length!==2 || !data.pallet.offset.every(Number.isFinite) || !data.dock?.levellers?.length || !data.tables?.places?.length)
    throw new Error('项目布局数据不完整，请重新生成工艺图纸数据。');
  onStatus('正在加载设备模型和图纸局部…');
  const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const tx=new T.TextureLoader();
  const [assets,images]=await Promise.all([
    Promise.all(cargoModels.map(async model=>{
      try{return [model.id,(await loader.loadAsync('/simready/'+model.id+'.glb')).scene];}
      catch(error){if(!model.optional)throw error;console.warn('纸箱款式加载失败',model.id,error);return null;}
    })),
    Promise.all(Object.entries(refs(data)).map(async ([key,ref])=>[key,await tx.loadAsync(rootUrl+ref.image)])),
  ]);
  const renderer=new T.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;
  renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
  const scene=new T.Scene();scene.background=new T.Color('#dce4e2');
  const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment(),env=pmrem.fromScene(room,.04);
  room.dispose();pmrem.dispose();scene.environment=env.texture;scene.environmentIntensity=.70;
  const sun=new T.DirectionalLight('#fff2d9',2.1);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
  Object.assign(sun.shadow.camera,{near:1,far:170,left:-43,right:43,top:43,bottom:-43});
  sun.shadow.camera.updateProjectionMatrix();sun.shadow.normalBias=.035;sun.shadow.bias=-.00018;
  scene.add(sun,sun.target,new T.HemisphereLight('#dfefff','#9b9d8d',1.25));
  const floor=new T.Mesh(new T.PlaneGeometry(384,312),new T.MeshStandardMaterial({map:floorTexture(),roughness:.89}));
  floor.rotation.x=-Math.PI/2;floor.position.y=-.035;floor.receiveShadow=true;scene.add(floor);
  const loaded=assets.filter(Boolean),plant=createCargoPlant(data,Object.fromEntries(loaded));
  const meshes={sorting:plant.sorting.group,pallet:plant.pallet.group,dock:plant.dock,tables:plant.tables};
  const drawings={},lines=traces(data,plant);
  for(const [key,img] of images){
    const r=refs(data)[key];img.colorSpace=T.SRGBColorSpace;img.anisotropy=4;
    const plane=new T.Mesh(new T.PlaneGeometry(r.width,r.depth),new T.MeshBasicMaterial({map:img,toneMapped:false,alphaTest:.15}));
    plane.rotation.x=-Math.PI/2;plane.position.set(r.centre[0],0,r.centre[1]);drawings[key]=plane;
    scene.add(meshes[key],plane,lines[key]);
  }
  const perspective=new T.PerspectiveCamera(34,1,.05,1200), ortho=new T.OrthographicCamera(-1,1,1,-1,.05,1200);
  const ctrl=new OrbitControls(perspective,canvas);ctrl.enableDamping=true;ctrl.dampingFactor=.12;ctrl.minDistance=2;
  ctrl.maxDistance=420;ctrl.maxPolarAngle=Math.PI*.484;ctrl.enablePan=true;ctrl.target.set(0,0,0);
  let key='sorting', mode='3d', focus=-1, camera=perspective, time=21, paused=false, speed=1, disposed=false, last, frameId;
  const nav=targets(data);
  function activeRegion() {return key==='chutes'?'sorting':key;}
  function extent() {
    const k=activeRegion(), r=refs(data)[k] || data.sorter.reference;
    if(k==='overview'){
      const placed=[[r,[0,0]],[data.dock.reference,data.dockOffset],[data.tables.reference,data.tables.offset]];
      const x0=Math.min(...placed.map(([a,o])=>a.centre[0]+o[0]-a.width/2)),x1=Math.max(...placed.map(([a,o])=>a.centre[0]+o[0]+a.width/2));
      const z0=Math.min(...placed.map(([a,o])=>a.centre[1]+o[1]-a.depth/2)),z1=Math.max(...placed.map(([a,o])=>a.centre[1]+o[1]+a.depth/2));
      return {at:[(x0+x1)/2,(z0+z1)/2],w:x1-x0,d:z1-z0,y:0};
    }
    const chosen=nav[key][focus];
    if(chosen && key==='pallet') return {at:chosen.at,w:5.4,d:4.0,y:chosen.height+.16};
    if(chosen && key==='chutes') return {at:chosen.at,w:6.1,d:6.5,y:chosen.height};
    if(chosen && key==='sorting') return {at:chosen.at,w:8.5,d:6.5,y:chosen.height};
    if(chosen) return {at:chosen.at,w:key==='dock'?15:11,d:key==='dock'?12:8,y:chosen.height};
    if(key==='chutes'){const a=data.sorter.chutes;return {at:middle(a[0][0],a.at(-1)[1]),w:distanceX(a)+5,d:12,y:1.5};}
    return {at:r.centre,w:r.width,d:r.depth,y:key==='sorting'?1.8:key==='pallet'?.45:0};
  }
  function distanceX(paths){return Math.abs(paths.at(-1)[0][0]-paths[0][0][0]);}
  function resize(){
    const {width:w,height:h}=canvas.getBoundingClientRect();if(!w || !h)return;
    renderer.setSize(w,h,false);perspective.aspect=w/h;perspective.updateProjectionMatrix();
    const a=extent(), half=Math.max(a.d/2,a.w/2/(w/h))*1.07;
    ortho.left=-half*w/h;ortho.right=-ortho.left;ortho.top=half;ortho.bottom=-half;ortho.updateProjectionMatrix();
  }
  function show(view=key,projection=mode,target=-1) {
    key=view;mode=projection;focus=target;
    const k=activeRegion();
    const shared=k==='sorting' || k==='overview';
    for(const id of Object.keys(meshes)){
      const visible=k==='overview' || id===k || (shared && id==='pallet');
      const offset=shared?({pallet:data.pallet.offset,dock:data.dockOffset,tables:data.tables.offset}[id] || [0,0]):[0,0];
      meshes[id].position.set(offset[0],0,offset[1]);lines[id].position.copy(meshes[id].position);
      const r=refs(data)[id];drawings[id].position.set(r.centre[0]+offset[0],id==='tables'?.004:0,r.centre[1]+offset[1]);
      meshes[id].visible=visible && mode==='3d';
      // The master drawing already contains the lower line. Show its enlarged sheet only in the pallet view.
      drawings[id].visible=visible && mode!=='3d' && (id!=='pallet' || k==='pallet');
      lines[id].visible=visible && mode==='overlay';
    }
    floor.visible=mode==='3d';scene.background.set(mode==='3d'?'#dce4e2':'#f0f3f1');
    camera=mode==='3d'?perspective:ortho;ctrl.object=camera;ctrl.enableRotate=mode==='3d';
    ctrl.mouseButtons.LEFT=mode==='3d'?T.MOUSE.ROTATE:T.MOUSE.PAN;
    ctrl.touches.ONE=mode==='3d'?T.TOUCH.ROTATE:T.TOUCH.PAN;
    // Flush damping from the previous orbit before installing the registered view.
    ctrl.enableDamping=false;ctrl.update();ctrl.enableDamping=true;
    const ex=extent(),[x,z]=ex.at;resize();
    if(mode==='3d'){
      const az=key==='dock' || key==='overview'?.10:.35;
      const angle=key==='pallet'?(focus<0?.91:.43):.71;
      const distance=Math.max((ex.w*Math.cos(az)+ex.d*Math.sin(az))/perspective.aspect,ex.d*.9+ex.w*Math.sin(az)*.57)*1.87+2;
      camera.up.set(0,1,0);camera.position.set(x+Math.sin(az)*distance*Math.cos(angle),ex.y+distance*Math.sin(angle),z+Math.cos(az)*distance*Math.cos(angle));
      ctrl.target.set(x,ex.y,z);
    } else {
      camera.up.set(0,0,-1);camera.zoom=1;camera.position.set(x,220,z);ctrl.target.set(x,0,z);camera.updateProjectionMatrix();
    }
    camera.lookAt(ctrl.target);ctrl.update();sun.target.position.copy(ctrl.target);sun.position.set(x-22,52,z+24);
  }
  const observer=new ResizeObserver(resize);observer.observe(canvas);
  function render(now){
    if(disposed)return;
    if(!paused && last!==undefined)time+=Math.min((now-last)/1000,.12)*speed;
    last=now;
    if(mode==='3d'){
      if(meshes.sorting.visible)plant.sorting.update(time);
      if(meshes.pallet.visible)plant.pallet.update(time);
    }
    ctrl.update();renderer.render(scene,camera);frameId=requestAnimationFrame(render);
  }
  show();frameId=requestAnimationFrame(render);
  return {data,plant,renderer,nav,show,missingCartons:assets.length-loaded.length,get time(){return time;}, get view(){return key;},get mode(){return mode;},
    setPaused(v){paused=v;},setSpeed(v){speed=v;},seek(t){time=t;},getCamera(){return camera;},getTarget(){return ctrl.target.clone();},
    dispose(){disposed=true;cancelAnimationFrame(frameId);observer.disconnect();ctrl.dispose();
      const geometries=new Set(),materials=new Set(),textures=new Set();
      scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)for(const m of [].concat(o.material)){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}});
      geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());env.dispose();renderer.dispose();}
  };
}
