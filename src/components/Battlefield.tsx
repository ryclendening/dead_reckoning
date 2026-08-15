import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { Billboard, Line, Text } from '@react-three/drei'
import * as THREE from 'three'
import { effectiveSensorRange, RADAR_RANGE } from '../game/engine'
import { axialToPoint, HEX_RADIUS, snapToHex } from '../game/hex'
import type { Asset, CombatEvent, DefenseCue, EnemyFlight, Phase, Point, ReinforcementCall, RoundResult, Squadron } from '../game/types'

const friendly='#55d6df', amber='#d99a25', hostile='#de4f3f'
const airLossTitles=new Set(['AIRCRAFT LOST','PURSUIT LOSS'])
const airDamageTitles=new Set(['DAMAGE REPORTED','OVEREXTENSION DAMAGE'])
const groundDamageTitles=new Set(['WEAPONS IMPACT','TARGET DESTROYED','HOME BASE STRUCK','DEFENSE SITE DAMAGED'])
const to3=(p:Point,y=.13):[number,number,number]=>[p[0],y,p[1]]
const flightCurve=(route:Point[],altitude:number)=>{const points=route.map(p=>new THREE.Vector3(p[0],altitude,p[1]));if(points.length===2)points.splice(1,0,points[0].clone().lerp(points[1],.5));return new THREE.CatmullRomCurve3(points)}

function CameraRig(){
  const {camera,size}=useThree()
  useEffect(()=>{const c=camera as THREE.OrthographicCamera;c.position.set(15,23,26);c.lookAt(0,0,0);c.zoom=size.height<700?13.5:15;c.updateProjectionMatrix()},[camera,size.height])
  return null
}

function HexOverlay({opacity}:{opacity:number}){
  const geometry=useMemo(()=>{const vertices:number[]=[];for(let r=-12;r<=12;r++){for(let q=-14;q<=14;q++){const [x,z]=axialToPoint(q,r);if(Math.abs(x)>9.85||Math.abs(z)>13.85)continue;for(let edge=0;edge<6;edge++){const a=Math.PI/6+edge*Math.PI/3,b=Math.PI/6+(edge+1)*Math.PI/3;vertices.push(x+Math.cos(a)*HEX_RADIUS,.075,z+Math.sin(a)*HEX_RADIUS,x+Math.cos(b)*HEX_RADIUS,.075,z+Math.sin(b)*HEX_RADIUS)}}}return new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(vertices,3))},[])
  useEffect(()=>()=>geometry.dispose(),[geometry])
  return <lineSegments geometry={geometry}><lineBasicMaterial color="#d9dbc0" transparent opacity={opacity} depthWrite={false}/></lineSegments>
}

function PlacementHex({position}:{position:Point}){
  const outline=useMemo(()=>Array.from({length:7},(_,i)=>{const a=Math.PI/6+i*Math.PI/3;return [Math.cos(a)*HEX_RADIUS,.1,Math.sin(a)*HEX_RADIUS] as [number,number,number]}),[])
  return <group position={to3(position,.02)}><mesh rotation={[-Math.PI/2,0,Math.PI/6]}><circleGeometry args={[HEX_RADIUS*.88,6]}/><meshBasicMaterial color="#f1c65b" transparent opacity={.13} depthWrite={false}/></mesh><Line points={outline} color="#f1c65b" opacity={.95} transparent lineWidth={2}/></group>
}

function Terrain({phase}:{phase:Phase}){
  const ridges=useMemo(()=>Array.from({length:62},(_,i)=>({x:(i*5.71)%19-9.5,z:(i*8.13)%27-13.5,s:.28+((i*7)%5)*.16,h:.14+((i*11)%7)*.1})),[])
  const hexOpacity=phase==='deploy'?.2:0
  return <group>
    <mesh receiveShadow rotation={[-Math.PI/2,0,0]}><planeGeometry args={[20,28,40,56]}/><meshStandardMaterial color="#596044" roughness={1}/></mesh>
    <mesh position={[0,.035,0]} rotation={[-Math.PI/2,0,-.11]}><planeGeometry args={[1.55,29]}/><meshStandardMaterial color="#233d42" roughness={.72}/></mesh>
    {ridges.map((ridge,i)=><mesh key={i} position={[ridge.x,ridge.h/2,ridge.z]} rotation={[0,i*.7,0]} castShadow receiveShadow><coneGeometry args={[ridge.s,ridge.h,5]}/><meshStandardMaterial color={i%3===0?'#6f6b48':'#454c35'} roughness={1}/></mesh>)}
    {hexOpacity>0?<HexOverlay opacity={hexOpacity}/>:null}
    <mesh position={[0,-.03,0]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[20.2,28.2]}/><meshBasicMaterial color="#0c0f0c" transparent opacity={.08}/></mesh>
  </group>
}

