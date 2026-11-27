import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const app=path.dirname(fileURLToPath(import.meta.url));
const dest=path.resolve(app,process.env.AIRPORT_EVIDENCE || 'evidence/cargo/side-wings');
const url=process.env.AIRPORT_URL || 'http://127.0.0.1:5426/';
const before=process.argv.includes('--before'),version=before?'修改前':'修改后';
const {chromium}=createRequire(path.join(process.env.PLAYWRIGHT_FROM || app,'package.json'))('playwright');
await mkdir(dest,{recursive:true});
const browser=await chromium.launch({channel:'chromium',args:process.platform==='win32'?['--enable-gpu','--use-angle=d3d11']:[]});
const report={errors:[],views:{},stations:[]};
const page=await browser.newPage({viewport:{width:1600,height:920}});
const ready=async p=>p.waitForFunction(()=>!!window.__cargo,null,{timeout:90000});
const frames=p=>p.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
const watch=p=>p.on('pageerror',e=>report.errors.push(e.message));
watch(page);
try{
  await page.goto(url);await ready(page);
  await page.getByRole('button',{name:'暂停',exact:true}).click();
  const range=page.getByRole('combobox',{name:'总览范围'});
  for(const [i,label] of ['进港侧辅房','出港侧辅房'].entries()){
    // A stable free-camera comparison of the same floor on either version.
    const pose=await page.evaluate(i=>{
      const c=window.__cargo;
      const [[x,z],[xx,zz]]=c.data.site.freight.wings[i];
      const station={key:'qaWing',at:[(x+xx)/2,(z+zz)/2],width:26,depth:105,height:2,
        az:i===0?1.48:-1.48,elevation:.74};
      const n=c.nav.overview.push(station)-1;c.show('overview','3d',n);c.seek(8);
      return {eye:c.getCamera().position.toArray(),target:c.getTarget().toArray()};
    },i);
    await frames(page);await page.locator('main canvas').screenshot({path:path.join(dest,version+'-'+label+'.jpg'),quality:94});
    report.views[label]=pose;
  }
  if(!before){
    report.openBays=await page.evaluate(()=>{
      const c=window.__cargo,info=c.data.site.freight;
      return info.sideRooms.map((area,i)=>{
        const ranges=area.floors.map(poly=>poly.map(p=>p[1])).sort((a,b)=>Math.min(...a)-Math.min(...b));
        const z=(Math.max(...ranges[0])+Math.min(...ranges[1]))/2;
        const oldWing=info.wings[i],xs=[(oldWing[0][0]+oldWing[1][0])/2,c.data.site.bounds[i][0]];
        const hits=[0,0],matrix=c.hall.group.matrix.clone(),local=c.getCamera().position.clone();
        c.hall.group.updateWorldMatrix(true,true);
        c.hall.group.traverse(obj=>{
          if(!obj.isInstancedMesh || obj.geometry.type!=='BoxGeometry')return;
          for(let j=0;j<obj.count;j++){
            obj.getMatrixAt(j,matrix);matrix.premultiply(obj.matrixWorld).invert();
            xs.forEach((x,index)=>{
              local.set(x,.75,z).applyMatrix4(matrix);
              if(Math.max(Math.abs(local.x),Math.abs(local.y),Math.abs(local.z))<.499)hits[index]++;
            });
          }
        });
        return {side:area.label,hits};
      });
    });
    assert(report.openBays.every(r=>r.hits.every(n=>n===0)),'两侧敞开段须同时清除旧房体和裁切边界上的旧墙');
    for(const [key,label] of [['inWing','进港侧辅房'],['outWing','出港侧辅房']]){
      await page.goto(url+'?station='+key);await ready(page);
      assert.equal(await range.locator('option:checked').innerText(),label);
      assert.equal(await page.locator('.cargo-caption h2').innerText(),label);
      assert((await page.locator('.cargo-bottom').innerText()).includes('首层'));
      await page.locator('[data-projection=overlay]').click();await frames(page);
      const drawing=await page.evaluate(()=>({at:window.__cargo.getTarget().toArray(),view:window.__cargo.mode}));
      assert.equal(drawing.view,'overlay');
      assert(await page.getByText('辅房主要墙线',{exact:false}).isVisible());
      await page.locator('main canvas').screenshot({path:path.join(dest,label+'-图纸叠合.png')});
      await page.locator('[data-projection=paper]').click();await frames(page);
      assert.equal(await page.evaluate(()=>window.__cargo.mode),'paper');
      await page.locator('main canvas').screenshot({path:path.join(dest,label+'-物流图层.png')});
      await page.locator('[data-projection="3d"]').click();await frames(page);
      const picked=await page.evaluate(key=>{
        const c=window.__cargo,room=c.data.site.freight.sideRooms.find(w=>w.key===key);
        const at=c.nav.overview.find(w=>w.key===key).at;
        const group=c.hall.group.getObjectByName(key);
        const bbox=group.children.filter(x=>x.isMesh && !x.isInstancedMesh);
        const walls=group.children.filter(x=>x.isInstancedMesh);
        const p=room.floors[0].slice(0,2);
        const x=(p[0][0]+p[1][0])/2,z=(p[0][1]+p[1][1])/2+1.10;
        const cam=c.getCamera(),pt=cam.position.clone().set(x,0,z).project(cam);
        const rect=c.renderer.domElement.getBoundingClientRect();
        const screen=[rect.x+(1+pt.x)*rect.width/2,rect.y+(1-pt.y)*rect.height/2];
        return {at,bbox:bbox.length,wallBatches:walls.length,polygons:room.floors.length,screen};
      },key);
      assert.equal(picked.bbox,picked.polygons);assert(picked.wallBatches>0);
      assert(Math.hypot(drawing.at[0]-picked.at[0],drawing.at[2]-picked.at[1])<.01);
      await page.mouse.click(...picked.screen);await frames(page);
      const floor=await page.locator('.cargo-reading strong').innerText();
      assert.equal(floor,'所选地面 · '+label);
      await page.getByRole('button',{name:'回到全场'}).click();
      await page.locator('[data-tag="'+key+'"]').click();await frames(page);
      assert.equal(await range.locator('option:checked').innerText(),label);
      await page.screenshot({path:path.join(dest,label+'-浏览器.jpg'),quality:93});
      report.stations.push({key,label,floor,polygonCount:picked.polygons});
    }
    await page.setViewportSize({width:390,height:844});
    await range.selectOption({label:'进港侧辅房'});await frames(page);
    assert(await range.isVisible());await page.screenshot({path:path.join(dest,'手机-进港侧辅房.jpg'),quality:90});
    const previous=process.env.AIRPORT_PRIOR_FLOOR;
    if(previous){
      const legacy=await browser.newPage();watch(legacy);
      for(const name of ['layout.json','work-lines.png','work-plan.png']){
        const bytes=await readFile(path.join(previous,name));
        await legacy.route('**/project-layout/'+name,route=>route.fulfill({body:bytes,contentType:name.endsWith('json')?'application/json':'image/png'}));
      }
      await legacy.goto(url);await ready(legacy);
      assert.equal(await legacy.evaluate(()=>window.__cargo.hall.group.visible),true);
      assert.equal(await legacy.getByRole('option',{name:'进港侧辅房',exact:true}).count(),0);
      report.previousLayout='PASS';await legacy.close();
    }
  }
  assert.deepEqual(report.errors,[]);report.result='PASS';
  console.log(JSON.stringify({version,result:report.result,rooms:report.stations.length}));
}catch(e){report.failure=e.message;throw e;}
finally{
  await writeFile(path.join(dest,version+'-侧房核验.json'),JSON.stringify(report,null,2));
  await browser.close();
}
