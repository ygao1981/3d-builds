import {useEffect,useRef,useState} from 'react';
import {Icon} from '../ui/icons.jsx';
import {equipmentView,openCargo} from './scene.js';
import manifest from '../simready-assets.json';
import './cargo.css';

const views=[
  ['overview','主站房全景','装卸、分拣与组板','site'],
  ['sorting','自动分拣环线','交叉带与供包台','orbit'],
  ['chutes','滑槽卸载','滚筒滑槽与回流线','shuffle'],
  ['pallet','空托盘系统','拆盘、转向与移载','box'],
  ['dock','装卸交接','调平台与交接辊道','site'],
  ['tables','组板作业','理货、组板与系网','box'],
];
const modes=[['3d','三维演示'],['overlay','图纸叠合'],['paper','工艺原图']];
const layers=[['both','上下层同看'],['upper','上层分拣环线'],['lower','下层空托盘']];
const replayLabels={feed:'斜向供包',unload:'滑槽卸载',stack:'格口人工码盘',release:'底部拆盘',turn:'托盘转向',transfer:'顶升移载',chain:'横向链条输送',meter:'收货扫码称重',distribute:'分流排队',truck:'货车卸货',raise:'交接台升降',handoff:'整板交接',build:'纸箱组板',supply:'叉车送料'};
const capture=new URLSearchParams(location.search).has('capture');