function HealthBar3D({fraction,label,position=[0,.83,0],enemy=false}:{fraction:number;label:string;position?:[number,number,number];enemy?:boolean}){
  const value=clamp01(fraction)
  const width=1.08
  const color=value>.62?(enemy?hostile:friendly):value>.32?amber:hostile
  return <Billboard position={position} follow lockZ={false}>
    <mesh renderOrder={30}><planeGeometry args={[width,.14]}/><meshBasicMaterial color="#090b09" transparent opacity={.9} depthTest={false} depthWrite={false}/></mesh>
    <mesh position={[-width*(1-value)/2,0,.008]} scale={[Math.max(.025,value),1,1]} renderOrder={31}><planeGeometry args={[width-.08,.075]}/><meshBasicMaterial color={color} depthTest={false} depthWrite={false}/></mesh>
    <Text position={[0,.16,.012]} fontSize={.13} color="#f2efdc" anchorX="center" anchorY="middle" renderOrder={32}>{label}</Text>
  </Billboard>
}

function DamageSmoke({severity=.3,position=[0,.25,0]}:{severity?:number;position?:[number,number,number]}){
  const ref=useRef<THREE.Group>(null)
  const age=useRef(0)
  useFrame((_,delta)=>{age.current+=delta;if(!ref.current)return;ref.current.children.forEach((child,index)=>{const cycle=(age.current*.23+index*.31)%1;child.position.y=cycle*.95;child.position.x=Math.sin(age.current*.75+index)*.1*cycle;const scale=.32+cycle*.45+severity*.25;child.scale.setScalar(scale);const material=(child as THREE.Mesh).material as THREE.MeshBasicMaterial;material.opacity=(1-cycle)*(.2+severity*.34)})})
  return <group ref={ref} position={position}>{[0,1,2].map(i=><mesh key={i} position={[0,i*.18,0]}><sphereGeometry args={[.22,7,5]}/><meshBasicMaterial color={i===0?'#282823':'#4a4a40'} transparent opacity={.4} depthWrite={false}/></mesh>)}</group>
}

function Runway({asset,enemy=false}:{asset:Asset;enemy?:boolean}){
  const severity=1-clamp01(asset.health/Math.max(1,asset.maxHealth))
  const position=asset.position
  const health=asset.health
  return <group position={to3(position,.14)} rotation={[0,.2,0]}>
    <mesh castShadow><boxGeometry args={[2,.08,.5]}/><meshStandardMaterial color={health>0?'#343732':'#25221f'} roughness={.9}/></mesh>
    {[-.65,0,.65].map(x=><mesh key={x} position={[x,.05,0]}><boxGeometry args={[.25,.012,.035]}/><meshBasicMaterial color={enemy?'#bd5b4a':'#d2cfb5'}/></mesh>)}
    <mesh position={[0,.16,-.46]} castShadow><boxGeometry args={[.48,.25,.45]}/><meshStandardMaterial color={enemy?'#5d4035':'#42585b'}/></mesh>
    {asset.struck?<HealthBar3D fraction={health/asset.maxHealth} label={`${Math.round(health)}%`} position={[0,.88,0]} enemy={enemy}/>:null}
    {asset.struck&&health<asset.maxHealth?<DamageSmoke severity={Math.max(.15,severity)} position={[0,.22,-.1]}/>:null}
  </group>
}

