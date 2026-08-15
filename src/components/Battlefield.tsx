import { memo, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { Billboard, Line, Text, useGLTF, useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { effectiveSensorRange, EXECUTION_SECONDS, RADAR_RANGE } from '../game/engine'
import { axialToPoint, HEX_RADIUS, snapToHex } from '../game/hex'
import type { Asset, CombatEvent, CombatSequence, DefenseCue, EnemyFlight, Phase, Point, ReinforcementCall, RoundResult, Squadron, WeaponEffect } from '../game/types'

const friendly='#55d6df', amber='#d99a25', hostile='#de4f3f'
const airLossTitles=new Set(['AIRCRAFT LOST','PURSUIT LOSS','ENEMY AIRCRAFT LOST'])
const airDamageTitles=new Set(['DAMAGE REPORTED','OVEREXTENSION DAMAGE'])
const groundDamageTitles=new Set(['WEAPONS IMPACT','TARGET DESTROYED','HOME BASE STRUCK','DEFENSE SITE DAMAGED'])
const to3=(p:Point,y=.13):[number,number,number]=>[p[0],y,p[1]]
const flightCurve=(route:Point[],altitude:number)=>{const points=route.map(p=>new THREE.Vector3(p[0],altitude,p[1]));if(points.length===2)points.splice(1,0,points[0].clone().lerp(points[1],.5));return new THREE.CatmullRomCurve3(points,false,'centripetal')}
const flightPoint=(curve:THREE.CatmullRomCurve3,progress:number)=>{const normalized=Math.min(.999,Math.max(0,progress));const point=curve.getPointAt(normalized);const altitude=Math.min(1,normalized/.055,(1-normalized)/.085);point.y=.15+.45*Math.max(0,altitude);return point}

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
  const hexOpacity=phase==='deploy' ? .2 : 0
  return <group>
    <mesh receiveShadow rotation={[-Math.PI/2,0,0]}><planeGeometry args={[20,28,40,56]}/><meshStandardMaterial color="#596044" roughness={1}/></mesh>
    <mesh position={[0,.035,0]} rotation={[-Math.PI/2,0,-.11]}><planeGeometry args={[1.55,29]}/><meshStandardMaterial color="#233d42" roughness={.72}/></mesh>
    {ridges.map((ridge,i)=><mesh key={i} position={[ridge.x,ridge.h/2,ridge.z]} rotation={[0,i*.7,0]} castShadow receiveShadow><coneGeometry args={[ridge.s,ridge.h,5]}/><meshStandardMaterial color={i%3===0?'#6f6b48':'#454c35'} roughness={1}/></mesh>)}
    {hexOpacity>0?<HexOverlay opacity={hexOpacity}/>:null}
    <mesh position={[0,-.03,0]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[20.2,28.2]}/><meshBasicMaterial color="#0c0f0c" transparent opacity={.08}/></mesh>
  </group>
}

function HealthBar3D({fraction,label,color=hostile,position=[0,.83,0],status='ENROUTE'}:{fraction:number;label:string;color?:string;position?:[number,number,number];status?:string}){
  const value=clamp01(fraction)
  const width=1.34
  const fill=useRef<THREE.Mesh>(null)
  const trail=useRef<THREE.Mesh>(null)
  const flash=useRef<THREE.Mesh>(null)
  const content=useRef<THREE.Group>(null)
  const displayed=useRef(value)
  const trailing=useRef(value)
  const previous=useRef(value)
  const hitAge=useRef(2)
  useEffect(()=>{if(value<previous.current-.01)hitAge.current=0;previous.current=value},[value])
  useFrame((_,delta)=>{displayed.current=THREE.MathUtils.damp(displayed.current,value,18,delta);trailing.current=THREE.MathUtils.damp(trailing.current,value,4.5,delta);const shown=Math.max(.02,displayed.current);const delayed=Math.max(shown,trailing.current);if(trail.current){trail.current.scale.x=delayed;trail.current.position.x=-width*(1-delayed)/2}if(fill.current){fill.current.scale.x=shown;fill.current.position.x=-width*(1-shown)/2}hitAge.current+=delta;const pulse=Math.max(0,1-hitAge.current/.45);if(content.current)content.current.scale.setScalar(1+pulse*.12);if(flash.current){const material=flash.current.material as THREE.MeshBasicMaterial;material.opacity=pulse*.75}})
  const segments=[.25,.5,.75]
  return <Billboard position={position} follow lockZ={false}>
    <group ref={content}>
      <mesh renderOrder={29} ref={flash}><planeGeometry args={[width+.2,.43]}/><meshBasicMaterial color="#ff5a42" transparent opacity={0} depthTest={false} depthWrite={false}/></mesh>
      <mesh renderOrder={30}><planeGeometry args={[width+.16,.38]}/><meshBasicMaterial color="#050706" transparent opacity={.96} depthTest={false} depthWrite={false}/></mesh>
      <mesh renderOrder={30} position={[0,-.08,.002]}><planeGeometry args={[width,.14]}/><meshBasicMaterial color="#161914" transparent opacity={1} depthTest={false} depthWrite={false}/></mesh>
      <mesh ref={trail} position={[-width*(1-value)/2,-.08,.006]} scale={[Math.max(.02,value),1,1]} renderOrder={31}><planeGeometry args={[width,.14]}/><meshBasicMaterial color="#f1d46a" transparent opacity={.72} depthTest={false} depthWrite={false}/></mesh>
      <mesh ref={fill} position={[-width*(1-value)/2,-.08,.01]} scale={[Math.max(.02,value),1,1]} renderOrder={32}><planeGeometry args={[width,.14]}/><meshBasicMaterial color={color} depthTest={false} depthWrite={false}/></mesh>
      {segments.map(x=><mesh key={x} renderOrder={33} position={[width*(x-.5),-.08,.018]}><planeGeometry args={[.018,.16]}/><meshBasicMaterial color="#020302" transparent opacity={.95} depthTest={false} depthWrite={false}/></mesh>)}
      <Text position={[-width*.47,.095,.012]} fontSize={.115} color="#f2efdc" anchorX="left" anchorY="middle" renderOrder={34}>{label}</Text>
      <Text position={[width*.47,.095,.012]} fontSize={.085} color={color} anchorX="right" anchorY="middle" renderOrder={34}>{status}</Text>
    </group>
  </Billboard>
}

function HitCallout({label}:{label:string}){
  const ref=useRef<THREE.Group>(null)
  const age=useRef(0)
  useFrame((_,delta)=>{age.current+=delta;if(!ref.current)return;const fade=Math.max(0,1-age.current/1.35);ref.current.position.y=age.current*.2;ref.current.scale.setScalar(1+age.current*.12);ref.current.visible=fade>0;ref.current.children.forEach(child=>{const material=(child as THREE.Mesh).material as THREE.MeshBasicMaterial|undefined;if(material)material.opacity=fade})})
  return <Billboard position={[0,1.28,0]} follow lockZ={false}><group ref={ref}><mesh renderOrder={34}><planeGeometry args={[.72,.24]}/><meshBasicMaterial color="#050505" transparent opacity={.92} depthTest={false} depthWrite={false}/></mesh><Text position={[0,0,.01]} fontSize={.16} color="#ff6653" anchorX="center" anchorY="middle" renderOrder={35}>{label}</Text></group></Billboard>
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
    {asset.struck?<HealthBar3D fraction={health/asset.maxHealth} label={`${Math.round(health)}%`} position={[0,.88,0]}/>:null}
    {asset.struck&&health<asset.maxHealth?<DamageSmoke severity={Math.max(.15,severity)} position={[0,.22,-.1]}/>:null}
  </group>
}

function Radar({asset,enemy=false}:{asset:Asset,enemy?:boolean}){
  const ref=useRef<THREE.Group>(null)
  useFrame((_,d)=>{if(ref.current)ref.current.rotation.y+=d*.45})
  return <group position={to3(asset.position,.15)}><mesh castShadow position={[0,.18,0]}><cylinderGeometry args={[.24,.3,.36,8]}/><meshStandardMaterial color={asset.health>0?'#55584d':'#292522'}/></mesh><group ref={ref} position={[0,.5,0]} rotation={[0,0,.2]}><mesh castShadow><sphereGeometry args={[.32,8,5,0,Math.PI]}/><meshStandardMaterial color={enemy?'#8f604d':'#b9c1ac'} side={THREE.DoubleSide}/></mesh></group>{asset.health>0?<Ring radius={enemy?2.6:RADAR_RANGE} color={enemy?hostile:friendly}/>:null}{asset.struck?<HealthBar3D fraction={asset.health/asset.maxHealth} label={`${Math.round(asset.health)}%`} position={[0,1.08,0]}/>:null}{asset.struck&&asset.health<asset.maxHealth?<DamageSmoke severity={1-asset.health/asset.maxHealth} position={[0,.45,0]}/>:null}</group>
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
    <Ring radius={asset.kind==='sam'?3.2:1.9} color={enemy?hostile:friendly} opacity={selected ? .65 : .25}/>
    {asset.struck?<HealthBar3D fraction={asset.health/asset.maxHealth} label={`${Math.round(asset.health)}%`} position={[0,.98,0]}/>:null}
    {asset.struck&&asset.health<asset.maxHealth?<DamageSmoke severity={1-asset.health/asset.maxHealth} position={[0,.3,0]}/>:null}
  </group>
}

const ROLE_UV:Record<Squadron['role'],{x:number;y:number;s:number}>={fighter:{x:1,y:2,s:.96},recon:{x:0,y:0,s:1.12}}
function AircraftTexture({role,color}:{role:Squadron['role'];color:string}){
  const base=useTexture('/assets/aircraft-atlas.png')
  const uv=ROLE_UV[role]??ROLE_UV.fighter
  const texture=useMemo(()=>{const clone=base.clone();clone.needsUpdate=true;clone.repeat.set(.5,1/3);clone.offset.set(uv.x*.5,uv.y/3);return clone},[base,uv.x,uv.y])
  const scale=uv.s
  return <group rotation={[-Math.PI/2,0,Math.PI]} scale={[scale,scale,scale]}>
    <mesh position={[0,0,.011]} renderOrder={6}><planeGeometry args={[1.25,1.65]}/><meshBasicMaterial map={texture} transparent opacity={.94} depthWrite={false}/></mesh>
    <mesh position={[0,0,.006]} renderOrder={5}><planeGeometry args={[1.34,1.74]}/><meshBasicMaterial color={color} transparent opacity={.22} depthWrite={false}/></mesh>
  </group>
}
function FighterJet({enemy=false}:{enemy?:boolean}){
  const url=enemy?'/assets/mig-23_mld.glb':'/assets/f16.glb'
  const {scene}=useGLTF(url)
  const normalized=useMemo(()=>{
    const object=scene.clone(true);const box=new THREE.Box3().setFromObject(object);const size=box.getSize(new THREE.Vector3());const center=box.getCenter(new THREE.Vector3());const scale=1.55/Math.max(size.x,size.y,size.z)
    object.position.set(-center.x,-center.y,-center.z)
    object.traverse(child=>{if(child instanceof THREE.Mesh){child.castShadow=true;child.receiveShadow=true;const material=child.material as THREE.MeshStandardMaterial;if(material&&'roughness' in material)material.roughness=Math.max(.28,material.roughness??.45)}})
    return {object,scale}
  },[scene])
  const edge=enemy?hostile:friendly
  return <group rotation={[0,Math.PI,0]}>
    <group scale={normalized.scale}><primitive object={normalized.object}/></group>
    <mesh position={[0,-.055,.04]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.54,.61,24]}/><meshBasicMaterial color={edge} transparent opacity={.72} depthWrite={false}/></mesh>
  </group>
}

