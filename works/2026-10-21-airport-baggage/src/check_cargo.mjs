import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const app=path.dirname(fileURLToPath(import.meta.url)), dest=path.resolve(app,process.env.AIRPORT_EVIDENCE || 'evidence/cargo');
await mkdir(dest,{recursive:true});
const {chromium}=createRequire(path.join(process.env.PLAYWRIGHT_FROM||app,'package.json'))('playwright');
const browser=await chromium.launch({channel:'chromium',args:process.platform==='win32'?['--enable-gpu','--use-angle=d3d11']:[]});
const url=process.env.AIRPORT_URL || 'http://127.0.0.1:5426/';
const results={assets:[],errors:[],views:[]};
const page=await browser.newPage({viewport:{width:1440,height:900}});
page.on('pageerror',e=>results.errors.push(e.message));
page.on('response',r=>{const p=new URL(r.url()).pathname;if(p.endsWith('.glb')||p.startsWith('/project-layout/'))results.assets.push([p,r.status()]);});
const waitFrame=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));

async function checkSortingLayers(){
  const area=page.locator('[data-area="sorting"]'),layers=page.getByRole('group',{name:'设备分层'});
  const device=page.getByRole('combobox',{name:'设备定位'});
  const speed=page.getByRole('combobox',{name:'演示倍速'});
  const press=id=>layers.locator('[data-layer="'+id+'"]').click();
  const projection=id=>page.locator('[data-projection="'+id+'"]').click();
  await area.click();await projection('3d');
  await speed.selectOption('2');
  const time=await page.evaluate(()=>window.__cargo.time);
  const checks={};
  for(const id of ['both','upper','lower']){
    await press(id);await waitFrame();
    const actual=await page.evaluate(()=>{
      const {view,plant,hall,data,time,getCamera,getTarget}=window.__cargo;
      const {sorting,pallet,chutePacking}=plant,p=pallet.group.position;
      return {view,sorting:sorting.group.visible,pallet:pallet.group.visible,packing:chutePacking.group.visible,
        platform:hall.serviceDeck.visible,position:[p.x,p.z],registered:data.pallet.offset,time,
        camera:getCamera().position.toArray(),target:getTarget().toArray()};
    });
    assert.equal(await area.getAttribute('aria-pressed'),'true');assert.equal(actual.view,'sorting');
    assert.equal(await layers.locator('[aria-pressed=true]').getAttribute('data-layer'),id);
    assert.equal(actual.sorting,id!=='lower');assert.equal(actual.pallet,id!=='upper');
    assert.equal(actual.platform,id!=='lower');assert.equal(actual.packing,id==='both');
    assert.equal(actual.time,time);assert.deepEqual(actual.position,actual.registered);
    assert.equal(await speed.inputValue(),'2');
    checks[id]=actual;
    await page.screenshot({path:path.join(dest,'sorting-layer-'+id+'.png')});
  }
  assert.deepEqual(checks.upper.camera,checks.both.camera);
  const heading=({camera,target})=>Math.atan2(camera[0]-target[0],camera[2]-target[2]);
  assert(Math.abs(heading(checks.lower)-heading(checks.upper))<.001);
  const lowerFootprint=()=>page.evaluate(()=>{
    const c=window.__cargo,p=c.data.pallet,g=c.plant.pallet.group;
    const points=[...p.inlets,...p.tails].map(([x,z])=>g.localToWorld(g.position.clone().set(x,p.deck,z)).project(c.getCamera()));
    const xs=points.map(v=>v.x),ys=points.map(v=>v.y);
    return {visible:points.every(v=>Math.abs(v.x)<1 && Math.abs(v.y)<1 && Math.abs(v.z)<1),
      width:(Math.max(...xs)-Math.min(...xs))/2,height:(Math.max(...ys)-Math.min(...ys))/2};
  });
  checks.lower.desktopFootprint=await lowerFootprint();
  assert(checks.lower.desktopFootprint.visible && checks.lower.desktopFootprint.width>.50);
  const lowerLabels=await device.locator('option').allTextContents();
  assert(lowerLabels.includes('拆盘机 1') && lowerLabels.includes('旋转台 2') && lowerLabels.includes('移载支路 9'));
  assert.deepEqual(await page.locator('[data-cue]').evaluateAll(nodes=>nodes.map(n=>n.dataset.cue).sort()),['chain','release','transfer','turn']);
  await page.locator('[data-cue="chain"]').click();
  assert.equal(await device.locator('option:checked').innerText(),'横向输送链');
  assert.equal(await area.getAttribute('aria-pressed'),'true');
  const start=await page.evaluate(()=>window.__cargo.plant.pallet.movers[0].load.position.toArray());
  await page.waitForFunction(start=>window.__cargo.plant.pallet.movers[0].load.position.toArray().some((n,i)=>Math.abs(n-start[i])>.1),start,{timeout:8000});
  await page.getByRole('button',{name:'暂停',exact:true}).click();
  await page.getByRole('button',{name:'重置视角'}).click();assert.equal(await device.inputValue(),'-1');
  assert.equal(await layers.locator('[data-layer=lower]').getAttribute('aria-pressed'),'true');
  for(const id of ['lower','upper','both']){
    await press(id);await projection('paper');await waitFrame();
    const sheet=await page.evaluate(id=>{
      const {data,plant}=window.__cargo,expected=id==='lower'?data.pallet.reference:data.sorter.reference;
      const images=plant.sorting.group.parent.children.filter(o=>o.visible && o.material?.map?.image?.src)
        .map(o=>new URL(o.material.map.image.src).pathname.split('/').pop());
      return {expected,images};
    },id);
    assert(sheet.images.includes(sheet.expected.image));assert((await page.locator('.cargo-caption').innerText()).includes(sheet.expected.sheet));
    assert.equal(sheet.images.includes('pallet.png'),id==='lower');
    await projection('overlay');await waitFrame();
    const strokes=await page.evaluate(()=>window.__cargo.plant.sorting.group.parent.children
      .filter(o=>o.visible && o.children[0]?.isLine2).length);
    assert.equal(strokes,id==='both'?2:1);
    const legend=await page.locator('.cargo-legend').innerText();assert.equal(legend.includes('空托盘线'),id!=='upper');
    checks[id].sheet=sheet.expected.sheet;checks[id].overlayGroups=strokes;
  }
  await projection('3d');await press('lower');await page.setViewportSize({width:390,height:844});await waitFrame();
  assert(await page.evaluate(()=>!window.__cargo.plant.sorting.group.visible && window.__cargo.plant.pallet.group.visible));
  checks.lower.mobileFootprint=await lowerFootprint();
  assert(checks.lower.mobileFootprint.visible && checks.lower.mobileFootprint.width>.65);
  const bounds=await layers.boundingBox(),projections=await page.getByRole('group',{name:'查看方式'}).boundingBox();
  assert(bounds.x>=0 && bounds.x+bounds.width<=390 && bounds.y>=projections.y+projections.height);
  await page.screenshot({path:path.join(dest,'sorting-layer-mobile.png')});
  await layers.locator('[data-layer=upper]').focus();await page.keyboard.press('Enter');
  assert((await device.locator('option').allTextContents()).includes('供包台 1'));assert.equal(await device.inputValue(),'-1');
  assert.equal(await page.locator('[data-cue="stack"],[data-cue="unload"]').count(),0);
  await page.locator('[data-cue="feed"]').click();await waitFrame();
  assert.equal(await layers.locator('[data-layer=upper]').getAttribute('aria-pressed'),'true');
  assert(await page.evaluate(()=>window.__cargo.plant.sorting.group.visible && !window.__cargo.plant.pallet.group.visible));
  await page.getByRole('button',{name:'暂停',exact:true}).click();
  await page.locator('[data-area="pallet"]').click();assert.equal(await layers.count(),0);
  await area.click();assert.equal(await layers.locator('[data-layer=both]').getAttribute('aria-pressed'),'true');
  await page.setViewportSize({width:1440,height:900});await waitFrame();
  return checks;
}
try{
  await page.goto(url);await page.waitForFunction(()=>Boolean(window.__cargo),undefined,{timeout:60000});
  const state=await page.evaluate(()=>{const c=window.__cargo,d=c.data,gl=c.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
    return {title:d.title,trays:d.sorter.carts,feeds:d.sorter.feeds.length,chutes:d.sorter.chutes.length,
      returnLines:d.sorter.returns.length,turns:d.pallet.turns.length,palletPorts:d.pallet.tails.length,
      docks:d.dock.levellers.length,tablePositions:d.tables.places.length,ringM:c.plant.sorting.loop.length,nominalRingM:d.sorter.nominalLength,
      chuteLengthM:Math.hypot(...d.sorter.chutes[0][0].map((v,i)=>v-d.sorter.chutes[0][1][i])),
      palletPitches:d.pallet.transfers.slice(1).map((p,i)=>p[0]-d.pallet.transfers[i][0]),
      gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};});
  results.measurements=state;assert(Math.abs(state.ringM-state.nominalRingM)<.6);
  assert(state.palletPitches.every(n=>Math.abs(n-2.4)<.07));
  await page.getByRole('button',{name:'暂停',exact:true}).click();
  const t=await page.evaluate(()=>window.__cargo.time);await waitFrame();assert.equal(await page.evaluate(()=>window.__cargo.time),t);
  await page.getByRole('button',{name:'继续',exact:true}).click();
  await page.waitForFunction(t=>window.__cargo.time>t+.12,t);
  await page.getByRole('combobox',{name:'演示倍速'}).selectOption('2');
  const stamps=await page.evaluate(async()=>{const times=[];for(let i=0;i<41;i++)times.push(await new Promise(r=>requestAnimationFrame(r)));
    return times.slice(1).map((t,i)=>t-times[i]).sort((a,b)=>a-b);});
  results.frameTiming={frames:stamps.length,medianMs:stamps[20],p90Ms:stamps[36]};
  await page.getByRole('button',{name:'暂停',exact:true}).click();
  await page.getByRole('combobox',{name:'演示倍速'}).selectOption('1');
  for(const area of ['sorting','chutes','pallet','dock','tables','overview']){
    await page.locator('[data-area="'+area+'"]').click();
    await page.locator('[data-projection="3d"]').click();
    await page.evaluate(()=>window.__cargo.seek(57));await waitFrame();
    await page.screenshot({path:path.join(dest,area+'-3d.png')});
    if(['sorting','pallet','overview'].includes(area)){
      const {seen,actual,expected}=await page.evaluate(area=>{
        const {plant,data}=window.__cargo,group=plant.pallet.group;
        return {seen:group.visible,actual:[group.position.x,group.position.z],expected:data.pallet.offset};
      },area);
      assert(seen);assert.deepEqual(actual,expected);(results.palletAlignment??=[]).push(area);
    }
    if(area==='pallet' || area==='sorting'){
      const moved=await page.evaluate(async area=>{const c=window.__cargo;
        const subject=area==='pallet'?c.plant.pallet.movers[0].load:c.plant.sorting.loads.find(x=>x.box.visible).box;
        const read=()=>subject.position.toArray();
        const a=read();c.seek(c.time+.35);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const b=read();
        return Math.max(...a.map((x,i)=>Math.abs(x-(b[i]??x))));},area);
      assert(moved>.02,area+' should move');results[area+'MotionM']=moved;
    }
    await page.locator('[data-projection="paper"]').click();await waitFrame();
    const paper=await page.screenshot({path:path.join(dest,area+'-paper.png')});
    await page.locator('[data-projection="overlay"]').click();await waitFrame();
    const overlay=await page.screenshot({path:path.join(dest,area+'-overlay.png')});
    assert(!paper.equals(overlay));
    assert.equal(await page.evaluate(()=>window.__cargo.getCamera().isOrthographicCamera),true);
    if(area==='pallet'){
      const canvas=await page.locator('canvas').boundingBox(),x=canvas.x+canvas.width*.55,y=canvas.y+canvas.height*.6;
      const before=await page.evaluate(()=>window.__cargo.getTarget().toArray());
      await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+85,y+30,{steps:6});await page.mouse.up();
      await waitFrame();
      const after=await page.evaluate(()=>window.__cargo.getTarget().toArray());
      results.paperDragM=Math.hypot(...after.map((v,i)=>v-before[i]));assert(results.paperDragM>.1);
      await page.getByRole('button',{name:'重置视角'}).click();
    }
    results.views.push(area);
  }
  results.sortingLayers=await checkSortingLayers();
  await page.locator('[data-area="dock"]').click();await page.locator('[data-projection="3d"]').click();
  await page.getByRole('combobox',{name:'设备定位'}).selectOption('0');await waitFrame();
  await page.getByRole('button',{name:'重置视角'}).click();
  assert.equal(await page.getByRole('combobox',{name:'设备定位'}).inputValue(),'-1');
  await page.setViewportSize({width:390,height:844});await page.locator('[data-area="pallet"]').click();await waitFrame();
  await page.screenshot({path:path.join(dest,'mobile.png')});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));
  const f=await browser.newPage();await f.route('**/project-layout/layout.json',r=>r.fulfill({status:404,body:''}));
  await f.goto(url);await f.getByRole('alert').waitFor();await f.unroute('**/project-layout/layout.json');
  await f.getByRole('button',{name:'重新加载'}).click();await f.waitForFunction(()=>Boolean(window.__cargo),undefined,{timeout:60000});
  results.recovered=true;assert(results.assets.every(x=>x[1]===200));assert.deepEqual(results.errors,[]);
  console.log(JSON.stringify({state,views:results.views,frameTiming:results.frameTiming}));
}catch(e){results.failure=e.message;results.page=(await page.locator('body').innerText()).slice(0,500);throw e;}
finally{await writeFile(path.join(dest,'acceptance.json'),JSON.stringify(results,null,2));await browser.close();}