function Radar({asset,enemy=false}:{asset:Asset,enemy?:boolean}){
  const ref=useRef<THREE.Group>(null)
  useFrame((_,d)=>{if(ref.current)ref.current.rotation.y+=d*.45})
  return <group position={to3(asset.position,.15)}><mesh castShadow position={[0,.18,0]}><cylinderGeometry args={[.24,.3,.36,8]}/><meshStandardMaterial color={asset.health>0?'#55584d':'#292522'}/></mesh><group ref={ref} position={[0,.5,0]} rotation={[0,0,.2]}><mesh castShadow><sphereGeometry args={[.32,8,5,0,Math.PI]}/><meshStandardMaterial color={enemy?'#8f604d':'#b9c1ac'} side={THREE.DoubleSide}/></mesh></group>{asset.health>0?<Ring radius={enemy?2.6:RADAR_RANGE} color={enemy?hostile:friendly}/>:null}{asset.struck?<HealthBar3D fraction={asset.health/asset.maxHealth} label={`${Math.round(asset.health)}%`} position={[0,1.08,0]} enemy={enemy}/>:null}{asset.struck&&asset.health<asset.maxHealth?<DamageSmoke severity={1-asset.health/asset.maxHealth} position={[0,.45,0]}/>:null}</group>
}

function DefenseNetworkCue({cue,radar}:{cue:DefenseCue;radar:Point}){
  const ref=useRef<THREE.Group>(null)
  useFrame(({clock})=>{if(ref.current){const pulse=1+Math.sin(clock.elapsedTime*4)*.018;ref.current.scale.setScalar(pulse)}})
  return <group ref={ref} position={to3(radar,.2)}><Ring radius={RADAR_RANGE+cue.rangeBonus} color="#9ee6a8" opacity={.5}/><Text position={[0,.18,-RADAR_RANGE-cue.rangeBonus-.35]} rotation={[-Math.PI/2,0,0]} fontSize={.24} color="#9ee6a8">CUED DEFENSE +{cue.rangeBonus.toFixed(1)}</Text></group>
}

function Ring({radius,color,opacity=.32}:{radius:number,color:string,opacity?:number}){
  const pts=useMemo(()=>Array.from({length:49},(_,i)=>{const a=i/48*Math.PI*2;return [Math.cos(a)*radius,.07,Math.sin(a)*radius] as [number,number,number]}),[radius])
  return <Line points={pts} color={color} transparent opacity={opacity} dashed dashSize={.18} gapSize={.12} lineWidth={1}/>
}

function Defense({asset,enemy=true,selected=false}:{asset:Asset;enemy?:boolean;selected?:boolean}){
  const shown=!enemy||asset.intel!=='unknown'; if(!shown)return null
  if(asset.kind==='radar')return <Radar asset={asset} enemy={enemy}/>
  return <group position={to3(asset.position,.15)}>
    <mesh castShadow><cylinderGeometry args={[.34,.42,.15,8]}/><meshStandardMaterial color={asset.health>0?'#7a493d':'#292522'}/></mesh>
    {asset.kind==='sam'?[-.18,.18].map(x=><mesh key={x} position={[x,.35,0]} rotation={[0,0,-.28]} castShadow><cylinderGeometry args={[.045,.065,.62,6]}/><meshStandardMaterial color="#aa9a75"/></mesh>):<mesh position={[0,.28,0]}><boxGeometry args={[.45,.28,.2]}/><meshStandardMaterial color="#4d4036"/></mesh>}
    <Ring radius={asset.kind==='sam'?3.2:1.9} color={enemy?hostile:friendly} opacity={selected?.65:.25}/>
    {asset.struck?<HealthBar3D fraction={asset.health/asset.maxHealth} label={`${Math.round(asset.health)}%`} position={[0,.98,0]} enemy={enemy}/>:null}
    {asset.struck&&asset.health<asset.maxHealth?<DamageSmoke severity={1-asset.health/asset.maxHealth} position={[0,.3,0]}/>:null}
  </group>
}

function PlaneModel({color=friendly,role='fighter'}:{color?:string,role?:Squadron['role']}){
  const scale=role==='strike'?1.2:role==='recon'?1.05:.92
  return <group scale={scale} rotation={[0,Math.PI,0]}>
    <mesh castShadow rotation={[Math.PI/2,0,0]}><coneGeometry args={[.13,.75,5]}/><meshStandardMaterial color={color} metalness={.35} roughness={.45}/></mesh>
    <mesh castShadow position={[0,0,.05]}><boxGeometry args={[.75,.035,.16]}/><meshStandardMaterial color={color} metalness={.35} roughness={.45}/></mesh>
    <mesh castShadow position={[0,.07,.26]}><boxGeometry args={[.3,.16,.1]}/><meshStandardMaterial color="#1d292b"/></mesh>
  </group>
}

