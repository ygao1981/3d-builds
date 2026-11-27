import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const app=path.dirname(fileURLToPath(import.meta.url));
const out=path.resolve(app,process.env.AIRPORT_EVIDENCE || 'evidence/cargo/overview-camera');
const url=process.env.AIRPORT_URL || 'http://127.0.0.1:5426/';
const {chromium}=createRequire(path.join(process.env.PLAYWRIGHT_FROM || app,'package.json'))('playwright');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chromium',args:process.platform==='win32'?['--enable-gpu','--use-angle=d3d11']:[]});
const report={errors:[]};
const frames=(page,n=2)=>page.evaluate(n=>new Promise(done=>{
  function tick(){if(--n>0)requestAnimationFrame(tick);else done();}requestAnimationFrame(tick);
}),n);
const read=page=>page.evaluate(()=>{
  const c=window.__cargo,eye=c.getCamera().position,target=c.getTarget(),offset=eye.clone().sub(target);
  return {eye:eye.toArray(),target:target.toArray(),near:c.getCamera().near,radius:offset.length(),yaw:Math.atan2(offset.x,offset.z),
    pitch:Math.asin(offset.y/offset.length())};
});
const diff=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
function samePose(a,b,reason){
  const eye=diff(a.eye,b.eye),target=diff(a.target,b.target);
  assert(eye<.02 && target<.02,reason+' (eye '+eye+', target '+target+')');
}
async function open(page){
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>!!window.__cargo,undefined,{timeout:90000});
  await page.getByRole('button',{name:'暂停',exact:true}).click();
}
async function clearPoint(page){
  return page.evaluate(()=>{
    const canvas=document.querySelector('canvas'),r=canvas.getBoundingClientRect();
    for(const v of [.62,.72,.52,.42])for(const u of [.63,.47,.75,.38]){
      const x=Math.round(r.x+u*r.width),y=Math.round(r.y+v*r.height);
      if([[-34,0],[34,0],[0,0]].every(([dx,dy])=>document.elementFromPoint(x+dx,y+dy)===canvas))return {x,y};
    }
    throw new Error('找不到可直接拖动的场景区域');
  });
}
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await open(page);
  const reset=page.getByRole('button',{name:'回到全场'}),range=page.getByRole('combobox',{name:'总览范围'});
  await page.locator('.cargo-camera-help summary').click();
  assert(await page.getByText('左键拖动旋转',{exact:false}).isVisible());
  await page.screenshot({path:path.join(out,'全场操作.png')});await page.locator('.cargo-camera-help summary').click();
  const initial=await read(page),{x,y}=await clearPoint(page),mouse=page.mouse;
  await mouse.move(x,y);await mouse.down();await mouse.move(x+120,y-54,{steps:10});await mouse.up();await frames(page,60);
  const orbit=await read(page);
  assert(Math.abs(orbit.yaw-initial.yaw)>.4 && Math.abs(orbit.pitch-initial.pitch)>.15 && diff(orbit.target,initial.target)<.01,'旋转应改变方位及俯仰');
  await mouse.move(x,y);await mouse.down({button:'right'});await mouse.move(x-91,y+35,{steps:8});await mouse.up({button:'right'});await frames(page,60);
  const pan=await read(page);assert(diff(orbit.target,pan.target)>2 && Math.abs(orbit.target[1]-pan.target[1])<.01,'平移应沿地面');
  const wheelPoint=await clearPoint(page);
  const ray=await page.evaluate(({x,y})=>{
    const r=document.querySelector('canvas').getBoundingClientRect(),cam=window.__cargo.getCamera();
    return cam.position.clone().set(2*(x-r.x)/r.width-1,1-2*(y-r.y)/r.height,.5).unproject(cam).sub(cam.position).normalize().toArray();
  },wheelPoint);
  await mouse.move(wheelPoint.x,wheelPoint.y);await mouse.wheel(0,-500);await frames(page,6);
  const zoom=await read(page),delta=zoom.eye.map((v,i)=>v-pan.eye[i]);
  const alongRay=delta.reduce((n,v,i)=>n+v*ray[i],0)/Math.hypot(...delta);
  report.wheel={pan,zoom,alongRay};assert(zoom.radius<pan.radius*.9 && alongRay>.99,'缩放应沿指针射线靠近场景');
  await reset.click();const point=await clearPoint(page);await mouse.click(point.x,point.y);
  assert(await page.locator('canvas').evaluate(el=>el===document.activeElement),'点画面应获得键盘焦点');
  const movement={};
  for(const key of ['w','s','a','d','q','e']){
    const a=await read(page);await page.keyboard.down(key);await frames(page,6);await page.keyboard.up(key);const b=await read(page);
    const delta=b.eye.map((v,i)=>v-a.eye[i]),sin=Math.sin(a.yaw),cos=Math.cos(a.yaw);
    const signed={w:-delta[0]*sin-delta[2]*cos,s:delta[0]*sin+delta[2]*cos,a:-delta[0]*cos+delta[2]*sin,d:delta[0]*cos-delta[2]*sin,q:-delta[1],e:delta[1]}[key];
    assert(signed>.2,'键盘移动方向 '+key);movement[key]=signed;
  }
  await page.keyboard.down('w');await frames(page,4);await reset.focus();
  const blurred=await read(page);await frames(page,9);samePose(blurred,await read(page),'焦点离开后应停止移动');await page.keyboard.up('w');
  const keep=await read(page);await page.setViewportSize({width:1030,height:820});await frames(page);
  samePose(keep,await read(page),'改变窗宽应保留手动视角');
  await page.locator('[data-projection=paper]').click();
  assert(await page.evaluate(()=>__cargo.getCamera().isOrthographicCamera));
  await page.locator('[data-projection=overlay]').click();await page.locator('[data-projection="3d"]').click();await frames(page);
  samePose(keep,await read(page),'查看图纸后应返回手动视角');
  await page.locator('[data-area=sorting]').click();await page.locator('[data-layer=lower]').click();await frames(page);
  await page.locator('[data-area=overview]').click();await frames(page);samePose(keep,await read(page),'从分拣工位应回到手动视角');
  await range.selectOption({label:'AGV 暂存工位'});const preset=await read(page);
  assert(diff(keep.target,preset.target)>8 && preset.radius<keep.radius*.6,'工位定位应生效');
  const focusPoint=await clearPoint(page);await mouse.click(focusPoint.x,focusPoint.y);await page.keyboard.down('q');await frames(page,8);await page.keyboard.up('q');
  const low=await read(page);assert(low.eye[1]<preset.eye[1]-1.6,'全场和近景都应能降低眼高');
  await page.locator('[data-area=pallet]').click();await page.locator('[data-area=overview]').click();await frames(page);
  assert.equal(await range.locator('option:checked').innerText(),'AGV 暂存工位');samePose(low,await read(page),'恢复近景应保留对应工位');
  await page.screenshot({path:path.join(out,'自由视角工位.png')});
  const floorPoint=await clearPoint(page);await mouse.click(floorPoint.x,floorPoint.y);await page.keyboard.down('q');
  await page.waitForFunction(()=>__cargo.getCamera().position.y<.26,undefined,{timeout:10000});await frames(page,4);await page.keyboard.up('q');
  const floor=await read(page);assert(floor.eye[1]>=.2499,'降低相机应停在地面上方');
  assert(Math.abs(initial.near-initial.radius/135)<.01 && floor.near<=.05,'应保留全场地面细节，并在接近设备时缩小近裁切距离');
  await page.setViewportSize({width:1440,height:900});await reset.click();await frames(page);samePose(initial,await read(page),'回到全场应恢复起始取景');
  await page.locator('[data-area=dock]').click();await page.locator('[data-area=overview]').click();await frames(page);samePose(initial,await read(page),'重置后应清除旧视角');
  assert.equal(await page.getByRole('button',{name:'继续',exact:true}).count(),1);
  report.desktop={initial,orbit,pan,zoom,movement,keep,low,floor,reset:await read(page)};
  await page.close();

  const mobile=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1});
  await open(mobile);const client=await mobile.context().newCDPSession(mobile);
  const base=await clearPoint(mobile);
  const send=(type,points)=>client.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([x,y],i)=>({id:i+1,x:base.x+x,y:base.y+y}))});
  async function swipe(start,end){
    await send('touchStart',start);
    for(let j=1;j<=8;j++)await send('touchMove',start.map(([x,y],i)=>[x+(end[i][0]-x)*j/8,y+(end[i][1]-y)*j/8]));
    await send('touchEnd',[]);await frames(mobile,50);
  }
  const home=await read(mobile);
  await swipe([[0,0]],[[70,-28]]);const turned=await read(mobile);
  assert(Math.abs(turned.yaw-home.yaw)>.25,'单指旋转');
  await swipe([[-30,0],[30,0]],[[-18,25],[42,25]]);const slid=await read(mobile);
  assert(diff(turned.target,slid.target)>1,'双指平移');
  await swipe([[-25,0],[25,0]],[[-47,0],[47,0]]);const pinched=await read(mobile);
  assert(pinched.radius<slid.radius*.82,'双指缩放');
  const homeButton=mobile.getByRole('button',{name:'回到全场'});await homeButton.click();await frames(mobile);
  report.touch={home,turned,slid,pinched,reset:await read(mobile)};
  samePose(home,report.touch.reset,'窄屏重置全场');
  for(const width of [390,320]){
    await mobile.setViewportSize({width,height:844});await frames(mobile);
    const bounds=await homeButton.boundingBox();assert(bounds.x>=0 && bounds.x+bounds.width<=width && bounds.y+bounds.height<=844,'回到全场应在窄屏内');
  }
  await mobile.setViewportSize({width:390,height:844});await frames(mobile);
  await mobile.screenshot({path:path.join(out,'窄屏全场.png')});
  assert.deepEqual(report.errors,[]);
  console.log('鼠标旋转平移缩放、六向键盘、手动视角恢复、回到全场及触屏手势通过。');
}catch(error){report.failure=error.message;throw error;}
finally{await writeFile(path.join(out,'camera-check.json'),JSON.stringify(report,null,2));await browser.close();}