function PlaneModel({color=friendly,role='fighter',enemy=false}:{color?:string,role?:Squadron['role'];enemy?:boolean}){
  if(role==='fighter')return <Suspense fallback={<mesh><coneGeometry args={[.22,.82,5]}/><meshStandardMaterial color={color}/></mesh>}><FighterJet enemy={enemy}/></Suspense>
  const body=role==='recon'?{f:.12,l:.95,w:1.36}:{f:.15,l:.78,w:.96}
  return <group rotation={[0,Math.PI,0]}>
    <AircraftTexture role={role} color={color}/>
    <mesh castShadow rotation={[Math.PI/2,0,0]}><coneGeometry args={[body.f,body.l,5]}/><meshStandardMaterial color="#4b5251" emissive={color} emissiveIntensity={.05} metalness={.38} roughness={.42}/></mesh>
    <mesh castShadow position={[0,0,.04]}><boxGeometry args={[body.w,.035,.14]}/><meshStandardMaterial color={color} metalness={.35} roughness={.45}/></mesh>
  </group>
}

useGLTF.preload('/assets/f16.glb')
useGLTF.preload('/assets/mig-23_mld.glb')

function Route({squadron,selected}:{squadron:Squadron,selected:boolean}){
  if(squadron.route.length<2)return null
  return <group><Line points={squadron.route.map(p=>to3(p,selected ? .28 : .18))} color={selected?'#7ceaf0':'#348c93'} opacity={selected?1:.38} transparent lineWidth={selected?2.2:1}/>{selected?squadron.route.map((p,i)=><group key={i} position={to3(p,.2)}><mesh position={[0,.1,0]}><sphereGeometry args={[.13,10,8]}/><meshBasicMaterial color={friendly}/></mesh><Ring radius={effectiveSensorRange(squadron)} color={friendly} opacity={i===squadron.route.length-1 ? .22 : .1}/></group>):null}</group>
}

