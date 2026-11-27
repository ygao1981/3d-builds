// Every pose is sampled from the demonstration clock so pausing, seeking and filming
// use exactly the same pallets and mechanism positions as normal playback.
const speed=.26, palletPitch=.145, stroke=.060;
const clamp=t=>Math.max(0,Math.min(1,t));
const ramp=(t,start,duration)=>clamp((t-start)/duration);
const smooth=t=>t*t*(3-2*t);
const length=(a,b)=>Math.hypot(b[0]-a[0],b[1]-a[1]);
const blend=(a,b,q)=>a+(b-a)*q;
const gripTime=.55, liftTime=.85, settleTime=1.1, swivelTime=2.1, transferTime=1.05;

function travel(object,from,to,u,height,yaw){
  object.position.set(blend(from[0],to[0],u),height,blend(from[1],to[1],u));
  object.rotation.y=yaw;
}

export function palletCycle(spec,index,objects){
  const {loads,jaws,turntable,lifts,ports}=objects;
  const turn=spec.turns[index], stack=spec.stackers[index], entry=spec.inlets[index];
  const sign=Math.sign(turn[0]-entry[0]), yaw=-sign*Math.PI/2;
  const start=[entry[0]+sign*.61,entry[1]],deck=spec.deck,low=deck-stroke;
  const arrival=length(start,stack)/speed, offset=index*23;
  const nearest=ports.reduce((a,b)=>length(spec.transfers[a],turn)<length(spec.transfers[b],turn)?a:b);
  const hub=spec.transfers[nearest];
  let cursor=arrival;
  const trips=ports.map((outlet,i)=>{
    const at=spec.transfers[outlet],tail=spec.tails[outlet],dist=length(at,tail);
    // Stop with the whole 1.2 m pallet supported on the final roller module.
    const stop=[blend(tail[0],at[0],.60/dist),blend(tail[1],at[1],.60/dist)];
    const begin=cursor, release=begin+(i<loads.length-1?gripTime+liftTime:.35);
    const turnAt=release+length(stack,turn)/speed, runAt=turnAt+swivelTime;
    const hubAt=runAt+length(turn,hub)/speed, cross=outlet!==nearest;
    const chainAt=hubAt+(cross?transferTime:0), outletAt=chainAt+length(hub,at)/speed;
    const exitAt=outletAt+(cross?transferTime:0), finish=exitAt+length(at,stop)/speed;
    // Hold the first receiving pallet long enough for an operator to load a carton at the chute.
    cursor=finish+(index===0 && i===0?48:2);
    return {begin,release,turnAt,runAt,hubAt,chainAt,outletAt,exitAt,finish,end:cursor,at,stop,outlet,cross};
  });
  const cycle=cursor+1.0;
  const machine={loads,jaws,turntable,lifts,ports,nearest,trips,arrival,offset,cycle,load:loads[0]};
  function setJaws(extension,height){
    for(const [i,jaw] of jaws.entries()){
      const side=i===0?-1:1;
      jaw.position.set(stack[0],height,stack[1]+side*(.68-.25*extension));
    }
  }
  function update(time){
    const t=((time+offset)%cycle+cycle)%cycle;
    setJaws(0,deck+palletPitch+.050);turntable.rotation.y=0;
    for(const port of ports)lifts[port].position.y=low;
    if(t<arrival){
      loads.forEach((load,i)=>{load.visible=true;travel(load,start,stack,t/arrival,deck+i*palletPitch,0);});
      machine.load=loads[0];return;
    }
    const i=trips.findIndex(trip=>t<trip.end);
    if(i<0){loads.forEach(load=>{load.visible=false;});return;}
    const trip=trips[i],load=loads[i],since=t-trip.begin;
    machine.load=load;
    const settleStart=trip.release+1.28/speed;
    const settle=smooth(ramp(t,settleStart,settleTime));
    const raised=.085*smooth(ramp(since,gripTime,liftTime));
    const stackShift=raised*(1-settle)-palletPitch*settle;
    for(const [j,pallet] of loads.entries()){
      pallet.visible=j>=i;
      if(j>i)travel(pallet,stack,stack,0,deck+(j-i)*palletPitch+stackShift,0);
    }
    if(i+1<loads.length){
      const withdraw=settleStart+settleTime;
      const extension=smooth(ramp(since,0,gripTime))*(1-smooth(ramp(t,withdraw,gripTime)));
      const home=smooth(ramp(t,withdraw+gripTime,.75));
      setJaws(extension,deck+palletPitch+.050+stackShift*(1-home));
    }
    const angle=yaw*smooth(ramp(t,trip.turnAt,swivelTime));
    turntable.rotation.y=angle*(1-smooth(ramp(t,trip.runAt+1.55/speed,swivelTime)));
    const lowerEnd=trip.cross?trip.hubAt:trip.exitAt+1.18/speed;
    const hubTop=low+stroke*smooth(ramp(t,trip.turnAt,transferTime))*(1-smooth(ramp(t,lowerEnd,transferTime)));
    lifts[nearest].position.y=hubTop;
    if(trip.cross){
      lifts[trip.outlet].position.y=low+stroke*smooth(ramp(t,trip.outletAt,transferTime))*
        (1-smooth(ramp(t,trip.exitAt+1.18/speed,transferTime)));
    }
    if(t<trip.turnAt){
      travel(load,stack,turn,ramp(t,trip.release,trip.turnAt-trip.release),deck,0);
    }else if(t<trip.runAt){
      travel(load,turn,turn,0,deck,angle);
    }else if(t<trip.hubAt){
      travel(load,turn,hub,ramp(t,trip.runAt,trip.hubAt-trip.runAt),deck,yaw);
    }else if(t<trip.chainAt){
      travel(load,hub,hub,0,Math.max(spec.chainDeck,hubTop),yaw);
    }else if(t<trip.outletAt){
      travel(load,hub,trip.at,ramp(t,trip.chainAt,trip.outletAt-trip.chainAt),spec.chainDeck,yaw);
    }else if(t<trip.exitAt){
      travel(load,trip.at,trip.at,0,Math.max(spec.chainDeck,lifts[trip.outlet].position.y),yaw);
    }else{
      travel(load,trip.at,trip.stop,ramp(t,trip.exitAt,trip.finish-trip.exitAt),deck,yaw);
    }
  }
  machine.update=update;
  return machine;
}
