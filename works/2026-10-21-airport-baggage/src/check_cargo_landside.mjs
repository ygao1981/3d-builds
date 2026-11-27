import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const app = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(app, process.env.AIRPORT_EVIDENCE || 'evidence/cargo/marked-floor-review');
const baseline = process.argv.includes('--before');
const version = baseline ? '修改前' : '修改后';
const {chromium} = createRequire(path.join(process.env.PLAYWRIGHT_FROM || app, 'package.json'))('playwright');
await mkdir(out, {recursive:true});
const browser = await chromium.launch({channel:'chromium', args:process.platform === 'win32' ? ['--enable-gpu','--use-angle=d3d11'] : []});
const page = await browser.newPage({viewport:{width:1800,height:1000}});
const report = {version, views:{}, errors:[]};
page.on('pageerror', error => report.errors.push(error.message));
const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const url = process.env.AIRPORT_URL || 'http://127.0.0.1:5426/';
const menu = page.getByRole('combobox', {name:'总览范围'});

async function photo(name) {
  await frames();
  await page.screenshot({path:path.join(out,version+'-'+name+'.jpg'),quality:92});
  report.views[name] = await page.evaluate(() => {
    const c = window.__cargo;
    return {eye:c.getCamera().position.toArray(), target:c.getTarget().toArray()};
  });
}

try {
  await page.goto(url);
  await page.waitForFunction(() => !!window.__cargo, null, {timeout:90000});
  await page.getByRole('button',{name:'暂停',exact:true}).click();
  for (const [name, station, distance] of [
    ['主站房','全站房物流范围',254], ['出港收货','整托货物地磅称重',69],
    ['中部交接','利旧作业平台',76], ['进港发货','AGV 暂存工位',82]
  ]) {
    await menu.selectOption({label:station});
    await page.evaluate(distance => {
      const c=window.__cargo, target=c.getTarget(), eye=c.getCamera();
      const az=Math.PI-.10, elevation=1.03;
      eye.position.set(target.x+distance*Math.sin(az)*Math.cos(elevation), target.y+distance*Math.sin(elevation),
        target.z+distance*Math.cos(az)*Math.cos(elevation));
      eye.lookAt(target); c.seek(14);
    },distance);
    await photo(name);
  }
  if (!baseline) await verify();
  assert.deepEqual(report.errors,[]);
  report.result='PASS';
  console.log(version,report.result,Object.keys(report.views).length);
} catch (error) {
  report.failure=error.message;
  throw error;
} finally {
  await writeFile(path.join(out,version+'-实测.json'),JSON.stringify(report,null,2));
  await browser.close();
}

