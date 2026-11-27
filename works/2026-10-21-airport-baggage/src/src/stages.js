// The nine stages of a bag's journey: one camera preset each, and the event that marks the stage as seen.
// Camera views use the rig convention: azimuth 0 looks north from the south side, positive azimuth moves the camera east.

let collectorOffsetCache = null;

function collectorEventTime(sim, plan) {
  if (plan.collectorTime === undefined) {
    if (collectorOffsetCache === null) collectorOffsetCache = sim.world.mainPath.distanceNearest(-25.5, 22.5);
    const offsetDistance = plan.path.length - sim.world.mainPath.length;
    plan.collectorTime = plan.t0 + plan.path.timeAtDistance(collectorOffsetCache + offsetDistance);
  }
  return plan.collectorTime;
}

// The first event time strictly after a time, over every planned bag that matches the filter.
function firstPlanEvent(sim, after, getTime, accepts = () => true) {
  let best = Infinity;
  for (const plan of sim.plans) {
    if (!accepts(plan)) continue;
    const time = getTime(plan);
    if (Number.isFinite(time) && time > after && time < best) best = time;
  }
  return best;
}

// The camera stage (index into STAGES) a planned bag is in at a time, and when that stage began.
export function bagStageAt(plan, time) {
  const starts = plan.flagged
    ? [plan.t0, plan.t0 + 3, plan.archTime, plan.ctEntryTime]
    : [plan.t0, plan.t0 + 3, plan.archTime, plan.ctEntryTime, plan.onTrayTime, plan.leaveTime, plan.footTime];
  let index = 0;
  starts.forEach((start, candidate) => {
    if (time >= start) index = candidate;
  });
  return { index, since: Math.max(0, time - starts[index]) };
}

export const STAGES = [
  {
    key: 1,
    id: 'desk',
    name: '值机柜台',
    short: '值机',
    does: '行李挂签后进入输送带',
    unitId: 'desk-2',
    view: { target: [-34, 1.9, 5.2], distance: 13, azimuth: 0.75, elevation: 0.5 },
    eventAfter: (sim, after) => firstPlanEvent(sim, after, (plan) => plan.t0, (plan) => plan.source.kind === 'desk' && plan.source.index <= 1),
  },
  {
    key: 2,
    id: 'collector',
    name: '汇流输送带',
    short: '汇流',
    does: '行李沿下坡输送带进入分拣厅',
    unitId: null,
    view: { target: [-29.5, 1.2, 21], distance: 15, azimuth: 0.55, elevation: 0.45 },
    eventAfter: (sim, after) => firstPlanEvent(sim, after, (plan) => collectorEventTime(sim, plan)),
  },
  {
    key: 3,
    id: 'arch',
    name: '读码门',
    short: '读码',
    does: '读码门读取行李标签',
    unitId: 'arch-1',
    view: { target: [5, 1.5, 22.5], distance: 11, azimuth: 0.35, elevation: 0.36 },
    eventAfter: (sim, after) => firstPlanEvent(sim, after, (plan) => plan.archTime),
  },
  {
    key: 4,
    id: 'ct',
    name: 'CT 安检',
    short: '安检',
    does: '告警行李转入人工复检',
    unitId: 'ct-1',
    view: { target: [8.5, 1.4, 17.6], distance: 14, azimuth: 0.9, elevation: 0.4 },
    eventAfter: (sim, after) => firstPlanEvent(sim, after, (plan) => plan.ctExitTime),
  },
  {
    key: 5,
    id: 'tray',
    name: '翻转托盘',
    short: '托盘',
    does: '行李进入分拣托盘',
    unitId: null,
    view: { target: [8, 1.1, 12.2], distance: 9, azimuth: 0.9, elevation: 0.38 },
    eventAfter: (sim, after) => firstPlanEvent(sim, after, (plan) => plan.onTrayTime),
  },
  {
    key: 6,
    id: 'chute',
    name: '溜槽',
    short: '溜槽',
    does: '托盘翻转，行李滑入对应溜槽',
    unitId: 'chute-C1',
    view: { target: [17, 0.9, 13.4], distance: 11, azimuth: 0.85, elevation: 0.4 },
    eventAfter: (sim, after) => firstPlanEvent(sim, after, (plan) => plan.leaveTime, (plan) => !plan.flagged && plan.chute <= 1),
  },
  {
    key: 7,
    id: 'makeup',
    name: '集包转盘',
    short: '集包',
    does: '按航班集包并转入行李车',
    unitId: 'carousel-1',
    view: { target: [73, 0.9, 0.2], distance: 24, azimuth: 0.35, elevation: 0.5 },
    eventAfter: (sim, after) => sim.carouselWrapAfter(after, 0),
  },
  {
    key: 8,
    id: 'tug',
    name: '牵引车组',
    short: '牵引',
    does: '牵引车组将行李运往机位',
    unitId: 'tug-1',
    view: { target: [72, 1, 23], distance: 27, azimuth: -1.1, elevation: 0.35 },
    eventAfter: (sim, after) => sim.trainArrivalAfter(after),
  },
  {
    key: 9,
    id: 'loader',
    name: '皮带装载机',
    short: '装机',
    does: '装载机把行李送入飞机货舱',
    unitId: 'loader-1',
    view: { target: [85, 2.8, 26], distance: 16, azimuth: -2.6, elevation: 0.2 },
    eventAfter: (sim, after) => sim.loaderEntryAfter(after),
  },
];
