import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { Line, Text } from '@react-three/drei'
import * as THREE from 'three'
import { effectiveSensorRange, RADAR_RANGE } from '../game/engine'
import { axialToPoint, HEX_RADIUS, snapToHex } from '../game/hex'
import type { Asset, CombatEvent, DefenseCue, EnemyFlight, Phase, Point, RoundResult, Squadron } from '../game/types'

const friendly='#55d6df', amber='#d99a25', hostile='#de4f3f'
const to3=(p:Point,y=.13):[number,number,number]=>[p[0],y,p[1]]

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

function Runway({position,enemy=false,health=100}:{position:Point,enemy?:boolean,health?:number}){
  return <group position={to3(position,.14)} rotation={[0,.2,0]}>
    <mesh castShadow><boxGeometry args={[2,.08,.5]}/><meshStandardMaterial color={health>0?'#343732':'#25221f'} roughness={.9}/></mesh>
    {[-.65,0,.65].map(x=><mesh key={x} position={[x,.05,0]}><boxGeometry args={[.25,.012,.035]}/><meshBasicMaterial color={enemy?'#bd5b4a':'#d2cfb5'}/></mesh>)}
    <mesh position={[0,.16,-.46]} castShadow><boxGeometry args={[.48,.25,.45]}/><meshStandardMaterial color={enemy?'#5d4035':'#42585b'}/></mesh>
  </group>
}

function Radar({position,enemy=false}:{position:Point,enemy?:boolean}){
  const ref=useRef<THREE.Group>(null)
  useFrame((_,d)=>{if(ref.current)ref.current.rotation.y+=d*.45})
  return <group position={to3(position,.15)}><mesh castShadow position={[0,.18,0]}><cylinderGeometry args={[.24,.3,.36,8]}/><meshStandardMaterial color="#55584d"/></mesh><group ref={ref} position={[0,.5,0]} rotation={[0,0,.2]}><mesh castShadow><sphereGeometry args={[.32,8,5,0,Math.PI]}/><meshStandardMaterial color={enemy?'#8f604d':'#b9c1ac'} side={THREE.DoubleSide}/></mesh></group><Ring radius={enemy?2.6:RADAR_RANGE} color={enemy?hostile:friendly}/></group>
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
  if(asset.kind==='radar')return <Radar position={asset.position} enemy={enemy}/>
  return <group position={to3(asset.position,.15)}>
    <mesh castShadow><cylinderGeometry args={[.34,.42,.15,8]}/><meshStandardMaterial color={asset.health>0?'#7a493d':'#292522'}/></mesh>
    {asset.kind==='sam'?[-.18,.18].map(x=><mesh key={x} position={[x,.35,0]} rotation={[0,0,-.28]} castShadow><cylinderGeometry args={[.045,.065,.62,6]}/><meshStandardMaterial color="#aa9a75"/></mesh>):<mesh position={[0,.28,0]}><boxGeometry args={[.45,.28,.2]}/><meshStandardMaterial color="#4d4036"/></mesh>}
    <Ring radius={asset.kind==='sam'?3.2:1.9} color={enemy?hostile:friendly} opacity={selected?.65:.25}/>
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

function Flight({squadron,route,progress,active,selected}:{squadron:Squadron,route:Point[],progress:number,active:boolean,selected:boolean}){
  const ref=useRef<THREE.Group>(null)
  const curve=useMemo(()=>new THREE.CatmullRomCurve3(route.map(p=>new THREE.Vector3(p[0],.6,p[1]))),[route])
  useFrame(()=>{if(!ref.current||!active)return;const p=curve.getPoint(Math.min(.999,progress));const q=curve.getPoint(Math.min(.999,progress+.01));ref.current.position.copy(p);ref.current.lookAt(q)})
  return <group ref={ref} position={curve.getPoint(active?Math.min(.999,progress):0)}><PlaneModel role={squadron.role}/><mesh position={[.12,-.43,.13]} rotation={[-Math.PI/2,0,0]}><circleGeometry args={[.22,12]}/><meshBasicMaterial color="#080a08" transparent opacity={.36}/></mesh>{active?<group position={[0,-.58,0]}><Ring radius={effectiveSensorRange(squadron)} color={friendly} opacity={selected?.22:.08}/></group>:null}</group>
}

function EnemyContact({flight,progress}:{flight:EnemyFlight,progress:number}){
  const window=flight.detectionWindows.find(w=>progress>=w.start&&progress<=w.end)
  const ref=useRef<THREE.Group>(null);const curve=useMemo(()=>new THREE.CatmullRomCurve3(flight.route.map(p=>new THREE.Vector3(p[0],.68,p[1]))),[flight.route])
  useFrame(()=>{if(!ref.current)return;const p=curve.getPoint(Math.min(.999,progress));const q=curve.getPoint(Math.min(.999,progress+.01));ref.current.position.copy(p);ref.current.lookAt(q)})
  if(!window)return null
  const visual=window.source==='visual';const network=window.source==='network'
  return <group ref={ref} position={curve.getPoint(Math.min(.999,progress))}><PlaneModel role={flight.role} color={visual?hostile:network?'#9ee6a8':amber}/><Text position={[0,.5,0]} fontSize={.28} color={visual?hostile:network?'#9ee6a8':amber} anchorX="center">{visual?`${flight.callsign} · ${flight.aircraft}`:network?'DEFENSE TRACK':'RADAR CONTACT'}</Text>{visual?<group position={[0,-.6,0]}><Ring radius={1.1} color={hostile} opacity={.3}/></group>:null}</group>
}

function EventPulse({event}:{event:CombatEvent}){
  const ref=useRef<THREE.Mesh>(null); useFrame(({clock})=>{if(ref.current){const s=1+Math.sin(clock.elapsedTime*5)*.25;ref.current.scale.setScalar(s)}})
  if(!event.position)return null
  const color=event.tone==='danger'?hostile:event.tone==='warning'?amber:friendly
  return <group position={to3(event.position,.32)}><mesh ref={ref} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.18,.28,18]}/><meshBasicMaterial color={color} transparent opacity={.9}/></mesh></group>
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

