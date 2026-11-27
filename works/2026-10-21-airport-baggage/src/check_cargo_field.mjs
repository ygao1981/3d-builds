import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)),out=path.resolve(root,process.env.AIRPORT_EVIDENCE||'evidence/cargo/field');
await mkdir(out,{recursive:true});
const {chromium}=createRequire(path.join(process.env.PLAYWRIGHT_FROM||root,'package.json'))('playwright');
const browser=await chromium.launch({channel:'chromium',args:process.platform==='win32'?['--enable-gpu','--use-angle=d3d11']:[]});
const page=await browser.newPage({viewport:{width:1536,height:900},deviceScaleFactor:1});
const report={errors:[],shots:[]},url=process.env.AIRPORT_URL||'http://127.0.0.1:5426/';
page.on('pageerror',e=>report.errors.push(e.message));
const frame=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function shot(name){
  await frame();await page.screenshot({path:path.join(out,name+'.jpg'),type:'jpeg',quality:91});report.shots.push(name);
}
try{
  await page.goto(url);await page.waitForFunction(()=>!!window.__cargo,undefined,{timeout:90000});
  assert.equal(await page.evaluate(()=>window.__cargo.view),'overview');
  await shot('01-hall');
  const distance=()=>page.evaluate(()=>window.__cargo.getCamera().position.distanceTo(window.__cargo.getTarget()));
  const close=await distance();
  await page.getByRole('combobox',{name:'总览范围'}).selectOption('0');await shot('01b-entire-hall');
  report.cameras={work:close,whole:await distance()};assert(report.cameras.whole>close*1.4);
  await page.getByRole('combobox',{name:'总览范围'}).selectOption('-1');
  const poses=await page.evaluate(()=>{
    const c=window.__cargo,{plant:p,data:d}=c;
    const before=[p.sorting.group,p.pallet.group,p.dock,p.tables].map(g=>g.position.toArray());
    const views=['sorting','pallet','chutes','dock','tables','overview'].map(k=>{
      c.show(k);return [k,[p.sorting.group,p.pallet.group,p.dock,p.tables].map(g=>g.position.toArray()),c.hall.group.visible,p.dock.visible,p.tables.visible];
    });
    const edges=p.sorting.induction.noses.map(parts=>{
      let max=-Infinity;
      for(const part of parts){
        const attr=part.geometry.getAttribute('position');
        for(let i=0;i<attr.count;i++)max=Math.max(max,attr.getZ(i));
      }
      return -d.sorter.radius-(d.sorter.width+.06)/2-max;
    });
    const chain=p.pallet.banks.map((bank,i)=>{
      const machine=p.pallet.movers[i],trip=machine.trips.find(t=>t.cross);
      const at=(trip.chainAt+trip.outletAt)/2-machine.offset;
      let link,module;
      function sample(t){
        p.pallet.update(t);const matrix=bank.modules[0].plates.matrix.clone();
        if(link===undefined){
          let best=Infinity;
          for(const part of bank.modules)for(let idx=0;idx<part.plates.count/2;idx++){
            part.plates.getMatrixAt(idx,matrix);
            if(Math.abs(matrix.elements[13]+.024-machine.load.position.y)>.0001)continue;
            const gap=Math.abs(matrix.elements[12]-machine.load.position.x);
            if(Math.abs(matrix.elements[12]-part.centre)<1.0 && gap<best){link=idx;module=part;best=gap;}
          }
          if(link===undefined)throw new Error('托盘底部缺少承托链节');
        }
        module.plates.getMatrixAt(link,matrix);
        return {x:matrix.elements[12],y:matrix.elements[13],p:machine.load.position.toArray(),theta:module.wheels[0].rotation.z};
      }
      const a=sample(at),b=sample(at+.05);
      const spans=bank.modules.map(m=>m.wheels[1].position.x-m.wheels[0].position.x);
      const railPitch=bank.modules.map(m=>m.drive[1].position.z-m.drive[0].position.z);
      const centred=bank.modules.every(m=>m.drive.every(w=>Math.abs(w.position.x-m.centre)<1e-6));
      return {modules:bank.modules.length,spans,railPitch,centred,dx:b.x-a.x,palletDx:b.p[0]-a.p[0],gap:Math.abs(a.x-a.p[0]),top:a.y+.024,palletBottom:a.p[1],wheelAngle:b.theta-a.theta};
    });
    const sorter=p.sorting,ring=d.sorter,loop=sorter.loop,drive=1.48;
    const induction=sorter.induction.routes.map((route,inlet)=>{
      const load=sorter.loads.find(item=>item.inlet===inlet),entry=route[0],join=route.at(-1);
      const profile=sorter.induction.profiles[inlet],arrive=(ring.right-join[0]-load.slot*loop.length/ring.carts)/drive;
      const pose=(t)=>{sorter.update(t);return [load.box.position.x,load.box.position.z,load.box.visible];};
      const start=arrive-profile.duration,onTrunk=pose(start+profile.timeAt(1.5));
      let maxGap=0,allSeen=true,prev;
      for(let time=start+profile.timeAt(1.5);time<arrive+.30;time+=.04){
        const v=pose(time);
        if(prev)maxGap=Math.max(maxGap,Math.hypot(v[0]-prev[0],v[1]-prev[1]));
        allSeen=allSeen && v[2];prev=v;
      }
      const earlier=pose(arrive-.09),later=pose(arrive-.04),onCart=pose(arrive+.10);
      return {trunkError:Math.hypot(onTrunk[0]-entry[0]-1.5,onTrunk[1]-entry[1]),cartError:Math.hypot(onCart[0]-join[0]+drive*.10,onCart[1]-join[1]),
        tangent:(earlier[0]-later[0])/.05,entrySpeed:profile.entrySpeed,exitSpeed:profile.exitSpeed,allSeen,maxGap};
    });
    const pallet=p.pallet.movers[0].loads[0];
    pallet.children[0].computeBoundingBox();const bounds=pallet.children[0].boundingBox.clone().makeEmpty();
    for(const part of pallet.children){part.computeBoundingBox();bounds.union(part.boundingBox);}
    const size=bounds.getSize(pallet.position.clone()).toArray();
    const returns=ring.returns.map(row=>({inlet:row[2][2],bend:row[3][2],end:row.at(-1)[2],
      first:Math.hypot(row[3][0]-row[2][0],row[3][1]-row[2][1]),last:Math.hypot(row.at(-2)[0]-row.at(-3)[0],row.at(-2)[1]-row.at(-3)[1])}));
    return {before,views,edges,chain,induction,returns,size,flat:bounds.max.y,floorScales:d.site.floorScales.length,
      hallPosts:d.site.columns.length,markedStaging:d.site.staging.length,receipt:!!c.hall.meter};
  });
  report.geometry=poses;
  assert(poses.views.every(([,p,h,d,t])=>h&&d&&t&&JSON.stringify(p)===JSON.stringify(poses.before)));
  assert(poses.edges.length===3 && poses.edges.every(x=>x>.049&&x<.061));
  assert.deepEqual(poses.chain.map(c=>c.modules),[4,5]);
  assert(poses.chain.every(c=>c.centred && c.railPitch.every(v=>Math.abs(v-1.15)<.0001)));
  assert(poses.chain.every(c=>c.spans.every(s=>Math.abs(s-2.166)<.001) && c.gap<.4 && Math.abs(c.dx-c.palletDx)<.00003 && Math.abs(c.palletBottom-c.top)<.001 && Math.abs(c.wheelAngle)>.09));
  assert(poses.size.every((v,i)=>Math.abs(v-[1.20,.145,1.00][i])<.0001) && poses.floorScales===3);
  for(const [i,r] of poses.returns.entries()){
    assert(r.inlet===3.05 && r.end===.8 && r.bend===[2.04,1.5][i]);
    assert(Math.abs(r.first-[3.26,5.246][i])<.001 && Math.abs(r.last-[5.965,7.865][i])<.001);
  }
  assert(poses.induction.every(path=>path.allSeen && path.trunkError<.001 && path.cartError<.001 && path.maxGap<.08 &&
    path.exitSpeed>path.entrySpeed && Math.abs(path.tangent-1.48)<.001));
  assert(poses.receipt && poses.markedStaging>0 && poses.hallPosts>0);
  await page.locator('.cargo-map-tags').getByRole('button',{name:'收货计量',exact:true}).click();
  assert.equal(await page.getByRole('combobox',{name:'设备定位'}).locator('option:checked').innerText(),'收货扫码称重');
  assert.match(await page.locator('.cargo-facts').innerText(),/PR0020-F1004/);
  for(const [area,cue,time,name] of [
    ['sorting','meter',3,'02-receiving'],['sorting','distribute',null,'02b-distribution'],['sorting',null,24,'03-ring'],['sorting','feed',null,'04-infeed'],
    ['pallet','chain',null,'05-chain'],['chutes','stack',null,'05b-chute-packing'],['dock',null,11,'06-docks'],['dock','truck',11,'07-unloading'],
    ['dock','raise',4,'07b-lift'],['dock','handoff',null,'08-handoff'],['tables',null,12,'09-packing'],['tables','build',16,'10-building'],
    ['overview',null,10,'11-cad']
  ]){
    await page.locator('[data-area="'+area+'"]').click();
    if(cue)await page.locator('[data-cue="'+cue+'"]').click();
    if(name==='11-cad')await page.locator('[data-projection="overlay"]').click();
    await page.evaluate(t=>{const c=window.__cargo;c.setPaused(true);if(t!==null)c.seek(t);},time);
    await shot(name);
  }
  report.work=await page.evaluate(()=>{
    const p=window.__cargo.plant,d=p.dockOps,w=p.packing;
    function dock(t){d.update(t);return {cargo:d.cargo.position.toArray(),truck:d.vehicle.position.toArray(),uld:d.uld.position.toArray()};}
    function pack(t){w.update(t);return {carton:w.box.position.toArray(),worker:w.worker.figure.position.toArray()};}
    function clearance(vehicle,cargo){
      vehicle.updateWorldMatrix(true,true);cargo.updateWorldMatrix(true,false);
      const liftInverse=vehicle.matrixWorld.clone().invert(),point=cargo.position.clone();
      const blades=['sm_fork1_c01_obj_00','sm_fork2_c01_obj_00'].map(name=>vehicle.getObjectByName(name));
      return blades.map(blade=>{
        let top=-Infinity;
        blade.traverse(mesh=>{
          if(!mesh.isMesh)return;
          for(let i=0;i<mesh.geometry.attributes.position.count;i++){
            mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld).applyMatrix4(liftInverse);
            if(point.z>1.82 && point.z<2.5)top=Math.max(top,point.y);
          }
        });
        return cargo.position.y+.1065-top;
      });
    }
    d.update(12);w.update(4);const forks=[...clearance(d.vehicle,d.cargo),...clearance(w.vehicle,w.delivery)];
    const lifts=d.lifts.map((lift,i)=>{
      const path=window.__cargo.data.dock.handoffs[i],offset=i*lift.period*.48;
      const sample=t=>{lift.update(t-offset);return [lift.table.position.y,lift.uld.position.y,lift.uld.position.z,lift.uld.visible];};
      const before=sample(5),after=sample(6),onBelt=sample(lift.moveAt+1),later=sample(lift.moveAt+2);
      let unsupported=0,premature=0;
      for(let t=0;t<lift.period;t+=.1){
        const [y,base,z,visible]=sample(t);
        if(!visible)continue;
        const onLift=z-1.58<path[1][1],onFixed=z+1.58>path[1][1];
        if(onLift && Math.abs(y-base)>.001 || onFixed && Math.abs(base-.508)>.001)unsupported++;
        if(onLift && onFixed && Math.abs(y-.508)>.001)premature++;
      }
      return {low:sample(0)[0],high:onBelt[0],vertical:after[0]-before[0],speed:later[2]-onBelt[2],unsupported,premature};
    });
    const job=p.chutePacking,arrive=job.firstArrival;
    function chute(t){
      p.sorting.update(t);p.pallet.update(t);job.update(t);
      const parcel=job.candidates.find(e=>e.parcel.visible),m=p.pallet.movers[0];
      return {parcel:parcel?.parcel.position.toArray(),id:parcel?.box.uuid,originalVisible:parcel?.box.visible,
        pallet:m.loads[0].position.toArray(),palletVisible:m.loads[0].visible};
    }
    const samples=[.01,3.5,7,8].map(dt=>chute(arrive+dt)),dta=window.__cargo.data;
    const location=samples[2].pallet.map((v,i)=>v+([dta.pallet.offset[0],.145,dta.pallet.offset[1]][i]));
    return {forks,lifts,stacking:{samples,location},dock:[dock(7),dock(15),dock(19)],packing:[pack(12),pack(16),pack(20.8),pack(23)],supply:[0,4,8].map(t=>{w.update(t);return [w.vehicle.position.z,w.delivery.position.z];}),landing:w.landing,deck:window.__cargo.data.tables.height};
  });
  assert(report.work.forks.every(gap=>Number.isFinite(gap) && Math.abs(gap)<.001));
  const [a,b,rest]=report.work.dock;
  assert(b.cargo[2]-a.cargo[2]>6 && Math.abs((b.truck[2]-a.truck[2])-(b.cargo[2]-a.cargo[2]))<.001);
  assert(report.work.lifts.length===2 && report.work.lifts.every(l=>Math.abs(l.low+.492)<1e-6 && Math.abs(l.high-.508)<1e-6 &&
    Math.abs(l.speed-.30)<1e-5 && Math.abs(l.vertical-.05)<1e-5 && l.unsupported===0 && l.premature===0));
  const {samples,location}=report.work.stacking;
  assert(samples.every(s=>s.parcel && s.id===samples[0].id && s.palletVisible));
  assert(!samples[0].originalVisible && samples[1].parcel[2]>samples[0].parcel[2]);
  assert(samples[2].parcel.every((v,i)=>Math.abs(v-location[i])<.001));assert.deepEqual(samples[3].parcel,samples[2].parcel);
  assert(report.work.supply[2][1]-report.work.supply[0][1]>1.75);
  assert(report.work.supply.every(([fork,pallet])=>Math.abs(pallet-fork-1.94)<.001));
  const [pick,carry,placed,leave]=report.work.packing;
  assert(pick.carton[0]-carry.carton[0]>.4 && Math.abs(carry.worker[0]-carry.carton[0]-.38)<.001);
  assert(Math.abs(placed.carton[1]-report.work.deck-.05)<.001 && Math.abs(placed.carton[0]-report.work.landing[0])<.001);
  assert.deepEqual(placed.carton,leave.carton);
  await page.locator('[data-projection="3d"]').click();
  for(const [label,view] of [['斜向供包','sorting'],['组板','tables'],['整板交接','dock']]){
    await page.locator('[data-area="overview"]').click();
    await page.locator('.cargo-flow').getByRole('button',{name:label}).click();
    assert.equal(await page.evaluate(()=>window.__cargo.view),view);
  }
  await page.locator('[data-area="overview"]').click();
  await page.setViewportSize({width:390,height:844});await shot('12-mobile');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));
  const old=await browser.newPage();
  await old.route('**/project-layout/layout.json',async route=>{
    const response=await route.fetch(),data=await response.json();delete data.site;
    await route.fulfill({response,json:data});
  });
  await old.route('**/vehicle_forklift_red_c01.glb',r=>r.abort());
  await old.goto(url);await old.waitForFunction(()=>!!window.__cargo,undefined,{timeout:90000});
  await old.locator('[data-area="dock"]').click();await old.locator('[data-cue="truck"]').click();
  report.previousLayout=await old.evaluate(()=>({view:window.__cargo.view,missingCartons:window.__cargo.missingCartons,receipt:!!window.__cargo.hall.meter}));
  assert.deepEqual(report.previousLayout,{view:'dock',missingCartons:0,receipt:false});
  assert.deepEqual(report.errors,[]);
  console.log(JSON.stringify({holes:poses.edges,chain:poses.chain,views:poses.views.length,shots:report.shots.length}));
}catch(e){report.failure=e.message;report.screen=(await page.locator('body').innerText()).slice(0,600);throw e;}
finally{await writeFile(path.join(out,'field-check.json'),JSON.stringify(report,null,2));await browser.close();}
