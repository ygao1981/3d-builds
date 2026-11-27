import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import {createHall} from './hall.js';
import {hallWorkViews,inboundDescription} from './inbound-work.js';
import {floorUse} from './floor-operations.js';
import { createCargoPlant } from './plant.js';
import manifest from '../simready-assets.json';
import workerAsset from './worker-asset.json';

const rootUrl='/project-layout/';
const cargoModels=manifest.models.filter(model=>model.projects.includes('cargo'));
const refs=(d)=>({sorting:d.sorter.reference,pallet:d.pallet.reference,dock:d.dock.reference,tables:d.tables.reference});
const middle=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2];

export function equipmentView(page,layer){
  return page==='sorting' && layer==='lower'?'pallet':page;
}

function traces(data,plant) {
  const groups={sorting:new T.Group(),pallet:new T.Group(),dock:new T.Group(),tables:new T.Group(),sideRooms:new T.Group()};
  const mat=new LineMaterial({color:'#008179',linewidth:2.6,depthTest:false,depthWrite:false,toneMapped:false});
  const lowerMat=mat.clone();lowerMat.color.set('#a94416');
  function trace(key,line) {
    const geo=new LineGeometry();geo.setPositions(line.flatMap(([x,z])=>[x,.02,z]));
    const obj=new Line2(geo,key==='pallet'?lowerMat:mat);obj.renderOrder=10;groups[key].add(obj);
  }
  for(const room of data.site?.freight?.sideRooms||[])
    for(const line of [...room.shell,...room.partitions])trace('sideRooms',line);
  const loop=plant.sorting.loop,s=data.sorter,p=data.pallet;
  trace('sorting',Array.from({length:241},(_,i)=>loop.at(i*loop.length/240)));
  const eq=data.site?.distributionEquipment;
  const induction=plant.sorting.induction;
  const distribution=data.site?[data.site.distribution || data.site.feederTrunk,...induction.branches.map(b=>[...b.path,b.centre])]:[];
  const feeds=s.feeds.map(([rear,join],i)=>[induction.branches[i]?.centre??rear,join]);
  [...feeds,...s.chutes,...s.returns,...distribution,...(eq?[eq.merge,...eq.sources,eq.slide]:[])].forEach(path=>trace('sorting',path));
  if(s.feedDeck)for(const [i,[start,join]] of s.feeds.entries()){
    const len=Math.hypot(join[0]-start[0],join[1]-start[1]),dx=(join[0]-start[0])/len,dz=(join[1]-start[1])/len;
    function arrow(x,z,u,v){
      trace('sorting',[[x-u*.45-v*.18,z-v*.45+u*.18],[x,z],[x-u*.45+v*.18,z-v*.45-u*.18]]);
    }
    const station=s.feedDeck.rows[2][0];arrow(start[0]+dx*station,start[1]+dz*station,dx,dz);
    const branch=induction.branches[i];
    if(branch){const [u,v]=branch.travel;arrow(branch.seam[0]-.72*u,branch.seam[1]-.72*v,u,v);}
  }
  if(eq)eq.buffer.rows.forEach((z,i)=>trace('sorting',[[eq.buffer.left[0],z],[i===3?eq.buffer.returnEnd:eq.buffer.right[0],z]]));
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
export function targets(data,inspection,packing,workViews=hallWorkViews(data)) {
  const sort=data.sorter, p=data.pallet, d=data.dock;
  const eq=data.site?.distributionEquipment;
  const floor=data.site?.floorOperations;
  const details=eq?[
    {label:'排队与供包接头',at:data.site.branches[1].at(-1),height:sort.deck,width:11,az:1.18},
    {label:'分配线末端滑板',at:eq.slide[0].slice(0,2),height:eq.slide[0][2],width:14,az:1.13},
    {label:'暂存与汇流',at:middle(eq.buffer.left,eq.buffer.right),height:.8,width:32,az:.18}
  ]:[];
  return {
    sorting:sort.feeds.map(([a,c],i)=>({label:'供包台 '+(i+1),at:middle(a,c),height:sort.deck,az:0,elevation:1.35,width:11})).concat(data.site?[{label:'收货扫码称重',at:data.site.receipt,height:.85}]:[]).concat(data.site?.distribution?[{label:'分流与排队',at:data.site.branches[Math.floor(sort.feeds.length/2)][0],height:sort.deck}]:[]).concat(details),
    chutes:sort.chutes.map(([a,c],i)=>({label:'滚筒滑槽 '+(i+1),at:middle(a,c),height:(sort.chuteTop+sort.chuteBottom)/2})).concat({
      label:'格口人工码盘',at:middle(sort.chutes[0][1],p.tails[0].map((v,i)=>v+p.offset[i])),height:1.12}),
    pallet:[...p.stackers.map((at,i)=>({label:'拆盘机 '+(i+1),at,height:p.deck})),
      ...p.turns.map((at,i)=>({label:'旋转台 '+(i+1),at,height:p.deck})),
      ...p.transfers.map((at,i)=>({label:'移载支路 '+(i+1),at,height:p.deck})),{label:'横向输送链',at:middle(p.transfers[0],p.transfers[p.turns.length+1]),height:p.chainDeck}],
    dock:[...d.levellers.map(item=>({label:item.id+' 调平台',at:item.at,height:.5})),
      ...d.handoffs.map((row,i)=>({label:'整板箱交接 '+(i+1),at:row[1],height:d.deck})),{label:'全部月台',wide:true}],
    tables:data.tables.places.map(({at},i)=>({label:'图示台位 '+String(i+1).padStart(2,'0'),at,height:data.tables.height})).concat(
      {label:'全部台位',wide:true},...(packing?[{label:'作业员组板',at:middle(packing.supply,packing.landing).map(v=>v+.42),
        width:4.3,depth:3.1,height:.95,az:-.73,elevation:.26}]:[])),
    overview:[{label:'全站房物流范围',wide:true},{label:'空托盘原位剖视'},...(floor?[
      {label:'整板交接地轨',at:middle(floor.tracks[0].start,floor.tracks[1].end),width:20,depth:108,az:.50},
      {label:'AGV 暂存工位',at:floor.agv.at,width:26,depth:18,az:-.24},
      {label:'待运区与复重秤',at:floor.apronFocus,width:92,depth:34,az:.12},
      {label:'利旧作业平台',at:middle(...floor.existing.deck),width:19,depth:33,az:.68}
    ]:[]),...(inspection?[inspection.target]:[]),...(data.site?.freight?.nodes||[]).map(n=>n.key==='inWork'?
      {...n,width:31,depth:54,height:3,az:.14,elevation:.85,note:inboundDescription}:n),...workViews],
  };
}

export async function openCargo(canvas,onStatus,onFreeBrowse=()=>{}) {
  const response=await fetch(rootUrl+'layout.json',{cache:'no-store'});
  if(!response.ok || !response.headers.get('content-type')?.includes('json')) throw new Error('本机尚未配置项目工艺图纸，请载入本项目的布局资料后重试。');
  const data=await response.json();
  if(data.schema!==2 || !data.sorter?.chutes?.length || !data.pallet?.tails?.length || !Array.isArray(data.pallet.offset) ||
    data.pallet.offset.length!==2 || !data.pallet.offset.every(Number.isFinite) || !data.dock?.levellers?.length || !data.tables?.places?.length)
    throw new Error('项目布局数据不完整，请重新生成工艺图纸数据。');
  onStatus('正在加载设备模型和图纸局部…');
  const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const tx=new T.TextureLoader();
  const [assets,images,markings,furniture]=await Promise.all([
    Promise.all(cargoModels.map(async model=>{
      try{return [model.id,(await loader.loadAsync('/simready/'+model.id+'.glb')).scene];}
      catch(error){if(!model.optional)throw error;console.warn('可选资产加载失败',model.id,error);return null;}
    })),
    Promise.all(Object.entries({...refs(data),...(data.site?{hall:data.site.reference}:{})}).map(async ([key,ref])=>[key,await tx.loadAsync(rootUrl+ref.image)])),
    data.site?.reference.markings?tx.loadAsync(rootUrl+data.site.reference.markings):null,
    data.site?.distributionEquipment?.receipts?.length?loader.loadAsync('/assets/screening.glb')
      .then(model=>model.scene).catch(()=>{console.warn('安检操作台模型未载入，使用简化工作台。');return null;}):null,
  ]);
  const renderer=new T.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;
  renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.91;
  const scene=new T.Scene();scene.background=new T.Color('#dce4e2');
  const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment(),env=pmrem.fromScene(room,.04);
  room.dispose();pmrem.dispose();scene.environment=env.texture;scene.environmentIntensity=.65;
  const sun=new T.DirectionalLight('#fff1d4',1.75);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
  Object.assign(sun.shadow.camera,{near:1,far:170,left:-43,right:43,top:43,bottom:-43});
  sun.shadow.camera.updateProjectionMatrix();sun.shadow.normalBias=.035;sun.shadow.bias=-.00018;
  scene.add(sun,sun.target,new T.HemisphereLight('#e3efff','#8d9587',.82));
  const models=Object.fromEntries(assets.filter(Boolean));
  const texturesLoader=new KTX2Loader().setWorkerLimit(1).detectSupport(renderer);
  try{
    models.worker=(await loader.setKTX2Loader(texturesLoader).loadAsync('/'+workerAsset.file)).scene;
  }catch(error){
    console.warn('货站人物模型加载失败',error);
  }finally{texturesLoader.dispose();}
  const workViews=hallWorkViews(data);
  const inboundTables=workViews.find(n=>n.key==='inOnline')?.tables.map(t=>t.index);
  const plant=createCargoPlant(data,models,inboundTables);
  const offsets={sorting:[0,0],pallet:data.pallet.offset,dock:data.dockOffset,tables:data.tables.offset,hall:[0,0]};
  const meshes={sorting:plant.sorting.group,pallet:plant.pallet.group,dock:plant.dock,tables:plant.tables};
  const hall=createHall(data,models,markings,furniture,workViews);
  scene.add(hall.group);
  if(hall.freight)scene.add(hall.freight.studio);
  const drawings={},lines=traces(data,plant);
  scene.add(lines.sideRooms);
  for(const [id,obj] of Object.entries(meshes)){
    const [x,z]=offsets[id];obj.position.set(x,0,z);lines[id].position.set(x,0,z);
    scene.add(obj,lines[id]);
  }
  const palletBounds=new T.Box3().setFromObject(meshes.pallet);
  for(const [id,img] of images){
    const r=id==='hall'?data.site.reference:refs(data)[id],[x,z]=offsets[id];
    img.colorSpace=T.SRGBColorSpace;img.anisotropy=4;
    const plane=new T.Mesh(new T.PlaneGeometry(r.width,r.depth),new T.MeshBasicMaterial({map:img,toneMapped:false,alphaTest:.09}));
    plane.rotation.x=-Math.PI/2;plane.position.set(x+r.centre[0],id==='hall'?-.014:id==='tables'?.004:0,z+r.centre[1]);drawings[id]=plane;
    scene.add(plane);
  }
  const perspective=new T.PerspectiveCamera(34,1,.05,1200), ortho=new T.OrthographicCamera(-1,1,1,-1,.05,1200);
  const ctrl=new OrbitControls(perspective,canvas);ctrl.enableDamping=true;ctrl.dampingFactor=.12;ctrl.minDistance=2;
  ctrl.maxDistance=420;ctrl.maxPolarAngle=Math.PI*.484;ctrl.enablePan=true;ctrl.target.set(0,0,0);
  let page='overview', key=page, layer='both', mode='3d', focus=-1;
  let camera=perspective, time=21, paused=false, speed=1, disposed=false, last, frameId;
  const nav=targets(data,hall.inspection,plant.packing,workViews);
  plant.packing.cues.build.focus=nav.tables.length-1;
  const inspectionCue=hall.inspection && {view:'overview',focus:nav.overview.indexOf(hall.inspection.target),time:hall.inspection.time};
  const inOverview=()=>page==='overview' && mode==='3d';
  const keys=new Set(),step=new T.Vector3(),eyeFloor=.25;
  let overviewPose=null,overviewMoved=false,gesture=false,freeBrowse=false;
  ctrl.addEventListener('start',()=>{gesture=inOverview();});
  ctrl.addEventListener('change',()=>{if(gesture)overviewMoved=true;});
  ctrl.addEventListener('end',()=>{gesture=false;});
  function keyDown(event){
    if(!inOverview() || event.ctrlKey || event.altKey || event.metaKey || !['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE'].includes(event.code))return;
    event.preventDefault();keys.add(event.code);
  }
  function keyUp(event){keys.delete(event.code);}
  function clearKeys(){keys.clear();}
  canvas.addEventListener('keydown',keyDown);canvas.addEventListener('keyup',keyUp);
  canvas.addEventListener('blur',clearKeys);window.addEventListener('blur',clearKeys);
  function moveOverview(dt){
    if(!keys.size || !dt)return;
    const forward=keys.has('KeyW')-keys.has('KeyS'),right=keys.has('KeyD')-keys.has('KeyA');
    const up=keys.has('KeyE')-keys.has('KeyQ'),yaw=ctrl.getAzimuthalAngle();
    step.set(right*Math.cos(yaw)-forward*Math.sin(yaw),up,-right*Math.sin(yaw)-forward*Math.cos(yaw));
    step.normalize().multiplyScalar(dt*T.MathUtils.clamp(ctrl.getDistance()*.65,3,80));
    step.y=Math.max(step.y,eyeFloor-perspective.position.y);
    if(step.lengthSq()){
      perspective.position.add(step);ctrl.target.add(step);
      ctrl.target.y=Math.max(eyeFloor,ctrl.target.y);overviewMoved=true;
    }
  }
  function activeRegion() {return key==='chutes'?'sorting':key;}
  function extent() {
    const k=activeRegion(),r=refs(data)[k];
    if(k==='overview'){
      const station=nav.overview[focus];
      if(station?.at && (mode==='3d' || station.planCut))
        return {at:station.at,w:station.width,d:station.depth,y:station.key==='canopy'?3:station.independent?1.2:.8};
      if(mode==='3d' && focus===1){
        const p=data.pallet,mid=middle(p.turns[0],p.tails[Math.floor(p.tails.length/2)]);
        return {at:mid.map((v,i)=>v+p.offset[i]),w:distanceX(p.inlets.map(a=>[a]))+8,d:22,y:1.16};
      }
      if(mode==='3d' && focus<0){
        const global=(p,offset)=>p.map((v,i)=>v+offset[i]);
        const points=[data.site?.receipt || data.sorter.feeds[0][0],
          global(data.dock.levellers[plant.dockOps.active].at,offsets.dock),
          global(data.dock.handoffs[0][0],offsets.dock),
          global(data.tables.places[plant.packing.active].at,offsets.tables),
          [data.sorter.left-data.sorter.radius,0],[data.sorter.right+data.sorter.radius,0]];
        const xx=points.map(p=>p[0]),zz=points.map(p=>p[1]);
        const left=Math.min(...xx)-5,right=Math.max(...xx)+6,front=Math.min(...zz)-7,back=Math.max(...zz)+6;
        return {at:[(left+right)/2,(front+back)/2],w:right-left,d:back-front,y:1.5};
      }
      const [[x,z],[xx,zz]]=hall.bounds;
      return {at:middle([x,z],[xx,zz]),w:xx-x,d:zz-z,y:1.8};
    }
    const offset=offsets[k],local=(at,w,d,y)=>({at:at.map((p,i)=>p+offset[i]),w,d,y});
    const chosen=nav[key][focus];
    if(chosen && !chosen.wide){
      if(key==='tables' && chosen.width){
        // In portrait, frame the handling area so the carton and both hands remain legible.
        const crop=T.MathUtils.clamp(canvas.clientWidth/Math.max(1,canvas.clientHeight),.52,1);
        return local(chosen.at,chosen.width*crop,chosen.depth*crop,chosen.height);
      }
      if(key==='pallet')return local(chosen.at,focus>=nav.pallet.length-1?9:6.8,5.4,chosen.height+.16);
      if(key==='chutes')return local(chosen.at,8,8,chosen.height);
      if(key==='sorting'){
        const span=chosen.width || (focus>data.sorter.feeds.length?23:focus===data.sorter.feeds.length?9.5:13);
        return local(chosen.at,span,chosen.width?span*.64:focus>data.sorter.feeds.length?15:9,chosen.height+.35);
      }
      return local(chosen.at,key==='dock'?14:10,key==='dock'?17:8,chosen.height+.65);
    }
    if(mode==='3d' && !chosen){
      if(key==='dock'){
        const gate=data.dock.levellers[plant.dockOps.active].at,uld=data.dock.handoffs[0][1];
        return local(middle(gate,uld),Math.max(26,Math.abs(gate[0]-uld[0])+21),23,1.05);
      }
      if(key==='tables')return local(data.tables.places[plant.packing.active].at,25,18,1.0);
      if(key==='sorting')return local([0,-1.6],46,36,2);
      if(page==='sorting' && key==='pallet'){
        const {min,max}=palletBounds,padding=data.pallet.width;
        return {at:middle([min.x,min.z],[max.x,max.z]),w:max.x-min.x+padding,d:max.z-min.z+padding,y:data.pallet.deck};
      }
      if(key==='pallet')return local(middle(data.pallet.turns[0],data.pallet.transfers[4]),33,20,1);
    }
    if(key==='chutes'){const a=data.sorter.chutes;return local(middle(a[0][0],a.at(-1)[1]),distanceX(a)+5,12,1.5);}
    return local(r.centre,r.width,r.depth,key==='sorting'?1.8:key==='pallet'?.45:0);
  }
  function distanceX(paths){return Math.abs(paths.at(-1)[0][0]-paths[0][0][0]);}
  function resize(){
    const {width:w,height:h}=canvas.getBoundingClientRect();if(!w || !h)return;
    renderer.setSize(w,h,false);perspective.aspect=w/h;perspective.updateProjectionMatrix();
    const a=extent(), half=Math.max(a.d/2,a.w/2/(w/h))*1.07;
    ortho.left=-half*w/h;ortho.right=-ortho.left;ortho.top=half;ortho.bottom=-half;ortho.updateProjectionMatrix();
  }
  function show(view=page,projection=mode,target,selectedLayer='both') {
    const panorama=view==='overview' && projection==='3d';
    if(inOverview() && overviewMoved){
      overviewPose={focus,eye:perspective.position.clone(),target:ctrl.target.clone()};
    }
    const resume=panorama && target===undefined?overviewPose:null;
    if(target===undefined){
      const fromDrawing=page==='overview' && mode!=='3d';
      const homeFocus=data.site?.floorOperations?0:-1;
      target=panorama?(resume?.focus ?? (fromDrawing?focus:homeFocus)):-1;
    }
    if(panorama && !resume)overviewPose=null;
    gesture=false;overviewMoved=!!resume;clearKeys();
    const subject=equipmentView(view,selectedLayer);
    const switchingLayer=view==='sorting' && view===page && selectedLayer!==layer && projection===mode && target===focus;
    const keepPose=switchingLayer && subject===key;
    const heading=switchingLayer && subject!==key && mode==='3d' && focus<0?ctrl.getAzimuthalAngle():undefined;
    page=view;key=subject;layer=page==='sorting'?selectedLayer:'both';mode=projection;focus=target;
    const k=activeRegion();
    const view3d=mode==='3d';
    const selected=k==='overview' && view3d?nav.overview[focus]:null,isolated=!!selected?.independent;
    hall.freight?.setView(selected,k==='overview' && view3d && (focus===0 || !!selected?.key));
    for(const [id,obj] of Object.entries(meshes)){
      obj.visible=view3d && !isolated && !(k==='pallet' && id==='sorting') && !(layer==='upper' && id==='pallet');
      const onSheet=k==='overview' || k===id || (k==='sorting' && id==='pallet');
      drawings[id].visible=!view3d && onSheet && (id!=='pallet' || k==='pallet');
      lines[id].visible=onSheet && mode==='overlay';
    }
    const showLower=k==='overview' && view3d && !isolated;
    plant.sorting.section(showLower?(focus===1?2:1):0);
    lines.pallet.visible=showLower || (mode==='overlay' && layer!=='upper' && ['overview','sorting','pallet'].includes(k));
    lines.pallet.position.y=showLower?data.pallet.deck+.16:0;
    const lowerInk=lines.pallet.children[0].material;
    lowerInk.color.set(showLower?'#14776a':'#a94416');lowerInk.linewidth=showLower?1.65:2.6;
    lowerInk.transparent=showLower;lowerInk.opacity=showLower?.72:1;
    lines.sideRooms.visible=k==='overview' && mode==='overlay';
    if(drawings.hall)drawings.hall.visible=!view3d && k!=='pallet';
    hall.group.visible=view3d && !isolated;hall.overhead.visible=k==='overview' && focus===0;hall.dockUpper.visible=k!=='dock' && selected?.key!=='dispatch';
    hall.serviceDeck.visible=k!=='pallet';
    plant.chutePacking.group.visible=meshes.sorting.visible && meshes.pallet.visible;
    scene.background.set(view3d?'#a9bab9':'#f2f4f1');
    if(keepPose)return focus;
    camera=mode==='3d'?perspective:ortho;ctrl.object=camera;ctrl.enableRotate=mode==='3d';
    ctrl.mouseButtons.LEFT=mode==='3d'?T.MOUSE.ROTATE:T.MOUSE.PAN;
    ctrl.touches.ONE=mode==='3d'?T.TOUCH.ROTATE:T.TOUCH.PAN;
    // Flush damping from the previous orbit before installing the registered view.
    ctrl.enableDamping=false;ctrl.update();ctrl.enableDamping=true;
    ctrl.screenSpacePanning=!panorama;ctrl.zoomToCursor=panorama;
    ctrl.minDistance=panorama?.75:2;ctrl.maxPolarAngle=panorama?Math.PI:Math.PI*.484;
    const ex=extent(),[x,z]=ex.at;resize();
    if(mode==='3d'){
      const fullFloor=key==='overview' && focus===0 && !!hall.operations;
      const fitLower=page==='sorting' && key==='pallet' && focus<0;
      const az=heading ?? nav[key][focus]?.az ?? (key==='overview'?(focus===1?-.50:perspective.aspect<.8?(fullFloor?-Math.PI/2:-1.34):fullFloor?-.055:-.18):key==='dock'?2.46:key==='tables'?.49:key==='pallet' && !fitLower?-.61:.37);
      const angle=nav[key][focus]?.elevation ?? (key==='overview'?(focus===1?.47:fullFloor?(hall.freight?.90:.68):isolated?.48:.81):key==='dock'?.70:key==='tables'?.62:key==='pallet'?(focus<0?.89:.56):.70);
      const horizontal=ex.w*Math.abs(Math.cos(az))+ex.d*Math.abs(Math.sin(az));
      const depth=ex.w*Math.abs(Math.sin(az))+ex.d*Math.abs(Math.cos(az));
      const fit=Math.max(horizontal/perspective.aspect,depth*Math.sin(angle));
      const tangent=Math.tan(T.MathUtils.degToRad(perspective.fov/2));
      let distance=fit/(2*tangent)*1.10+depth*Math.cos(angle)*.48;
      if(key==='overview' || fitLower){
        distance=0;
        const top=nav.overview[focus]?.height;
        const heights=fitLower?[palletBounds.min.y-ex.y,palletBounds.max.y-ex.y]:top!==undefined?[-ex.y,top-ex.y]:[-3,5];
        for(const dx of [-ex.w/2,ex.w/2])for(const dz of [-ex.d/2,ex.d/2])for(const dy of heights){
          const across=dx*Math.cos(az)-dz*Math.sin(az),along=dx*Math.sin(az)+dz*Math.cos(az);
          const elevation=dy*Math.cos(angle)-along*Math.sin(angle);
          const toward=dy*Math.sin(angle)+along*Math.cos(angle);
          distance=Math.max(distance,toward+Math.max(Math.abs(across)/(tangent*perspective.aspect*(fullFloor?.96:.92)),Math.abs(elevation)/(tangent*(fullFloor?.91:.82))));
        }
      }
      ctrl.maxDistance=panorama?Math.max(420,distance*1.15,resume?resume.eye.distanceTo(resume.target):0):420;
      camera.near=Math.max(.045,distance/135);camera.far=panorama?ctrl.maxDistance+450:distance+450;camera.updateProjectionMatrix();
      camera.up.set(0,1,0);camera.position.set(x+Math.sin(az)*distance*Math.cos(angle),ex.y+distance*Math.sin(angle),z+Math.cos(az)*distance*Math.cos(angle));
      ctrl.target.set(x,ex.y,z);
      if(resume){camera.position.copy(resume.eye);ctrl.target.copy(resume.target);}
    } else {
      camera.up.set(0,0,-1);camera.zoom=1;camera.position.set(x,220,z);ctrl.target.set(x,0,z);camera.updateProjectionMatrix();
    }
    camera.lookAt(ctrl.target);ctrl.update();sun.target.position.set(x,view3d?ex.y:0,z);
    const shadowSize=k==='overview'?Math.max(ex.w,ex.d)*.57:Math.max(18,Math.min(54,ex.w));
    Object.assign(sun.shadow.camera,{left:-shadowSize,right:shadowSize,top:shadowSize,bottom:-shadowSize,far:shadowSize*5});
    sun.shadow.camera.updateProjectionMatrix();sun.position.set(x-shadowSize*.72,shadowSize*1.52,z+shadowSize*.84);
    return focus;
  }
  const observer=new ResizeObserver(()=>{
    const rect=canvas.getBoundingClientRect();if(!rect.width || !rect.height)return;
    const change=Math.abs(rect.width/rect.height/perspective.aspect-1);
    const refit=inOverview()?(!overviewMoved && change>.0001):change>.15;
    if(refit)show(page,mode,focus,layer);else resize();
  });observer.observe(canvas);
  const tags=new Map(),localTags=new Set(['inReview','inOnline','inHolding']);
  const lastEye=new T.Matrix4(),lastProjection=new T.Matrix4();
  let tagsDirty=true,lastWidth=0,lastHeight=0,lastTagFocus,lastBrowse;
  const labels={
    ...(hall.inspection?{inspection:[...hall.inspection.target.at,2.35]}:{}),
    dock:[...data.dock.levellers[plant.dockOps.active].at.map((n,i)=>n+offsets.dock[i]),5.0],
    sorting:[data.sorter.left*.5,-data.sorter.radius,data.sorter.deck+1.2],
    pallet:[...data.pallet.tails.at(-1).map((n,i)=>n+offsets.pallet[i]),data.pallet.deck+.18],
    tables:[...data.tables.places.at(-1).at.map((n,i)=>n+offsets.tables[i]),2.4],
    ...(data.site?{meter:[...data.site.receipt,2.1]}:{}),
    ...(data.site?.floorOperations?{tracks:[...nav.overview[2].at,.15],agv:[...nav.overview[3].at,.6],
      apron:[...nav.overview[4].at,1.2],legacy:[...nav.overview[5].at,.56]}:{}),
  };
  const packingLabel=plant.packing.active;
  if(hall.freight)for(const station of nav.overview){
    if(station.key && !station.independent)labels[station.key]=[...(station.labelAt||station.at),1.1];
  }
  labels.tables=[...data.tables.places[packingLabel].at.map((n,i)=>n+offsets.tables[i]),2.1];
  const tagPoint=new T.Vector3();
  const pickRay=new T.Raycaster(),floorPlane=new T.Plane(new T.Vector3(0,1,0),0);
  function inspectFloor(clientX,clientY){
    if(!inOverview() || !hall.freight || !hall.group.visible)return null;
    const r=canvas.getBoundingClientRect();
    pickRay.setFromCamera({x:2*(clientX-r.left)/r.width-1,y:1-2*(clientY-r.top)/r.height},camera);
    const ground=pickRay.ray.intersectPlane(floorPlane,new T.Vector3());
    if(!ground)return null;
    const [[left,front],[right,back]]=hall.bounds;
    if(ground.x<left || ground.x>right || ground.z<front || ground.z>back)return null;
    return floorUse(data,ground.x,ground.z);
  }
  function tag(key,element){if(element)tags.set(key,element);else tags.delete(key);tagsDirty=true;}
  function updateOverviewLabels(){
    const selected=nav.overview[focus],hallView=inOverview() && !selected?.independent;
    let browsing=false,wide=false;
    if(hallView && selected?.at && overviewMoved){
      const span=2*ctrl.getDistance()*Math.tan(T.MathUtils.degToRad(perspective.fov/2))*Math.max(1,perspective.aspect);
      const shifted=Math.hypot(ctrl.target.x-selected.at[0],ctrl.target.z-selected.at[1]);
      wide=span>Math.max(68,Math.max(selected.width,selected.depth)*1.7);
      browsing=wide || shifted>Math.max(7,Math.min(selected.width,selected.depth)*.7);
    }
    if(browsing!==freeBrowse){freeBrowse=browsing;onFreeBrowse(browsing);}
    if(hall.operations)hall.operations.lettering.visible=hallView && (focus<1 || focus===4 || browsing);
    const building=hallView && (focus===0 || wide && perspective.position.y>20);
    hall.overhead.visible=building;
    if(hall.freight)hall.freight.canopy.visible=building || hallView && selected?.key==='canopy';
  }
  function positionTags(){
    if(key!=='overview' || mode!=='3d' || !tags.size)return;
    const {clientWidth:w,clientHeight:h}=canvas,placed=[];
    if(!tagsDirty && w===lastWidth && h===lastHeight && focus===lastTagFocus && freeBrowse===lastBrowse &&
      lastEye.equals(camera.matrixWorld) && lastProjection.equals(camera.projectionMatrix))return;
    tagsDirty=false;lastWidth=w;lastHeight=h;lastTagFocus=focus;lastBrowse=freeBrowse;
    lastEye.copy(camera.matrixWorld);lastProjection.copy(camera.projectionMatrix);
    const selected=nav.overview[focus]?.key;
    for(const [id,node] of tags){
      const anchor=labels[id];if(!anchor)continue;
      const local=localTags.has(id);
      if(local?(selected!=='inWork' || freeBrowse):selected && !freeBrowse){
        node.style.visibility='hidden';continue;
      }
      tagPoint.set(anchor[0],anchor[2],anchor[1]).project(camera);
      const x=(1+tagPoint.x)*w/2,y=(1-tagPoint.y)*h/2;
      const width=node.offsetWidth,height=node.offsetHeight;
      const rise=[0,height+8,2*(height+8),3*(height+8)].find(d=>y-d>height+7 &&
        !placed.some(r=>Math.abs(x-r.x)<(width+r.w)/2+4 && Math.abs(y-d-r.y)<height+7));
      const hidden=rise===undefined || Math.abs(tagPoint.z)>1 || x<width/2 || x>w-width/2 || y>h;
      node.style.visibility=hidden?'hidden':'visible';
      if(!hidden){placed.push({x,y:y-rise,w:width});node.style.left=x+'px';node.style.top=(y-rise)+'px';node.style.setProperty('--tag-rise',rise+'px');}
    }
  }
  function render(now){
    if(disposed)return;
    const dt=last===undefined?0:Math.min((now-last)/1000,.12);
    if(!paused)time+=dt*speed;
    last=now;
    if(mode==='3d'){
      if(meshes.sorting.visible)plant.sorting.update(time);
      if(meshes.pallet.visible)plant.pallet.update(time);
      if(plant.chutePacking.group.visible)plant.chutePacking.update(time);
      plant.dockOps.update(time,key==='overview' && nav.overview[focus]?.key==='dispatch');
      plant.packing.update(time);hall.receipts.forEach(unit=>unit.update(time));
      hall.additionalReceipts.forEach(unit=>unit.update(time));
      if(hall.group.visible && hall.freight?.goods.visible)hall.freight.update(time);
    }
    if(inOverview()){
      moveOverview(dt);
      // Allow looking up at equipment while keeping the eye above the floor.
      const radius=Math.max(ctrl.getDistance(),ctrl.minDistance);
      ctrl.maxPolarAngle=Math.acos(T.MathUtils.clamp((eyeFloor-ctrl.target.y)/radius,-1,1));
    }
    ctrl.update();
    if(inOverview()){
      if(perspective.position.y<eyeFloor){perspective.position.y=eyeFloor;perspective.lookAt(ctrl.target);}
      // Resolve the closely spaced floor markings at hall scale and equipment at eye level.
      const near=Math.max(.045,Math.min(ctrl.getDistance()/135,perspective.position.y/30));
      if(Math.abs(near-perspective.near)>near*.015){perspective.near=near;perspective.updateProjectionMatrix();}
    }
    updateOverviewLabels();
    if(mode==='3d' && hall.operations?.lettering.visible)
      hall.operations.orientLabels(camera,ctrl.getAzimuthalAngle(),Math.cos(ctrl.getPolarAngle()),canvas.clientHeight);
    renderer.render(scene,camera);positionTags();frameId=requestAnimationFrame(render);
  }
  const requested=new URLSearchParams(location.search).get('station');
  const match=requested?nav.overview.findIndex(n=>n.key===requested):-1;
  const initialFocus=match>=0?match:data.site?.floorOperations?0:-1;
  show('overview','3d',initialFocus);frameId=requestAnimationFrame(render);
  return {data,plant,hall,renderer,nav,show,tag,inspectFloor,initialFocus,packingLabel,inspectionCue,missingWorker:!models.worker,missingCartons:cargoModels.filter(m=>m.id.startsWith('box_cardboard_') && !models[m.id]).length,get time(){return time;}, get view(){return page;},get mode(){return mode;},
    setPaused(v){paused=v;},setSpeed(v){speed=v;},seek(t){time=t;},getCamera(){return camera;},getTarget(){return ctrl.target.clone();},
    dispose(){disposed=true;cancelAnimationFrame(frameId);observer.disconnect();ctrl.dispose();
      canvas.removeEventListener('keydown',keyDown);canvas.removeEventListener('keyup',keyUp);
      canvas.removeEventListener('blur',clearKeys);window.removeEventListener('blur',clearKeys);
      plant.sorting.disposeSection();
      const geometries=new Set(),materials=new Set(),textures=new Set();
      scene.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.dispose();if(o.geometry)geometries.add(o.geometry);if(o.material)for(const m of [].concat(o.material)){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}});
      geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());env.dispose();renderer.dispose();}
  };
}