function Route({squadron,selected}:{squadron:Squadron,selected:boolean}){
  if(squadron.route.length<2)return null
  return <group><Line points={squadron.route.map(p=>to3(p,selected?.28:.18))} color={selected?'#7ceaf0':'#348c93'} opacity={selected?1:.38} transparent lineWidth={selected?2.2:1}/>{selected?squadron.route.map((p,i)=><group key={i} position={to3(p,.2)}><mesh position={[0,.1,0]}><sphereGeometry args={[.13,10,8]}/><meshBasicMaterial color={friendly}/></mesh><Ring radius={effectiveSensorRange(squadron)} color={friendly} opacity={i===squadron.route.length-1?.22:.1}/></group>):null}</group>
}

type FlightStatus={aircraft:number;damaged:number;fraction:number;hasDamage:boolean}

function AircraftSmoke(){
  const ref=useRef<THREE.Group>(null)
  const age=useRef(0)
  useFrame((_,delta)=>{age.current+=delta;if(!ref.current)return;ref.current.children.forEach((child,index)=>{const cycle=(age.current*.5+index*.34)%1;child.position.z=.36+cycle*.8;child.position.y=.02+Math.sin(age.current*2+index)*.035;const scale=.12+cycle*.24;child.scale.setScalar(scale);((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity=(1-cycle)*.46})})
  return <group ref={ref}>{[0,1,2].map(i=><mesh key={i}><sphereGeometry args={[.18,6,4]}/><meshBasicMaterial color="#34342f" transparent opacity={.38} depthWrite={false}/></mesh>)}</group>
}

function Flight({squadron,route,progress,active,selected,status,activeEvent}:{squadron:Squadron;route:Point[];progress:number;active:boolean;selected:boolean;status:FlightStatus;activeEvent?:CombatEvent}){
  const ref=useRef<THREE.Group>(null)
  const modelRef=useRef<THREE.Group>(null)
  const reaction=useRef({id:'',age:2,kind:'none' as 'none'|'damage'|'strike'})
  const curve=useMemo(()=>flightCurve(route,.6),[route])
  const reactionEvent=activeEvent?.detail.includes(squadron.callsign)&&(airLossTitles.has(activeEvent.title)||airDamageTitles.has(activeEvent.title)||activeEvent.title==='WEAPONS IMPACT')?activeEvent:undefined
  useEffect(()=>{if(reactionEvent&&reaction.current.id!==reactionEvent.id)reaction.current={id:reactionEvent.id,age:0,kind:reactionEvent.title==='WEAPONS IMPACT'?'strike':'damage'}},[reactionEvent])
  useFrame((_,delta)=>{if(ref.current&&active){const p=curve.getPoint(Math.min(.999,progress));const q=curve.getPoint(Math.min(.999,progress+.01));ref.current.position.copy(p);ref.current.lookAt(q)}if(!modelRef.current)return;reaction.current.age+=delta;const age=reaction.current.age;if(age<1.35){const fade=1-age/1.35;if(reaction.current.kind==='damage'){modelRef.current.rotation.z=Math.sin(age*23)*.18*fade;modelRef.current.rotation.x=-Math.sin(age*9)*.08*fade;modelRef.current.position.y=Math.sin(age*18)*.055*fade}else{modelRef.current.rotation.z=Math.sin(age*8)*.12*fade;modelRef.current.position.y=-Math.sin(Math.min(1,age*2.5)*Math.PI)*.13*fade}}else{modelRef.current.rotation.set(0,0,0);modelRef.current.position.y=0}})
  return <group ref={ref} position={curve.getPoint(active?Math.min(.999,progress):0)}><group ref={modelRef}><PlaneModel role={squadron.role}/>{status.hasDamage?<AircraftSmoke/>:null}</group><mesh position={[.12,-.43,.13]} rotation={[-Math.PI/2,0,0]}><circleGeometry args={[.22,12]}/><meshBasicMaterial color="#080a08" transparent opacity={.36}/></mesh>{active?<><HealthBar3D fraction={status.fraction} label={`${status.aircraft}/${squadron.aircraft}${status.damaged?` · ${status.damaged} DMG`:''}`} position={[0,.72,0]}/><group position={[0,-.58,0]}><Ring radius={effectiveSensorRange(squadron)} color={friendly} opacity={selected?.22:.08}/></group></>:null}</group>
}

function EnemyContact({flight,progress,status,activeEvent}:{flight:EnemyFlight;progress:number;status:FlightStatus;activeEvent?:CombatEvent}){
  const window=flight.detectionWindows.find(w=>progress>=w.start&&progress<=w.end)
  const ref=useRef<THREE.Group>(null)
  const modelRef=useRef<THREE.Group>(null)
  const reaction=useRef({id:'',age:2})
  const curve=useMemo(()=>flightCurve(flight.route,.68),[flight.route])
  const hitEvent=flight.role==='fighter'&&activeEvent?.title==='INTERCEPT SUCCESS'||flight.role==='strike'&&activeEvent?.title==='LAYERED DEFENSE ENGAGES'?activeEvent:undefined
  useEffect(()=>{if(hitEvent&&reaction.current.id!==hitEvent.id)reaction.current={id:hitEvent.id,age:0}},[hitEvent])
  useFrame((_,delta)=>{if(ref.current){const p=curve.getPoint(Math.min(.999,progress));const q=curve.getPoint(Math.min(.999,progress+.01));ref.current.position.copy(p);ref.current.lookAt(q)}if(!modelRef.current)return;reaction.current.age+=delta;const age=reaction.current.age;if(age<1.35){const fade=1-age/1.35;modelRef.current.rotation.z=Math.sin(age*24)*.22*fade;modelRef.current.rotation.x=-Math.sin(age*10)*.1*fade;modelRef.current.position.y=Math.sin(age*18)*.06*fade}else{modelRef.current.rotation.set(0,0,0);modelRef.current.position.y=0}})
  if(!window)return null
  const visual=window.source==='visual';const network=window.source==='network'
  return <group ref={ref} position={curve.getPoint(Math.min(.999,progress))}><group ref={modelRef}><PlaneModel role={flight.role} color={visual?hostile:network?'#9ee6a8':amber}/>{visual&&status.hasDamage?<AircraftSmoke/>:null}</group><Text position={[0,.5,0]} fontSize={.28} color={visual?hostile:network?'#9ee6a8':amber} anchorX="center">{visual?`${flight.callsign} · ${status.aircraft}`:network?'DEFENSE TRACK':'RADAR CONTACT'}</Text>{visual?<><HealthBar3D fraction={status.fraction} label={`${status.aircraft}/${flight.initialAircraft}`} position={[0,.79,0]} enemy/><group position={[0,-.6,0]}><Ring radius={1.1} color={hostile} opacity={.3}/></group></>:null}</group>
}

function ReinforcementFlight({call,progress}:{call:ReinforcementCall;progress:number}){
  const ref=useRef<THREE.Group>(null);const start=call.time/18
  const curve=useMemo(()=>flightCurve(call.route,.74),[call.route])
  const local=clamp01((progress-start)/Math.max(.01,1-start))
  useFrame(()=>{if(!ref.current)return;const p=curve.getPoint(local);const q=curve.getPoint(Math.min(.999,local+.012));ref.current.position.copy(p);ref.current.lookAt(q)})
  if(progress<start)return null
  return <group><Line points={call.route.map(p=>to3(p,.3))} color="#f1c65b" transparent opacity={.5} dashed dashSize={.18} gapSize={.12} lineWidth={1.2}/><group ref={ref} position={curve.getPoint(local)}><PlaneModel color="#f1c65b" role="fighter"/><Text position={[0,.5,0]} fontSize={.23} color="#f1c65b" anchorX="center">{call.type==='alert-cap'?'ALERT PAIR':'REPLACEMENT'}</Text></group></group>
}

function CombatEffect({event}:{event:CombatEvent}){
  const projectile=useRef<THREE.Mesh>(null)
  const flash=useRef<THREE.Mesh>(null)
  const ring=useRef<THREE.Mesh>(null)
  const debris=useRef<THREE.Group>(null)
  const age=useRef(0)
  if(!event.position)return null
  const defensiveShot=event.title==='LAYERED DEFENSE ENGAGES'
  const airborne=airLossTitles.has(event.title)||airDamageTitles.has(event.title)||event.title==='INTERCEPT SUCCESS'
  const deliberate=airborne||defensiveShot||groundDamageTitles.has(event.title)
  const color=event.tone==='danger'?hostile:event.tone==='warning'?amber:friendly
  useFrame((_,delta)=>{age.current+=delta;const t=age.current;if(projectile.current){projectile.current.visible=t<.52;projectile.current.position.y=defensiveShot?Math.min(2.2,.1+t*4.2):Math.max(.08,2.4-t*4.5)}if(flash.current){const pulse=t<.18?1+t*5:Math.max(0,1.9-(t-.18)*2.1);flash.current.scale.setScalar(Math.max(.01,pulse));((flash.current.material as THREE.MeshBasicMaterial)).opacity=Math.max(0,.95-t*.75)}if(ring.current){const scale=1+t*2.1;ring.current.scale.setScalar(scale);((ring.current.material as THREE.MeshBasicMaterial)).opacity=Math.max(0,.85-t*.48)}if(debris.current){debris.current.children.forEach((child,index)=>{const angle=index/debris.current!.children.length*Math.PI*2;const travel=Math.min(1.4,t)*(airborne ? .5 : .72);child.position.set(Math.cos(angle)*travel,.12+Math.sin(Math.min(1,t)*Math.PI)*(.3+index*.025),Math.sin(angle)*travel);child.rotation.x+=delta*5;child.rotation.z+=delta*4})}})
  const height=airborne ? .7 : .1
  if(!deliberate)return <group position={to3(event.position,.32)}><mesh ref={ring} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.18,.28,18]}/><meshBasicMaterial color={color} transparent opacity={.9}/></mesh></group>
  return <group position={to3(event.position,height)}>
    {!airborne?<mesh ref={projectile} position={[0,2.4,0]} rotation={[0,0,.14]}><cylinderGeometry args={[.035,.055,.36,6]}/><meshBasicMaterial color="#f4e7b1"/></mesh>:null}
    <mesh ref={flash}><sphereGeometry args={[airborne ? .3 : .42,9,7]}/><meshBasicMaterial color={airborne?'#ffb64a':'#ffcc68'} transparent opacity={.95} depthWrite={false}/></mesh>
    <mesh ref={ring} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.24,.36,22]}/><meshBasicMaterial color={color} transparent opacity={.85} depthWrite={false}/></mesh>
    <group ref={debris}>{Array.from({length:airborne ? 5 : 8},(_,i)=><mesh key={i}><boxGeometry args={[.06,.06,.16]}/><meshBasicMaterial color={i%2?'#f1ad48':'#2f302b'}/></mesh>)}</group>
  </group>
}

