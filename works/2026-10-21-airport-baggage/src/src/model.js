import { SITE_OFFSET_RAMP } from './sim/layout.js';
import { BAG_VARIANTS, FLIGHTS } from './sim/simulation.js';

// Sites, units and the text that describes them. The 3D view and the dashboard both read from here.
export const SITES = [
  {
    id: 'hall',
    name: '安检与分拣厅',
    short: '分拣厅',
    view: { target: [12.5, 0.6, 13.5], distance: 38, azimuth: 0.42, elevation: 0.72 },
  },
  {
    id: 'checkin',
    name: '值机大厅',
    short: '值机大厅',
    view: { target: [-36, 1.8, 9.5], distance: 31, azimuth: 0.5, elevation: 0.72 },
  },
  {
    id: 'ramp',
    name: '集包区与机坪',
    short: '集包与机坪',
    view: { target: [SITE_OFFSET_RAMP - 8, 1.6, 23], distance: 24, azimuth: -0.95, elevation: 0.36 },
  },
];

export function siteOfPosition(x) {
  if (x < -31) return 'checkin';
  if (x > SITE_OFFSET_RAMP - 40) return 'ramp';
  return 'hall';
}

const UNIT_TITLES = {
  'ct-1': ['1 号 CT 安检机', '托运行李二级安检'],
  'arch-1': ['1 号读码门', '读取行李条码和 RFID 标签'],
  'diverter-1': ['1 号异常分流器', '将告警行李送往人工复检室'],
  'search-room': ['人工复检室', '三级图像复核和开包检查'],
  'store-crane': ['暂存区堆垛机', '存放提前托运的行李'],
  'loader-1': ['1 号皮带装载机', '将行李送入飞机货舱'],
  'aircraft-1': ['14 号机位的窄体客机', '货舱已打开，正在装载'],
};

export function unitPins(siteId) {
  const pins = {
    hall: [
      { unitId: 'ct-1', label: '1 号安检机', icon: 'scan' },
      { unitId: 'arch-1', label: '读码门', icon: 'tag' },
      { unitId: 'search-room', label: '人工复检室', icon: 'search' },
      { unitId: 'chute-C1', label: 'C1 溜槽', icon: 'box' },
      { unitId: 'chute-C4', label: 'C4 溜槽', icon: 'box' },
    ],
    checkin: [
      { unitId: 'desk-1', label: '1 号柜台', icon: 'tag' },
      { unitId: 'desk-3', label: '3 号柜台', icon: 'tag' },
      { unitId: 'arch-1', label: '读码门', icon: 'tag' },
    ],
    ramp: [
      { unitId: 'loader-1', label: '皮带装载机', icon: 'arrow' },
      { unitId: 'carousel-1', label: '1 号集包转盘', icon: 'orbit' },
      { unitId: 'tug-1', label: '1 号牵引车', icon: 'arrow' },
      { unitId: 'aircraft-1', label: '14 号机位', icon: 'plane' },
    ],
  };
  return pins[siteId];
}