function describe(key,d,selection){
  const eq=d.site?.distributionEquipment;
  if(key==='overview' && selection==='收货安检')return {sheet:d.site.reference,parts:'PR0020-F1005 至 F1007',
    note:'收货计量后，纸箱沿输送带进入 X 光机。判图在操作台完成，需要开包时在人工复核台处理。画面展示一个代表工位。',
    metrics:[['机检设备','货物 X 光机'],['配套工位','判图台、人工复核台'],['设备外形与摆位','工艺示意']]};
  if(key==='sorting' && selection?.startsWith('供包台 ')){
    const s=d.sorter,f=s.feedDeck;
    if(f){
      const [a,b]=s.feeds[Number(selection.split(' ')[1])-1];
      const angle=Math.atan2(Math.abs(b[1]-a[1]),Math.abs(b[0]-a[0]))*180/Math.PI;
      const lengths=f.rows.map(([start,end])=>(end-start).toFixed(2)).join('、');
      return {sheet:s.reference,parts:'PR0020-1001、F1009、F1013',
        note:`排队带向图面下方送料，包裹再转向左下方上环。沿输送方向量取的五排短带可见长度依次约 ${lengths} 米。`,
        metrics:[['与环线夹角（图测）','约 '+Math.round(angle)+'°'],['短带区总宽（图测）','约 '+f.width.toFixed(2)+' m'],['每排短带',f.strips+' 条，单条约 '+f.stripWidth.toFixed(2)+' m']]};
    }
    return {sheet:s.reference,parts:s.partsSheet,note:'当前布局按供包中心线示意。载入供包台复核版配套布局，可查看按图分排的窄带。',
      metrics:[['供包支路',s.feeds.length+' 路'],['供包台','五段式']]};
  }
  if(key==='overview' && selection==='空托盘原位剖视')return {...describe('pallet',d),note:'环线和滑槽淡化后，可在主站房原位看到拆盘机、旋转台、横向输送链和九条移载支路。'};
  if(key==='sorting' && selection==='收货扫码称重')return {sheet:d.site.reference,parts:eq?.receipts?'PR0020-F1004 至 F1007':d.site.receiptParts||'PR0020-F1004',note:'收货线将散件送过三面读码与体积测量装置，再由称重皮带计量。',metrics:[['条码识读','三面'],['称重皮带','1.60 × 0.80 m'],['输送面高度','0.80 m']]};
  if(key==='overview' && d.site?.floorOperations){
    const f=d.site.floorOperations,sheet=d.site.reference;
    if(selection==='整板交接地轨')return {sheet,parts:'PR0020-1001、F1013',note:'从两条整板交接辊道末端沿地面看，两组地轨基础一直延伸到待运区。',metrics:[['地轨基础',f.tracks.length+' 组'],['每组图注长度','100.5 m'],['图注间距','2.50 m']]};
    if(selection==='AGV 暂存工位')return {sheet,parts:'PR0020-F1018',note:'三排主货架和侧边交接位紧邻暂存皮带。潜伏式 AGV 可进入货架底部。车辆按平面图的停放位置展示。',metrics:[['图示货架',f.agv.stands.length+' 位'],['侧向交接位',f.agv.handover.length+' 位'],['图示 AGV',f.agv.vehicles.length+' 台']]};
    if(selection==='待运区与复重秤')return {sheet,parts:'PR0020-F1022、F1023',note:'圆角边线圈出图示理货和待运范围。复重秤旁是磅房和业务用房，场坪上保留拖车停靠位置与作业空间。',metrics:[['复重秤',d.site.reweigh.length+' 台'],['相邻用房',f.booths.length+' 组'],['图示拖斗',f.tow.dollies.length+' 节']]};
    if(selection==='利旧作业平台')return {sheet,parts:'PR0020-1001 利旧设备图层',note:'平台一侧为滚珠台面，上有六处图示摆位。台面外形按平面图定位，高度与滚珠外观用于演示。',metrics:[['平台','1 处'],['台面图示摆位',f.existing.positions.length+' 处']]};
    return {sheet,parts:'PR0020-1001、F1013、F1018、F1022',note:'两组地轨从整板交接辊道延伸至场坪。理货、待运区域按图保留作业空间。斜线区只展开到工艺占地。点场内标签可放大各工位。',metrics:[['装卸月台',d.dock.levellers.length+' 处'],['打板台位',d.tables.places.length+' 处'],['空托盘支路',d.pallet.tails.length+' 路']]};
  }
  if(key==='sorting' && eq){
    if(selection==='排队与供包接头')return {sheet:d.sorter.reference,parts:'PR0020-F1009 至 F1011、F1013',note:'包裹从分配主线转入排队皮带。排队带末端斜切，整幅承载面贴到五段供包台侧边，包裹在接缝上转向。',metrics:[['供包支路',d.sorter.feeds.length+' 路'],['排队皮带宽','1.20 m'],['排队带高度','3.55 m']]};
    if(selection==='分配线末端滑板')return {sheet:d.sorter.reference,parts:'PR0020-F1009',note:'分配线的最后一段接 D01-022 小滑板。旁边较低的平行带承接来件，两条带在另一端折返。',metrics:[['设备编号','D01-022'],['滑板长 × 宽','0.90 × 1.20 m'],['入口 / 出口','3.55 / 3.08 m']]};
    if(selection==='暂存与汇流')return {sheet:d.sorter.reference,parts:'PR0020-F1016 至 F1018',note:'三道暂存带与一道回送带通过端部移载台交接。旁侧汇流线爬升后，从侧面把包裹送上分配主线。',metrics:[['暂存 / 回送','3 道 / 1 道'],['双向移载台','10 台'],['暂存带高度','0.80 m']]};
  }
  if(key==='pallet')return {sheet:d.pallet.reference,parts:d.pallet.partsSheet,note:'平面塑料托盘拆垛后转向。九台链条输送机分两组横向输送，各支路在 0.80 米处用顶升滚筒接盘。',metrics:[['拆盘机 / 旋转台','各 2 台'],['横向链条输送机',d.pallet.transfers.length+' 台'],['托盘尺寸','1.20 × 1.00 m']]};
  if(key==='dock')return {sheet:d.dock.reference,parts:d.dock.partsSheet,note:'叉车经调平台卸货。整板交接台升到 0.508 米，与固定辊道对平后按 18 米/分交板。',metrics:[['汽车调平台',d.dock.levellers.length+' 台'],['升降交接台',d.dock.handoffs.length+' 台'],['固定辊道',d.dock.handoffs.reduce((n,s)=>n+s.length-2,0)+' 台']]};
  if(key==='tables')return {sheet:d.tables.reference,parts:d.tables.partsSheet,note:'叉车把托货送到打板台旁，作业员逐箱组板，成板后系网。台位按图定位，货物与人员为作业示意。',metrics:[['图示台位',d.tables.places.length+' 处'],['台面',d.tables.size.join(' × ')+' m'],['台高',d.tables.height+' m']]};
  if(key==='overview')return {sheet:d.sorter.reference,parts:d.dock.partsSheet+'、'+d.tables.partsSheet,note:'青绿色线标出环线下方的空托盘路径。点「下层空托盘」在原位看拆盘、转向和九条支路，再用总览范围返回全场。',metrics:[['装卸月台',d.dock.levellers.length+' 处'],['打板台位',d.tables.places.length+' 处'],['空托盘支路',d.pallet.tails.length+' 路']]};
  if(key==='chutes')return {sheet:d.sorter.reference,parts:d.sorter.partsSheet,note:'九道滑槽末端带平段。环内第二支路转弯标高 1.50 米。第一支路 S01-103 的平面标长与设备表有差异，演示按平面定位，标高衔接待确认。',metrics:[['滚筒滑槽',d.sorter.chutes.length+' 道'],['入口高度',d.sorter.chuteTop.toFixed(2)+' m'],['末端高度',d.sorter.chuteBottom.toFixed(2)+' m']]};
  return {sheet:d.sorter.reference,parts:d.sorter.partsSheet,note:'收货线完成扫码、测体积和称重。三路五段供包台斜向交件，环线上另设一台五面读码器。',metrics:[['环线小车',d.sorter.carts+' 台'],['五段供包台',d.sorter.feeds.length+' 路'],['输送面高度',d.sorter.deck.toFixed(2)+' m']]};
}

