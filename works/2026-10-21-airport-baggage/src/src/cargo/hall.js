import * as T from 'three';
import {amber,batch,dark,frame,metal,platform,side,steel} from './hardware.js';
import {dressStaging,fitReceipt,parcelBuffer} from './workcells.js';

const concrete=metal('#97a49f',.92,.01),fascia=metal('#53666d',.76,.25),wall=metal('#c8ceca',.80,.11);
const pale=metal('#e4ddbf',.88,0),glazing=metal('#62818a',.28,.55),ochre=metal('#d5a23c',.79,.09);
const yard=metal('#677977',.96,.02),joint=metal('#9da8a2',.9,.02);
export function workingBounds(data){
  if(data.site)return data.site.bounds;
  const points=[...data.dock.levellers.map(i=>i.at.map((n,j)=>n+data.dockOffset[j])),
    ...data.tables.places.map(i=>i.at.map((n,j)=>n+data.tables.offset[j]))];
  return [[Math.min(...points.map(p=>p[0]))-7,Math.min(...points.map(p=>p[1]))-1.5],
    [Math.max(...points.map(p=>p[0]))+7,Math.max(...points.map(p=>p[1]))+9]];
}
function panelSign(text,width){
  const canvas=document.createElement('canvas');canvas.width=384;canvas.height=112;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#26454b';ctx.fillRect(0,0,384,112);
  ctx.fillStyle='#efb24f';ctx.fillRect(0,0,12,112);ctx.fillStyle='#f3f2e9';ctx.font='bold 62px "Microsoft YaHei",sans-serif';
  ctx.textBaseline='middle';ctx.textAlign='center';ctx.fillText(text,196,57);
  const tex=new T.CanvasTexture(canvas);tex.colorSpace=T.SRGBColorSpace;
  return new T.Mesh(new T.PlaneGeometry(width,width*112/384),new T.MeshBasicMaterial({map:tex,toneMapped:false,side:T.DoubleSide}));
}
function iColumn(b,x,z,h){
  for(const dx of [-.22,.22])b.box(x+dx,h/2,z,.065,h,.51,wall);
  b.box(x,h/2,z,.44,h,.075,fascia);b.box(x,.13,z,.68,.26,.74,concrete);
  for(const sign of [-1,1])b.box(x+sign*.23,.49,z,.071,.59,.54,ochre);
}
function truss(b,x0,x1,y,z){
  const bay=(x1-x0)/8;
  b.beam([x0,y,z],[x1,y,z],.18,.19,fascia);b.beam([x0,y+.91,z],[x1,y+.91,z],.24,.16,wall);
  for(let k=0;k<8;k++)b.beam([x0+k*bay,y+(k%2)*.9,z],[x0+(k+1)*bay,y+((k+1)%2)*.9,z],.11,.12,fascia);
}
function surface(group,points,material){
  const shape=new T.Shape(points.map(([x,z])=>new T.Vector2(x,-z)));
  const slab=new T.Mesh(new T.ShapeGeometry(shape),material);slab.rotation.x=-Math.PI/2;
  slab.position.y=-.006;slab.receiveShadow=true;group.add(slab);
}
function groundBay(b,x,z,w,d){
  for(const sign of [-1,1]){
    b.box(x+sign*w/2,.012,z,.091,.018,d,pale);b.box(x,.012,z+sign*d/2,w,.018,.091,pale);
  }
}
function servicePlatform(b,outline){
  const h=2.90;
  // Grating bars stop at the surveyed polygon. Open slots show the machinery below.
  for(const axis of [0,1]){
    const cross=1-axis,coords=outline.map(p=>p[axis]),step=axis===0?.15:.52;
    for(let at=Math.min(...coords)+step/2;at<Math.max(...coords);at+=step){
      const hits=[];
      outline.forEach((p,i)=>{
        const q=outline[(i+1)%outline.length];
        if((p[axis]<=at)===(q[axis]<=at))return;
        hits.push(p[cross]+(q[cross]-p[cross])*(at-p[axis])/(q[axis]-p[axis]));
      });
      hits.sort((a,c)=>a-c);
      for(let i=1;i<hits.length;i+=2){
        const span=hits[i]-hits[i-1],mid=(hits[i]+hits[i-1])/2;
        if(axis===0)b.box(at,h-.025,mid,.034,.05,span,steel);
        else b.box(mid,h-.046,at,span,.045,.028,steel);
      }
    }
  }
  outline.forEach(([x,z],i)=>{
    const [xx,zz]=outline[(i+1)%outline.length];
    b.beam([x,h-.14,z],[xx,h-.14,zz],.12,.22,frame);
    const n=Math.ceil(Math.hypot(xx-x,zz-z)/4.5);
    for(let k=0;k<n;k++){
      const px=x+(xx-x)*k/n,pz=z+(zz-z)*k/n;
      b.box(px,(h-.18)/2,pz,.125,h-.18,.125,frame);b.box(px,.035,pz,.28,.07,.28,steel);
    }
  });
  // The single stair on this platform projects 3.21 m north, 4.23 m west of the NE corner.
  const [east,zTop]=outline[1],xStair=east-4.23,run=3.21,width=.8,steps=16;
  for(let i=0;i<steps;i++){
    const z=zTop-run+run*(i+.5)/steps,y=h*(i+1)/steps;
    b.box(xStair,y-.024,z,width,.048,run/steps,steel);
    b.box(xStair,y+.001,z-run/(2*steps)+.012,width,.006,.024,ochre);
  }
  for(const sign of [-1,1]){
    const x=xStair+sign*(width/2+.029);
    b.beam([x,.10,zTop-run],[x,h-.06,zTop],.06,.14,frame);
    for(const t of [0,.5,1]){
      const y=h*t,z=zTop-run+run*t;
      b.box(x,y+.49,z,.035,.98,.035,side);
    }
    for(const lift of [.53,.99])b.beam([x,lift,zTop-run],[x,h+lift,zTop],.044,.044,ochre);
  }
}
export function createHall(data,assets,texture){
  const group=new T.Group(),b=batch(group),[[x0,z0],[x1,z1]]=workingBounds(data),w=x1-x0,d=z1-z0;
  const mx=(x1+x0)/2;
  const dockUpper=new T.Group(),upper=batch(dockUpper);group.add(dockUpper);
  const bays=data.dock.levellers.map(t=>({id:t.id,x:t.at[0]+data.dockOffset[0],z:t.at[1]+data.dockOffset[1]}));
  const dockZ=bays[0].z-data.dock.levelSize[1]/2;
  const packingPaint=metal('#718f84',.95,.02),dockPaint=metal('#82969b',.95,.02),sortPaint=metal('#788d95',.93,.02);
  // Cut the receiving pits through both the slab and its painted surface.
  const pits=data.dock.handoffs.map(([a,c])=>({
    x:a[0]+data.dockOffset[0],start:a[1]+data.dockOffset[1]-.06,end:c[1]+data.dockOffset[1]+.06
  })).sort((a,c)=>a.x-c.x);
  function slab(left,right,front,back){
    if(right<=left || back<=front)return;
    b.box((left+right)/2,-.61,(front+back)/2,right-left,1.19,back-front,concrete);
    const paintEnd=Math.min(back,dockZ+6.3);
    if(front<paintEnd)surface(group,[[left,front],[right,front],[right,paintEnd],[left,paintEnd]],dockPaint);
  }
  let slabLeft=x0;
  for(const pit of pits){
    const half=data.dock.rollerWidth/2+.10,left=pit.x-half,right=pit.x+half;
    slab(slabLeft,left,dockZ,z1);slab(left,right,dockZ,pit.start);slab(left,right,pit.end,z1);
    b.box(pit.x,-1.61,(pit.start+pit.end)/2,half*2,.10,pit.end-pit.start,fascia);
    slabLeft=right;
  }
  slab(slabLeft,x1,dockZ,z1);
  const contextPaint=metal('#a0adab',.96,.02),hatching=metal('#8b9e9b',.97,.01);
  for(const [[a,c],[v,f]] of data.site?.contextZones||[]){
    surface(group,[[a,c],[v,c],[v,f],[a,f]],contextPaint);
    const depth=f-c;
    for(let off=-depth;off<v-a;off+=1.65){
      const start=Math.max(0,-off),end=Math.min(depth,v-a-off);if(end<=start)continue;
      b.beam([a+off+start,.003,c+start],[a+off+end,.003,c+end],.078,.010,hatching);
    }
  }
  for(const poly of data.site?.packingZones||[])surface(group,poly,packingPaint);
  const ring=data.sorter,sw=Math.abs(ring.right-ring.left)+2*ring.radius+4.5;
  const chutes=ring.chutes,sz=(chutes[0][1][1]-ring.radius-2)/2,sd=chutes[0][1][1]+ring.radius+3.0;
  surface(group,[[-sw/2,sz-sd/2],[sw/2,sz-sd/2],[sw/2,sz+sd/2],[-sw/2,sz+sd/2]],sortPaint);
  groundBay(b,0,sz,sw,sd);
  const apronDepth=14;
  b.box(mx,-1.23,dockZ-apronDepth/2,w,.30,apronDepth,yard);
  b.box(mx,-.63,z1,w,1.19,.20,fascia);
  for(let x=x0+6;x<x1;x+=6){
    const pit=pits.find(p=>Math.abs(x-p.x)<data.dock.rollerWidth/2+.10),start=pit?pit.end:dockZ;
    b.box(x,-.021,(start+z1)/2,.017,.016,z1-start,joint);
  }
  for(let z=dockZ+6;z<z1;z+=6){
    let left=x0;
    for(const pit of pits.filter(p=>p.start<z && z<p.end)){
      const edge=pit.x-data.dock.rollerWidth/2-.10;
      b.box((left+edge)/2,-.021,z,edge-left,.016,.017,joint);left=pit.x+data.dock.rollerWidth/2+.10;
    }
    b.box((left+x1)/2,-.021,z,x1-left,.016,.017,joint);
  }
  if(texture && data.site){
    const r=data.site.reference;const mesh=new T.Mesh(new T.PlaneGeometry(r.width,r.depth),
      new T.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,opacity:.7,toneMapped:false}));
    mesh.rotation.x=-Math.PI/2;mesh.position.set(r.centre[0],.006,r.centre[1]);group.add(mesh);
  }
  const equipment=data.site?.distributionEquipment;
  const receiptDoors=(equipment?.receipts||[]).map(([x],i)=>({id:'收货 '+(i+1),x,width:3.1}));
  const gates=[...bays.map(b=>({...b,width:3.25})),...data.dock.handoffs.map((row,i)=>({id:'交接 '+(i+1),x:row[0][0]+data.dockOffset[0],width:3.60})),...receiptDoors].sort((a,c)=>a.x-c.x);
  function rearWall(a,c){
    if(c<=a)return;
    upper.box((a+c)/2,2.52,dockZ,c-a,3.20,.19,wall);
    b.box((a+c)/2,.46,dockZ+.02,c-a,.92,.22,fascia);
    for(let x=a+.8;x<c;x+=1.55)upper.box(x,2.51,dockZ+.105,.029,2.87,.035,concrete);
  }
  let last=x0;
  for(const gate of gates){
    const half=gate.width/2;rearWall(last,gate.x-half);last=gate.x+half;
    for(const s of [-1,1]){
      b.box(gate.x+s*(half+.09),1.76,dockZ,.20,3.52,.44,dark);
      b.box(gate.x+s*(half-.06),-.52,dockZ-.15,.24,.78,.23,dark);
      b.roller([gate.x+s*(half+.37),.04,dockZ+.52],[gate.x+s*(half+.37),.86,dockZ+.52],.073,ochre);
      b.box(gate.x+s*1.61,-1.071,dockZ-5.8,.055,.017,10.5,pale);
    }
    b.box(gate.x,3.73,dockZ,gate.width+.35,.54,.44,dark);
    for(let k=0;k<3;k++)b.box(gate.x,3.5+k*.09,dockZ+.235,gate.width,.041,.04,steel);
    const placard=panelSign(gate.id.replace('A01-',''),1.55);
    placard.position.set(gate.x,4.24,dockZ+.17);group.add(placard);
  }
  rearWall(last,x1);
  upper.box(mx,4.27,dockZ,w,.53,.24,wall);upper.box(mx,4.95,dockZ,w,.84,.17,glazing);
  upper.box(mx,5.48,dockZ,w,.21,.31,fascia);
  for(let x=x0+.5;x<=x1;x+=4.1)upper.box(x,4.96,dockZ,.095,.93,.22,wall);
  for(const x of [x0,x1]){
    b.box(x,.46,(dockZ+z1)/2,.22,.92,z1-dockZ,wall);
    b.box(x,.94,(dockZ+z1)/2,.34,.085,z1-dockZ,fascia);
  }
  for(const x of [x0,x1]){
    const sign=x===x0?1:-1;
    for(let a=dockZ;a<z1-6;a+=12){
      const end=Math.min(a+12,z1-6),height=a<dockZ+30?5.30:a<dockZ+62?3.45:1.35;
      b.box(x,height/2,(a+end)/2,.18,height,end-a,wall);
      b.box(x+sign*.10,.50,(a+end)/2,.06,.42,end-a,fascia);
      if(height>2){
        b.box(x+sign*.105,height-.58,(a+end)/2,.05,.68,end-a-.32,glazing);
        for(let zz=a+2;zz<end;zz+=2.5)b.box(x+sign*.14,height-.58,zz,.08,.73,.085,wall);
      }
      b.box(x,height+.05,(a+end)/2,.28,.12,end-a,fascia);
      iColumn(b,x+(sign*.15),a,height+.1);
    }
  }
  // The roof is cut away. Only a narrow rear strip is shown, so the handling floor remains visible.
  const col=data.site?.columns || [];
  for(const [x,z] of col)iColumn(b,x,z,5.6);
  const majorX=[...new Set(col.map(p=>Math.round(p[0]*2)/2))].sort((a,c)=>a-c);
  const piers=[x0,...majorX.filter((x,i)=>x>x0+2 && x<x1-2 && (!i || x-majorX[i-1]>1.5)),x1];
  for(let i=1;i<piers.length;i++){
    const a=piers[i-1],c=piers[i];truss(upper,a,c,5.08,dockZ+2.8);
    upper.box((a+c)/2,6.09,dockZ+.98,c-a,.11,3.93,wall);
    upper.beam([a,4.5,dockZ],[a,5.54,dockZ+2.8],.16,.16,fascia);
  }
  // Cutaway roof structure is a visual interpretation of the registered column axes.
  const overhead=new T.Group(),rafters=batch(overhead);group.add(overhead);
  const rows=[...new Set(col.map(p=>Math.round(p[1]*2)/2))].sort((a,c)=>a-c);
  for(const x of piers.slice(1,-1)){
    const matches=col.filter(([xx])=>Math.abs(xx-x)<.55).map(p=>p[1]).sort((a,c)=>a-c);
    let start=dockZ;
    for(const end of matches){
      if(end-start<3)continue;
      const count=Math.ceil((end-start)/3.2),step=(end-start)/count;
      rafters.beam([x,5.62,start],[x,5.62,end],.15,.19,fascia);
      rafters.beam([x,6.47,start],[x,6.47,end],.19,.18,wall);
      for(let k=0;k<count;k++)rafters.beam([x,5.63+k%2*.84,start+k*step],[x,5.63+(k+1)%2*.84,start+(k+1)*step],.09,.10,fascia);
      start=end;
    }
  }
  for(const z of rows){
    const match=col.filter(p=>Math.abs(p[1]-z)<.55).sort((a,c)=>a[0]-c[0]);
    if(match.length>1)rafters.beam([match[0][0],5.62,z],[match.at(-1)[0],5.62,z],.15,.22,fascia);
  }
  rafters.finish();
  if(data.site){
    dressStaging(b,data.site);
    for(const [x,z] of data.site.floorScales||[]){
      b.box(x,.009,z,4,.024,4,platform);
      for(const sign of [-1,1]){
        b.box(x+sign*1.98,.025,z,.035,.009,4,steel);
        b.box(x,.025,z+sign*1.98,4,.009,.035,steel);
      }
    }
    for(const [x,z] of data.site.reweigh){
      b.box(x,.012,z,4,.026,8,platform);
      for(const sign of [-1,1])b.box(x+sign*1.97,.035,z,.058,.021,7.98,amber);
      b.box(x+2.22,.61,z,.11,1.22,.11,side);b.box(x+2.22,1.33,z,.49,.29,.19,dark);
    }
  }
  const receipts=equipment?.receipts?equipment.receipts.map((at,i)=>fitReceipt(group,at,assets,[3.15,.80,2.65][i],i,dockZ)):
    data.site?[fitReceipt(group,data.site.receipt,assets)]:[];
  if(equipment?.serviceDeck)servicePlatform(b,equipment.serviceDeck);
  if(equipment?.receipts){
    const first=receipts[0],last=receipts.at(-1),left=first.at[0]-.68,right=last.at[0]+.68;
    const front=first.at[1]+first.end,back=equipment.sources[0][0][1],middle=(front+back)/2;
    // A single diagram volume joins the six external interfaces. Its interior is unspecified.
    const cap=2.35,midX=(left+right)/2;
    const region=new T.Mesh(new T.BoxGeometry(right-left,cap,back-front),
      new T.MeshBasicMaterial({color:'#819a98',transparent:true,opacity:.24,depthWrite:false}));
    region.position.set(midX,cap/2,middle);group.add(region);
    const edge=new T.LineSegments(new T.EdgesGeometry(region.geometry),new T.LineBasicMaterial({color:'#688380'}));
    region.add(edge);
    for(const x of [left,right])for(let z=front;z<back;z+=1.25){
      const length=Math.min(.8,back-z);b.box(x,.016,z+length/2,.056,.016,length,ochre);
    }
    const faces=[...receipts.map(({at,end})=>[at[0],at[1]+end,.8,.8]),
      ...equipment.sources.map(path=>[path[0][0],path[0][1],path[0][2],1.2])];
    for(const [x,z,h,w] of faces){
      for(const sign of [-1,1])b.box(x+sign*(w/2+.09),h+.34,z,.085,.82,.13,fascia);
      b.box(x,h+.76,z,w+.26,.08,.13,fascia);
    }
    const sign=panelSign('上游工序示意',4.15);
    sign.rotation.x=-Math.PI/2;sign.position.set(midX,cap+.025,middle);group.add(sign);
  }
  const buffer=equipment?parcelBuffer(group,b,data.site,data.sorter,assets):null;
  b.finish();upper.finish();
  return {group,meter:receipts[0],receipts,buffer,overhead,dockUpper,bounds:[[x0,dockZ-apronDepth],[x1,z1]]};
}
