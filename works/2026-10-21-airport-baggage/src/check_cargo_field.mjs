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
  const overview=page.getByRole('combobox',{name:'总览范围'});
  if(await page.evaluate(()=>!!window.__cargo.data.site?.floorOperations)){
    assert.equal(await overview.inputValue(),'0');
    report.hallFloor=await page.evaluate(()=>{
      const c=window.__cargo,{hall,data}=c,f=data.site.floorOperations,matrix=hall.group.matrix.clone();
      const boxes=[];
      hall.group.traverse(m=>{
        if(!m.isInstancedMesh || m.geometry.type!=='BoxGeometry')return;
        for(let i=0;i<m.count;i++){
          m.getMatrixAt(i,matrix);const a=matrix.elements;
          boxes.push([a[12],a[13],a[14],a[0],a[5],a[10]]);
        }
      });
      const matches=(p)=>boxes.some(b=>p.every((v,i)=>v===null || Math.abs(b[i]-v)<.002));
      const tracks=hall.operations.tracks.map((pair,i)=>{
        const last=data.dock.handoffs[i].at(-1).map((n,j)=>n+data.dockOffset[j]);
        return {gauge:Math.abs(pair[1].position.x-pair[0].position.x),lengths:pair.map(m=>m.geometry.parameters.depth),
          startError:Math.hypot((pair[1].position.x+pair[0].position.x)/2-last[0],pair[0].position.z-pair[0].geometry.parameters.depth/2-last[1])};
      });
      const stands=f.agv.stands.filter(({at:[x,z],turned})=>{
        const w=turned?1.03:1.21,d=turned?1.21:1.03;
        return [-1,1].every(i=>[-1,1].every(j=>matches([x+i*(w/2-.07),.23,z+j*(d/2-.07),.12,.46,.12])));
      }).length;
      return {tracks,stands,transfer:f.agv.handover.filter(([x,z])=>matches([x,.39,z,1.4,.12,2])).length,
        mobile:f.agv.vehicles.filter(({at:[x,z],alongZ})=>matches([x,.13,z,alongZ?.72:.88,.19,alongZ?.88:.72])).length,
        booths:f.booths.filter(([[x,z],[xx,zz]])=>matches([(x+xx)/2,1.53,(z+zz)/2,xx-x,2.72,zz-z])).length,
        tow:matches([f.tow.tractor[0],.52,f.tow.tractor[1],4.35,.49,2.48]),
        dollies:f.tow.dollies.filter(([x,z])=>matches([x,.49,z,3.45,.23,3.22])).length,
        slots:f.existing.positions.length,reweigh:data.site.reweigh.length,
        receiptLines:hall.receipts.length+hall.additionalReceipts.length,
        inside:f.apronBays.every(b=>b.outline.every(([x,z])=>x>=hall.bounds[0][0] && x<=hall.bounds[1][0] && z<=hall.bounds[1][1])),
        overviewTargets:c.nav.overview.map(t=>t.label)};
    });
    const f=report.hallFloor;
    assert.equal(f.tracks.length,2);assert(f.tracks.every(t=>t.startError<.001 && t.gauge===2.5 && t.lengths.every(l=>Math.abs(l-100.5)<.00001)));
    assert.deepEqual([f.stands,f.transfer,f.mobile,f.booths,f.tow,f.dollies,f.slots,f.reweigh,f.receiptLines,f.inside],[43,2,7,6,true,4,6,4,9,true]);
    for(const [label,metric] of [['整板交接地轨','100.5 m'],['AGV 暂存工位','43 位'],['待运区与复重秤','6 组'],['利旧作业平台','6 处']]){
      await overview.selectOption({label});await frame();
      assert.equal(await page.locator('.cargo-caption h2').innerText(),label);
      assert((await page.locator('.cargo-facts').innerText()).includes(metric));
      await shot(label.replace(' ',''));
    }
  }
  await overview.selectOption('-1');
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
  if(await page.evaluate(()=>Boolean(window.__cargo.data.sorter.feedDeck))){
    report.feedDecks=await page.evaluate(()=>{
      const c=window.__cargo,s=c.plant.sorting,d=c.data.sorter,ind=s.induction;
      const decks=d.feeds.map(([a,b],i)=>{
        const len=Math.hypot(b[0]-a[0],b[1]-a[1]),dx=(b[0]-a[0])/len,dz=(b[1]-a[1])/len;
        const profile=ind.profiles[i],load=s.loads.find(l=>l.inlet===i);
        const arrive=(d.right-b[0]-load.slot*s.loop.length/d.carts)/1.48;
        const position=t=>{s.update(t);if(!load.box.visible)throw Error('供包路径上的纸箱消失');return [load.box.position.x,load.box.position.z];};
        const entryTime=arrive-profile.duration,delta=(a,b)=>b.map((v,k)=>v-a[k]);
        const queueAt=dist=>position(entryTime+profile.timeAt(dist)),before=ind.branches[i].queueEnd;
        const queueMove=delta(queueAt(before-.65),queueAt(before-.25));
        const cartMove=delta(position(arrive+.02),position(arrive+.22));
        const rows=ind.noses[i].filter(m=>m.userData.feedPart?.startsWith('短带 ')).map(m=>{
          const pos=m.geometry.attributes.position,uv=m.geometry.attributes.uv;
          const points=Array.from({length:pos.count},(_,k)=>{
            const x=pos.getX(k)-a[0],z=pos.getZ(k)-a[1];
            return {s:x*dx+z*dz,n:-x*dz+z*dx,u:uv.getX(k)};
          });
          const ns=points.map(p=>p.n).sort((x,y)=>x-y).filter((v,j,arr)=>!j || v-arr[j-1]>.002);
          const low=Math.min(...points.map(p=>p.s)),high=Math.max(...points.map(p=>p.s)),widths=[];
          for(let j=0;j<ns.length;j+=2)widths.push(ns[j+1]-ns[j]);
          const band=points.filter(p=>Math.abs(p.n-ns[0])<.002).sort((x,y)=>x.s-y.s);
          const t0=entryTime+profile.timeAt(profile.length-len+low);
          const t1=entryTime+profile.timeAt(profile.length-len+high);
          const first=position(t0),u0=band[0].u+m.material.map.offset.x;
          const last=position(t1),phase=band.at(-1).u+m.material.map.offset.x-u0;
          const [x,z]=delta(first,last);
          return {low,high,length:high-low,width:ns.at(-1)-ns[0],widths,
            angle:Math.atan2(z,-x)*180/Math.PI,travel:x*dx+z*dz,drift:Math.abs(-x*dz+z*dx),
            axisError:Math.abs(-(last[0]-a[0])*dz+(last[1]-a[1])*dx),spliceError:Math.abs(phase-Math.round(phase))};
        });
        const frameEdges=ind.noses[i].flatMap(m=>{
          const pos=m.geometry.attributes.position;
          return Array.from({length:pos.count},(_,k)=>-(pos.getX(k)-a[0])*dz+(pos.getZ(k)-a[1])*dx);
        });
        return {queueMove,cartMove,rows,frameWidth:Math.max(...frameEdges)-Math.min(...frameEdges)};
      });
      s.update(c.time);return decks;
    });
    assert.equal(report.feedDecks.length,3);
    for(const deck of report.feedDecks){
      assert(Math.abs(deck.queueMove[0])<.001 && Math.abs(deck.queueMove[1]-.4)<.001);
      assert(Math.abs(deck.cartMove[0]+.296)<.001 && Math.abs(deck.cartMove[1])<.001);
      assert(Math.abs(deck.frameWidth-1.566)<.002);
      assert.equal(deck.rows.length,5);
      for(const [i,row] of deck.rows.entries()){
        assert.equal(row.widths.length,5);
        assert(row.widths.every(w=>Math.abs(w-.24)<.002) && Math.abs(row.width-1.28)<.002);
        assert(Math.abs(row.length-[.388,.402,.402,.388,.639][i])<.003);
        assert(Math.abs(row.angle-30)<.08 && Math.abs(row.travel-row.length)<.002);
        assert(row.drift<.001 && row.axisError<.001 && row.spliceError<.001);
      }
    }
  }
  // Test the physical top triangles. A continuous animation alone can mask a missing belt.
  report.junctions=await page.evaluate(()=>{
    const c=window.__cargo,s=c.plant.sorting,i=s.induction,e=c.data.site.distributionEquipment;
    const triangles=[];
    s.group.updateMatrixWorld(true);
    s.group.traverse(m=>{
      if(m.name!=='输送承载面')return;
      const a=m.geometry.attributes.position;
      for(let n=0;n<a.count;n+=3){
        const pts=[0,1,2].map(k=>m.position.clone().fromBufferAttribute(a,n+k).applyMatrix4(m.matrixWorld));
        const [p,q,r]=pts,det=(q.x-p.x)*(r.z-p.z)-(q.z-p.z)*(r.x-p.x);
        if(det>=-.0000001)continue;
        triangles.push({id:m.id,p,q,r,det,left:Math.min(p.x,q.x,r.x),right:Math.max(p.x,q.x,r.x),
          front:Math.min(p.z,q.z,r.z),rear:Math.max(p.z,q.z,r.z)});
      }
    });
    function heights(x,z,h,atX=x,atZ=z){
      const found=new Map(),eps=.000002;
      for(const t of triangles){
        if(x<t.left-eps || x>t.right+eps || z<t.front-eps || z>t.rear+eps)continue;
        const {p,q,r,det}=t;
        const u=((x-p.x)*(r.z-p.z)-(z-p.z)*(r.x-p.x))/det;
        const v=((q.x-p.x)*(z-p.z)-(q.z-p.z)*(x-p.x))/det;
        if(Math.min(u,v,1-u-v)<-eps)continue;
        const y=p.y+u*(q.y-p.y)+v*(r.y-p.y);
        if(Math.abs(y-h)>=.038)continue;
        const du=((atX-x)*(r.z-p.z)-(atZ-z)*(r.x-p.x))/det;
        const dv=((q.x-p.x)*(atZ-z)-(q.z-p.z)*(atX-x))/det;
        found.set(t.id,y+du*(q.y-p.y)+dv*(r.y-p.y));
      }
      return found;
    }
    function cut(mid,dir,face,height){
      const normal=[-dir[1],dir[0]],slope=(normal[0]*face[0]+normal[1]*face[1])/(dir[0]*face[0]+dir[1]*face[1]);
      let tested=0,gaps=0,overlaps=0,paired=0,maxStepMm=0;
      for(const off of [-.57,-.38,-.19,0,.19,.38,.57])for(let k=-12;k<=12;k++){
        const step=k*.012-off*slope;
        const x=mid[0]+off*normal[0]+step*dir[0],z=mid[1]+off*normal[1]+step*dir[1];
        const h=typeof height==='function'?height(x,z):height;
        const count=heights(x,z,h).size;
        tested++;if(!count)gaps++;if(count>1 && k!==0)overlaps++;
        if(k===0){
          // Project the two actual mating top triangles back onto their common face.
          const a=heights(x-dir[0]*.002,z-dir[1]*.002,h,x,z);
          const b=heights(x+dir[0]*.002,z+dir[1]*.002,h,x,z);
          if(a.size===1 && b.size===1){
            paired++;maxStepMm=Math.max(maxStepMm,Math.abs([...a.values()][0]-[...b.values()][0])*1000);
          }
        }
      }
      return {tested,gaps,overlaps,paired,maxStepMm};
    }
    const unit=(a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz);return [dx/l,dz/l];};
    const seams=i.branches.map(b=>({
      distributor:cut(b.port.mid,unit(b.path[0],b.path[1]),[0,1],3.55),
      induction:cut(b.seam,b.travel,b.normal,3.55)
    }));
    const incoming=[...e.sources,e.merge].map((path,j)=>{
      const a=path.at(-2),b=path.at(-1),dir=unit(a,b),bank=j===e.sources.length?1:-1;
      const run=bank*.6/dir[1],mid=[b[0]+dir[0]*run,b[1]+bank*.6];
      return cut(mid,dir,[0,1],b[2]);
    });
    const [a,b]=e.slide;
    const slide=cut(a,[1,0],[1,0],x=>a[2]+(b[2]-a[2])*Math.max(0,(x-a[0])/(b[0]-a[0])));
    const traffic=s.transit.map(item=>{
      let samples=0,unsupported=0;
      for(let f=.01;f<1;f+=.004){
        s.update((item.length*f-item.offset)/.78);
        const {x,y,z}=item.box.position;
        samples++;if(!heights(x,z,y).size)unsupported++;
      }
      return {samples,unsupported};
    });
    const receipts=c.hall.receipts.map(unit=>{
      unit.update(2);const first=unit.item.position.clone();unit.update(3);
      return {x:unit.at[0],length:unit.end-unit.start,height:first.y,travel:first.distanceTo(unit.item.position)};
    });
    return {seams,incoming,slide,traffic,receipts,bufferRows:c.hall.buffer.rows.length,bufferTransfers:c.hall.buffer.transfers.length};
  });
  const j=report.junctions,allCuts=[...j.seams.flatMap(v=>[v.distributor,v.induction]),...j.incoming,j.slide];
  assert.equal(allCuts.length,11);
  assert(allCuts.every(s=>s.gaps===0 && s.overlaps===0),JSON.stringify(j));
  assert(allCuts.every(s=>s.paired===7 && s.maxStepMm<1),JSON.stringify(allCuts));
  assert(j.traffic.length===2 && j.traffic.every(p=>p.unsupported===0),JSON.stringify(j.traffic));
  assert(j.bufferRows===4 && j.bufferTransfers===10);
  assert.equal(new Set(j.receipts.map(unit=>unit.x)).size,3);
  assert(j.receipts.every(unit=>unit.length>=14.2 && unit.height===.8 && Math.abs(unit.travel-.5)<.0001));
  await page.locator('[data-area="overview"]').click();
  await page.getByRole('button',{name:'下层空托盘',exact:true}).click();await frame();
  report.lowerCut=await page.evaluate(()=>{
    const c=window.__cargo;
    return {view:c.view,lowerVisible:c.plant.pallet.group.visible,upperVisible:c.plant.sorting.group.visible,
      inPlace:c.plant.pallet.group.position.toArray(),drawingOrigin:[c.data.pallet.offset[0],0,c.data.pallet.offset[1]],
      dimmed:c.plant.sorting.chuteSections.every(g=>g.children.every(m=>m.material.opacity<.3))};
  });
  assert.equal(report.lowerCut.view,'overview');assert(report.lowerCut.lowerVisible && report.lowerCut.upperVisible && report.lowerCut.dimmed);
  assert.deepEqual(report.lowerCut.inPlace,report.lowerCut.drawingOrigin);
  await shot('01c-in-place-pallet');
  await page.getByRole('combobox',{name:'总览范围'}).selectOption('-1');
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
  if(report.hallFloor){
    report.mobileExtent=await page.evaluate(()=>{
      const c=window.__cargo,cam=c.getCamera(),[[left,front],[right,back]]=c.hall.bounds;
      return [left,right].flatMap(x=>[front,back].map(z=>cam.position.clone().set(x,0,z).project(cam).toArray().slice(0,2)));
    });
    assert(report.mobileExtent.flat().every(v=>Math.abs(v)<1),'全场范围应在窄屏内完整显示');
  }
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
