import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const app=path.dirname(fileURLToPath(import.meta.url));
const dest=path.resolve(app,process.env.AIRPORT_EVIDENCE || 'evidence/cargo/motion');
await mkdir(dest,{recursive:true});
const {chromium}=createRequire(path.join(process.env.PLAYWRIGHT_FROM||app,'package.json'))('playwright');
const browser=await chromium.launch({channel:'chromium',args:process.platform==='win32'?['--enable-gpu','--use-angle=d3d11']:[]});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const url=process.env.AIRPORT_URL || 'http://127.0.0.1:5426/';
const result={models:[],errors:[],replays:[]};
page.on('pageerror',e=>result.errors.push(e.message));
page.on('response',r=>{if(r.url().endsWith('.glb'))result.models.push([r.url().split('/').pop(),r.status()]);});
async function still(elapsed,file){
  await page.evaluate(async elapsed=>{
    const c=window.__cargo;c.seek(c.time+elapsed);
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  },elapsed);
  await page.screenshot({path:path.join(dest,file+'.png')});
}
try{
  await page.goto(url);await page.waitForFunction(()=>!!window.__cargo,undefined,{timeout:60000});
  const manifest=JSON.parse(await readFile(path.join(app,'src/simready-assets.json'),'utf8'));
  assert.equal(new Set(result.models.map(([name])=>name)).size,manifest.models.filter(m=>m.projects.includes('cargo')).length);
  assert(result.models.every(([,status])=>status===200));
  await page.getByRole('combobox',{name:'演示倍速'}).selectOption('4');
  for(const [area,id,beat] of [['sorting','feed',1.0],['chutes','unload',2.8],['pallet','release',1.7],
    ['pallet','turn',2.0],['pallet','transfer',2.7]]){
    await page.locator('[data-area="'+area+'"]').click();
    await page.locator('[data-cue="'+id+'"]').click();
    assert.equal(await page.getByRole('combobox',{name:'演示倍速'}).inputValue(),'1');
    await page.getByRole('button',{name:'暂停',exact:true}).click();
    const state=await page.evaluate(id=>{const c=window.__cargo,cue=c.plant.sorting.cues[id] || c.plant.pallet.cues[id];
      return {view:c.view,expected:cue.view,time:c.time,start:cue.time,focus:cue.focus};},id);
    assert.equal(state.view,state.expected);assert(Math.abs(state.time-state.start)<1);
    assert.equal(await page.getByRole('combobox',{name:'设备定位'}).inputValue(),String(state.focus));
    await still(beat,id);
    if(id==='release')await still(4.4,'release-out');
    result.replays.push(id);
  }
  result.motion=await page.evaluate(()=>{
    const c=window.__cargo,{pallet,sorting}=c.plant,p=c.data.pallet;
    const checks={deliveries:[],halfTurns:[],fullTurns:[],liftTravel:[],dispensing:[],cycleErrors:[],cartons:[],minContact:Infinity,maxContact:0,peakTilt:0};
    for(const [side,m] of pallet.movers.entries()){
      const pose=t=>m.update(t-m.offset);
      const signature=()=>[...m.loads,...m.jaws,m.turntable,...m.ports.map(port=>m.lifts[port])].flatMap(obj=>
        [Number(obj.visible),...obj.position.toArray(),...obj.quaternion.toArray()]);
      const first=m.trips[0];pose(first.begin);const y=m.loads[1].position.y,rest=m.jaws[0].position.z;
      pose(first.release);checks.dispensing.push({retainedRise:m.loads[1].position.y-y,bottom:m.load.position.y,
        jawExtension:Math.abs(m.jaws[0].position.z-rest)});
      pose(first.turnAt);checks.dispensing[side].nextBottom=m.loads[1].position.y;
      for(const [i,trip] of m.trips.entries()){
        const same=()=>m.load===m.loads[i] && m.load.visible;
        pose((trip.turnAt+trip.runAt)/2);
        checks.halfTurns.push([side,m.turntable.rotation.y,m.load.rotation.y]);
        const identityAtTurn=same();
        pose(trip.runAt);checks.fullTurns.push([side,m.turntable.rotation.y,m.load.rotation.y]);
        if(trip.cross){
          pose(trip.chainAt);const before=m.lifts[trip.outlet].position.y;
          pose(trip.outletAt);const onChain=m.load.position.y;
          pose(trip.exitAt);checks.liftTravel.push([m.lifts[trip.outlet].position.y-before,onChain,m.load.position.y]);
        }
        pose(trip.finish);
        checks.deliveries.push({port:trip.outlet,same:identityAtTurn && same(),height:m.load.position.y,
          error:Math.hypot(m.load.position.x-trip.stop[0],m.load.position.z-trip.stop[1]),
          remaining:m.loads.filter(o=>o.visible).length,expected:m.loads.length-i});
      }
      const t=first.release+.27;pose(t);const a=signature();pose(m.cycle-.2);pose(t+m.cycle);const b=signature();
      checks.cycleErrors.push(Math.max(...a.map((n,i)=>Math.abs(n-b[i]))));
    }
    const sample=sorting.loads.find(l=>l.outlet===sorting.cues.unload.focus),s=c.data.sorter;
    const [head,tail]=s.chutes[sample.outlet],run=Math.hypot(tail[0]-head[0],tail[1]-head[1]);
    const y=z=>s.chuteTop+(s.chuteBottom-s.chuteTop)*Math.min(1,Math.max(0,(z-head[1])/(run*.8)));
    for(let i=0;i<=64;i++){
      sorting.update(sorting.cues.unload.time+.8+.55+.008+4.78*i/64);
      const box=sample.box,half=box.userData.size[2]/2;
      const ends=[-half,half].map(z=>box.localToWorld(box.position.clone().set(0,0,z)));
      const [rear,front]=ends.sort((a,b)=>a.z-b.z),points=[rear.z,front.z];
      for(const knee of [head[1],head[1]+.8*run])if(knee>rear.z && knee<front.z)points.push(knee);
      const gap=Math.min(...points.map(z=>rear.y+(front.y-rear.y)*(z-rear.z)/(front.z-rear.z)-y(z)));
      checks.minContact=Math.min(checks.minContact,gap);checks.maxContact=Math.max(checks.maxContact,gap);
      checks.peakTilt=Math.max(checks.peakTilt,box.rotation.x*180/Math.PI);
    }
    for(const name of new Set(sorting.loads.map(l=>l.box.name))){
      const model=sorting.loads.find(l=>l.box.name===name).box;
      let textured=false;model.traverse(n=>{if(n.isMesh && [].concat(n.material).some(m=>m.map?.image?.width>0))textured=true;});
      checks.cartons.push({name,size:model.userData.size,uniform:model.children[0].scale.toArray(),textured});
    }
    function rollerPose({node}){
      node.updateWorldMatrix(true,true);
      const point=node.position.clone();let top=-Infinity;
      node.traverse(mesh=>{
        if(!mesh.isMesh)return;
        for(let i=0;i<mesh.geometry.attributes.position.count;i++){
          mesh.getVertexPosition(i,point);top=Math.max(top,point.applyMatrix4(mesh.matrixWorld).y);
        }
      });
      return {at:node.getWorldPosition(point).toArray(),top,rotation:node.quaternion.clone()};
    }
    pallet.update(0);const before=pallet.wheels.map(rollerPose);
    pallet.update(.08);const after=pallet.wheels.map(rollerPose);
    const wheels=pallet.wheels.map((w,i)=>({surface:Math.max(Math.abs(before[i].top-p.deck),Math.abs(after[i].top-p.deck)),
      drift:Math.hypot(...before[i].at.map((v,j)=>v-after[i].at[j])),
      speed:before[i].rotation.angleTo(after[i].rotation)*w.radius*w.lengthScale/.08}));
    checks.rollers={count:wheels.length,maxSurfaceError:Math.max(...wheels.map(w=>w.surface)),maxPivotDrift:Math.max(...wheels.map(w=>w.drift)),
      minSurfaceSpeed:Math.min(...wheels.map(w=>w.speed)),maxSurfaceSpeed:Math.max(...wheels.map(w=>w.speed))};
    return checks;
  });
  const m=result.motion;
  assert(m.cartons.length===3 && m.cartons.every(c=>c.textured && Math.max(...c.uniform)-Math.min(...c.uniform)<1e-9));
  assert.equal(new Set(m.deliveries.map(p=>p.port)).size,9);
  assert(m.deliveries.every(p=>p.same && p.error<.0001 && p.remaining===p.expected && Math.abs(p.height-.8)<.001));
  assert(m.dispensing.every(d=>d.retainedRise>.08 && d.jawExtension>.20 && Math.abs(d.bottom-.8)<.001 && Math.abs(d.nextBottom-.8)<.001));
  assert(m.halfTurns.every(([side,turn,load])=>Math.abs(turn-load)<1e-8 && Math.abs(turn-(side?1:-1)*Math.PI/4)<1e-6));
  assert(m.fullTurns.every(([side,turn,load])=>Math.abs(turn-load)<1e-8 && Math.abs(turn-(side?1:-1)*Math.PI/2)<1e-6));
  assert(m.liftTravel.length===7 && m.liftTravel.every(([stroke,chain,top])=>Math.abs(stroke-.06)<1e-5 && Math.abs(chain-.76)<.0001 && Math.abs(top-.8)<.0001));
  assert(Math.max(...m.cycleErrors)<1e-7);
  assert(m.peakTilt>15 && m.minContact>-.0005 && m.maxContact<.002);
  assert(m.rollers.count>2 && m.rollers.maxSurfaceError<.004 && m.rollers.maxPivotDrift<.00001);
  assert(Math.abs(m.rollers.minSurfaceSpeed-.26)<.0001 && Math.abs(m.rollers.maxSurfaceSpeed-.26)<.0001);
  const failed=await browser.newPage();
  await failed.route(u=>/box_cardboard_(c02|d03)\.glb$/.test(u.pathname),r=>r.abort());
  await failed.goto(url);await failed.waitForFunction(()=>window.__cargo?.missingCartons===2);
  assert(await failed.getByRole('status').isVisible());
  await failed.locator('[data-area="sorting"]').click();await failed.locator('[data-cue="unload"]').click();
  result.previousPack=await failed.evaluate(()=>[...new Set(window.__cargo.plant.sorting.loads.map(l=>l.box.name))]);
  assert.deepEqual(result.previousPack,['box_cardboard_a01']);
  await failed.unrouteAll();
  await failed.route('**/pallet_a01.glb',r=>r.abort());await failed.reload();
  await failed.getByRole('alert').waitFor();await failed.unroute('**/pallet_a01.glb');
  await failed.getByRole('button',{name:'重新加载'}).click();
  await failed.waitForFunction(()=>!!window.__cargo,undefined,{timeout:60000});result.assetRecovery=true;
  assert.deepEqual(result.errors,[]);
  console.log(JSON.stringify({replays:result.replays,completed:m.deliveries.length,peakTilt:m.peakTilt,clearance:[m.minContact,m.maxContact]}));
}catch(e){result.failure=e.message;throw e;}
finally{await writeFile(path.join(dest,'motion-check.json'),JSON.stringify(result,null,2));await browser.close();}
