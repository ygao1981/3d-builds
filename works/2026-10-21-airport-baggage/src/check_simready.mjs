import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.dirname(fileURLToPath(import.meta.url));
const requireBrowser = createRequire(path.join(process.env.PLAYWRIGHT_FROM || app, 'package.json'));
const { chromium } = requireBrowser('playwright');
const dest = path.join(app, 'evidence');
await mkdir(dest, { recursive: true });
const base = new URL(process.env.AIRPORT_URL || 'http://127.0.0.1:5426/');
base.searchParams.set('project','bagline');
const args = process.platform === 'win32' ? ['--enable-gpu', '--use-angle=d3d11'] : [];
const browser = await chromium.launch({ channel: 'chromium', args });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], responses = [];
page.on('pageerror', e => errors.push(e.message));
page.on('response', r => { if (new URL(r.url()).pathname.endsWith('.glb')) responses.push([new URL(r.url()).pathname, r.status()]); });
const report = { responses, errors, views: [] };
const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
try {
  await page.goto(base.href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__plant && window.__camera, undefined, { timeout: 90000 });
  await page.getByRole('button', { name: '暂停仿真' }).click();
  await page.waitForFunction(() => window.__sim.state.paused);
  assert.equal(new Set(responses.map(r => r[0])).size, 11);
  assert(responses.every(r => r[1] === 200));
  report.device = await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      viewport: [innerWidth, innerHeight] };
  });
  report.installations = await page.evaluate(() => window.__plant.simready.map(({ id, unit, count, object }) => {
    const textures = new Set();
    let meshes = 0;
    object.traverse(node => {
      if (!node.isMesh || !node.visible) return;
      meshes++;
      for (const material of [].concat(node.material)) {
        for (const item of Object.values(material)) if (item?.isTexture && item.image?.width) textures.add(item.uuid);
      }
    });
    return { id, unit, rollers: count, meshes, decodedTextures: textures.size };
  }));
  assert.equal(report.installations.length, 10);
  assert.equal(report.installations.reduce((s, m) => s + (m.rollers || 0), 0), 143);
  assert(report.installations.every(m => m.meshes && m.decodedTextures));
  report.alignment = await page.evaluate(() => {
    const plant = window.__plant;
    const points = [];
    for (const { unit, object } of plant.simready.filter(m => m.count)) {
      object.updateWorldMatrix(true, true);
      object.traverse(node => {
        if (!node.visible || !/^sm_roller\d+_.*_obj_00$/.test(node.name)) return;
        const p = node.getWorldPosition(node.position.clone());
        const radial = unit === 'read-bend' ? Math.abs(Math.hypot(p.x - 6.5, p.z - 21) - 1.5)
          : unit === 'read-roll-4' ? Math.abs(p.x - 8) : Math.abs(p.z - 22.5);
        let top = -Infinity;
        node.traverse(mesh => {
          if (!mesh.isMesh) return;
          const a = mesh.geometry.attributes.position;
          const v = p.clone();
          for (let i = 0; i < a.count; i++) top = Math.max(top, v.fromBufferAttribute(a,i).applyMatrix4(mesh.matrixWorld).y);
        });
        points.push({ radial, top });
      });
    }
    return { sampled: points.length, maxCentreLineErrorM: Math.max(...points.map(p => p.radial)),
      minDeckM: Math.min(...points.map(p => p.top)), maxDeckM: Math.max(...points.map(p => p.top)) };
  });
  assert(report.alignment.maxCentreLineErrorM < 0.01);
  assert(report.alignment.minDeckM > 0.797 && report.alignment.maxDeckM < 0.803);
  const readMotion = () => page.evaluate(() => {
    const unit = window.__plant.simready.find(m => m.unit === 'read-roll-3');
    return [window.__sim.time, ...unit.object.getObjectByName('sm_roller15_a05_obj_00').quaternion.toArray()];
  });
  const paused = await readMotion();
  await frame();
  assert.deepEqual(await readMotion(), paused);
  await page.getByRole('button', { name: '继续仿真' }).click();
  await page.waitForFunction(t => window.__sim.time > t + 0.15, paused[0]);
  assert.notDeepEqual((await readMotion()).slice(1), paused.slice(1));
  await page.getByRole('combobox', { name: '仿真速度' }).selectOption('2');
  await page.waitForFunction(() => window.__sim.state.speed === 2);
  await page.getByRole('combobox', { name: '仿真速度' }).selectOption('1');
  const intervals = await page.evaluate(async () => {
    const deltas = []; let last;
    for (let i=0; i<36; i++) {
      const stamp = await new Promise(resolve => requestAnimationFrame(resolve));
      if (last !== undefined) deltas.push(stamp-last);
      last = stamp;
    }
    return deltas.sort((a,b) => a-b);
  });
  report.frameTiming = { samples: intervals.length, medianMs: intervals[17], p90Ms: intervals[31] };
  await page.getByRole('button', { name: '暂停仿真' }).click();
  await page.waitForFunction(() => window.__sim.state.paused);
  for (const id of ['read', 'checkin', 'screen', 'sort', 'ramp']) {
    await page.locator('[data-station="' + id + '"]').click();
    await page.waitForFunction(() => !window.__app.rig.fly);
    const sample = await page.evaluate(id => {
      const s = window.__sim;
      const field = { read: 'archTime', checkin:'t0', screen:'ctEntryTime', sort:'leaveTime' }[id];
      const available = s.plans.filter(p => field && p[field] > s.time &&
        (id !== 'checkin' || (p.source.kind === 'desk' && p.source.index === 1)) &&
        (id !== 'sort' || (!p.flagged && p.chute === 0)));
      const plan = available.sort((a,b) => a[field]-b[field])[0];
      if (plan) s.jumpTo(plan[field] + (id === 'checkin' ? 1.4 : 0.18));
      if (id === 'ramp') s.jumpTo(s.loaderEntryAfter(s.time) + 1);
      return { id, time: s.time, tag: plan?.tag };
    }, id);
    await frame();
    await page.screenshot({ path: path.join(dest, id + '.png') });
    report.views.push(sample);
  }
  await page.getByRole('button', { name: '运行监控' }).click();
  await page.getByRole('button', { name: '分拣厅', exact: true }).click();
  await page.locator('[data-site="hall"][aria-pressed="true"]').waitFor();
  const query = page.getByRole('searchbox');
  await query.fill('000000-nomatch');
  assert.equal(await query.inputValue(), '000000-nomatch');
  await query.fill('');
  await page.getByRole('button', { name: '返回工艺巡览' }).click();
  await page.locator('[data-station="read"]').click();
  await page.waitForFunction(() => !window.__app.rig.fly);
  await page.setViewportSize({ width: 390, height: 844 });
  await frame();
  await page.screenshot({ path: path.join(dest, 'mobile.png') });
  await page.locator('[data-station="screen"]').click();
  assert.equal(await page.locator('[data-station="screen"]').getAttribute('aria-pressed'), 'true');
  assert(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth));
  const failure = await browser.newPage();
  await failure.route('**/simready/conveyor_belt_a05.glb', route => route.abort());
  await failure.goto(base.href);
  await failure.getByRole('alert').getByText('机场三维场景未能打开').waitFor({ timeout: 30000 });
  await failure.unroute('**/simready/conveyor_belt_a05.glb');
  await failure.getByRole('button', { name: '重新加载' }).click();
  await failure.waitForFunction(() => !!window.__plant, undefined, { timeout: 60000 });
  report.recoveredFromMissingAsset = true;
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ device: report.device, alignment: report.alignment, frameTiming: report.frameTiming, views: report.views.length }));
} catch (error) {
  report.failure = error.message;
  report.pageText = (await page.locator('body').innerText()).slice(0,600);
  await page.screenshot({ path: path.join(dest,'diagnostic.png') }).catch(() => {});
  throw error;
} finally {
  await writeFile(path.join(dest, 'browser-check.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
