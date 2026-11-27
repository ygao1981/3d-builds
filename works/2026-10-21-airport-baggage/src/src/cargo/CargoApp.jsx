import {useEffect,useRef,useState} from 'react';
import {Icon} from '../ui/icons.jsx';
import {openCargo} from './scene.js';
import manifest from '../simready-assets.json';
import './cargo.css';

const views=[
  ['sorting','自动分拣环线','交叉带与供包台','orbit'],
  ['chutes','滑槽卸载','滚筒滑槽与回流线','shuffle'],
  ['pallet','空托盘系统','拆盘、转向与移载','box'],
  ['dock','装卸交接','调平台与交接辊道','site'],
  ['tables','组板作业','移动打板台图示台位','box'],
  ['overview','主站房位置对照','分拣、空托盘、装卸与组板','target'],
];
const modes=[['3d','三维演示'],['overlay','图纸叠合'],['paper','工艺原图']];
const capture=new URLSearchParams(location.search).has('capture');

function describe(key,d){
  if(key==='pallet')return {sheet:d.pallet.reference,parts:d.pallet.partsSheet,note:'空托盘由两侧送入，经拆盘机、旋转台和横向链条线，分配到各滚筒支路。',metrics:[['拆盘机',d.pallet.stackers.length+' 台'],['旋转台',d.pallet.turns.length+' 台'],['移载支路',d.pallet.transfers.length+' 路']]};
  if(key==='dock')return {sheet:d.dock.reference,parts:d.dock.partsSheet,note:'沿图纸横向排列汽车调平台。整板箱交接辊道及其后续滚道单独布置，可按设备编号定位。',metrics:[['汽车调平台',d.dock.levellers.length+' 台'],['交接辊道',d.dock.handoffs.length+' 路'],['辊道输送机',d.dock.handoffs.reduce((n,s)=>n+s.length-2,0)+' 台']]};
  if(key==='tables')return {sheet:d.tables.reference,parts:d.tables.partsSheet,note:'台位取自工艺平面图上的移动分解组合台符号。设备可移动，图示摆位数量与采购数量分别统计。',metrics:[['图示台位',d.tables.places.length+' 处'],['台面',d.tables.size.join(' × ')+' m'],['台高',d.tables.height+' m']]};
  if(key==='overview')return {sheet:d.sorter.reference,parts:d.dock.partsSheet+'、'+d.tables.partsSheet,note:'四组设备按主站房平面图定位。分拣环线位于上层，下方的空托盘线还可切换到放大详图查看。',metrics:[['同图展示','4 组设备'],['依据','主站房平面图']]};
  if(key==='chutes')return {sheet:d.sorter.reference,parts:d.sorter.partsSheet,note:'包裹随小车到达格口后横向卸载，从倾斜滚筒滑槽进入末端平段。环内两条输送支路按平面走向建模。',metrics:[['滚筒滑槽',d.sorter.chutes.length+' 道'],['入口高度',d.sorter.chuteTop.toFixed(2)+' m'],['末端高度',d.sorter.chuteBottom.toFixed(2)+' m']]};
  return {sheet:d.sorter.reference,parts:d.sorter.partsSheet,note:'斜向供包台将包裹送上环形交叉带。小车水平运行，在对应滑槽前横向卸件。',metrics:[['环线小车',d.sorter.carts+' 台'],['五段供包台',d.sorter.feeds.length+' 路'],['输送面高度',d.sorter.deck.toFixed(2)+' m']]};
}

