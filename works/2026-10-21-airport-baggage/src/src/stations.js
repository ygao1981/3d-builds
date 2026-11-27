import { getState, setState } from './store.js';
import { flyTo, rig, snapToView, switchSite } from './runtime.js';
import { stopTour } from './playback.js';

export const STATIONS = [
  {
    id: 'checkin', code: 'CKI', site: 'checkin', area: '出发大厅', title: '值机交运', icon: 'tag',
    note: '柜台称重挂签后，托运行李从侧面汇入主输送线。手推车停放在旅客侧，台面读码器位于柜员手边。',
    equipment: '台式读码器 · 行李手推车',
    view: { target: [-35, 2.35, 6.9], distance: 12.5, azimuth: -0.95, elevation: 0.47 },
  },
  {
    id: 'read', code: 'ATR', site: 'hall', area: '分拣厅', title: '读码输送', icon: 'scan',
    note: '行李沿直线滚筒经过读码门，转过 90° 弯道后进入安检线。',
    equipment: '直线滚筒 · 弯道滚筒 · 检修护栏',
    view: { target: [5.6, 1.05, 21.7], distance: 13.4, azimuth: 0.69, elevation: 0.53 },
  },
  {
    id: 'screen', code: 'CT', site: 'hall', area: '分拣厅', title: '安检复核', icon: 'search',
    note: '正常行李进入分拣线。触发模拟告警时，分流摆臂将行李送往侧面的复检台。',
    equipment: 'CT 安检机 · 分流摆臂 · 复检台',
    view: { target: [9.0, 1.0, 17.1], distance: 15.8, azimuth: 1.06, elevation: 0.52 },
  },
  {
    id: 'sort', code: 'SRT', site: 'hall', area: '分拣厅', title: '航班分拣', icon: 'shuffle',
    note: '环线托盘把行李送到对应航班的溜槽。托盘侧倾后，行李滑向接驳车。',
    equipment: '翻盘分拣机 · 航班溜槽',
    view: { target: [15.0, 0.95, 12.0], distance: 18.2, azimuth: 0.52, elevation: 0.60 },
  },
  {
    id: 'ramp', code: 'G14', site: 'ramp', area: '机坪', title: '机坪装载', icon: 'plane',
    note: '牵引车组在集包区和机位之间循环运行。装载机的斜皮带将散装行李送入货舱。',
    equipment: '牵引车组 · 皮带装载机',
    view: { target: [84.7, 2.7, 26.9], distance: 21.5, azimuth: -2.26, elevation: 0.34 },
  },
];

export const DEFAULT_STATION = STATIONS[1];
export function inspectStation(station, instant = false) {
  stopTour();
  rig.getFollowPosition = null;
  rig.orbitRate = 0;
  const acrossSites = getState().siteId !== station.site;
  setState({ mode: 'inspect', stationId: station.id, siteId: station.site,
    selection: null, following: false, orbiting: false, stageIndex: -1 });
  if (instant || acrossSites) snapToView(station.view);
  else flyTo(station.view, 0.7);
}

export function enterMonitor() {
  setState({ mode: 'monitor', orbiting: false });
  rig.orbitRate = 0;
  switchSite(getState().siteId, 0.7);
}
