import {mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const app=path.dirname(fileURLToPath(import.meta.url)), dest=path.join(app,'evidence/cargo');
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
    const c=window.__cargo,s=c.data.sorter,loop=c.plant.sorting.loop;
    const load=c.plant.sorting.loads.find(x=>x.outlet===Math.floor(s.chutes.length/2));
    const release=loop.straight+loop.arc+s.chutes[load.outlet][0][0]-s.left-1.48*.55;
    const cycle=loop.length/1.48,drop=((release-load.slot*loop.length/s.carts)/1.48+cycle)%cycle;
    const p=c.data.pallet,turn=Math.abs(p.turns[0][0]-p.inlets[0][0])/.26;
    return {drop,turn,outlet:load.outlet,firstTurn:p.stackers.length,firstHandoff:c.data.dock.levellers.length};
  });
  const cuts=[
    ['sorting','overlay',-1,3,10,.4], ['sorting','3d',-1,5,12,1],
    ['chutes','3d',events.outlet,5,events.drop-1.2,1],['pallet','overlay',-1,3,28,1],
    ['pallet','3d',-1,3,37,1],['pallet','3d',events.firstTurn,4,events.turn-1,1],
    ['dock','3d',events.firstHandoff,3,15,1],['tables','3d',0,2,15,1],['overview','overlay',-1,2,15,1],
  ];
  encoder=spawn('ffmpeg',['-hide_banner','-loglevel','error','-n','-f','image2pipe','-framerate','30','-c:v','mjpeg','-i','pipe:0',
    '-an','-c:v','libx264','-threads','4','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',file],
    {windowsHide:true,stdio:['pipe','ignore','inherit']});
  const ended=once(encoder,'close');let total=0;const ranges=[];
  for(const [area,mode,focus,seconds,start,rate] of cuts){
    await page.locator('[data-area="'+area+'"]').evaluate(el=>el.click());
    await page.locator('[data-projection="'+mode+'"]').evaluate(el=>el.click());
    const basis=await page.evaluate(({area,mode,focus})=>{
      const c=window.__cargo;c.setPaused(true);c.show(area,mode,focus);
      const camera=c.getCamera(), at=c.getTarget(), offset=camera.position.clone().sub(at);
      return {at:at.toArray(),off:offset.toArray(),zoom:camera.zoom};
    },{area,mode,focus});
    const count=seconds*30;
    for(let i=0;i<count;i++){
      await page.evaluate(async({basis,time,fraction,mode})=>{
        const c=window.__cargo,cam=c.getCamera();c.seek(time);
        if(mode==='3d'){
          const [x,y,z]=basis.off,a=(fraction-.5)*.11,size=.98-.055*fraction;
          cam.position.set(basis.at[0]+(x*Math.cos(a)+z*Math.sin(a))*size,basis.at[1]+y*size,
            basis.at[2]+(z*Math.cos(a)-x*Math.sin(a))*size);
        }else{cam.zoom=basis.zoom*(1+.025*fraction);cam.updateProjectionMatrix();}
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      },{basis,time:start+i/30*rate,fraction:i/(count-1),mode});
      const frame=await page.screenshot({type:'jpeg',quality:92});
      if(!encoder.stdin.write(frame))await once(encoder.stdin,'drain');
    }
    ranges.push({area,mode,focus,startFrame:total,frames:count});total+=count;console.log(area,mode,total+'/900');
  }
  encoder.stdin.end();assert.equal((await ended)[0],0);assert.equal(total,900);
  await writeFile(path.join(dest,'film-shots.json'),JSON.stringify(ranges,null,2));
  console.log('已保存 '+file);
}finally{
  if(encoder && encoder.exitCode===null && !encoder.stdin.writableEnded)encoder.stdin.end();
  await browser.close();
}
