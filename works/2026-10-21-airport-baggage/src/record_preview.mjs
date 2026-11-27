import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.dirname(fileURLToPath(import.meta.url));
const requireBrowser = createRequire(path.join(process.env.PLAYWRIGHT_FROM || app, 'package.json'));
const { chromium } = requireBrowser('playwright');
const dest = path.join(app, 'evidence');
await mkdir(dest, { recursive: true });
const output = path.resolve(process.argv[2] || path.join(dest, 'airport-simready-preview.mp4'));
const url = new URL(process.env.AIRPORT_URL || 'http://127.0.0.1:5426/');
url.search = 'capture=1&start=30';
const fps = 30;
const browser = await chromium.launch({ channel: 'chromium',
  args: process.platform === 'win32' ? ['--enable-gpu', '--use-angle=d3d11'] : [] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
let encoder;
try {
  await page.goto(url.href);
  await page.waitForFunction(() => !!window.__camera && !!window.__plant, undefined, { timeout: 90000 });
  await page.evaluate(() => window.__app.setPaused(true));
  await page.waitForFunction(() => window.__sim.state.paused);
  const h = await page.evaluate(() => {
    const p = window.__sim.heroPlan;
    return { t0: p.t0, tag: p.tag, arch: p.archTime, ct: p.ctEntryTime, tray: p.onTrayTime,
      loader: window.__sim.loaderEntryAfter(p.footTime + 4) };
  });
  // The first five shots use the same planned bag. The apron has its own loading cycle.
  const cuts = [
    { id: 'checkin', seconds: 5, start: h.t0 - .5, rate: .85, target: [-34.7, 2.4, 7.1], distance: 9.1, az: -.9, el: .48, caption: 'A02 柜台　·　行李 ' + h.tag, unit: 'desk-2' },
    { id: 'read', seconds: 6, start: h.arch - 2.3, rate: .55, target: [4.8, 1, 22.15], distance: 12.2, az: .66, el: .48, caption: '读码门　·　主输送线', unit: 'arch-1' },
    { id: 'read', seconds: 4, start: h.arch + 1, rate: .245, target: [7.45, .92, 21.6], distance: 6.1, az: .78, el: .56, caption: '90° 弯道　·　滚筒交接', unit: 'read-bend' },
    { id: 'screen', seconds: 4, start: h.ct, rate: .52, target: [8.35, 1, 17.55], distance: 10.9, az: 1.05, el: .42, caption: 'CT 01　·　安检放行', unit: 'ct-1' },
    { id: 'sort', seconds: 5, start: h.tray - .25, rate: .86, target: [14.2, .98, 12.0], distance: 14.1, az: .5, el: .55, caption: 'C1 溜槽　·　翻盘卸载', unit: 'chute-C1' },
    { id: 'ramp', seconds: 6, start: h.loader + .4, rate: 1, target: [85.1, 2.65, 26.1], distance: 17.8, az: -2.6, el: .27, caption: '14 号机位　·　装机作业示意', unit: 'loader-1' },
  ];
  encoder = spawn('ffmpeg', ['-hide_banner','-loglevel','error','-n','-f','image2pipe','-framerate',String(fps),
    '-c:v','mjpeg','-i','pipe:0','-an','-c:v','libx264','-threads','4','-preset','veryfast','-crf','19',
    '-pix_fmt','yuv420p','-movflags','+faststart',output], { windowsHide: true, stdio: ['pipe','ignore','inherit'] });
  const ended = once(encoder,'close');
  let frameNumber = 0;
  const framing = [];
  for (const shot of cuts) {
    await page.locator('[data-station="' + shot.id + '"]').evaluate(el => el.click());
    assert(await page.evaluate(t => window.__sim.time <= t + .03, shot.start), 'Shots must advance in simulation time');
    const bounds = await page.evaluate(id => {
      const b = window.__plant.boundsOfUnit(id);
      return { centre: b.centre.toArray(), size: b.size.toArray() };
    }, shot.unit);
    const count = shot.seconds * fps;
    for (let i = 0; i < count; i++) {
      const camera = await page.evaluate(async ({ shot, progress, time }) => {
        const sim = window.__sim, rig = window.__app.rig;
        sim.jumpTo(time);
        rig.fly = null; rig.getFollowPosition = null; rig.orbitRate = 0;
        rig.target.fromArray(shot.target); rig.goal.target.copy(rig.target);
        rig.azimuth = rig.goal.azimuth = shot.az + (progress - .5) * .085;
        rig.elevation = rig.goal.elevation = shot.el;
        rig.distance = rig.goal.distance = shot.distance * (1.035 - .065 * progress);
        document.querySelector('.film-slate').dataset.caption = shot.caption;
        await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
        const c = window.__camera;
        return { position: c.position.toArray(), quaternion: c.quaternion.toArray(), fov: c.fov, aspect: c.aspect };
      }, { shot, progress: i/(count-1), time: shot.start + i/fps*shot.rate });
      framing.push({ frame: frameNumber++, unit: shot.unit, bounds, camera });
      const image = await page.screenshot({ type: 'jpeg', quality: 92 });
      if (!encoder.stdin.write(image)) await once(encoder.stdin,'drain');
    }
    console.log(shot.caption + '  ' + frameNumber + '/900');
  }
  encoder.stdin.end();
  assert.equal((await ended)[0], 0);
  await writeFile(path.join(dest,'film-framing.json'), JSON.stringify(framing));
  console.log(output);
} finally {
  if (encoder && encoder.exitCode === null && !encoder.stdin.writableEnded) encoder.stdin.end();
  await browser.close();
}