function historyPoint(route:Point[],progress:number):Point{
  if(route.length<2)return route[0]??[0,0]
  const lengths=route.slice(1).map((p,i)=>distance2(route[i],p));const total=lengths.reduce((sum,n)=>sum+n,0);let remaining=Math.max(0,Math.min(1,progress))*total
  for(let i=0;i<lengths.length;i++){if(remaining<=lengths[i]){const f=lengths[i]===0?0:remaining/lengths[i];return [route[i][0]+(route[i+1][0]-route[i][0])*f,route[i][1]+(route[i+1][1]-route[i][1])*f]}remaining-=lengths[i]}
  return route.at(-1)!
}

function HistoryOverlay({result}:{result:RoundResult}){
  return <group>
    {Object.entries(result.executionRoutes).map(([id,route])=>route.length>1?<Line key={id} points={route.map(p=>to3(p,.24))} color={friendly} opacity={.34} transparent dashed dashSize={.2} gapSize={.12} lineWidth={1.2}/>:null)}
    {result.enemyFlights.flatMap(f=>f.detectionWindows.map((w,i)=>{const points=Array.from({length:9},(_,j)=>to3(historyPoint(f.route,w.start+(w.end-w.start)*j/8),.26));return <Line key={`${f.id}-${i}`} points={points} color={w.source==='visual'?hostile:amber} opacity={.58} transparent dashed lineWidth={1.4}/>}))}
    {result.events.filter(e=>e.position).map((e,i)=><group key={e.id} position={to3(e.position!,.31)}><mesh rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.12,.2,12]}/><meshBasicMaterial color={e.tone==='danger'?hostile:e.tone==='warning'?amber:friendly}/></mesh><Text position={[0,.16,0]} fontSize={.18} color="#f0eedc">{i+1}</Text></group>)}
  </group>
}

