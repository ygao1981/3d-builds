import {useEffect,useRef,useState} from 'react';
import {Icon} from '../ui/icons.jsx';
import {openCargo} from './scene.js';
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
const replayLabels={feed:'斜向供包',unload:'滑槽卸载',stack:'格口人工码盘',release:'底部拆盘',turn:'托盘转向',transfer:'顶升移载',chain:'横向链条输送',meter:'收货扫码称重',distribute:'分流排队',truck:'货车卸货',raise:'交接台升降',handoff:'整板交接',build:'纸箱组板',supply:'叉车送料'};
const capture=new URLSearchParams(location.search).has('capture');

function describe(key,d){
  if(key==='pallet')return {sheet:d.pallet.reference,parts:d.pallet.partsSheet,note:'平面塑料托盘拆垛后转向。九台链条输送机分两组横向输送，各支路在 0.80 米处用顶升滚筒接盘。',metrics:[['拆盘机 / 旋转台','各 2 台'],['横向链条输送机',d.pallet.transfers.length+' 台'],['托盘尺寸','1.20 × 1.00 m']]};
  if(key==='dock')return {sheet:d.dock.reference,parts:d.dock.partsSheet,note:'叉车经调平台卸货。整板交接台升到 0.508 米，与固定辊道对平后按 18 米/分交板。',metrics:[['汽车调平台',d.dock.levellers.length+' 台'],['升降交接台',d.dock.handoffs.length+' 台'],['固定辊道',d.dock.handoffs.reduce((n,s)=>n+s.length-2,0)+' 台']]};
  if(key==='tables')return {sheet:d.tables.reference,parts:d.tables.partsSheet,note:'叉车把托货送到打板台旁，作业员逐箱组板，成板后系网。台位按图定位，货物与人员为作业示意。',metrics:[['图示台位',d.tables.places.length+' 处'],['台面',d.tables.size.join(' × ')+' m'],['台高',d.tables.height+' m']]};
  if(key==='overview')return {sheet:d.sorter.reference,parts:d.dock.partsSheet+'、'+d.tables.partsSheet,note:'点场内标签进入工位，或按散件、板货流程观看交接。地面斜线表示其他工艺占区。',metrics:[['装卸月台',d.dock.levellers.length+' 处'],['打板台位',d.tables.places.length+' 处'],['布局依据','主站房工艺平面图']]};
  if(key==='chutes')return {sheet:d.sorter.reference,parts:d.sorter.partsSheet,note:'九道滑槽末端带平段。环内第二支路转弯标高 1.50 米。第一支路 S01-103 的平面标长与设备表有差异，演示按平面定位，标高衔接待确认。',metrics:[['滚筒滑槽',d.sorter.chutes.length+' 道'],['入口高度',d.sorter.chuteTop.toFixed(2)+' m'],['末端高度',d.sorter.chuteBottom.toFixed(2)+' m']]};
  return {sheet:d.sorter.reference,parts:d.sorter.partsSheet,note:'收货线完成扫码、测体积和称重。三路五段供包台斜向交件，环线上另设一台五面读码器。',metrics:[['环线小车',d.sorter.carts+' 台'],['五段供包台',d.sorter.feeds.length+' 路'],['输送面高度',d.sorter.deck.toFixed(2)+' m']]};
}

