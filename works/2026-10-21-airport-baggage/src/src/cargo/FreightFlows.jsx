import {useState} from 'react';

const flows={
  '跨境电商出港':['卸车','计量','安检','暂存汇流','供包','卸载','码盘','查验','组板','复重','跨境待运','交接'],
  '国际快件出港':{
    '常规快件':['卸车','计量','安检','人工分拣','查验','组板','复重','快件待运','交接'],
    '超大超重货物':['卸车','超限处理','查验','组板','复重','快件待运','交接'],
  },
  '国际快件进港':['接机来板','入站处理','进港理货','进港作业','查验','待提','装车'],
  '中转货物':{
    '国内转国际':['接收中转','中转理货','查验','组板','复重','交接'],
    '国际转国内':['接机来板','入站处理','中转理货','查验','调拨交付'],
    '国际转国际':{
      '中心内中转':['接机来板','入站处理','中转理货','查验','组板','复重','交接'],
      '国际货站调入':['接收调拨','组板','复重','交接'],
      '调往国际货站':['接机来板','入站处理','中转理货','查验','调出'],
    },
  },
};

export default function FreightFlows({scene,onStep,flow,setFlow,selection}){
  const [direction,setDirection]=useState('国内转国际');
  const [allocation,setAllocation]=useState('中心内中转'),[shipment,setShipment]=useState('常规快件');
  const {nav,plant,inspectionCue}=scene;
  const station=(key,time=12)=>({view:'overview',focus:nav.overview.findIndex(n=>n.key===key),time});
  const steps={
    '计量':['收货计量',plant.sorting.cues.meter],'安检':['收货安检',inspectionCue],
    '查验':['按需查验',station('customs')],'暂存汇流':['暂存与汇流',
      {view:'sorting',focus:nav.sorting.findIndex(n=>n.label==='暂存与汇流'),time:14}],
    '卸车':['到站卸车',plant.dockOps.cues.truck],'超限处理':['超限货处理',station('special')],
    '入站处理':['进港业务接收',station('inWork')],'接收调拨':['接收调入货物',station('transfer')],
    '调出':['交付国际货站',station('carrier')],
    '供包':['斜向供包',plant.sorting.cues.feed],'卸载':['滑槽卸载',plant.sorting.cues.unload],
    '码盘':['格口码盘',plant.sorting.cues.stack],'组板':['组板系网',plant.packing.cues.build],
    '复重':['整板复重',station('weigh',13)],'跨境待运':['跨境待运',station('crossWait')],
    '快件待运':['快件待运',station('expressWait')],'交接':['承运交接',station('carrier')],
    '人工分拣':['人工分拣出料',station('manual',42)],'接机来板':['接收来板',station('carrier')],
    '进港理货':['拆板理货',station('inbound')],'进港作业':['进港快件作业',station('inWork')],
    '待提':['待提归集',station('pickup',10)],'装车':['提货装车',station('dispatch',15)],'接收中转':['接收中转货',station('carrier')],
    '中转理货':['中转分拨',station('transfer')],
    '调拨交付':['国内段交付',station('carrier')],
  };
  const quick=[
    ['散件',[steps['计量'],steps['安检'],steps['供包'],steps['卸载'],steps['码盘']]],
    ['板货',[['叉车送料',plant.packing.cues.supply],['组板',plant.packing.cues.build],['整板交接',plant.dockOps.cues.handoff]]]
  ];
  const transfer=flow==='中转货物',express=flow==='国际快件出港',international=transfer && direction==='国际转国际';
  const route=international?flows[flow][direction][allocation]:transfer?flows[flow][direction]:express?flows[flow][shipment]:flows[flow];
  const rows=flow==='工位速览'?quick:[['工序',route.map(id=>steps[id])]];
  return <div className="cargo-flow cargo-business" aria-label="作业流程">
    <div className="cargo-flow-choice">
      <label>业务流程 <select aria-label="业务流程" value={flow} onChange={e=>setFlow(e.target.value)}>
        {['工位速览',...Object.keys(flows)].map(name=><option key={name}>{name}</option>)}</select></label>
      {transfer && <select aria-label="中转方向" value={direction} onChange={e=>setDirection(e.target.value)}>
        {Object.keys(flows['中转货物']).map(name=><option key={name}>{name}</option>)}</select>}
      {international && <select aria-label="调拨方式" value={allocation} onChange={e=>setAllocation(e.target.value)}>
        {Object.keys(flows['中转货物'][direction]).map(name=><option key={name}>{name}</option>)}</select>}
      {express && <select aria-label="货物类型" value={shipment} onChange={e=>setShipment(e.target.value)}>
        {Object.keys(flows[flow]).map(name=><option key={name}>{name}</option>)}</select>}
    </div>
    {rows.map(([kind,items])=><div key={kind} className="cargo-flow-steps" aria-label={kind}>
      <span>{kind}</span>{items.filter(([,cue])=>cue && cue.focus>=-1).map(([label,cue],i)=>
        <button key={label} type="button" aria-pressed={selection===label} onClick={()=>onStep(label,cue)}>
        {i>0 && <i aria-hidden="true">→</i>}{label}</button>)}</div>)}
  </div>;
}