function friendlyStatusAt(squadron:Squadron,result:RoundResult|undefined,progress:number):FlightStatus{
  let aircraft=squadron.aircraft
  let damaged=squadron.damaged
  for(const event of result?.events??[]){
    if(event.time>progress*18||!event.detail.includes(squadron.callsign))continue
    if(airLossTitles.has(event.title))aircraft=Math.max(0,aircraft-1)
    if(airDamageTitles.has(event.title))damaged++
  }
  return {aircraft,damaged,fraction:clamp01((aircraft-damaged*.28)/Math.max(1,squadron.aircraft)),hasDamage:aircraft<squadron.aircraft||damaged>squadron.damaged}
}

function enemyStatusAt(flight:EnemyFlight,result:RoundResult|undefined,progress:number):FlightStatus{
  let aircraft=flight.initialAircraft
  for(const event of result?.events??[]){
    if(event.time>progress*18)continue
    if(flight.role==='fighter'&&event.title==='INTERCEPT SUCCESS')aircraft=Math.max(0,aircraft-1)
    if(flight.role==='strike'&&(event.title==='LAYERED DEFENSE ENGAGES'||event.title==='RESERVE CAP ARRIVES'))aircraft=Math.max(0,aircraft-1)
  }
  return {aircraft,damaged:0,fraction:aircraft/Math.max(1,flight.initialAircraft),hasDamage:aircraft<flight.initialAircraft}
}