export function formatClock(seconds) {
  const whole = Math.floor(seconds) % 86400;
  const hours = String(Math.floor(whole / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((whole % 3600) / 60)).padStart(2, '0');
  const rest = String(whole % 60).padStart(2, '0');
  return `${hours}:${minutes}:${rest}`;
}

const STATUS_LABEL = {
  checked: '已托运',
  screened: '已安检',
  sorted: '分拣中',
  loaded: '已装箱',
  alarm: '安检告警',
  searching: '人工复检中',
  stored: '暂存中',
  missing: '行李缺失',
};

export function statusLabel(status) {
  return STATUS_LABEL[status] ?? '状态未知';
}

const DESTINATION_LABEL = {
  Porto: '波尔图',
  Nairobi: '内罗毕',
  Reykjavik: '雷克雅未克',
  Marrakesh: '马拉喀什',
  Tallinn: '塔林',
  Lima: '利马',
  Hanoi: '河内',
};

export function flightLabel(flight) {
  return `${flight.code} 飞往${DESTINATION_LABEL[flight.destination]}`;
}

export function flightSearchText(flight) {
  return `${flight.code} ${flight.destination} ${DESTINATION_LABEL[flight.destination]}`;
}

const BAG_TYPE_LABEL = {
  bag_hard_blue: '蓝色硬壳箱',
  bag_hard_orange: '橙色硬壳箱',
  bag_hard_teal: '青色硬壳箱',
  bag_soft_grey: '灰色软壳箱',
  bag_duffel_green: '绿色旅行袋',
  bag_backpack_red: '红色背包',
};

export const TIMELINE_STEPS = ['挂签', '读码', '安检', '分拣', '集包', '装箱', '装机'];

export function describeBag(simulation, plan, time) {
  const flight = FLIGHTS[plan.flight];
  const status = simulation.bagStatus(plan, time);
  const { stage, marks } = simulation.timelineStage(plan, time);
  const next = marks[Math.min(marks.length - 1, stage + 1)];
  const current = marks[Math.max(0, stage)];
  const withinStage = next > current ? Math.min(1, (time - current) / (next - current)) : 1;
  const progress = Math.min(1, Math.max(0, (Math.max(stage, 0) + withinStage) / (marks.length - 1)));
  const entry = simulation.entryFor(plan.id);
  const x = entry ? entry.current[0] : 0;
  let where;
  if (!plan.flagged && (time >= plan.footTime || time >= plan.leaveTime)) where = `${simulation.world.chutes[plan.chute].id} 溜槽`;
  else if (time >= plan.onTrayTime && !plan.flagged) where = '翻盘式分拣机';
  else if (plan.flagged && time >= plan.tableTime) where = '人工复检室';
  else if (time >= plan.ctExitTime) where = '分拣上包输送带';
  else if (time >= plan.ctEntryTime) where = '1 号安检机';
  else if (time >= plan.archTime || x > -25) where = '主输送线';
  else if (x > -31) where = '下坡输送带';
  else if (time >= plan.t0 + 3) where = '汇流输送带';
  else where = plan.source.kind === 'store' ? '行李暂存区' : `${plan.source.index + 1} 号值机柜台`;
  return {
    title: `行李 ${plan.tag}`,
    subtitle: flightLabel(flight),
    status,
    statusText: statusLabel(status),
    fields: [
      ['行李牌号', plan.tag],
      ['航班', `${flight.code} · ${flight.gate} 登机口`],
      ['目的地', DESTINATION_LABEL[flight.destination]],
      ['重量', `${plan.weight.toFixed(1)} kg`],
      ['类型', plan.hero ? '粉色硬壳箱' : BAG_TYPE_LABEL[BAG_VARIANTS[plan.variant].node]],
      ['当前位置', where],
      ['目标溜槽', plan.flagged ? '等待人工复检' : simulation.world.chutes[plan.chute].id],
    ],
    progress,
    progressLabel: TIMELINE_STEPS[Math.max(0, Math.min(stage, TIMELINE_STEPS.length - 1))],
    stage,
    marks,
  };
}

export function describeUnit(simulation, unitId) {
  let equipment;
  if (unitId.startsWith('read-roll-')) equipment = ['直线滚筒输送机', 'A05', '滚筒按线速转动'];
  else if (unitId === 'read-bend') equipment = ['弯道滚筒输送机', 'A02', '滚筒按线速转动'];
  else if (unitId === 'counter-reader') equipment = ['柜台读码器', 'B01', '台面设备'];
  else if (unitId === 'terminal-cart') equipment = ['行李手推车', 'A01', '停放中'];
  else if (unitId.startsWith('service-barrier-')) equipment = ['检修护栏', 'A02', '已布设'];
  if (equipment) return {
    title: equipment[0], subtitle: 'NVIDIA SimReady', status: 'ok', statusText: equipment[2],
    fields: [['模型款式', equipment[1]], ['来源', 'NVIDIA'], ['格式转换', 'CodePawl'], ['授权', 'CC BY 4.0']],
  };
  const signals = simulation.signals;
  const world = simulation.world;
  if (unitId === 'ct-1') {
    return {
      title: UNIT_TITLES[unitId][0],
      subtitle: UNIT_TITLES[unitId][1],
      status: signals.scanning ? 'scanning' : 'idle',
      statusText: signals.scanning ? '正在扫描行李' : '待扫描',
      fields: [
        ['处理能力', '1,180 件/小时'],
        ['皮带速度', '2.4 m/s（仿真）'],
        ['最近结果', signals.scanResult === 'alarm' ? '告警，已转人工复检' : '通过'],
        ['告警率', '5.6%'],
        ['安检级别', '托运行李二级安检'],
      ],
      progress: signals.scanning ? 0.6 : 0,
      progressLabel: '扫描进度',
    };
  }
  if (unitId === 'arch-1') {
    const attempts = simulation.state.readCount + simulation.state.noReadCount;
    const rate = attempts ? (simulation.state.readCount / attempts) * 100 : 100;
    return {
      title: UNIT_TITLES[unitId][0],
      subtitle: UNIT_TITLES[unitId][1],
      status: 'ok',
      statusText: '读码中',
      fields: [
        ['读码成功', String(simulation.state.readCount)],
        ['读码失败', String(simulation.state.noReadCount)],
        ['读码成功率', `${rate.toFixed(1)}%`],
        ['读取方式', 'IATA 行李牌、ATR 和 RFID'],
      ],
      progress: rate / 100,
      progressLabel: '读码成功率',
    };
  }
  if (unitId.startsWith('chute-')) {
    const index = world.chutes.findIndex((chute) => `chute-${chute.id}` === unitId);
    const chute = world.chutes[index];
    const flight = FLIGHTS[index];
    const loaded = signals.flightLoaded[index];
    return {
      title: `${chute.id} 溜槽`,
      subtitle: flightLabel(flight),
      status: index === 6 ? 'closed' : 'open',
      statusText: index === 6 ? '已关闭' : '已开启',
      fields: [
        ['航班', `${flight.code} · ${flight.gate} 登机口`],
        ['已装载 / 预计', `${loaded} / ${flight.expected} 件`],
        ['开启后通过量', String(signals.chuteCounts[index])],
        ['距起飞', `${flight.departsInMinutes} 分钟`],
      ],
      progress: Math.min(1, loaded / flight.expected),
      progressLabel: '装载进度',
    };
  }
  if (unitId.startsWith('tray-')) {
    return {
      title: `${unitId.slice(5)} 号托盘`,
      subtitle: '翻盘式分拣小车',
      status: 'moving',
      statusText: '运行中',
      fields: [['速度', '3.4 m/s（仿真）'], ['节距', '1.32 m'], ['翻转角度', '左右各 30°']],
      progress: 0.5,
      progressLabel: '本圈进度',
    };
  }
  if (unitId.startsWith('tug-')) {
    return {
      title: `${unitId.slice(4)} 号牵引车`,
      subtitle: '牵引集装箱拖车和行李拖车',
      status: 'moving',
      statusText: '驶向 14 号机位',
      fields: [['速度', '18 km/h'], ['载荷', '1 个集装箱、14 件散装行李'], ['目的地', '14 号机位']],
      progress: 0.4,
      progressLabel: '运输进度',
    };
  }
  if (unitId.startsWith('desk-')) {
    return {
      title: `${unitId.slice(5)} 号值机柜台`,
      subtitle: '行李称重、挂签后进入汇流输送带',
      status: 'ok',
      statusText: '开放中',
      fields: [['今日托运行李', String(180 + Number(unitId.slice(5)) * 23)], ['行李牌打印机', '就绪'], ['皮带速度', '1.0 m/s']],
      progress: 0.55,
      progressLabel: '排队情况',
    };
  }
  if (unitId.startsWith('carousel-')) {
    return {
      title: `${unitId.slice(9)} 号集包转盘`,
      subtitle: flightLabel(FLIGHTS[unitId.endsWith('1') ? 0 : 1]),
      status: 'ok',
      statusText: '开放中',
      fields: [['带上行李', '7 件'], ['集装箱', '已装 2 / 3 个'], ['皮带速度', '0.8 m/s']],
      progress: 0.66,
      progressLabel: '装载进度',
    };
  }
  if (unitId.startsWith('uld-')) {
    return {
      title: `${unitId.slice(4)} 号集装箱`,
      subtitle: 'LD3 航空集装箱',
      status: 'ok',
      statusText: '装载中',
      fields: [['容积', '4.5 m³'], ['箱内行李', String(18 + Number(unitId.slice(4)) * 6)], ['净载上限', '1,588 kg']],
      progress: 0.5,
      progressLabel: '装箱进度',
    };
  }
  const titles = UNIT_TITLES[unitId] ?? ['设备详情', ''];
  return {
    title: titles[0],
    subtitle: titles[1],
    status: 'ok',
    statusText: '运行中',
    fields: [['状态', '正常'], ['已处理行李', String(simulation.state.readCount)]],
    progress: 0.5,
    progressLabel: '负载',
  };
}

export function computeKpis(simulation) {
  const recent = simulation.state.recentArch;
  const now = simulation.time;
  const window = 120;
  const inWindow = recent.filter((read) => read.time > now - window);
  const perHour = Math.round(((inWindow.length / window) * 3600) / 10) * 10;
  const noReads = inWindow.filter((read) => read.noRead).length;
  const readRate = inWindow.length ? ((inWindow.length - noReads) / inWindow.length) * 100 : 100;
  const next = FLIGHTS[0];
  const loaded = simulation.signals.flightLoaded[0];
  return [
    { id: 'rate', label: '每小时行李量', value: perHour.toLocaleString('zh-CN'), delta: '+4.2%', trend: 'up' },
    { id: 'read', label: '读码成功率', value: `${readRate.toFixed(1)}%`, delta: noReads ? `${noReads} 件未读出` : '全部读出', trend: noReads ? 'down' : 'up' },
    { id: 'loaded', label: `${next.code} 装载量`, value: `${loaded} / ${next.expected}`, delta: `${next.departsInMinutes} 分钟后起飞`, trend: 'flat' },
    { id: 'mishandled', label: '每千件错运量', value: (3.6 + Math.sin(now / 90) * 0.2).toFixed(1), delta: '-0.3', trend: 'down-good' },
  ];
}
