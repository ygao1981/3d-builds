import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { AIRPORT, sim } from '../appContext.js';
import { getState, setState, useStore } from '../store.js';
import { computeKpis, describeBag, describeUnit, flightLabel, flightSearchText, formatClock, SITES, statusLabel, TIMELINE_STEPS, unitPins } from '../model.js';
import { FLIGHTS } from '../sim/simulation.js';
import { pinRegistry } from '../pins.js';
import { FOLLOW_DISTANCES, plantRef, resetView, rig, selectBag, selectUnit, startFollow, stopFollow, switchSite, zoomBy } from '../runtime.js';
import { STAGES, bagStageAt } from '../stages.js';
import { SPEED_STEPS } from '../sim/simulation.js';
import { nextStage, pickStage, previousStage, setSlowAtEvents, setSpeed, startTour, stepOnce, stopTour, togglePause } from '../playback.js';
import { Icon, Logo, StatusIcon } from './icons.jsx';
import Inspection from './Inspection.jsx';
import { DEFAULT_STATION, inspectStation, STATIONS } from '../stations.js';

// Re-render the dashboard a few times per simulated second, driven by the same clock as the 3D view.
function useSimulationTick(intervalSeconds = 0.25) {
  const [, setVersion] = useState(0);
  useEffect(() => {
    let last = -1;
    let frame;
    const loop = () => {
      if (Math.abs(sim.time - last) >= intervalSeconds) {
        last = sim.time;
        setVersion((value) => value + 1);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [intervalSeconds]);
}

function TopBar() {
  const siteId = useStore((state) => state.siteId);
  const search = useStore((state) => state.search);
  return (
    <header className="top-bar card">
      <div className="brand">
        <Logo />
        <div className="brand-text">
          <h1>行李运行监控</h1>
          <span>{AIRPORT.name}（{AIRPORT.code}）</span>
        </div>
      </div>
      <nav className="site-switcher" aria-label="场景">
        {SITES.map((site) => (
          <button
            key={site.id}
            type="button"
            className={`quiet-button${site.id === siteId ? ' active' : ''}`}
            data-site={site.id}
            title={site.name}
            aria-pressed={siteId === site.id}
            onClick={() => switchSite(site.id)}
          >
            {site.short}
          </button>
        ))}
      </nav>
      <label className="search">
        <Icon name="magnifier" size={16} />
        <input
          type="search"
          aria-label="搜索行李牌号、航班或目的地"
          placeholder="行李牌号、航班或目的地"
          value={search}
          onChange={(event) => setState({ search: event.target.value, tab: event.target.value ? 'bags' : getState().tab })}
        />
      </label>
      <div className="clock tabular" title="机场仿真时间">
        <Icon name="clock" size={16} />
        <span className="clock-label">仿真</span>
        <span id="live-clock">{formatClock(AIRPORT.clockStart + sim.time)}</span>
      </div>
      <button type="button" className="quiet-button back-to-inspection"
        onClick={() => inspectStation(STATIONS.find(station => station.id === getState().stationId) || DEFAULT_STATION, true)}>返回工艺巡览</button>
    </header>
  );
}

function KpiCards() {
  const kpis = computeKpis(sim);
  const icons = { rate: 'bag', read: 'tag', loaded: 'plane', mishandled: 'alert' };
  return (
    <section className="kpi-grid" aria-label="运行指标">
      {kpis.map((kpi) => (
        <article key={kpi.id} className="card kpi">
          <div className="kpi-label"><Icon name={icons[kpi.id]} size={16} /><span>{kpi.label}</span></div>
          <div className="kpi-value tabular">{kpi.value}</div>
          <div className={`kpi-delta ${kpi.trend}`}>
            <Icon name={kpi.trend === 'up' ? 'up' : kpi.trend === 'flat' ? 'flat' : 'down'} size={14} />
            <span>{kpi.delta}</span>
          </div>
        </article>
      ))}
    </section>
  );
}

// Which stage the selected thing is in and how long it has been there.
function StageRow({ selection }) {
  const bagStage = selection.kind === 'bag' ? bagStageAt(sim.planById(selection.planId), sim.time) : null;
  const stage = bagStage ? STAGES[bagStage.index] : STAGES.find((item) => item.unitId === selection.unitId);
  if (!stage) return null;
  return (
    <div className="stage-row tabular" data-stage-row>
      <Icon name="scan" size={16} />
      <span>第 {stage.key} / {STAGES.length} 步 <span className="stage-name">{stage.name}</span></span>
      {bagStage && <span className="stage-since">已停留 {bagStage.since.toFixed(0)} 秒</span>}
    </div>
  );
}

const FOLLOW_LABELS = { close: '近景', mid: '中景', wide: '远景' };

function FollowControls() {
  const following = useStore((state) => state.following);
  const distance = useStore((state) => state.followDistance);
  return (
    <div className="follow-controls" role="group" aria-label="跟随视角">
      <button type="button" className={`quiet-button${following ? ' active' : ''}`} data-follow="toggle" aria-pressed={following} onClick={() => (following ? stopFollow() : startFollow(distance))}>
        <Icon name={following ? 'scan' : 'ring'} size={16} />
        <span>跟随</span>
      </button>
      {Object.keys(FOLLOW_DISTANCES).map((name) => (
        <button key={name} type="button" className={`quiet-button${following && distance === name ? ' active' : ''}`} data-follow={name} aria-pressed={following && distance === name} onClick={() => startFollow(name)}>
          {FOLLOW_LABELS[name]}
        </button>
      ))}
    </div>
  );
}

function DetailCard() {
  const selection = useStore((state) => state.selection);
  if (!selection) return null;
  let description;
  if (selection.kind === 'bag') {
    const plan = sim.planById(selection.planId);
    if (!plan) return null;
    description = describeBag(sim, plan, sim.time);
  } else {
    description = describeUnit(sim, selection.unitId);
  }
  return (
    <aside className="card detail-card" aria-label="详情" tabIndex={0}>
      <div className="detail-head">
        <span className="detail-icon"><Icon name={selection.kind === 'bag' ? 'bag' : 'site'} size={22} /></span>
        <div>
          <h2>{description.title}</h2>
          <p>{description.subtitle}</p>
        </div>
      </div>
      <div className="status-row">
        <StatusIcon status={description.status} size={20} />
        <strong>{description.statusText}</strong>
      </div>
      <StageRow selection={selection} />
      <FollowControls />
      {Number.isFinite(description.progress) && <div className="progress-block">
        <div className="progress-label"><span>{description.progressLabel}</span><span className="tabular">{Math.round(description.progress * 100)}%</span></div>
        <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.round(description.progress * 100)}%` }} /></div>
      </div>}
      <dl className="fields">
        {description.fields.map(([label, value]) => (
          <div key={label} className="field">
            <dt>{label}</dt>
            <dd className="tabular">{value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

function PlaybackControls() {
  const speed = useStore((state) => state.speed);
  const paused = useStore((state) => state.paused);
  const slowed = useStore((state) => state.slowed);
  const slowAtEvents = useStore((state) => state.slowAtEvents);
  const status = paused
    ? { icon: 'pause', text: '已暂停', tone: 'paused' }
    : slowed
      ? { icon: 'hourglass', text: '关键动作慢放中', tone: 'slowed' }
      : { icon: 'play', text: `${speed} 倍速播放中`, tone: 'playing' };
  return (
    <div className="playback" role="group" data-keeps-tour aria-label="仿真播放">
      <span className={`playback-state ${status.tone}`} role="status" data-playback-state={status.tone}><Icon name={status.icon} size={16} /><span>{status.text}</span></span>
      <button type="button" className="quiet-button" data-playback="toggle" title="暂停或播放（空格键）" onClick={togglePause}>
        <Icon name={paused ? 'play' : 'pause'} size={16} />
        <span>{paused ? '播放' : '暂停'}</span>
      </button>
      <button type="button" className="quiet-button" data-playback="step" title="暂停时推进一步" disabled={!paused} onClick={stepOnce}>
        <Icon name="stepForward" size={16} />
        <span>单步</span>
      </button>
      <span className="speed-group" role="group" aria-label="播放倍速">
        {SPEED_STEPS.map((value) => (
          <button key={value} type="button" className={`quiet-button tabular${speed === value ? ' active' : ''}`} data-speed={value} aria-pressed={speed === value} title="播放倍速（减号或加号键）" onClick={() => setSpeed(value)}>
            {value} 倍
          </button>
        ))}
      </span>
      <button type="button" className={`quiet-button${slowAtEvents ? ' active' : ''}`} data-playback="slow" aria-pressed={slowAtEvents} title="导览播放到关键动作时降至 0.25 倍速" onClick={() => setSlowAtEvents(!slowAtEvents)}>
        <Icon name={slowAtEvents ? 'scan' : 'ring'} size={16} />
        <span>关键动作慢放</span>
      </button>
    </div>
  );
}

function StageBar() {
  const stageIndex = useStore((state) => state.stageIndex);
  const touring = useStore((state) => state.touring);
  const tourIndex = useStore((state) => state.tourIndex);
  const current = touring ? tourIndex : stageIndex;
  const optionsRef = useRef(null);
  useEffect(() => {
    const options = optionsRef.current;
    const selected = options.querySelector('.stage-button.active');
    if (!selected || options.scrollWidth <= options.clientWidth) return;
    const bounds = options.getBoundingClientRect();
    const active = selected.getBoundingClientRect();
    if (active.left < bounds.left) options.scrollLeft += active.left - bounds.left;
    else if (active.right > bounds.right) options.scrollLeft += active.right - bounds.right;
  }, [current]);

  return (
    <nav className="stage-bar card" aria-label="流程镜头">
      <button type="button" className="quiet-button icon-only" data-stage-step="previous" title="上一步" aria-label="上一步" onClick={previousStage}><Icon name="previous" size={16} /></button>
      <div className="stage-options" ref={optionsRef}>
        {STAGES.map((stage, index) => (
          <button
            key={stage.id}
            type="button"
            className={`quiet-button stage-button${index === current ? ' active' : ''}`}
            data-stage={stage.id}
            aria-label={stage.name}
            aria-pressed={index === current}
            title={`${stage.name} · ${stage.does}（按 ${stage.key} 键）`}
            onClick={() => pickStage(index)}
          >
            <span className="stage-key tabular" aria-hidden="true">{stage.key}</span>
            <span>{stage.short}</span>
          </button>
        ))}
      </div>
      <button type="button" className="quiet-button icon-only" data-stage-step="next" title="下一步" aria-label="下一步" onClick={nextStage}><Icon name="next" size={16} /></button>
      <button type="button" className={`quiet-button tour-button${touring ? ' active' : ''}`} data-keeps-tour data-tour aria-label={touring ? '停止导览' : '开始导览'} onClick={() => (touring ? stopTour() : startTour())}>
        <Icon name={touring ? 'pause' : 'route'} size={16} />
        <span>{touring ? `导览 ${tourIndex + 1} / ${STAGES.length}` : '导览'}</span>
      </button>
    </nav>
  );
}

function Timeline() {
  const selection = useStore((state) => state.selection);
  const plan = selection?.kind === 'bag' ? sim.planById(selection.planId) : sim.heroPlan;
  if (!plan) return null;
  const description = describeBag(sim, plan, sim.time);
  const flight = FLIGHTS[plan.flight];
  const elapsed = Math.max(0, sim.time - plan.t0);
  return (
    <section className="card timeline" aria-label="行李时间线">
      <div className="timeline-head">
        <span className="timeline-title"><Icon name="bag" size={16} /> 跟踪行李 <strong className="tabular">{plan.tag}</strong></span>
        <span className="timeline-meta tabular">{flightLabel(flight)} · 值机后 {elapsed.toFixed(0)} 秒</span>
        <PlaybackControls />
      </div>
      <ol className="steps">
        {TIMELINE_STEPS.map((step, index) => {
          const done = index < description.stage;
          const current = index === description.stage;
          return (
            <li key={step} className={`step${done ? ' done' : ''}${current ? ' current' : ''}`} aria-current={current ? 'step' : undefined}>
              <span className="step-mark">{done ? <Icon name="check" size={18} /> : current ? <Icon name="scan" size={18} /> : <span className="step-dot" />}</span>
              <span className="step-name">{step}</span>
            </li>
          );
        })}
      </ol>
      <div className="progress-track slim"><div className="progress-fill" style={{ width: `${Math.round(description.progress * 100)}%` }} /></div>
    </section>
  );
}

function BagRows() {
  const search = useStore((state) => state.search).trim().toLowerCase();
  const selection = useStore((state) => state.selection);
  const rows = sim.state.active
    .filter((plan) => !plan.flagged || sim.time < plan.clearedTime)
    .filter((plan) => sim.time >= plan.archTime)
    .filter((plan) => {
      if (!search) return true;
      const flight = FLIGHTS[plan.flight];
      return `${plan.tag} ${flightSearchText(flight)}`.toLowerCase().includes(search);
    })
    .sort((first, second) => (second.hero ? 1 : 0) - (first.hero ? 1 : 0) || second.id - first.id)
    .slice(0, 8);
  if (!rows.length) return <p className="empty">{search ? '没有找到匹配的行李。' : '暂无可查看的行李。'}</p>;
  return rows.map((plan) => {
    const flight = FLIGHTS[plan.flight];
    const status = sim.bagStatus(plan, sim.time);
    const selected = selection?.kind === 'bag' && selection.planId === plan.id;
    return (
      <button key={plan.id} type="button" className={`row${selected ? ' selected' : ''}`} data-row="bag" onClick={() => selectBag(plan.id)}>
        <StatusIcon status={status} size={18} />
        <span className="row-main"><strong className="tabular">{plan.tag}</strong><small>{flightLabel(flight)}</small></span>
        <span className="row-side">{plan.hero ? '跟踪中' : statusLabel(status)}</span>
      </button>
    );
  });
}

function FlightRows() {
  const search = useStore((state) => state.search).trim().toLowerCase();
  const rows = FLIGHTS.map((flight, index) => ({ flight, index }))
    .filter(({ flight }) => flightSearchText(flight).toLowerCase().includes(search));
  if (!rows.length) return <p className="empty">没有找到匹配的航班。</p>;
  return rows.map(({ flight, index }) => {
    const loaded = sim.signals.flightLoaded[index];
    const share = Math.min(1, loaded / flight.expected);
    return (
      <button key={flight.code} type="button" className="row" data-row="flight" data-flight={flight.code} onClick={() => selectUnit(`chute-${sim.world.chutes[index].id}`, { fly: true })}>
        <StatusIcon status={index === 6 ? 'closed' : 'open'} size={18} />
        <span className="row-main"><strong>{flightLabel(flight)}</strong><small>{flight.gate} 登机口 · {flight.departsInMinutes} 分钟后起飞</small></span>
        <span className="row-side tabular">
          {loaded}/{flight.expected}
          <span className="mini-track"><span style={{ width: `${share * 100}%` }} /></span>
        </span>
      </button>
    );
  });
}

function AlertRows() {
  const entries = [...sim.state.log].reverse().slice(0, 8);
  if (!entries.length) return <p className="empty">暂无告警。</p>;
  return entries.map((entry, index) => (
    <button key={`${entry.time}-${index}`} type="button" className="row" onClick={() => entry.bagId && selectBag(entry.bagId)}>
      <StatusIcon status={entry.level === 'alarm' ? 'alarm' : entry.level === 'warning' ? 'warning' : 'ok'} size={18} />
      <span className="row-main"><strong>{entry.text}</strong><small className="tabular">{formatClock(AIRPORT.clockStart + entry.time)}</small></span>
    </button>
  ));
}

function ListPanel() {
  const tab = useStore((state) => state.tab);
  const tabs = [['bags', '行李'], ['flights', '航班'], ['alerts', '告警']];
  return (
    <section className="card list-panel" aria-label="行李、航班与告警">
      <div className="tabs" role="group" aria-label="列表切换">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" className={`quiet-button${tab === id ? ' active' : ''}`} data-tab={id} aria-pressed={tab === id} onClick={() => setState({ tab: id })}>
            {label}
          </button>
        ))}
      </div>
      <div className="rows">
        {tab === 'bags' && <BagRows />}
        {tab === 'flights' && <FlightRows />}
        {tab === 'alerts' && <AlertRows />}
      </div>
    </section>
  );
}

function CameraButtons() {
  const orbiting = useStore((state) => state.orbiting);
  return (
    <div className="camera-buttons card" role="group" aria-label="视角控制">
      <button type="button" title="放大" aria-label="放大" data-camera="zoom-in" onClick={() => zoomBy(0.8)}><Icon name="plus" /></button>
      <button type="button" title="缩小" aria-label="缩小" data-camera="zoom-out" onClick={() => zoomBy(1.25)}><Icon name="minus" /></button>
      <button type="button" title="回到全景" aria-label="回到全景" data-camera="home" onClick={() => resetView()}><Icon name="home" /></button>
      <button
        type="button"
        title="慢速环绕"
        aria-label="慢速环绕"
        aria-pressed={orbiting}
        data-camera="orbit"
        className={orbiting ? 'on' : ''}
        onClick={() => {
          rig.orbitRate = orbiting ? 0 : 0.035;
          setState({ orbiting: !orbiting });
        }}
      >
        <Icon name="orbit" />
      </button>
      <button type="button" title="跟随示例行李" aria-label="跟随示例行李" data-camera="follow" onClick={() => sim.heroPlan && selectBag(sim.heroPlan.id)}><Icon name="target" /></button>
    </div>
  );
}

function Pin({ id, label, icon, getPosition, tone }) {
  const reference = useRef();
  useEffect(() => {
    pinRegistry.set(id, { element: reference.current, getPosition });
    return () => pinRegistry.delete(id);
  }, [id, getPosition]);
  return (
    <div ref={reference} className={`pin ${tone ?? ''}`}>
      <Icon name={icon} size={14} />
      <span>{label}</span>
    </div>
  );
}

function Pins() {
  const siteId = useStore((state) => state.siteId);
  const selection = useStore((state) => state.selection);
  const pins = unitPins(siteId);
  const vector = useRef(new THREE.Vector3());
  return (
    <div className="pin-layer" aria-hidden="true">
      {pins.map((pin) => (
        <Pin
          key={`${siteId}-${pin.unitId}`}
          id={`${siteId}-${pin.unitId}`}
          label={pin.label}
          icon={pin.icon}
          getPosition={() => {
            const bounds = plantRef.current?.boundsOfUnit(pin.unitId);
            if (!bounds) return null;
            return vector.current.set(bounds.centre.x, bounds.centre.y + bounds.size.y / 2 + 0.6, bounds.centre.z).clone();
          }}
        />
      ))}
      {siteId === 'hall' && sim.heroPlan && !(selection?.kind === 'bag') && (
        <Pin
          id="hero"
          label={`行李 ${sim.heroPlan.tag}`}
          icon="bag"
          tone="hero"
          getPosition={() => {
            const position = plantRef.current?.positionOfBag(sim.heroPlan.id);
            return position ? position.clone().setY(position.y + 1.1) : null;
          }}
        />
      )}
    </div>
  );
}

function Caption() {
  const caption = useStore((state) => state.caption);
  if (!caption) return null;
  return <div className="caption" role="status">{caption}</div>;
}

function FilmCursor() {
  const reference = useRef();
  useEffect(() => {
    const onMove = (event) => {
      reference.current.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
      reference.current.style.opacity = '1';
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);
  return (
    <svg ref={reference} className="film-cursor" width="28" height="28" viewBox="0 0 24 24" style={{ opacity: 0 }}>
      <path d="M4 2l15 9.2-6.4 1.5 3.6 6.6-2.8 1.5-3.6-6.6L5.4 19z" fill="#111" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export default function Dashboard({ children }) {
  useSimulationTick(0.25);
  const mode = useStore(state => state.mode);
  const showCursor = new URLSearchParams(window.location.search).has('film');
  const capture = new URLSearchParams(window.location.search).has('capture');
  return (
    <div className={mode === 'monitor' ? 'dashboard' : 'station-shell' + (capture ? ' filming' : '')}>
      <main className="viewport" aria-label="行李处理三维场景">{children}</main>
      {mode === 'inspect' ? <Inspection/> : <>
      <TopBar />
      <StageBar />
      <CameraButtons />
      <Pins />
      <Caption />
      <KpiCards />
      <Timeline />
      <div className="side-panels">
        <DetailCard />
        <ListPanel />
      </div>
      {showCursor && <FilmCursor />}
      </>}
    </div>
  );
}