export default function CargoApp(){
  const canvas=useRef(null), engine=useRef(null);
  const [data,setData]=useState(null),[status,setStatus]=useState('正在读取工艺图纸…'),[error,setError]=useState('');
  const [view,setView]=useState('overview'),[mode,setMode]=useState('3d'),[focus,setFocus]=useState(-1);
  const [paused,setPaused]=useState(false),[speed,setSpeed]=useState(1);
  const [filmAction,setFilmAction]=useState('');
  useEffect(()=>{
    let active=true,scene;
    openCargo(canvas.current,s=>active && setStatus(s)).then(value=>{
      scene=value;if(!active){scene.dispose();return;}
      engine.current=value;window.__cargo=value;document.title=value.data.title+' · 货站工艺演示';
      setData(value.data);setStatus('');
    }).catch(e=>{if(active){console.error(e);setError(e.message.includes('布局') || e.message.includes('尚未配置')?e.message:'设备模型或图纸加载失败。请检查本地资料并确认浏览器已启用图形加速。');}});
    return ()=>{active=false;scene?.dispose();if(window.__cargo===scene)delete window.__cargo;};
  },[]);
  function show(v=view,m=mode,i=-1){engine.current?.show(v,m,i);setView(v);setMode(m);setFocus(i);if(capture)setFilmAction('');}
  const machines=engine.current?.plant;
  const replayCues=({pallet:machines?.pallet,sorting:machines?.sorting,chutes:machines?.sorting,dock:machines?.dockOps,tables:machines?.packing})[view]?.cues;
  function replay(id,cue){
    const scene=engine.current;
    show(cue.view,'3d',cue.focus);scene.seek(cue.time);
    scene.setSpeed(1);scene.setPaused(false);setSpeed(1);setPaused(false);
    if(capture)setFilmAction(replayLabels[id]);
  }
  const isMeter=data?.site && view==='sorting' && focus===data.sorter.feeds.length;
  const active=views.find(([id])=>id===view),detail=isMeter?{sheet:data.site.reference,parts:data.site.receiptParts||'PR0020-F1001',note:'纸箱在收货线上经三面读码、体积测量与称重。五段供包台位于后续分拣工序，环线上另设五面读码器。',metrics:[['条码识读','三面'],['称重皮带','1.60 × 0.80 m'],['输送面高度','0.80 m']]}:data && describe(view,data),devices=engine.current?.nav[view] || [];
  return <div className={'cargo-shell'+(capture?' cargo-film':'')}>
    <header className="cargo-header">
      <span className="cargo-brand"><Icon name="plane" size={24}/></span>
      <div><h1>{data?.title || '机场货站'}<span>货站工艺演示</span></h1><p>{data?.subtitle || '工艺布局'}</p></div>
      <span className="cargo-head-state"><i/>本地仿真</span>
    </header>
    <aside className="cargo-side"><h2>工艺区域</h2>
      <nav aria-label="工艺区域">{views.map(([id,name,sub,icon])=><button type="button" key={id} data-area={id} aria-pressed={view===id} onClick={()=>show(id,mode)} disabled={!data}>
        <Icon name={icon} size={20}/><span><strong>{name}</strong><small>{sub}</small></span></button>)}</nav>
      {detail && <section className="cargo-facts"><h3>设备资料</h3><dl>{detail.metrics.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl><small>设备表　{detail.parts}</small>
        <details><summary>模型来源</summary><p>叉车、纸箱、货车内的木托盘和入口滚筒使用 NVIDIA SimReady 资产，由 CodePawl 转换。空托盘线采用设备表 N04 的平面塑料托盘。货物摆放、作业节拍及设备内部构造为演示设定。</p>
          <a href={manifest.source.datasetUrl+'/tree/'+manifest.source.revision} target="_blank" rel="noreferrer">资产版本</a> · <a href={manifest.source.licenseUrl} target="_blank" rel="noreferrer">CC BY 4.0</a></details></section>}
    </aside>
    <main className="cargo-main"><canvas ref={canvas} aria-label="货站物流设备三维视窗"/>
      {detail && <div className="cargo-caption"><span>{detail.sheet.sheet}　·　1∶{detail.sheet.scale}</span><h2>{isMeter?'收货扫码称重':view==='overview' && mode==='3d' && focus<0?'主站房作业联动':active[1]}</h2></div>}
      <div className="cargo-projections" role="group" aria-label="查看方式">{modes.map(([id,name])=><button key={id} type="button" data-projection={id} aria-pressed={mode===id} onClick={()=>show(view,id,focus)} disabled={!data}>{name}</button>)}</div>
      {data && view==='overview' && mode==='3d' && <div className="cargo-map-tags">
        {[['dock','装卸交接','dock',-1],['sorting','分拣与空托盘','sorting',-1],['tables','组板作业','tables',engine.current.packingLabel],
          ...(data.site?[['meter','收货计量','sorting',data.sorter.feeds.length]]:[])].map(([id,label,area,target])=>
          <button key={id} type="button" ref={el=>engine.current?.tag(id,el)} onClick={()=>show(area,'3d',target)}>{label}</button>)}</div>}
      {mode==='overlay' && <div className="cargo-legend">
        {view!=='pallet' && <><i/>设备中心线及轮廓</>}
        {['sorting','chutes','pallet','overview'].includes(view) && <><i className="cargo-lower"/>空托盘线</>}
        <b/>工艺图线</div>}
      {data && view==='overview' && mode==='3d' && <div className="cargo-flow" aria-label="作业流程">
        <div><span>散件</span>{(data.site?[['收货计量',machines.sorting.cues.meter]]:[]).concat([
          ['斜向供包',machines.sorting.cues.feed],['滑槽卸载',machines.sorting.cues.unload],['格口码盘',machines.sorting.cues.stack]]).map(([name,cue],i)=>
          <button key={name} type="button" onClick={()=>replay(name,cue)}>{i>0 && <i aria-hidden="true">→</i>}{name}</button>)}</div>
        <div><span>板货</span>{[['叉车送料',machines.packing.cues.supply],['组板',machines.packing.cues.build],['整板交接',machines.dockOps.cues.handoff]].map(([name,cue],i)=>
          <button key={name} type="button" onClick={()=>replay(name,cue)}>{i>0 && <i aria-hidden="true">→</i>}{name}</button>)}</div>
      </div>}
      {mode==='3d' && replayCues && <div className="cargo-replay" role="group" aria-label="工艺动作回放">
        <span>动作回放</span>{Object.entries(replayCues).map(([id,cue])=>
          <button type="button" key={id} data-cue={id} onClick={()=>replay(id,cue)}>{replayLabels[id]}</button>)}</div>}
      {data && engine.current.missingCartons>0 && <div className="cargo-asset-notice" role="status">
        有 {engine.current.missingCartons} 款纸箱未载入，正在使用已有纸箱演示。</div>}
      {data && data.sorter.chuteFlat===undefined && !engine.current.missingCartons && <div className="cargo-asset-notice" role="status">当前载入旧版布局。更新项目配套资料后可查看本次复核的尺寸。</div>}
      {(status && !data || error) && <div className="cargo-loading" role={error?'alert':'status'}>{error || status}
        {error && <button type="button" onClick={()=>location.reload()}>重新加载</button>}</div>}
    </main>
    <footer className="cargo-bottom"><div className="cargo-reading"><strong>{mode==='3d'?(isMeter?'收货计量工位':active[2]):mode==='paper'?'工艺图纸局部':'图模位置对照'}</strong>
      <span>{mode==='3d'?detail?.note:'按图纸原方向俯视，可用滚轮放大、拖动平移。'}</span></div>
      <div className="cargo-actions">
        {devices.length>0 && (view!=='overview' || mode==='3d') && <select aria-label={view==='overview'?'总览范围':'设备定位'} value={focus} onChange={e=>show(view,mode,Number(e.target.value))}>
          <option value={-1}>{view==='overview'?'重点工位联动':['dock','tables'].includes(view) && mode==='3d'?'作业视角':'区域全貌'}</option>{devices.map((x,i)=><option key={x.label} value={i}>{x.label}</option>)}</select>}
        {mode==='3d' && <><button type="button" disabled={!data} onClick={()=>{engine.current?.setPaused(!paused);setPaused(!paused);}}>
          <Icon name={paused?'play':'pause'} size={16}/>{paused?'继续':'暂停'}</button>
          <select aria-label="演示倍速" value={speed} onChange={e=>{const s=Number(e.target.value);setSpeed(s);engine.current?.setSpeed(s);}}>
            {[.5,1,2,4].map(s=><option key={s} value={s}>{s} 倍速</option>)}</select></>}
        <button type="button" aria-label="重置视角" title="重置视角" disabled={!data} onClick={()=>show()}><Icon name="home" size={17}/></button>
      </div>
    </footer>
    {capture && detail && <div className="cargo-slate"><small>{data.title}　/　货站工艺</small><strong>{filmAction || active[1]}</strong><span>{detail.sheet.sheet}　·　{active[2]}</span></div>}
  </div>;
}