export default function CargoApp(){
  const canvas=useRef(null), engine=useRef(null);
  const [data,setData]=useState(null),[status,setStatus]=useState('正在读取工艺图纸…'),[error,setError]=useState('');
  const [view,setView]=useState('sorting'),[mode,setMode]=useState('3d'),[focus,setFocus]=useState(-1);
  const [paused,setPaused]=useState(false),[speed,setSpeed]=useState(1);
  useEffect(()=>{
    let active=true,scene;
    openCargo(canvas.current,s=>active && setStatus(s)).then(value=>{
      scene=value;if(!active){scene.dispose();return;}
      engine.current=value;window.__cargo=value;document.title=value.data.title+' · 货站工艺演示';
      setData(value.data);setStatus('');
    }).catch(e=>{if(active){console.error(e);setError(e.message.includes('布局') || e.message.includes('尚未配置')?e.message:'设备模型或图纸加载失败。请检查本地资料并确认浏览器已启用图形加速。');}});
    return ()=>{active=false;scene?.dispose();if(window.__cargo===scene)delete window.__cargo;};
  },[]);
  function show(v=view,m=mode,i=-1){engine.current?.show(v,m,i);setView(v);setMode(m);setFocus(i);}
  const active=views.find(([id])=>id===view),detail=data && describe(view,data),devices=engine.current?.nav[view] || [];
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
        <details><summary>模型来源</summary><p>纸箱、木托盘和直线滚筒由 NVIDIA 制作，CodePawl 转换为 GLB，场景中按设备尺寸适配。其余设备按工艺图建模。</p>
          <a href={manifest.source.datasetUrl+'/tree/'+manifest.source.revision} target="_blank" rel="noreferrer">资产版本</a> · <a href={manifest.source.licenseUrl} target="_blank" rel="noreferrer">CC BY 4.0</a></details></section>}
    </aside>
    <main className="cargo-main"><canvas ref={canvas} aria-label="货站物流设备三维视窗"/>
      {detail && <div className="cargo-caption"><span>{detail.sheet.sheet}　·　1∶{detail.sheet.scale}</span><h2>{active[1]}</h2></div>}
      <div className="cargo-projections" role="group" aria-label="查看方式">{modes.map(([id,name])=><button key={id} type="button" data-projection={id} aria-pressed={mode===id} onClick={()=>show(view,id,focus)} disabled={!data}>{name}</button>)}</div>
      {mode==='overlay' && <div className="cargo-legend">
        {view!=='pallet' && <><i/>设备中心线及轮廓</>}
        {['sorting','chutes','pallet','overview'].includes(view) && <><i className="cargo-lower"/>空托盘线</>}
        <b/>工艺图线</div>}
      {(status && !data || error) && <div className="cargo-loading" role={error?'alert':'status'}>{error || status}
        {error && <button type="button" onClick={()=>location.reload()}>重新加载</button>}</div>}
    </main>
    <footer className="cargo-bottom"><div className="cargo-reading"><strong>{mode==='3d'?active[2]:mode==='paper'?'工艺图纸局部':'图模位置对照'}</strong>
      <span>{mode==='3d'?detail?.note:'按图纸原方向俯视，可用滚轮放大、拖动平移。'}</span></div>
      <div className="cargo-actions">
        {devices.length>0 && <select aria-label="设备定位" value={focus} onChange={e=>show(view,mode,Number(e.target.value))}>
          <option value={-1}>区域全貌</option>{devices.map((x,i)=><option key={x.label} value={i}>{x.label}</option>)}</select>}
        {mode==='3d' && <><button type="button" disabled={!data} onClick={()=>{engine.current?.setPaused(!paused);setPaused(!paused);}}>
          <Icon name={paused?'play':'pause'} size={16}/>{paused?'继续':'暂停'}</button>
          <select aria-label="演示倍速" value={speed} onChange={e=>{const s=Number(e.target.value);setSpeed(s);engine.current?.setSpeed(s);}}>
            {[.5,1,2,4].map(s=><option key={s} value={s}>{s} 倍速</option>)}</select></>}
        <button type="button" aria-label="重置视角" title="重置视角" disabled={!data} onClick={()=>show()}><Icon name="home" size={17}/></button>
      </div>
    </footer>
    {capture && detail && <div className="cargo-slate"><small>{data.title}　/　货站工艺</small><strong>{active[1]}</strong><span>{detail.sheet.sheet}　·　{active[2]}</span></div>}
  </div>;
}
