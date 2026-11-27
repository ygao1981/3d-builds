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
      let link;
      function sample(t){
        p.pallet.update(t);const matrix=bank.plates.matrix.clone();
        if(link===undefined){
          let best=Infinity;
          for(let idx=0;idx<bank.plates.count/2;idx++){
            bank.plates.getMatrixAt(idx,matrix);
            if(Math.abs(matrix.elements[13]+.024-machine.load.position.y)>.0001)continue;
            const gap=Math.abs(matrix.elements[12]-machine.load.position.x);
            if(gap<best){link=idx;best=gap;}
          }
          if(link===undefined)throw new Error('托盘底部缺少承托链节');
        }
        bank.plates.getMatrixAt(link,matrix);
        return {x:matrix.elements[12],y:matrix.elements[13],p:machine.load.position.toArray(),theta:bank.wheels[0].rotation.z};
      }
      const a=sample(at),b=sample(at+.05);
      return {links:bank.plates.count,dx:b.x-a.x,palletDx:b.p[0]-a.p[0],top:a.y+.024,palletBottom:a.p[1],wheelAngle:b.theta-a.theta};
    });
    return {before,views,edges,chain,hallPosts:d.site.columns.length,markedStaging:d.site.staging.length,receipt:!!c.hall.meter};
  });
  report.geometry=poses;
  assert(poses.views.every(([,p,h,d,t])=>h&&d&&t&&JSON.stringify(p)===JSON.stringify(poses.before)));
  assert(poses.edges.length===3 && poses.edges.every(x=>x>.049&&x<.061));
  assert(poses.chain.length===2 && poses.chain.every(c=>c.links>100 && Math.abs(c.dx-c.palletDx)<.00003 && Math.abs(c.palletBottom-c.top)<.001 && Math.abs(c.wheelAngle)>.09));
  assert(poses.receipt && poses.markedStaging>0 && poses.hallPosts>0);
  await page.locator('.cargo-map-tags').getByRole('button',{name:'收货计量',exact:true}).click();
  assert.equal(await page.getByRole('combobox',{name:'设备定位'}).locator('option:checked').innerText(),'收货扫码称重');
  for(const [area,cue,time,name] of [
    ['sorting','meter',3,'02-receiving'],['sorting',null,24,'03-ring'],['sorting','feed',null,'04-infeed'],
    ['pallet','chain',null,'05-chain'],['dock',null,11,'06-docks'],['dock','truck',11,'07-unloading'],
    ['dock','handoff',12,'08-handoff'],['tables',null,12,'09-packing'],['tables','build',16,'10-building'],
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
    return {forks,dock:[dock(7),dock(15),dock(19)],packing:[pack(12),pack(16),pack(20.8),pack(23)],supply:[0,4,8].map(t=>{w.update(t);return [w.vehicle.position.z,w.delivery.position.z];}),landing:w.landing,deck:window.__cargo.data.tables.height};
  });
  assert(report.work.forks.every(gap=>Number.isFinite(gap) && Math.abs(gap)<.001));
  const [a,b,rest]=report.work.dock;
  assert(b.cargo[2]-a.cargo[2]>6 && Math.abs((b.truck[2]-a.truck[2])-(b.cargo[2]-a.cargo[2]))<.001);
  assert(rest.uld[2]-a.uld[2]>2);
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
