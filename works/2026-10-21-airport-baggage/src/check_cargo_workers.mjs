import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const app=path.dirname(fileURLToPath(import.meta.url)),url=process.env.AIRPORT_URL||'http://127.0.0.1:5426/';
const out=path.resolve(app,process.env.AIRPORT_EVIDENCE||'evidence/cargo/worker-review');
await mkdir(out,{recursive:true});
const {chromium}=createRequire(path.join(process.env.PLAYWRIGHT_FROM||app,'package.json'))('playwright');
const browser=await chromium.launch({channel:'chromium',args:['--enable-gpu','--use-angle=d3d11']});
const page=await browser.newPage({viewport:{width:1440,height:900}}),report={errors:[]};
page.on('pageerror',e=>report.errors.push(e.message));
try{
  await page.goto(url);await page.waitForFunction(()=>!!window.__cargo,undefined,{timeout:65000});
  await page.locator('[data-area="tables"]').click();await page.locator('[data-cue="build"]').click();
  assert.equal(await page.locator('.cargo-caption h2').innerText(),'作业员组板');
  const credit=page.getByText('模型来源',{exact:true});
  await credit.click();
  assert.equal(await page.getByRole('link',{name:/人物模型与授权/}).getAttribute('href'),'https://tevy.dev/models/road-worker');
  await credit.click();
  assert.equal(await page.evaluate(()=>window.__cargo.missingWorker),false);
  report.actors=await page.evaluate(()=>{
    const c=window.__cargo,p=c.plant.packing,j=c.plant.chutePacking,s=c.hall.inspection;
    const actors=[p.worker,j.worker,s.worker],meshes=actors.map(w=>w.mesh);
    return {actors:actors.length,bones:meshes[0].skeleton.bones.length,triangles:meshes[0].geometry.index.count/3,
      sharedGeometry:meshes.every(m=>m.geometry===meshes[0].geometry),skeletons:new Set(meshes.map(m=>m.skeleton)).size,
      pbr:meshes.every(m=>m.material.map?.isCompressedTexture && m.material.normalMap)};
  });
  assert(report.actors.sharedGeometry && report.actors.skeletons===3 && report.actors.pbr);
  report.contacts=await page.evaluate(()=>{
    const c=window.__cargo,p=c.plant.packing,j=c.plant.chutePacking,s=c.hall.inspection;
    const results={};
    function inspect(label,worker,samples,sideAxis){
      const {mesh,limbs,figure}=worker,sk=mesh.skeleton,g=mesh.geometry.attributes;
      const hands=limbs.map(({index})=>{
        const pattern=new RegExp('^(hand|index|middle|ring|pinky|thumb).*_'+(index?'R':'L')+'$');
        const vertices=[];
        for(let i=0;i<g.skinIndex.count;i++){
          const bone=sk.bones[g.skinIndex.getX(i)];if(pattern.test(bone.name))vertices.push(i);
        }
        return vertices;
      });
      const world=figure.position.clone(),inverse=figure.matrix.clone();
      let maxPalmError=0,maxVertexGap=0;
      for(const getBox of samples){
        const box=getBox(),size=box.userData.size,axis=sideAxis==='z'?2:0,other=axis===2?0:2;
        figure.updateWorldMatrix(true,false);figure.updateMatrixWorld(true);box.updateWorldMatrix(true,false);inverse.copy(box.matrixWorld).invert();
        const scale=box.scale.getComponent(axis);
        for(const [i,limb] of limbs.entries()){
          world.copy(limb.pad);limb.arm.end.localToWorld(world).applyMatrix4(inverse);
          const face=Math.sign(world.getComponent(axis))*size[axis]/2;
          maxPalmError=Math.max(maxPalmError,Math.abs(world.getComponent(axis)-face)*scale);
          assertInside(world,other,size);
          let min=Infinity;
          for(const k of hands[i]){
            mesh.getVertexPosition(k,world).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
            if(Math.abs(world.getComponent(other))<=size[other]/2 && world.y>=0 && world.y<=size[1])
              min=Math.min(min,Math.abs(world.getComponent(axis)-face)*scale);
          }
          maxVertexGap=Math.max(maxVertexGap,min);
        }
      }
      results[label]={samples:samples.length,maxPalmError,maxVertexGap};
    }
    function assertInside(point,axis,size){
      if(Math.abs(point.getComponent(axis))>size[axis]/2+.012 || point.y<-.012 || point.y>size[1]+.012)
        throw Error('手掌超出所抓箱面的边界');
    }
    inspect('packing',p.worker,[10.4,12,14,16,18,19.7,20.5].map(t=>()=>{p.update(t);return p.box;}),'z');
    inspect('chute',j.worker,[.55,2,4,5.9,6.35].map(dt=>()=>{
      const t=j.firstArrival+dt;c.plant.sorting.update(t);c.plant.pallet.update(t);j.update(t);
      return j.candidates.find(e=>e.parcel.visible).parcel;}),'z');
    inspect('bench',s.worker,[0,2,3.7,5.7,7.2].map(t=>()=>{s.line.update(t);return s.checkedItem;}),'x');
    return results;
  });
  report.feet=await page.evaluate(()=>{
    const c=window.__cargo,p=c.plant.packing,w=p.worker,mesh=w.mesh,g=mesh.geometry.attributes,sk=mesh.skeleton;
    const vertices=[[],[]],point=w.figure.position.clone();
    const table=c.data.tables.places[p.active],dims=table.rotated?[...c.data.tables.size].reverse():c.data.tables.size;
    const toFloor=w.figure.parent.matrixWorld.clone().invert();
    for(let i=0;i<g.skinIndex.count;i++){
      const name=sk.bones[g.skinIndex.getX(i)].name;
      if(/^(foot|toe)_/.test(name))vertices[name.endsWith('_L')?0:1].push(i);
    }
    let maxFloorError=0,largestSwing=0,maxPlantedDrift=0,minFootSeparation=Infinity,minKneeAngle=180,last,groundedPairs=0,bootIntrusions=0;
    for(let tick=0;tick<=1400;tick++){
      p.update(tick/50);w.figure.updateWorldMatrix(true,false);w.figure.updateMatrixWorld(true);
      const pos=w.limbs.map(({leg})=>leg.end.getWorldPosition(point.clone()));
      minFootSeparation=Math.min(minFootSeparation,Math.hypot(pos[0].x-pos[1].x,pos[0].z-pos[1].z));
      if(last)for(const [i,foot] of pos.entries()){
        const restHeight=w.limbs[i].leg.home.y;
        if(Math.abs(last[i].y-restHeight)<.00015 && Math.abs(foot.y-restHeight)<.00015){
          maxPlantedDrift=Math.max(maxPlantedDrift,foot.distanceTo(last[i]));groundedPairs++;
        }
      }
      last=pos;
      if(tick%15===0){
        const soles=vertices.map(arr=>Math.min(...arr.map(i=>{
          mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld).applyMatrix4(toFloor);
          if(point.y<.15 && ((Math.abs(point.x-table.at[0])<dims[0]/2-.01 && Math.abs(point.z-table.at[1])<dims[1]/2-.01) ||
            (Math.abs(point.x-p.delivery.position.x)<.475 && Math.abs(point.z-p.delivery.position.z)<.54)))bootIntrusions++;
          return point.y;
        })));
        maxFloorError=Math.max(maxFloorError,Math.abs(Math.min(...soles)));largestSwing=Math.max(largestSwing,...soles);
      }
      const leg=w.limbs[0].leg,knee=leg.b.getWorldPosition(point.clone());
      const angle=leg.a.getWorldPosition(point.clone()).sub(knee).angleTo(pos[0].clone().sub(knee));
      minKneeAngle=Math.min(minKneeAngle,angle*180/Math.PI);
    }
    p.update(4);const hip=sk.getBoneByName('hips').getWorldPosition(point).y;
    const resting=w.limbs.every(l=>l.arm.end.getWorldPosition(point).y<hip+.07);
    return {maxFloorError,largestSwing,maxPlantedDrift,minFootSeparation,minKneeAngle,resting,groundedPairs,bootIntrusions};
  });
  for(const row of Object.values(report.contacts))assert(row.maxPalmError<.003 && row.maxVertexGap<.003,JSON.stringify(report.contacts));
  assert(report.feet.resting && report.feet.bootIntrusions===0 && report.feet.maxFloorError<.015 && report.feet.largestSwing>.045 &&
    report.feet.groundedPairs>1200 && report.feet.maxPlantedDrift<.003 && report.feet.minFootSeparation>.11 && report.feet.minKneeAngle<90,JSON.stringify(report.feet));
  await page.setViewportSize({width:390,height:844});await page.locator('[data-cue="build"]').click();
  report.portrait=await page.evaluate(()=>{
    const c=window.__cargo,p=c.plant.packing,w=p.worker,camera=c.getCamera(),sk=w.mesh.skeleton;
    const frames=[4,10.4,13.5,16,18,20.5,23];
    let maxEdge=0,standingHeight=0;
    for(const t of frames){
      p.update(t);
      const points=['head','hand_L','hand_R','foot_L','foot_R'].map(name=>sk.getBoneByName(name).getWorldPosition(w.figure.position.clone()).project(camera));
      maxEdge=Math.max(maxEdge,...points.flatMap(v=>[Math.abs(v.x),Math.abs(v.y)]));
      if(t===4)standingHeight=(points[0].y-Math.min(points[3].y,points[4].y))/2;
    }
    return {poses:frames.length,maxEdge,standingHeight};
  });
  assert(report.portrait.maxEdge<.94 && report.portrait.standingHeight>.19,JSON.stringify(report.portrait));
  await page.evaluate(async()=>{window.__cargo.setPaused(true);window.__cargo.seek(16);
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
  await page.screenshot({path:path.join(out,'组板人物手机近景.jpg'),quality:88});
  await page.route('**/people/road-worker-v1.glb',route=>route.abort());await page.reload();
  await page.waitForFunction(()=>window.__cargo?.missingWorker===true);
  assert.match(await page.getByRole('status').innerText(),/简化模型/);await page.locator('[data-area="tables"]').click();
  await page.locator('[data-cue="build"]').click();report.fallback=await page.evaluate(()=>window.__cargo.plant.packing.worker.figure.visible);
  assert(report.fallback);assert.deepEqual(report.errors,[]);
  console.log(JSON.stringify(report));
}finally{await writeFile(path.join(out,'worker-check.json'),JSON.stringify(report,null,2));await browser.close();}