function assetAtTime(asset:Asset,result:RoundResult|undefined,progress:number,enemy:boolean,phase:Phase):Asset{
  if(phase!=='execute'||!result)return asset
  const wasStruck=result.events.some(event=>event.time<=progress*18&&groundDamageTitles.has(event.title)&&event.position&&distance2(event.position,asset.position)<.5)
  if(!wasStruck)return asset
  return (enemy?result.assets:result.playerAssets).find(candidate=>candidate.id===asset.id)??asset
}

interface Props {squadrons:Squadron[]; assets:Asset[]; playerAssets:Asset[]; selectedId:string; placementId:string; phase:Phase; progress:number; activeEvent?:CombatEvent; executionResult?:RoundResult; onRoute:(route:Point[])=>void; onPlace:(id:string,position:Point)=>void}
function BattlefieldScene({squadrons,assets,playerAssets,selectedId,placementId,phase,progress,activeEvent,executionResult,onRoute,onPlace}:Props){
  const selected=squadrons.find(s=>s.id===selectedId)!
  const playerBase=playerAssets.find(a=>a.kind==='base')?.position??[-7.8,11.2];const playerRadar=playerAssets.find(a=>a.kind==='radar')?.position??[-6.7,5.8]
  const placement=playerAssets.find(a=>a.id===placementId)
  const [drawing,setDrawing]=useState(false)
  const draft=useRef<Point[]>([])
  const displayedPlayerAssets=playerAssets.map(asset=>assetAtTime(asset,executionResult,progress,false,phase))
  const displayedEnemyAssets=assets.map(asset=>assetAtTime(asset,executionResult,progress,true,phase))
  const inputPlanes=useMemo(()=>({
    ground:new THREE.Plane(new THREE.Vector3(0,1,0),-.08),
    route:new THREE.Plane(new THREE.Vector3(0,1,0),-.28),
  }),[])
  const projectPointer=(e:ThreeEvent<PointerEvent>,plane:THREE.Plane):Point=>{
    const hit=e.ray.intersectPlane(plane,new THREE.Vector3())
    if(!hit)return [e.point.x,e.point.z]
    return [THREE.MathUtils.clamp(hit.x,-9.8,9.8),THREE.MathUtils.clamp(hit.z,-13.8,13.8)]
  }
  const down=(e:ThreeEvent<PointerEvent>)=>{if(phase==='deploy'){const point=projectPointer(e,inputPlanes.ground);const hex=snapToHex(point);e.stopPropagation();onPlace(placementId,[hex[0],Math.max(2.2,hex[1])]);return}if(phase!=='plan')return;const point=projectPointer(e,inputPlanes.route);e.stopPropagation();setDrawing(true);draft.current=[playerBase,point];onRoute(draft.current)}
  const move=(e:ThreeEvent<PointerEvent>)=>{if(!drawing||phase!=='plan')return;const point=projectPointer(e,inputPlanes.route);const last=draft.current.at(-1);if(!last||distance2(last,point)>.28){draft.current=[...draft.current,point];onRoute(draft.current)}}
  const up=()=>setDrawing(false)
  return <>
    <color attach="background" args={['#11140f']}/><fog attach="fog" args={['#11140f',34,60]}/>
    <ambientLight intensity={1.1}/><directionalLight position={[-5,10,5]} intensity={2.1} castShadow shadow-mapSize={[1024,1024]}/>
    <Terrain phase={phase}/>{phase==='deploy'&&placement?<PlacementHex position={placement.position}/>:null}
    {displayedPlayerAssets.map(a=>a.kind==='base'||a.kind==='decoy'?<Runway key={a.id} asset={a}/>:<Defense key={a.id} asset={a} enemy={false} selected={phase==='deploy'&&a.id===placementId}/>) }
    {playerAssets.map(a=><Text key={`${a.id}-friendly-label`} position={[a.position[0],.25,a.position[1]-.62]} rotation={[-Math.PI/2,0,0]} fontSize={.21} color={a.id===placementId&&phase==='deploy'?'#f4d16f':friendly}>{a.kind==='base'?'HOME BASE':a.kind.toUpperCase()}</Text>)}
    {displayedEnemyAssets.map(a=>a.kind==='base'&&a.intel!=='unknown'?<Runway key={a.id} asset={a} enemy/>:a.kind==='decoy'&&a.intel!=='unknown'?<Runway key={a.id} asset={a} enemy/>:<Defense key={a.id} asset={a}/>)}
    {assets.filter(a=>a.intel!=='unknown').map(a=><Text key={`${a.id}-label`} position={[a.position[0],.27,a.position[1]-.68]} rotation={[-Math.PI/2,0,0]} fontSize={.2} color={a.intel==='confirmed'?hostile:amber}>{a.intel.toUpperCase()} {a.kind.toUpperCase()} · {a.confidence}%</Text>)}
    {phase!=='deploy'?squadrons.map(s=><Route key={s.id} squadron={s} selected={phase==='plan'&&s.id===selectedId}/>):null}
    {squadrons.filter(s=>(executionResult?.executionRoutes[s.id]??s.route).length>=2).map(s=><Flight key={s.id} squadron={s} route={executionResult?.executionRoutes[s.id]??s.route} active={phase==='execute'} progress={progress} selected={s.id===selectedId} status={friendlyStatusAt(s,executionResult,progress)} activeEvent={activeEvent}/>) }
    {phase==='execute'?executionResult?.enemyFlights.map(f=><EnemyContact key={f.id} flight={f} progress={progress} status={enemyStatusAt(f,executionResult,progress)} activeEvent={activeEvent}/>):null}
    {phase==='execute'?executionResult?.reinforcementCalls.map(call=><ReinforcementFlight key={call.id} call={call} progress={progress}/>):null}
    {phase==='execute'?executionResult?.defenseCues?.filter(c=>progress>=c.start&&progress<=c.end).map(c=><DefenseNetworkCue key={c.id} cue={c} radar={playerRadar}/>):null}
    {phase==='debrief'&&executionResult?<HistoryOverlay result={executionResult}/>:null}
    {activeEvent?<CombatEffect key={activeEvent.id} event={activeEvent}/>:null}
    <mesh position={[0,3.2,0]} rotation={[-Math.PI/2,0,0]} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}><planeGeometry args={[20,28]}/><meshBasicMaterial transparent opacity={0} depthWrite={false}/></mesh>
  </>
}
const distance2=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1])
const clamp01=(value:number)=>Math.max(0,Math.min(1,value))

export const Battlefield=memo(function Battlefield(props:Props){return <Canvas orthographic shadows="basic" dpr={[1,1.5]} gl={{antialias:true,powerPreference:'high-performance'}}><CameraRig/><BattlefieldScene {...props}/></Canvas>})