interface Props {squadrons:Squadron[]; assets:Asset[]; playerAssets:Asset[]; selectedId:string; placementId:string; phase:Phase; progress:number; activeEvent?:CombatEvent; executionResult?:RoundResult; onRoute:(route:Point[])=>void; onPlace:(id:string,position:Point)=>void}
function BattlefieldScene({squadrons,assets,playerAssets,selectedId,placementId,phase,progress,activeEvent,executionResult,onRoute,onPlace}:Props){
  const selected=squadrons.find(s=>s.id===selectedId)!
  const playerBase=playerAssets.find(a=>a.kind==='base')?.position??[-7.8,11.2];const playerRadar=playerAssets.find(a=>a.kind==='radar')?.position??[-6.7,5.8]
  const placement=playerAssets.find(a=>a.id===placementId)
  const [drawing,setDrawing]=useState(false)
  const draft=useRef<Point[]>([])
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
    {playerAssets.map(a=>a.kind==='base'||a.kind==='decoy'?<Runway key={a.id} position={a.position} health={a.health}/>:<Defense key={a.id} asset={a} enemy={false} selected={phase==='deploy'&&a.id===placementId}/>) }
    {playerAssets.map(a=><Text key={`${a.id}-friendly-label`} position={[a.position[0],.25,a.position[1]-.62]} rotation={[-Math.PI/2,0,0]} fontSize={.21} color={a.id===placementId&&phase==='deploy'?'#f4d16f':friendly}>{a.kind==='base'?'HOME BASE':a.kind.toUpperCase()}</Text>)}
    {assets.map(a=>a.kind==='base'&&a.intel!=='unknown'?<Runway key={a.id} position={a.position} enemy health={a.health}/>:a.kind==='decoy'&&a.intel!=='unknown'?<Runway key={a.id} position={a.position} enemy health={a.health}/>:<Defense key={a.id} asset={a}/>)}
    {assets.filter(a=>a.intel!=='unknown').map(a=><Text key={`${a.id}-label`} position={[a.position[0],.27,a.position[1]-.68]} rotation={[-Math.PI/2,0,0]} fontSize={.2} color={a.intel==='confirmed'?hostile:amber}>{a.intel.toUpperCase()} {a.kind.toUpperCase()} · {a.confidence}%</Text>)}
    {phase!=='deploy'?squadrons.map(s=><Route key={s.id} squadron={s} selected={phase==='plan'&&s.id===selectedId}/>):null}
    {squadrons.filter(s=>(executionResult?.executionRoutes[s.id]??s.route).length>=2).map(s=><Flight key={s.id} squadron={s} route={executionResult?.executionRoutes[s.id]??s.route} active={phase==='execute'} progress={progress} selected={s.id===selectedId}/>) }
    {phase==='execute'?executionResult?.enemyFlights.map(f=><EnemyContact key={f.id} flight={f} progress={progress}/>):null}
    {phase==='execute'?executionResult?.defenseCues?.filter(c=>progress>=c.start&&progress<=c.end).map(c=><DefenseNetworkCue key={c.id} cue={c} radar={playerRadar}/>):null}
    {phase==='debrief'&&executionResult?<HistoryOverlay result={executionResult}/>:null}
    {activeEvent?<EventPulse event={activeEvent}/>:null}
    <mesh position={[0,3.2,0]} rotation={[-Math.PI/2,0,0]} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}><planeGeometry args={[20,28]}/><meshBasicMaterial transparent opacity={0} depthWrite={false}/></mesh>
  </>
}
const distance2=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1])

export const Battlefield=memo(function Battlefield(props:Props){return <Canvas orthographic shadows="basic" dpr={[1,1.5]} gl={{antialias:true,powerPreference:'high-performance'}}><CameraRig/><BattlefieldScene {...props}/></Canvas>})