type FlightStatus={aircraft:number;damaged:number;fraction:number;hasDamage:boolean;strength:number;morale:number;action:string}
const strengthToAircraft=(strength:number,maxAircraft:number)=>strength<=0?0:Math.max(1,Math.min(maxAircraft,Math.ceil(strength/25)))
const actionLabel=(status?:string,sequence?:CombatSequence)=>sequence?.kind==='dogfight'?'DOGFIGHT':sequence?.kind==='pursuit'?'PURSUIT':sequence?.kind==='strike'?'ATTACK RUN':status==='destroyed'?'DESTROYED':status==='disengaging'?'BREAKING CONTACT':status==='rtb'?'RTB':'ENROUTE'
function sequencePose(sequence:CombatSequence|undefined,seconds:number,id:string){
  if(!sequence||sequence.kind!=='dogfight'||seconds<sequence.start||seconds>sequence.end)return undefined
  const local=clamp01((seconds-sequence.start)/Math.max(.01,sequence.end-sequence.start));const side=Math.max(0,sequence.participantIds.indexOf(id));const angle=local*Math.PI*4+side*Math.PI;const next=angle+.08
  return {point:new THREE.Vector3(sequence.location[0]+Math.cos(angle)*.92,.72,sequence.location[1]+Math.sin(angle)*.64),look:new THREE.Vector3(sequence.location[0]+Math.cos(next)*.92,.72,sequence.location[1]+Math.sin(next)*.64)}
}

