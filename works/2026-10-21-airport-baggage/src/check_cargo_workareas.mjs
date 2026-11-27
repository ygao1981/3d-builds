import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const dir=path.resolve(root,process.env.AIRPORT_EVIDENCE || 'evidence/cargo/inbound-review');
const before=process.argv.includes('--before'),version=before?'修改前':'修改后';
const {chromium}=createRequire(path.join(process.env.PLAYWRIGHT_FROM || root,'package.json'))('playwright');
await mkdir(dir,{recursive:true});
const browser=await chromium.launch({channel:'chromium',args:process.platform==='win32'?['--enable-gpu','--use-angle=d3d11']:[]});
const page=await browser.newPage({viewport:{width:1600,height:920},deviceScaleFactor:1});
const report={version,errors:[],views:{}};
page.on('pageerror',e=>report.errors.push(e.message));
const frames=()=>page.evaluate(()=>new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok))));
const range=page.getByRole('combobox',{name:'总览范围'});
const select=async label=>{await range.selectOption({label});await frames();};
const snap=async name=>{
  await frames();await page.screenshot({path:path.join(dir,version+'-'+name+'.jpg'),quality:93});
  report.views[name]=await page.evaluate(()=>{
    const c=window.__cargo;
    return {eye:c.getCamera().position.toArray(),target:c.getTarget().toArray(),
      names:c.hall.operations.lettering.visible,tags:[...document.querySelectorAll('[data-tag]')]
      .filter(n=>n.checkVisibility({visibilityProperty:true})).map(n=>n.dataset.tag)};
  });
};
try{
  await page.goto(process.env.AIRPORT_URL || 'http://127.0.0.1:5426/');
  await page.waitForFunction(()=>!!window.__cargo,null,{timeout:90000});
  await page.getByRole('button',{name:'暂停',exact:true}).click();
  await page.evaluate(()=>window.__cargo.seek(10));await snap('主站房全景');
  await select('人工分拣出料');
  const canvas=page.locator('main canvas'),bounds=await canvas.boundingBox();
  await page.mouse.move(bounds.x+bounds.width*.46,bounds.y+bounds.height*.53);
  for(let i=0;i<31;i++){await page.mouse.wheel(0,120);await frames();}
  await snap('人工出料拉远');
  await select('进港快件作业区');
  // Keep the same operational-area camera in both versions even if the menu's framing evolves.
  await page.evaluate(()=>{
    const c=window.__cargo,eye=c.getCamera(),at=c.getTarget();
    eye.position.copy(at);eye.position.x+=5;eye.position.y+=29;eye.position.z+=33;eye.lookAt(at);
  });
  await snap('进港作业面');
  if(!before)await verifyWorkareas();
  assert.deepEqual(report.errors,[]);report.result='PASS';
  console.log(JSON.stringify({version,result:report.result,views:Object.keys(report.views)}));
}catch(err){report.failure=err.message;throw err;}
finally{await writeFile(path.join(dir,version+'-检查.json'),JSON.stringify(report,null,2));await browser.close();}

