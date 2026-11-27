import { AIRPORT, sim } from '../appContext.js';
import { describeUnit, formatClock } from '../model.js';
import { setSpeed, togglePause } from '../playback.js';
import { zoomBy } from '../runtime.js';
import { DEFAULT_STATION, enterMonitor, inspectStation, STATIONS } from '../stations.js';
import { useStore } from '../store.js';
import manifest from '../simready-assets.json';
import { Icon } from './icons.jsx';
import './inspection.css';

export default function Inspection() {
  const stationId = useStore(s => s.stationId);
  const station = STATIONS.find(item => item.id === stationId) || DEFAULT_STATION;
  const ready = useStore(s => s.sceneReady);
  const paused = useStore(s => s.paused);
  const speed = useStore(s => s.speed);
  const selected = useStore(s => s.selection);
  const index = STATIONS.indexOf(station);
  const bag = selected?.kind === 'bag' && sim.planById(selected.planId);
  const selectedName = bag ? '行李 ' + bag.tag : selected?.kind === 'unit' ? describeUnit(sim, selected.unitId).title : '';
  const { source } = manifest;
  return <>
    <header className="station-header">
      <div className="airport-brand"><span className="airport-mark"><Icon name="plane" size={24}/></span>
        <div><strong>子午线国际机场</strong><span>行李处理系统</span></div></div>
      <nav aria-label="工作视图"><button type="button" aria-current="page" onClick={() => inspectStation(station)}>工艺巡览</button>
        <button type="button" onClick={enterMonitor}>运行监控</button></nav>
      <div className="station-clock"><span>仿真时间</span><time>{formatClock(AIRPORT.clockStart + sim.time)}</time></div>
    </header>
    <aside className="station-sidebar" aria-label="工位导航">
      <div className="station-sidebar-title"><h1>行李作业线</h1><span>工位导航</span></div>
      <nav className="station-route" aria-label="作业工位">
        {STATIONS.map((item, i) => <button type="button" key={item.id} data-station={item.id}
          aria-pressed={item.id === station.id} onClick={() => inspectStation(item)}>
          <span className="station-route-icon"><Icon name={item.icon} size={18}/></span>
          <span className="station-route-text"><strong>{item.title}</strong><small>{item.area}</small></span>
          <span className="station-route-no">{String(i + 1).padStart(2, '0')}</span></button>)}
      </nav>
      <div className="station-meters"><span>仿真统计</span>
        <div><p><strong>{sim.activeEntries.length}</strong><small>在途行李 / 件</small></p>
        <p><strong>{sim.signals.chuteCounts.reduce((sum, count) => sum + count, 0)}</strong><small>已入溜槽 / 件</small></p></div>
      </div>
      <details className="station-credits"><summary>模型来源与授权</summary><p>输送机、护栏、读码器和手推车来自 NVIDIA SimReady，由 CodePawl 转为 GLB。其余机场专用模型来自原机场工程。</p>
      <p><a href={source.originalUrl} target="_blank" rel="noreferrer">NVIDIA 原始资产</a> · <a href={source.datasetUrl + '/tree/' + source.revision} target="_blank" rel="noreferrer">GLB 版本</a> · <a href={source.licenseUrl} target="_blank" rel="noreferrer">{source.license}</a></p></details>
    </aside>
    <section className="station-heading" aria-label="当前工位">
      <span className="station-location">{station.area} <b>/</b> {station.code}</span>
      <h2>{station.title}</h2>
    </section>
    <div className="station-view-tools" role="group" aria-label="三维视角">
      <button aria-label="放大场景" title="放大" onClick={() => zoomBy(0.8)}><Icon name="plus"/></button>
      <button aria-label="缩小场景" title="缩小" onClick={() => zoomBy(1.25)}><Icon name="minus"/></button>
      <button aria-label="恢复工位视角" title="恢复工位视角" onClick={() => inspectStation(station)}><Icon name="home"/></button>
    </div>
    <footer className="station-footer">
      <div className="station-description"><strong>{selectedName || station.equipment}</strong><span>{station.note}</span></div>
      <div className="station-controls"><button className="station-play" onClick={togglePause} aria-pressed={paused}><Icon name={paused ? 'play' : 'pause'}/>{paused ? '继续仿真' : '暂停仿真'}</button>
        <select value={speed} aria-label="仿真速度" onChange={event => setSpeed(Number(event.target.value))}>
          {[0.25, 1, 2, 5, 10].map(value => <option key={value} value={value}>{value} 倍速</option>)}</select>
      </div>
    </footer>
    {!ready && <div className="station-loading" role="status">正在加载机场设备和行李模型…</div>}
    <div className="film-slate"><span>{AIRPORT.code}　/　{station.code}</span><strong>{station.title}</strong><small>{String(index + 1).padStart(2,'0')} / 05　{station.area}</small></div>
  </>;
}