function AircraftSmoke(){
  const ref=useRef<THREE.Group>(null)
  const age=useRef(0)
  useFrame((_,delta)=>{age.current+=delta;if(!ref.current)return;ref.current.children.forEach((child,index)=>{const cycle=(age.current*.5+index*.34)%1;child.position.z=.36+cycle*.8;child.position.y=.02+Math.sin(age.current*2+index)*.035;const scale=.12+cycle*.24;child.scale.setScalar(scale);((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity=(1-cycle)*.46})})
  return <group ref={ref}>{[0,1,2].map(i=><mesh key={i}><sphereGeometry args={[.18,6,4]}/><meshBasicMaterial color="#34342f" transparent opacity={.38} depthWrite={false}/></mesh>)}</group>
}

function Flight({squadron,route,progress,active,selected,status,activeEvent,activeSequence}:{squadron:Squadron;route:Point[];progress:number;active:boolean;selected:boolean;status:FlightStatus;activeEvent?:CombatEvent;activeSequence?:CombatSequence}){
  const ref=useRef<THREE.Group>(null)
  const modelRef=useRef<THREE.Group>(null)
  const reaction=useRef({id:'',age:2,kind:'none' as 'none'|'damage'|'strike'})
  const curve=useMemo(()=>flightCurve(route,.6),[route])
  const reactionEvent=activeEvent?.detail.includes(squadron.callsign)&&(airLossTitles.has(activeEvent.title)||airDamageTitles.has(activeEvent.title)||activeEvent.title==='WEAPONS IMPACT')?activeEvent:undefined
  useEffect(()=>{if(reactionEvent&&reaction.current.id!==reactionEvent.id)reaction.current={id:reactionEvent.id,age:0,kind:reactionEvent.title==='WEAPONS IMPACT'?'strike':'damage'}},[reactionEvent])
  useFrame((_,delta)=>{if(ref.current&&active){const pose=sequencePose(activeSequence,progress*EXECUTION_SECONDS,squadron.id);const p=pose?.point??flightPoint(curve,progress);const q=pose?.look??flightPoint(curve,Math.min(.999,progress+.01));ref.current.position.copy(p);ref.current.lookAt(q)}if(!modelRef.current)return;reaction.current.age+=delta;const age=reaction.current.age;if(age<1.35){const fade=1-age/1.35;if(reaction.current.kind==='damage'){modelRef.current.rotation.z=Math.sin(age*23)*.18*fade;modelRef.current.rotation.x=-Math.sin(age*9)*.08*fade;modelRef.current.position.y=Math.sin(age*18)*.055*fade}else{modelRef.current.rotation.z=Math.sin(age*8)*.12*fade;modelRef.current.position.y=-Math.sin(Math.min(1,age*2.5)*Math.PI)*.13*fade}}else{modelRef.current.rotation.set(0,0,0);modelRef.current.position.y=0}})
  const damageEvent=reactionEvent&&(airLossTitles.has(reactionEvent.title)||airDamageTitles.has(reactionEvent.title))?reactionEvent:undefined
  const calloutLabel=damageEvent&&airLossTitles.has(damageEvent.title)?'−1 AIRCRAFT':damageEvent?'HIT · DAMAGE':''
  const strengthLabel=`${squadron.callsign} · ${squadron.role.toUpperCase()} · ${status.aircraft} PIPS`
  return <group ref={ref} visible={status.aircraft>0} position={flightPoint(curve,active?progress:0)}>
    <group ref={modelRef}><PlaneModel role={squadron.role}/>{status.hasDamage?<AircraftSmoke/>:null}</group>
    <mesh position={[.12,-.43,.13]} rotation={[-Math.PI/2,0,0]}><circleGeometry args={[.22,12]}/><meshBasicMaterial color="#080a08" transparent opacity={.36}/></mesh>
    {active?<>
      <Billboard position={[0,.56,0]} follow lockZ={false}><Text fontSize={.19} color={friendly} anchorX="center" outlineWidth={.012} outlineColor="#071010">FRIENDLY · {squadron.callsign} · {status.action}</Text></Billboard>
      <HealthBar3D fraction={status.fraction} color={friendly} label={strengthLabel} status={status.action} position={[0,.9,0]}/>
      {damageEvent?<HitCallout key={damageEvent.id} label={calloutLabel}/>:null}
      <group position={[0,-.58,0]}><Ring radius={effectiveSensorRange(squadron)} color={friendly} opacity={selected ? .22 : .08}/></group>
    </>:null}
  </group>
}

function EnemyContact({flight,progress,status,activeEvent,activeSequence}:{flight:EnemyFlight;progress:number;status:FlightStatus;activeEvent?:CombatEvent;activeSequence?:CombatSequence}){
  const window=flight.detectionWindows.find(w=>progress>=w.start&&progress<=w.end)
  const ref=useRef<THREE.Group>(null)
  const modelRef=useRef<THREE.Group>(null)
  const reaction=useRef({id:'',age:2})
  const curve=useMemo(()=>flightCurve(flight.route,.68),[flight.route])
  const hitEvent=flight.role==='fighter'&&activeEvent?.title==='ENEMY AIRCRAFT LOST'?activeEvent:undefined
  useEffect(()=>{if(hitEvent&&reaction.current.id!==hitEvent.id)reaction.current={id:hitEvent.id,age:0}},[hitEvent])
  useFrame((_,delta)=>{if(ref.current){const pose=sequencePose(activeSequence,progress*EXECUTION_SECONDS,flight.id);const p=pose?.point??flightPoint(curve,progress);const q=pose?.look??flightPoint(curve,Math.min(.999,progress+.01));ref.current.position.copy(p);ref.current.lookAt(q)}if(!modelRef.current)return;reaction.current.age+=delta;const age=reaction.current.age;if(age<1.35){const fade=1-age/1.35;modelRef.current.rotation.z=Math.sin(age*24)*.22*fade;modelRef.current.rotation.x=-Math.sin(age*10)*.1*fade;modelRef.current.position.y=Math.sin(age*18)*.06*fade}else{modelRef.current.rotation.set(0,0,0);modelRef.current.position.y=0}})
  if(!window)return null
  const visual=window.source==='visual';const network=window.source==='network'
  const damageEvent=hitEvent&&status.hasDamage?hitEvent:undefined
  const contactColor=visual?hostile:amber
  const contactLabel=visual?`ENEMY · ${flight.callsign}`:network?'ENEMY · DEFENSE TRACK':'ENEMY · RADAR CONTACT'
  if(!visual)return <group ref={ref} visible={status.aircraft>0} position={flightPoint(curve,progress)}>
    <mesh rotation={[-Math.PI/2,0,Math.PI/4]}><planeGeometry args={[.72,.72]}/><meshBasicMaterial color={amber} transparent opacity={network ? .42 : .58} depthWrite={false}/></mesh>
    <Billboard position={[0,.56,0]} follow lockZ={false}><Text fontSize={.18} color={contactColor} anchorX="center" outlineWidth={.012} outlineColor="#100a03">{contactLabel}</Text></Billboard>
    <group position={[0,-.6,0]}><Ring radius={1.1} color={amber} opacity={.18}/></group>
  </group>
  return <group ref={ref} visible={status.aircraft>0} position={flightPoint(curve,progress)}>
    <group ref={modelRef}><PlaneModel role={flight.role as Squadron['role']} color={contactColor} enemy/>{status.hasDamage?<AircraftSmoke/>:null}</group>
    <Billboard position={[0,.56,0]} follow lockZ={false}><Text fontSize={.19} color={contactColor} anchorX="center" outlineWidth={.012} outlineColor="#180806">{contactLabel}</Text></Billboard>
    <HealthBar3D fraction={status.fraction} color={contactColor} label={`${flight.callsign} · ${flight.role.toUpperCase()} · ${status.aircraft} PIPS`} status={status.action} position={[0,.9,0]}/>
    {damageEvent?<HitCallout key={damageEvent.id} label="ENEMY −1 AIRCRAFT"/>:null}
    <group position={[0,-.6,0]}><Ring radius={1.1} color={hostile} opacity={.3}/></group>
  </group>
}

function ReinforcementFlight({call,progress}:{call:ReinforcementCall;progress:number}){
  const ref=useRef<THREE.Group>(null);const start=call.time/EXECUTION_SECONDS
  const curve=useMemo(()=>flightCurve(call.route,.74),[call.route])
  const local=clamp01((progress-start)/Math.max(.01,1-start))
  useFrame(()=>{if(!ref.current)return;const p=flightPoint(curve,local);const q=flightPoint(curve,Math.min(.999,local+.012));ref.current.position.copy(p);ref.current.lookAt(q)})
  if(progress<start)return null
  return <group><Line points={call.route.map(p=>to3(p,.3))} color="#f1c65b" transparent opacity={.5} dashed dashSize={.18} gapSize={.12} lineWidth={1.2}/><group ref={ref} position={flightPoint(curve,local)}><PlaneModel color="#f1c65b" role="fighter"/><Text position={[0,.5,0]} fontSize={.23} color="#f1c65b" anchorX="center">{call.type==='alert-cap'?'ALERT PAIR':'REPLACEMENT'}</Text></group></group>
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

function lerpPoint(a:Point,b:Point,t:number):Point{return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]}

function WeaponEffectVisual({effect,seconds}:{effect:WeaponEffect;seconds:number}){
  const local=clamp01((seconds-effect.start)/Math.max(.01,effect.end-effect.start))
  if(seconds<effect.start||seconds>effect.end+.28)return null
  const position=lerpPoint(effect.from,effect.to,local)
  const hostileSource=effect.sourceId.startsWith('e-')||effect.sourceId==='red-fighter'
  const color=effect.kind==='aaa'?'#ffcf62':effect.kind==='gun'?'#ffd48a':hostileSource?hostile:friendly
  const isBurst=effect.kind==='gun'||effect.kind==='aaa'
  const height=effect.kind==='sam' ? .28+Math.sin(local*Math.PI)*1.28 : .75+Math.sin(local*Math.PI)*.28
  const trailPoint=lerpPoint(effect.from,effect.to,Math.max(0,local-.23))
  return <>
    {effect.kind==='sam'?<Line points={[to3(trailPoint,.28+Math.sin(Math.max(0,local-.23)*Math.PI)*1.28),to3(position,height)]} color="#e9e5d4" transparent opacity={.72} lineWidth={2.5}/>:null}
    {local<.32&&(effect.kind==='sam'||effect.kind==='aaa')?<Billboard position={to3(effect.from,.95)} follow lockZ={false}><Text fontSize={.22} color={color} outlineWidth={.014} outlineColor="#090a07">{effect.kind==='sam'?'SAM LAUNCH':'AAA FIRING'}</Text></Billboard>:null}
    <group position={to3(position,height)}>
    {isBurst?Array.from({length:effect.kind==='aaa'?7:4},(_,i)=><mesh key={i} position={[-i*.1,0,i*.04]}><sphereGeometry args={[effect.kind==='aaa' ? .055 : .045,6,4]}/><meshBasicMaterial color={color} transparent opacity={.95-i*.1} depthWrite={false}/></mesh>):<mesh rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[effect.kind==='sam' ? .065 : .045,effect.kind==='sam' ? .09 : .065,effect.kind==='sam' ? .62 : .42,8]}/><meshBasicMaterial color={color} transparent opacity={.98} depthWrite={false}/></mesh>}
    {effect.hit&&local>.78?<mesh><sphereGeometry args={[.18+local*.16,8,6]}/><meshBasicMaterial color="#ffb64a" transparent opacity={1-local*.55} depthWrite={false}/></mesh>:null}
    </group>
  </>
}

function ActiveSequenceVisual({sequence,seconds}:{sequence:CombatSequence;seconds:number}){
  if(seconds<sequence.start||seconds>sequence.end)return null
  const local=clamp01((seconds-sequence.start)/Math.max(.01,sequence.end-sequence.start))
  const radius=sequence.kind==='dogfight'?1.05:sequence.kind==='pursuit' ? .78 : .5
  const loops=Array.from({length:32},(_,i)=>{const t=i/31*Math.PI*2+local*Math.PI*2;return [sequence.location[0]+Math.cos(t)*radius,.64+Math.sin(i*.7)*.05,sequence.location[1]+Math.sin(t)*radius*.62] as [number,number,number]})
  const label=sequence.kind==='dogfight'?'DOGFIGHT':sequence.kind==='pursuit'?'RECON UNDER PURSUIT':sequence.kind==='defense'?'GROUND FIRE':'ATTACK RUN'
  return <group>
    <Line points={loops} color={sequence.kind==='dogfight'?hostile:amber} transparent opacity={.72} lineWidth={2}/>
    <Line points={loops.map((p,i)=>[p[0]*.985+sequence.location[0]*.015,p[1]+.05,p[2]*.985+sequence.location[1]*.015] as [number,number,number])} color={friendly} transparent opacity={.58} lineWidth={1.4}/>
    <Billboard position={[sequence.location[0],1.35,sequence.location[1]]} follow lockZ={false}><Text fontSize={.22} color="#f4e7b1" anchorX="center" outlineWidth={.015} outlineColor="#080806">{label}</Text></Billboard>
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
  const seconds=progress*EXECUTION_SECONDS
  const sequences=result?.combatSequences??[]
  const activeSequence=sequences.find(seq=>seconds>=seq.start&&seconds<=seq.end&&seq.participantIds.includes(squadron.id))
  const exchange=sequences.flatMap(seq=>seq.exchanges).filter(x=>x.defenderId===squadron.id&&x.time<=seconds).at(-1)
  const strength=exchange?.targetStrength??squadron.strength??Math.max(0,(squadron.aircraft/Math.max(1,squadron.maxAircraft))*100)
  const morale=exchange?.targetMorale??squadron.morale??70
  const finalStatus=result?.squadrons.find(s=>s.id===squadron.id)?.status
  const aircraft=strengthToAircraft(strength,squadron.maxAircraft)
  const damaged=Math.max(0,Math.round((100-strength)/25)-(squadron.maxAircraft-aircraft))
  return {aircraft,damaged,fraction:clamp01(strength/100),strength,morale,action:actionLabel(seconds>=EXECUTION_SECONDS-2?'rtb':finalStatus,activeSequence),hasDamage:strength<(squadron.strength??100)}
}

function enemyStatusAt(flight:EnemyFlight,result:RoundResult|undefined,progress:number):FlightStatus{
  const seconds=progress*EXECUTION_SECONDS
  const sequences=result?.combatSequences??[]
  const activeSequence=sequences.find(seq=>seconds>=seq.start&&seconds<=seq.end&&seq.participantIds.includes(flight.id))
  const exchange=sequences.flatMap(seq=>seq.exchanges).filter(x=>x.defenderId===flight.id&&x.time<=seconds).at(-1)
  const strength=exchange?.targetStrength??flight.strength??Math.max(0,(flight.aircraft/Math.max(1,flight.initialAircraft))*100)
  const morale=exchange?.targetMorale??flight.morale??62
  const finalStatus=result?.enemyFlights.find(f=>f.id===flight.id)?.status
  const aircraft=strengthToAircraft(strength,flight.initialAircraft)
  return {aircraft,damaged:0,fraction:clamp01(strength/100),strength,morale,action:actionLabel(finalStatus,activeSequence),hasDamage:strength<(flight.strength??100)}
}

function assetAtTime(asset:Asset,result:RoundResult|undefined,progress:number,enemy:boolean,phase:Phase):Asset{
  if(phase!=='execute'||!result)return asset
  const wasStruck=result.events.some(event=>event.time<=progress*EXECUTION_SECONDS&&groundDamageTitles.has(event.title)&&event.position&&distance2(event.position,asset.position)<.5)
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
  const seconds=progress*EXECUTION_SECONDS
  const observedAssetIds=new Set((executionResult?.contactObservations??[]).filter(o=>phase==='execute'&&seconds>=o.start&&seconds<=o.end&&o.targetId.startsWith('e-')).map(o=>o.targetId))
  const displayedPlayerAssets=playerAssets.map(asset=>assetAtTime(asset,executionResult,progress,false,phase))
  const displayedEnemyAssets=assets.map(asset=>{const timed=assetAtTime(asset,executionResult,progress,true,phase);return observedAssetIds.has(asset.id)&&timed.intel==='unknown'?{...timed,intel:'probable' as const,confidence:70,hidden:false}:timed})
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
    {displayedEnemyAssets.filter(a=>a.intel!=='unknown').map(a=><Text key={`${a.id}-label`} position={[a.position[0],.27,a.position[1]-.68]} rotation={[-Math.PI/2,0,0]} fontSize={.2} color={a.intel==='confirmed'?hostile:amber}>{observedAssetIds.has(a.id)&&assets.find(x=>x.id===a.id)?.intel==='unknown'?'OBSERVED':a.intel.toUpperCase()} {a.kind.toUpperCase()} · {a.confidence}%</Text>)}
    {phase!=='deploy'?squadrons.map(s=><Route key={s.id} squadron={s} selected={phase==='plan'&&s.id===selectedId}/>):null}
    {squadrons.filter(s=>(executionResult?.executionRoutes[s.id]??s.route).length>=2).map(s=><Flight key={s.id} squadron={s} route={executionResult?.executionRoutes[s.id]??s.route} active={phase==='execute'} progress={progress} selected={s.id===selectedId} status={friendlyStatusAt(s,executionResult,progress)} activeEvent={activeEvent} activeSequence={(executionResult?.combatSequences??[]).find(seq=>seconds>=seq.start&&seconds<=seq.end&&seq.participantIds.includes(s.id))}/>) }
    {phase==='execute'?executionResult?.enemyFlights.map(f=><EnemyContact key={f.id} flight={f} progress={progress} status={enemyStatusAt(f,executionResult,progress)} activeEvent={activeEvent} activeSequence={(executionResult?.combatSequences??[]).find(seq=>seconds>=seq.start&&seconds<=seq.end&&seq.participantIds.includes(f.id))}/>):null}
    {phase==='execute'?executionResult?.reinforcementCalls.map(call=><ReinforcementFlight key={call.id} call={call} progress={progress}/>):null}
    {phase==='execute'?executionResult?.defenseCues?.filter(c=>progress>=c.start&&progress<=c.end).map(c=><DefenseNetworkCue key={c.id} cue={c} radar={playerRadar}/>):null}
    {phase==='execute'?(executionResult?.combatSequences??[]).map(seq=><ActiveSequenceVisual key={seq.id} sequence={seq} seconds={seconds}/>):null}
    {phase==='execute'?(executionResult?.weaponEffects??[]).map(effect=><WeaponEffectVisual key={effect.id} effect={effect} seconds={seconds}/>):null}
    {phase==='debrief'&&executionResult?<HistoryOverlay result={executionResult}/>:null}
    {activeEvent?<CombatEffect key={activeEvent.id} event={activeEvent}/>:null}
    <mesh position={[0,3.2,0]} rotation={[-Math.PI/2,0,0]} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}><planeGeometry args={[20,28]}/><meshBasicMaterial transparent opacity={0} depthWrite={false}/></mesh>
  </>
}
const distance2=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1])
const clamp01=(value:number)=>Math.max(0,Math.min(1,value))

export const Battlefield=memo(function Battlefield(props:Props){return <Canvas orthographic shadows="basic" dpr={[1,1.5]} gl={{antialias:true,powerPreference:'high-performance'}}><CameraRig/><BattlefieldScene {...props}/></Canvas>})