async function verify() {
  const result=await page.evaluate(()=>{
    const {data,hall,getCamera}=window.__cargo, site=data.site, floor=site.floorOperations, freight=hall.freight;
    const position=getCamera().position.clone(),matrix=hall.group.matrix.clone(),marks=[];
    hall.group.updateWorldMatrix(true,true);
    freight.fixed.traverse(m=>{
      if(!m.isInstancedMesh || m.geometry.type!=='BoxGeometry')return;
      for(let i=0;i<m.count;i++){
        m.getMatrixAt(i,matrix);position.setFromMatrixPosition(matrix);
        if(Math.abs(position.y-.023)<.0001)marks.push([position.x,position.z]);
      }
    });
    const stockMarks=site.staging.map(p=>{
      const [x,z]=p.at,[w,d]=p.size;
      return [[x-w/2,z],[x+w/2,z],[x,z-d/2],[x,z+d/2]].filter(([a,b])=>
        marks.some(([c,f])=>Math.hypot(a-c,b-f)<.009)).length;
    });
    const template=freight.stagingLots.children[0].geometry;
    template.computeBoundingBox();
    function boxOf(group){
      const box=template.boundingBox.clone().setFromObject(group);
      return [box.min.x,box.min.z,box.max.x,box.max.z];
    }
    function pointIn([x,z],poly){
      let inside=false;
      poly.forEach(([a,c],i)=>{
        const [v,f]=poly[(i+1)%poly.length];
        if((c>z)!==(f>z) && x<a+(z-c)*(v-a)/(f-c))inside=!inside;
      });
      return inside;
    }
    const overlaps=([a,c,v,h],[x,z,xx,zz])=>a<xx && v>x && c<zz && h>z;
    const obstacles=[
      ...site.floorScales.map(([x,z])=>[x-2,z-2,x+2,z+2]),
      ...floor.handling.offices.map(({bounds:[a,b]})=>[...a,...b]),
      ...floor.tracks.map(t=>[t.start[0]-t.gauge/2,t.start[1],t.end[0]+t.gauge/2,t.end[1]]),
      ...site.staging.map(({at:[x,z],size:[w,d]})=>[x-w/2,z-d/2,x+w/2,z+d/2]),
      ...floor.handling.aisles.map(p=>[Math.min(...p.map(q=>q[0])),Math.min(...p.map(q=>q[1])),
        Math.max(...p.map(q=>q[0])),Math.max(...p.map(q=>q[1]))])
    ];
    const lots=freight.handlingLots.children.map(group=>{
      const [a,c,v,h]=boxOf(group),zone=floor.handling.areas.find(z=>z.key===group.name);
      return {area:group.name,within:[[a,c],[v,c],[a,h],[v,h]].every(p=>pointIn(p,zone.outline)),
        obstructs:obstacles.some(other=>overlaps([a,c,v,h],other))};
    });
    const deckBases=[];
    freight.onDeck.traverse(m=>{
      if(!m.isInstancedMesh)return;
      for(let i=0;i<m.count;i++){
        m.getMatrixAt(i,matrix);position.setFromMatrixPosition(matrix);
        if(Math.abs(matrix.elements[5]-.05)<.0001 && Math.abs(position.y-.515)<.0001)
          deckBases.push([position.x,position.z]);
      }
    });
    const slots=floor.existing.positions;
    const loaded=slots.filter(([[a,c],[b,d]])=>deckBases.some(([x,z])=>Math.hypot(x-(a+b)/2,z-(c+d)/2)<.01)).length;
    freight.update(0);const start=freight.parcels.map(p=>p.position.clone());
    freight.update(4);const advance=freight.parcels.map((p,i)=>p.position.z-start[i].z);
    const onBelt=freight.parcels.every(p=>p.position.y===.8 && Math.abs(p.position.x-floor.existing.straight.start[0])<.001);
    return {stockMarks:stockMarks.length,complete:stockMarks.filter(n=>n===4).length,lots,loaded,advance,onBelt,
      officeGroups:floor.handling.offices.length,officeRooms:floor.handling.offices.reduce((a,p)=>a+p.rooms,0),
      stagingInOutbound:site.staging.filter(p=>pointIn(p.at,floor.handling.areas.find(a=>a.key==='outReceipt').outline)).length};
  });
  report.geometry=result;
  assert.deepEqual([result.stockMarks,result.complete,result.stagingInOutbound,result.officeGroups,result.officeRooms,result.loaded],[76,76,5,3,4,4]);
  assert.equal(result.lots.length,6);assert(result.lots.every(x=>x.within && !x.obstructs),JSON.stringify(result.lots));
  assert(result.onBelt && result.advance.length===3 && result.advance.every(d=>Math.abs(d-1.92)<.002));
  for(const [key,label] of [['outReceipt','出港快件收货区'],['oldTransfer','利旧输送与平台周转'],['inDispatchArea','进港提货与发货']]){
    await menu.selectOption({label});await photo(label);
    assert.equal(await page.locator('.cargo-caption h2').innerText(),label);
    const target=await page.evaluate(key=>{
      const c=window.__cargo, f=c.data.site.floorOperations;
      if(key==='outReceipt')return c.data.site.floorScales[1];
      const bounds=key==='inDispatchArea'?f.handling.offices[0].bounds:f.existing.deck;
      return bounds[0].map((a,i)=>(a+bounds[1][i])/2);
    },key);
    await clickFloor(target,key==='outReceipt'?'收货电子地磅':key==='oldTransfer'?'利旧作业平台':'货运设备操作间');
    if(key==='outReceipt'){
      assert((await page.locator('.cargo-facts').innerText()).includes('5 处'));
      const clear=await page.evaluate(()=>{
        const p=window.__cargo.data.site.floorOperations.handling.aisles[0];
        return [0,1].map(i=>p.reduce((sum,pt)=>sum+pt[i],0)/p.length);
      });
      await clickFloor(clear,'货物周转通道');
    }
    if(key==='inDispatchArea')assert((await page.locator('.cargo-facts').innerText()).includes('2 间'));
  }
  const toggle=page.getByRole('checkbox',{name:'周转作业示例'});
  await toggle.uncheck();await frames();await photo('关闭周转作业');
  assert(await page.evaluate(()=>{
    const f=window.__cargo.hall.freight;
    return !f.goods.visible && [f.handlingLots,f.stagingLots,f.onDeck,...f.parcels].every(g=>g.parent===f.goods) && f.fixed.visible;
  }));
  await toggle.check();await frames();
  assert(await page.evaluate(()=>window.__cargo.hall.freight.goods.visible));
  await menu.selectOption({label:'提货装车'});await frames();
  const dispatch=await page.evaluate(()=>{
    const c=window.__cargo,d=c.data.dock,bay=d.levellers.find(p=>p.id===d.dispatchId);
    return {bay:bay.id,loadedAtBay:Math.abs(c.plant.dockOps.vehicle.position.x-bay.at[0])<.001};
  });
  assert.equal(dispatch.bay,'A01-002');assert(dispatch.loadedAtBay);report.dispatch=dispatch;
  await page.locator('[data-area="dock"]').click();await frames();
  assert(await page.evaluate(()=>{
    const c=window.__cargo,ops=c.plant.dockOps;return Math.abs(ops.vehicle.position.x-c.data.dock.levellers[ops.active].at[0])<.001;
  }));
  await page.goto(url+'?station=inDispatchArea');await page.waitForFunction(()=>!!window.__cargo);
  assert.equal(await page.locator('.cargo-caption h2').innerText(),'进港提货与发货');
  await page.setViewportSize({width:390,height:844});await frames();
  await menu.selectOption({label:'出港快件收货区'});await photo('手机收货');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  if(process.env.AIRPORT_PRIOR_LAYOUT){
    const older=await readFile(process.env.AIRPORT_PRIOR_LAYOUT);
    await page.route('**/project-layout/layout.json',route=>route.fulfill({body:older,contentType:'application/json'}));
    await page.goto(url);
    await page.waitForFunction(()=>!!window.__cargo);
    assert(await page.evaluate(()=>!window.__cargo.data.site.floorOperations.handling && window.__cargo.data.site.staging.length===64));
    await menu.selectOption({label:'利旧作业平台'});await frames();report.previous='PASS';
  }
}

async function clickFloor(at,label){
  const xy=await page.evaluate(([x,z])=>{
    const c=window.__cargo,eye=c.getCamera(),p=eye.position.clone().set(x,0,z).project(eye);
    const b=document.querySelector('main canvas').getBoundingClientRect();
    return [b.left+(p.x+1)*b.width/2,b.top+(1-p.y)*b.height/2];
  },at);
  await page.mouse.click(...xy);await frames();
  assert((await page.locator('.cargo-reading strong').innerText()).includes(label),'点选应显示 '+label);
}
