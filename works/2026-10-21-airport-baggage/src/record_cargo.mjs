import {mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const app=path.dirname(fileURLToPath(import.meta.url)), dest=path.resolve(app,process.env.AIRPORT_EVIDENCE || 'evidence/cargo');
await mkdir(dest,{recursive:true});
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const file=path.resolve(process.argv[2] || path.join(dest,'货站工艺演示-'+stamp+'.mp4'));
const {chromium}=createRequire(path.join(process.env.PLAYWRIGHT_FROM||app,'package.json'))('playwright');
const browser=await chromium.launch({channel:'chromium',args:process.platform==='win32'?['--enable-gpu','--use-angle=d3d11']:[]});
const page=await browser.newPage({viewport:{width:1280,height:720}});
const url=new URL(process.env.AIRPORT_URL || 'http://127.0.0.1:5426/');url.search='capture=1';
let encoder;
try{
  await page.goto(url.href);await page.waitForFunction(()=>Boolean(window.__cargo),undefined,{timeout:90000});
  const events=await page.evaluate(()=>{
    const c=window.__cargo;
    return {...c.plant.sorting.cues,...c.plant.pallet.cues,...c.plant.dockOps.cues,...c.plant.packing.cues};
  });
  const replay=(id,seconds,rate=1)=>[events[id].view,'3d',events[id].focus,seconds,events[id].time,rate,id];
  const fps=24;
  const cuts=[
    ['overview','3d',-1,2,13,1],replay('truck',3,2.3),...(events.meter?[replay('meter',2.5,1)]:[]),
    ...(events.distribute?[replay('distribute',3,1.8)]:[]),replay('feed',3,1.25),replay('unload',3,1.25),replay('chain',4,1.55),
    replay('turn',2,1.45),replay('stack',4,2),replay('supply',2,2.5),replay('build',3,2.7),
    replay('raise',3,3.5),replay('handoff',3.5,1.7),['overview','overlay',-1,1,16,1],['overview','3d',-1,1,18,1],
  ];
  encoder=spawn('ffmpeg',['-hide_banner','-loglevel','error','-n','-f','image2pipe','-framerate',String(fps),'-c:v','mjpeg','-i','pipe:0',
    '-an','-c:v','libx264','-threads','4','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',file],
    {windowsHide:true,stdio:['pipe','ignore','inherit']});
  const ended=once(encoder,'close');let total=0;const ranges=[];
  for(const [area,mode,focus,seconds,start,rate,cue] of cuts){
    await page.locator('[data-area="'+area+'"]').evaluate(el=>el.click());
    await page.locator('[data-projection="'+mode+'"]').evaluate(el=>el.click());
    if(cue)await page.locator('[data-cue="'+cue+'"]').evaluate(el=>el.click());
    const basis=await page.evaluate(({area,mode,focus})=>{
      const c=window.__cargo;c.setPaused(true);c.show(area,mode,focus);
      const camera=c.getCamera(), at=c.getTarget(), offset=camera.position.clone().sub(at);
      return {at:at.toArray(),off:offset.toArray(),zoom:camera.zoom};
    },{area,mode,focus});
    const count=Math.round(seconds*fps);
    for(let i=0;i<count;i++){
      await page.evaluate(async({basis,time,fraction,mode})=>{
        const c=window.__cargo,cam=c.getCamera();c.seek(time);
        if(mode==='3d'){
          const [x,y,z]=basis.off,a=(fraction-.5)*.11,size=.98-.055*fraction;
          cam.position.set(basis.at[0]+(x*Math.cos(a)+z*Math.sin(a))*size,basis.at[1]+y*size,
            basis.at[2]+(z*Math.cos(a)-x*Math.sin(a))*size);
        }else{cam.zoom=basis.zoom*(1+.025*fraction);cam.updateProjectionMatrix();}
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      },{basis,time:start+i/fps*rate,fraction:i/(count-1),mode});
      const frame=await page.screenshot({type:'jpeg',quality:92});
      if(!encoder.stdin.write(frame))await once(encoder.stdin,'drain');
    }
    ranges.push({area,mode,focus,cue,startFrame:total,frames:count});total+=count;console.log(area,mode,total+' frames');
  }
  encoder.stdin.end();assert.equal((await ended)[0],0);assert.equal(total,cuts.reduce((n,c)=>n+Math.round(c[3]*fps),0));
  await writeFile(path.join(dest,'film-shots.json'),JSON.stringify(ranges,null,2));
  console.log('已保存 '+file);
}finally{
  if(encoder && encoder.exitCode===null && !encoder.stdin.writableEnded)encoder.stdin.end();
  await browser.close();
}