async function verifyWorkareas(){
  assert(report.views['人工出料拉远'].tags.includes('inWork'),'拉远后必须可以识别并进入进港快件作业区');
  assert(report.views['人工出料拉远'].names);
  const geometry=await page.evaluate(()=>{
    const c=window.__cargo,f=c.hall.freight,work=f.inboundWork,scale=f.floorWeigh;
    const station=work.stations,polygon=c.data.site.floorOperations.workAreas[0];
    const matrix=station.matrix.clone(),corners=[],surfaces=[];
    station.updateWorldMatrix(true,true);
    station.traverse(o=>{
      if(!o.isMesh)return;
      o.geometry.computeBoundingBox();
      function record(m){
        const bounds=o.geometry.boundingBox.clone().applyMatrix4(m);
        const {min,max}=bounds;
        for(const x of [min.x,max.x])for(const z of [min.z,max.z])corners.push([x,z]);
        if(o.geometry.type==='BoxGeometry')surfaces.push([min.x,max.x,min.z,max.z,max.y]);
      }
      if(o.isInstancedMesh)for(let i=0;i<o.count;i++){o.getMatrixAt(i,matrix);record(matrix.premultiply(o.matrixWorld));}
      else record(o.matrixWorld);
    });
    function inside([x,z]){
      let crossings=0;
      for(let i=0;i<polygon.length;i++){
        const [a,b]=polygon[i],[d,e]=polygon[(i+1)%polygon.length];
        if((b>z)!==(e>z) && x<a+(d-a)*(z-b)/(e-b))crossings++;
      }
      return crossings%2===1;
    }
    const frames=[0,7.5,10.5,13.5,21.5].map(t=>{
      work.update(t);return work.parcel.getWorldPosition(work.parcel.position.clone()).toArray();
    });
    const [x,y,z]=frames[1];
    const desk=surfaces.find(([x0,x1,z0,z1,top])=>x0<x && x<x1 && z0<z && z<z1 && Math.abs(top-y)<.002);
    const rollerCentres=[];
    station.traverse(o=>{
      if(!o.isInstancedMesh || o.geometry.type!=='CylinderGeometry')return;
      for(let i=0;i<o.count;i++){
        o.getMatrixAt(i,matrix);matrix.premultiply(o.matrixWorld);
        const m=matrix.elements;
        if(Math.abs(m[12]-x)<.001 && Math.abs(m[13]+.048-y)<.002)rollerCentres.push(m[14]);
      }
    });
    const interfaces=desk?.slice(2,4).map(edge=>Math.min(...rollerCentres.map(z=>Math.abs(z-edge))));
    const weighed=[0,8,14,17,25,32].map(t=>{
      scale.update(t);return {t,load:scale.load.position.toArray(),fork:scale.forklift.position.toArray(),status:scale.status};
    });
    work.update(10);scale.update(10);
    const online=c.nav.overview.find(n=>n.key==='inOnline'),floor=c.data.site.floorOperations;
    return {footprintInside:corners.length>0 && corners.every(inside),frames,interfaces,weighed,
      onlineTables:online.tables.length,registered:online.tables.every(p=>inside(p.at)),
      scales:c.data.site.floorScales.length,rig:!!work.worker.mesh,mainFloorNames:floor.names.map(n=>n.text),
      groundMarkers:c.hall.operations.lettering.children.length,
      retained:{docks:c.data.dock.levellers.length,tables:c.data.tables.places.length,staging:c.data.site.staging.length,
        palletBranches:c.data.pallet.tails.length,ringCars:c.data.sorter.carts,manual:f.manual.length}};
  });
  report.geometry=geometry;
  assert(geometry.footprintInside && geometry.registered && geometry.rig);
  assert.equal(geometry.onlineTables,4);assert.equal(geometry.scales,3);
  assert.equal(geometry.groundMarkers,geometry.mainFloorNames.length);
  assert.deepEqual(geometry.retained,{docks:15,tables:59,staging:64,palletBranches:9,ringCars:114,manual:4});
  const [arrival,stop,lift,down,exit]=geometry.frames;
  assert(stop[2]-arrival[2]>5 && lift[1]>stop[1]+.10);
  assert.deepEqual(stop,down);assert(exit[2]-down[2]>5 && exit[1]===stop[1]);
  assert(geometry.interfaces?.length===2 && geometry.interfaces.every(d=>d<.09),'复核台两端必须接到同标高的辊面');
  const [start,rest,weigh,done,pick,cycle]=geometry.weighed;
  assert(start.load[1]>.17 && Math.abs(rest.load[1]-.021)<.001);
  assert.deepEqual(rest.load,weigh.load);assert.deepEqual(weigh.load,done.load);
  assert(weigh.load[2]-weigh.fork[2]>5.5 && weigh.status==='称重中' && done.status==='可取货');
  assert(pick.load[1]>rest.load[1]+.08);assert.deepEqual(start.load,cycle.load);
  for(const [id,label] of [['inOnline','进港快件上线交接'],['inReview','进港查验与开箱复核'],['inHolding','进口暂扣与超期暂存']]){
    await select('进港快件作业区');
    const marker=page.locator('[data-tag='+id+']');
    assert(await marker.isVisible());await marker.click();await frames();
    assert.equal(await page.locator('.cargo-caption h2').innerText(),label);await snap(label);
  }
  await select('整托货物地磅称重');await page.evaluate(()=>window.__cargo.seek(14));await snap('整托地磅称重');
  const toggle=page.getByRole('checkbox',{name:'周转作业示例'});
  await toggle.uncheck();await frames();
  assert(await page.evaluate(()=>{const f=window.__cargo.hall.freight;return f.fixed.visible && !f.goods.visible && f.floorWeigh.status==='待称';}));
  await select('进港快件作业区');await snap('隐藏周转批次');
  assert(await page.evaluate(()=>{const w=window.__cargo.hall.freight.inboundWork;return w.stations.parent.visible && !w.batchLoads.parent.visible;}));
  await toggle.check();await frames();
  for(const label of ['收货作业区','出港快件组板区']){await select(label);assert.equal(await page.locator('.cargo-caption h2').innerText(),label);}
  await page.getByRole('combobox',{name:'业务流程'}).selectOption('国际快件进港');
  const result=page.getByRole('combobox',{name:'进港处理结果'}),steps=page.locator('.cargo-flow-steps');
  const flows={};
  for(const outcome of ['常规放行','复核后放行','暂扣待处理']){
    await result.selectOption(outcome);
    const buttons=await steps.locator('button').allTextContents();flows[outcome]=buttons.map(n=>n.replace('→',''));
    assert(flows[outcome].includes('理货申报'));
    assert(flows[outcome].includes('货件查验'));
    assert.equal(flows[outcome].includes('人工复核'),outcome!=='常规放行');
    assert.equal(flows[outcome].includes('提货装车'),outcome!=='暂扣待处理');
    assert.equal(flows[outcome].includes('暂扣待处理'),outcome==='暂扣待处理');
    const next=outcome==='常规放行'?'放行交接':outcome==='复核后放行'?'人工复核':'暂扣待处理';
    await steps.getByRole('button',{name:next,exact:true}).click();await frames();
    assert(await page.evaluate(()=>window.__cargo.hall.group.visible && !window.__cargo.hall.freight.studio.visible));
    if(outcome==='复核后放行')assert.equal(await page.locator('.cargo-caption h2').innerText(),'进港查验与开箱复核');
  }
  report.inboundFlows=flows;
  await select('进港查验与开箱复核');
  await page.locator('[data-projection=overlay]').click();await frames();
  assert(!(await page.locator('.cargo-caption').innerText()).includes('工位组合示意'));
  assert.equal(await page.evaluate(()=>window.__cargo.hall.group.visible),false);
  await page.locator('[data-projection="3d"]').click();await frames();
  await page.getByRole('button',{name:'回到全场'}).click();await frames();
  await page.locator('[data-tag=inWork]').click();await frames();
  assert.equal(await page.locator('.cargo-caption h2').innerText(),'进港快件作业区');
  await snap('进港整区');
  const floorChecks=[
    ['进港快件作业区','inWork',-8,7,'进港快件作业区'],
    ['跨境出港待运','crossWait',2,1,'跨境出港待运'],
    ['快件出港待运','expressWait',2,1,'快件出港待运'],
    ['中转分拨','transfer',1,1,'中转分拨'],
    ['进港拆板理货','inbound',-2,1,'进港拆板理货'],
    ['整托货物地磅称重','floorWeigh',.7,.6,'收货电子地磅'],
  ];
  report.floorPicks=[];
  for(const [view,key,dx,dz,expected] of floorChecks){
    await select(view);
    const point=await page.evaluate(([key,dx,dz])=>{
      const c=window.__cargo,node=c.nav.overview.find(n=>n.key===key);
      const v=c.getTarget().set(node.at[0]+dx,0,node.at[1]+dz).project(c.getCamera());
      const r=document.querySelector('main canvas').getBoundingClientRect();
      return [r.left+(1+v.x)*r.width/2,r.top+(1-v.y)*r.height/2];
    },[key,dx,dz]);
    await page.mouse.click(...point);await frames();
    assert.equal(await page.locator('.cargo-reading strong').innerText(),'所选地面 · '+expected);
    report.floorPicks.push(expected);
  }
  await select('进港快件作业区');
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});await frames();
    const mobile=page.getByRole('checkbox',{name:'显示工位标签'});
    await mobile.check();await frames();assert(await page.locator('[data-tag=inReview]').isVisible());
    await page.locator('[data-tag=inReview]').click();await frames();
    assert.equal(await page.locator('.cargo-caption h2').innerText(),'进港查验与开箱复核');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));
    if(width===390)await snap('手机查验工位');
    await mobile.uncheck();await select('进港快件作业区');
  }
  const entry=new URL(process.env.AIRPORT_URL || 'http://127.0.0.1:5426/');
  for(const [station,title] of [['inWork','进港快件作业区'],['missing-workface','全站房物流范围']]){
    entry.searchParams.set('station',station);await page.goto(entry.href);
    await page.waitForFunction(t=>window.__cargo && document.querySelector('.cargo-caption h2')?.textContent===t,title,{timeout:90000});
    const selected=await range.locator('option:checked').textContent();assert.equal(selected,title);
  }
  report.entryLinks=true;
}