export default function CargoApp(){
  const canvas=useRef(null), engine=useRef(null);
  const [data,setData]=useState(null),[status,setStatus]=useState('正在读取工艺图纸…'),[error,setError]=useState('');
  const [view,setView]=useState('overview'),[mode,setMode]=useState('3d'),[focus,setFocus]=useState(-1);
  const [layer,setLayer]=useState('both');
  const [paused,setPaused]=useState(false),[speed,setSpeed]=useState(1);
  const [filmAction,setFilmAction]=useState('');
  useEffect(()=>{
    let active=true,scene;
    openCargo(canvas.current,s=>active && setStatus(s)).then(value=>{
      scene=value;if(!active){scene.dispose();return;}
      engine.current=value;window.__cargo=value;document.title=value.data.title+' · 货站工艺演示';
      setData(value.data);setFocus(value.hall.operations?0:-1);setStatus('');
    }).catch(e=>{if(active){console.error(e);setError(e.message.includes('布局') || e.message.includes('尚未配置')?e.message:'设备模型或图纸加载失败。请检查本地资料并确认浏览器已启用图形加速。');}});
    return ()=>{active=false;scene?.dispose();if(window.__cargo===scene)delete window.__cargo;};
  },[]);
  const subject=equipmentView(view,layer);
  const panorama=view==='overview' && mode==='3d';
  function show(v=view,m=mode,i,nextLayer=v==='sorting' && v===view?layer:'both'){
    const selected=engine.current?.show(v,m,i,nextLayer) ?? -1;
    setView(v);setMode(m);setFocus(selected);setLayer(nextLayer);if(capture)setFilmAction('');
  }
  function selectLayer(next){
    if(next!==layer)show(view,mode,equipmentView(view,next)===subject?focus:-1,next);
  }
  const machines=engine.current?.plant;
  const inspection=engine.current?.inspectionCue;
  const replayCues=({pallet:machines?.pallet,sorting:machines?.sorting,chutes:machines?.sorting,dock:machines?.dockOps,tables:machines?.packing})[subject]?.cues;
  function replay(id,cue){
    const scene=engine.current;
    const stayOnLower=view==='sorting' && layer==='lower' && cue.view==='pallet';
    show(stayOnLower?view:cue.view,'3d',cue.focus);scene.seek(cue.time);
    scene.setSpeed(1);scene.setPaused(false);setSpeed(1);setPaused(false);
    if(capture)setFilmAction(replayLabels[id] || id);
  }
  const isMeter=data?.site && subject==='sorting' && focus===data.sorter.feeds.length;
  const active=views.find(([id])=>id===subject),devices=engine.current?.nav[subject]||[];
  const selection=mode==='3d'?devices[focus]?.label:undefined;
  const detail=data && describe(subject,data,selection);
  let reading=detail?.note;
  if(data && view==='sorting' && focus<0 && layer==='both')
    reading=`交叉带输送面高 ${data.sorter.deck.toFixed(2)} 米。环线下方的空托盘线向滑槽末端供盘，切换设备层可查看交接位置。`;
  if(data && view==='sorting' && layer==='lower' && Number.isFinite(data.pallet.chainDeck))
    reading=`拆盘后，托盘经旋转台进入 ${data.pallet.chainDeck.toFixed(2)} 米高的横向链条线，再由 ${data.pallet.deck.toFixed(2)} 米高的滚筒支路送到滑槽卸货侧。`;
  return <div className={'cargo-shell'+(capture?' cargo-film':panorama?' cargo-overview':'')}>
    <header className="cargo-header">
      <span className="cargo-brand"><Icon name="plane" size={24}/></span>
      <div><h1>{data?.title || '机场货站'}<span>货站工艺演示</span></h1><p>{data?.subtitle || '工艺布局'}</p></div>
      <span className="cargo-head-state"><i/>本地仿真</span>
    </header>
    <aside className="cargo-side"><h2>工艺区域</h2>
      <nav aria-label="工艺区域">{views.map(([id,name,sub,icon])=><button type="button" key={id} data-area={id} aria-pressed={view===id} onClick={()=>show(id,mode)} disabled={!data}>
        <Icon name={icon} size={20}/><span><strong>{name}</strong><small>{sub}</small></span></button>)}</nav>
      {detail && <section className="cargo-facts"><h3>设备资料</h3><dl>{detail.metrics.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl><small>设备表　{detail.parts}</small>
        <details><summary>模型来源</summary><p>叉车、纸箱、货车内的木托盘和入口滚筒使用 NVIDIA SimReady 资产，由 CodePawl 转换。空托盘线采用设备表 N04 的平面塑料托盘。收货安检使用通用机体和项目工作台模型。货物摆放及作业节拍为演示设定。</p>
          <a href={manifest.source.datasetUrl+'/tree/'+manifest.source.revision} target="_blank" rel="noreferrer">资产版本</a> · <a href={manifest.source.licenseUrl} target="_blank" rel="noreferrer">CC BY 4.0</a></details></section>}
    </aside>
    <main className="cargo-main"><canvas ref={canvas} tabIndex={data && panorama?0:-1} aria-label={panorama?'主站房全景自由视角':'货站物流设备三维视窗'}/>
      {detail && <div className="cargo-caption"><span>{detail.sheet.sheet}　·　1∶{detail.sheet.scale}</span><h2>{selection || (view==='overview' && mode==='3d'?'主站房作业联动':active[1])}</h2>
        {data?.site?.floorOperations && view==='overview' && mode==='3d' && focus<1 &&
          <small className="cargo-floor-key"><i/>理货与待运 <b/>仅示作业占地</small>}
        {panorama && <details className="cargo-camera-help"><summary>自由视角操作</summary>
          <p>左键拖动旋转，右键拖动平移，滚轮朝指针位置缩放。</p>
          <p>点一下场景，用 W / S 前后移动，A / D 左右移动，Q 降低，E 升高。</p>
          <p>触屏可单指旋转，双指平移或捏合缩放。</p>
        </details>}
        {view==='sorting' && <div className="cargo-layers" role="group" aria-label="设备分层">{layers.map(([id,label])=>
          <button key={id} type="button" data-layer={id} aria-pressed={layer===id} onClick={()=>selectLayer(id)}>{label}</button>)}</div>}
      </div>}
      <div className="cargo-projections" role="group" aria-label="查看方式">{modes.map(([id,name])=><button key={id} type="button" data-projection={id} aria-pressed={mode===id}
        onClick={()=>{if(!(panorama && id===mode))show(view,id,view==='overview' && id==='3d'?undefined:focus);}} disabled={!data}>{name}</button>)}</div>
      {data && view==='overview' && mode==='3d' && <div className="cargo-map-tags">
        {[['pallet','下层空托盘','overview',1],['dock','装卸交接','dock',-1],['sorting','自动分拣环线','sorting',-1],['tables','组板作业','tables',engine.current.packingLabel],
          ...(data.site?[['meter','收货计量','sorting',data.sorter.feeds.length]]:[]),
          ...(inspection && focus!==inspection.focus?[['inspection','收货安检','overview',inspection.focus]]:[]),
          ...(data.site?.floorOperations?[['tracks','整板交接地轨','overview',2],['agv','AGV 暂存','overview',3],
            ['apron','待运与复重','overview',4],['legacy','利旧平台','overview',5]]:[])].map(([id,label,area,target])=>
          <button key={id} type="button" data-tag={id} ref={el=>engine.current?.tag(id,el)} onClick={()=>show(area,'3d',target)}>{label}</button>)}</div>}
      {mode==='overlay' && <div className="cargo-legend">
        {subject!=='pallet' && <><i/>设备中心线及轮廓</>}
        {layer!=='upper' && ['sorting','chutes','pallet','overview'].includes(subject) && <><i className="cargo-lower"/>空托盘线</>}
        <b/>工艺图线</div>}
      {data && view==='overview' && mode==='3d' && <div className="cargo-flow" aria-label="作业流程">
        <div><span>散件</span>{(data.site?[['收货计量',machines.sorting.cues.meter]]:[]).concat([
          ...(inspection?[['收货安检',inspection]]:[]),
          ['斜向供包',machines.sorting.cues.feed],['滑槽卸载',machines.sorting.cues.unload],['格口码盘',machines.sorting.cues.stack]]).map(([name,cue],i)=>
          <button key={name} type="button" onClick={()=>replay(name,cue)}>{i>0 && <i aria-hidden="true">→</i>}{name}</button>)}</div>
        <div><span>板货</span>{[['叉车送料',machines.packing.cues.supply],['组板',machines.packing.cues.build],['整板交接',machines.dockOps.cues.handoff]].map(([name,cue],i)=>
          <button key={name} type="button" onClick={()=>replay(name,cue)}>{i>0 && <i aria-hidden="true">→</i>}{name}</button>)}</div>
      </div>}
      {mode==='3d' && replayCues && <div className="cargo-replay" role="group" aria-label="工艺动作回放">
        <span>动作回放</span>{Object.entries(replayCues).filter(([,cue])=>layer!=='upper' || cue.view==='sorting').map(([id,cue])=>
          <button type="button" key={id} data-cue={id} onClick={()=>replay(id,cue)}>{replayLabels[id]}</button>)}</div>}
      {data && engine.current.missingCartons>0 && <div className="cargo-asset-notice" role="status">
        有 {engine.current.missingCartons} 款纸箱未载入，正在使用已有纸箱演示。</div>}
      {data && data.sorter.chuteFlat===undefined && !engine.current.missingCartons && <div className="cargo-asset-notice" role="status">当前载入旧版布局。更新项目配套资料后可查看本次复核的尺寸。</div>}
      {(status && !data || error) && <div className="cargo-loading" role={error?'alert':'status'}>{error || status}
        {error && <button type="button" onClick={()=>location.reload()}>重新加载</button>}</div>}
    </main>
    <footer className="cargo-bottom"><div className="cargo-reading"><strong>{mode==='3d'?(selection==='收货安检'?'货物过机与人工复核':isMeter?'收货计量工位':active[2]):mode==='paper'?'工艺图纸局部':'图模位置对照'}</strong>
      <span>{mode==='3d'?reading:mode==='paper' && view==='sorting'?'原图保留图面上的全部线条。可用滚轮放大、拖动平移。':'按图纸原方向俯视，可用滚轮放大、拖动平移。'}</span></div>
      <div className="cargo-actions">
        {devices.length>0 && (view!=='overview' || mode==='3d') && <select aria-label={view==='overview'?'总览范围':'设备定位'} value={focus} onChange={e=>show(view,mode,Number(e.target.value))}>
          <option value={-1}>{view==='overview'?'重点工位联动':['dock','tables'].includes(view) && mode==='3d'?'作业视角':'区域全貌'}</option>{devices.map((x,i)=><option key={x.label} value={i}>{x.label}</option>)}</select>}
        {mode==='3d' && <><button type="button" disabled={!data} onClick={()=>{engine.current?.setPaused(!paused);setPaused(!paused);}}>
          <Icon name={paused?'play':'pause'} size={16}/>{paused?'继续':'暂停'}</button>
          <select aria-label="演示倍速" value={speed} onChange={e=>{const s=Number(e.target.value);setSpeed(s);engine.current?.setSpeed(s);}}>
            {[.5,1,2,4].map(s=><option key={s} value={s}>{s} 倍速</option>)}</select></>}
        <button type="button" aria-label={panorama?'回到全场':'重置视角'} title={panorama?'回到全场':'重置视角'} disabled={!data} onClick={()=>panorama?show('overview','3d',0):show()}><Icon name="home" size={17}/>{panorama && '回到全场'}</button>
      </div>
    </footer>
    {capture && detail && <div className="cargo-slate"><small>{data.title}　/　货站工艺</small><strong>{filmAction || active[1]}</strong><span>{detail.sheet.sheet}　·　{active[2]}</span></div>}
  </div>;
}
