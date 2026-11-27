import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const app=path.dirname(fileURLToPath(import.meta.url));
const url=process.env.AIRPORT_URL || 'http://127.0.0.1:5426/';
const dest=path.resolve(app,process.env.AIRPORT_EVIDENCE || 'evidence/cargo/full-process/release');
const {chromium}=createRequire(path.join(process.env.PLAYWRIGHT_FROM || app,'package.json'))('playwright');
await mkdir(dest,{recursive:true});
const browser=await chromium.launch({channel:'chromium',args:process.platform==='win32'?['--enable-gpu','--use-angle=d3d11']:[]});
const report={errors:[],workfaces:[],routes:[],screens:[]};
const page=await browser.newPage({viewport:{width:1600,height:920}});
page.on('pageerror',e=>report.errors.push(e.message));
const select=name=>page.getByRole('combobox',{name,exact:true});
const ready=p=>p.waitForFunction(()=>!!window.__cargo,null,{timeout:90000});
const frames=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function shot(name){
  await frames();await page.screenshot({path:path.join(dest,name+'.jpg'),quality:90});
  report.screens.push(name);
}
try{
  await page.goto(url);await ready(page);await page.getByRole('button',{name:'暂停',exact:true}).click();
  await page.evaluate(()=>window.__cargo.seek(13));await frames();
  const geometry=await page.evaluate(()=>{
    const c=window.__cargo,h=c.hall,f=h.freight,info=c.data.site.freight;
    function meshes(group){
      const result=[];
      group.updateWorldMatrix(true,true);
      group.traverse(n=>{
        if(!n.isInstancedMesh)return;
        for(let i=0;i<n.count;i++){
          const m=n.matrixWorld.clone();n.getMatrixAt(i,m);m.premultiply(n.matrixWorld);
          const v=n.position.clone(),scale=v.clone();m.decompose(v,n.quaternion.clone(),scale);
          result.push({at:v.toArray(),size:scale.toArray()});
        }
      });return result;
    }
    const parts=meshes(f.fixed),near=(a,b)=>a.every((v,i)=>Math.abs(v-b[i])<.003);
    const has=(x,y,z,w,h,d)=>parts.some(p=>near(p.at,[x,y,z]) && near(p.size,[w,h,d]));
    const steel=info.canopy.columns.filter(([x,z])=>has(x,.12,z,.82,.24,.88)).length;
    const cars=info.secondTrain.dollies.filter(([x,z])=>has(x,.49,z,3.45,.23,3.22)).length;
    const outlets=f.manual.map(m=>{
      const {entry,x,z,exitX,start,rollStart,divert,end,discharge}=m;
      const id=entry.item.uuid;
      function sample(after,want){
        const t=entry.timeAt(entry.end+after);entry.update(t);
        return id===entry.item.uuid && near(entry.item.position.toArray(),want);
      }
      return {divert,upstream:sample(.02,[x,.8,start+.02]),split:sample(z-start,[x,.8,z]),
        through:divert?sample(z-start+Math.abs(exitX-x)/2,[(exitX+x)/2,.8,z]):sample(rollStart-start+.50,[x,.70,rollStart+.50]),
        discharge:divert?sample(entry.outfeed.length-.5,[exitX,.8,discharge+.5]):sample(end-start-.5,[x,.50,end-.5])};
    });
    const workers=f.handlers.map((h,i)=>{
      const samples=[0,7,15,19].map(t=>{h.update(t-(i?4:0));return h.box.position.toArray();});
      return {rig:!!h.worker.mesh,from:h.from,to:h.to,samples};
    });
    f.update(4);const pickup=f.carried.position.toArray(),sand=f.weigh.position.toArray();
    f.update(12);const moved=f.carried.position.toArray(),weightIn=f.weigh.position.toArray();
    f.update(16);const stable=f.weigh.position.toArray();
    f.update(27);const departed=f.weigh.position.toArray();f.update(13);
    const rackParts=meshes(f.rooms.get('equipment'));
    const rackPosts=rackParts.filter(p=>near(p.size,[.12,3.20,.12]));
    return {steel,cars,outlets,workers,pickup,moved,sand,weightIn,stable,departed,scale:c.data.site.reweigh[0],
      span:info.canopy.front-info.canopy.back,eave:info.canopy.eave-info.canopy.front,rackPosts:rackPosts.length,
      main:h.group.visible && f.canopy.visible && !f.studio.visible,items:info.nodes.map(n=>({key:n.key,label:n.label,independent:!!n.independent}))};
  });
  report.geometry=geometry;
  assert.equal(geometry.steel,12);assert.equal(geometry.cars,2);assert.equal(geometry.rackPosts,4);
  assert(Math.abs(geometry.span-34)<.02 && Math.abs(geometry.eave-5.5)<.001 && geometry.main);
  assert(geometry.outlets.length===4 && geometry.outlets.filter(x=>x.divert).length===2);
  assert(geometry.outlets.every(x=>x.upstream && x.split && x.through && x.discharge),'纸箱必须由同一收货线连续通过摆轮、汇流或坡降滚筒');
  for(const {rig,from,to,samples:[pick,carry,place,rest]} of geometry.workers){
    assert(rig && Math.abs(pick[0]-from[0])<.001 && Math.abs(pick[2]-from[1])<.001 && Math.abs(pick[1]-.585)<.001);
    assert(carry[1]>.95 && carry[2]>pick[2]+.5 && place[2]>carry[2]+.8);
    assert(Math.abs(place[2]-to[1])<.001 && Math.abs(place[1]-.525)<.001);assert.deepEqual(place,rest);
  }
  assert(geometry.moved[1]>geometry.pickup[1]+.12 && geometry.moved[2]<geometry.pickup[2]-3);
  assert.deepEqual(geometry.weightIn,geometry.stable);
  assert(Math.abs(geometry.weightIn[2]-geometry.scale[1])<.001 && geometry.sand[2]-geometry.weightIn[2]>3 && geometry.departed[2]<geometry.weightIn[2]-6);
  const batch=page.getByRole('checkbox',{name:'场坪周转货载示例'});
  await batch.uncheck();await frames();
  assert(await page.evaluate(()=>{const f=window.__cargo.hall.freight;return !f.goods.visible && f.fixed.visible && f.canopy.visible;}));
  await batch.check();await shot('全场物流');
  const range=select('总览范围');
  for(const item of geometry.items){
    await range.selectOption({label:item.label});await frames();
    assert.equal(await page.locator('.cargo-caption h2').innerText(),item.label);
    const picked=await page.evaluate(id=>{
      const s=window.__cargo.hall,room=s.freight.rooms.get(id);
      return {main:s.group.visible,studio:s.freight.studio.visible,room:room?.visible ?? false,roof:s.freight.canopy.visible,
        count:[...s.freight.rooms.values()].filter(r=>r.visible).length};
    },item.key);
    assert.equal(picked.main,!item.independent);
    assert.equal(picked.studio,item.independent);assert.equal(picked.count,item.independent?1:0);
    assert.equal(picked.roof,item.key==='canopy','工位近景应剖开棚架，避免遮住人员和货物');
    if(item.independent)assert(picked.room && await page.getByRole('button',{name:'返回主站房'}).isVisible());
    if(item.key==='dispatch'){
      const positions=[];
      for(const t of [14,20,25]){
        await page.evaluate(t=>window.__cargo.seek(t),t);await frames();
        positions.push(await page.evaluate(()=>{const d=window.__cargo.plant.dockOps;return [d.vehicle.position.z,d.cargo.position.z];}));
      }
      assert(positions[0][1]-positions[2][1]>8 && positions[2][0]>positions[2][1]);
      assert(Math.abs(positions[1][0]-positions[1][1]-1.94)<.001);report.dispatch=positions;
    }
    if(['manual','inbound','crossWait','transfer','canopy','shed','weigh','equipment','pickup','dispatch'].includes(item.key))await shot(item.label);
    if(item.key==='shed'){
      await page.getByRole('button',{name:'返回主站房'}).click();
      assert(await page.evaluate(()=>window.__cargo.hall.group.visible && !window.__cargo.hall.freight.studio.visible));
    }
    report.workfaces.push(item.label);
  }
  await page.getByRole('button',{name:'回到全场'}).click();
  const cases=[['跨境电商出港'],['国际快件出港','常规快件'],['国际快件出港','超大超重货物'],['国际快件进港'],
    ['中转货物','国内转国际'],['中转货物','国际转国内'],...['中心内中转','国际货站调入','调往国际货站'].map(v=>['中转货物','国际转国际',v])];
  for(const [flow,sub,allocation] of cases){
    await page.getByRole('button',{name:'主站房全景',exact:false}).first().click();
    await select('业务流程').selectOption(flow);
    if(sub)await select(flow==='中转货物'?'中转方向':'货物类型').selectOption(sub);
    if(allocation)await select('调拨方式').selectOption(allocation);
    const steps=page.locator('.cargo-flow-steps button'),labels=(await steps.allTextContents()).map(s=>s.replace('→','').trim());
    assert(labels.length>=4);
    for(const label of labels){
      const button=page.locator('.cargo-flow-steps').getByRole('button',{name:label,exact:true});
      await button.click();await frames();assert.equal(await button.getAttribute('aria-pressed'),'true');
      assert.equal(await select('业务流程').inputValue(),flow);
      if(allocation)assert.equal(await select('调拨方式').inputValue(),allocation);
      const head=await page.locator('.cargo-caption h2').innerText();assert(head.trim());
      assert(await page.evaluate(()=>window.__cargo.mode==='3d' && window.__cargo.renderer.info.render.triangles>100));
    }
    report.routes.push({flow,sub,allocation,steps:labels});
  }
  await page.locator('[data-area=overview]').click();await page.getByRole('button',{name:'回到全场'}).click();
  await page.locator('[data-projection=paper]').click();assert.equal(await page.evaluate(()=>window.__cargo.hall.group.visible),false);
  await page.locator('[data-projection=overlay]').click();await page.locator('[data-projection="3d"]').click();
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});await frames();
    const choice=select('业务流程');await choice.selectOption('中转货物');await select('中转方向').selectOption('国际转国际');
    await select('调拨方式').selectOption('国际货站调入');
    const marker=page.getByRole('checkbox',{name:'显示工位标签'});
    assert(!(await page.locator('.cargo-map-tags').isVisible()));await marker.check();await frames();
    assert(await page.locator('[data-tag=sorting]').isVisible());await marker.uncheck();
    const dims=await page.locator('.cargo-business').boundingBox();assert(dims.x>=0 && dims.x+dims.width<=width+.1);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);
    if(width===390)await shot('手机流程操作');
  }
  const old=await browser.newPage();
  const previous=process.env.AIRPORT_PRIOR_FLOOR;
  if(previous)await old.route(/\/project-layout\/(layout\.json|work-lines\.png|work-plan\.png)$/,route=>{
    const name=path.basename(new URL(route.request().url()).pathname);
    return route.fulfill({path:path.join(previous,name),contentType:name.endsWith('.json')?'application/json':'image/png'});
  });else await old.route('**/project-layout/layout.json',async route=>{
    const response=await route.fetch(),d=await response.json();delete d.site.freight;await route.fulfill({response,json:d});
  });
  await old.goto(url);await ready(old);
  assert.equal(await old.getByRole('combobox',{name:'业务流程'}).count(),0);
  await old.locator('.cargo-flow').getByRole('button',{name:'斜向供包'}).click();
  assert.equal(await old.evaluate(()=>window.__cargo.view),'sorting');report.previousLayout=previous?'前版实际布局及两张图层':'移除新增字段的兼容检查';
  await old.close();assert.deepEqual(report.errors,[]);report.result='PASS';
  console.log(JSON.stringify({workfaces:report.workfaces.length,routes:report.routes.length,steps:report.routes.reduce((n,r)=>n+r.steps.length,0),screens:report.screens.length}));
}catch(error){report.failure=error.message;throw error;}
finally{await writeFile(path.join(dest,'全流程验证.json'),JSON.stringify(report,null,2));await browser.close();}
