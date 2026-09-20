import { memo, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { Billboard, Line, MapControls, Text, useGLTF, useTexture } from '@react-three/drei'
import * as THREE from 'three'
import type { MapControls as MapControlsImpl } from 'three-stdlib'
import { effectiveSensorRange, EXECUTION_SECONDS, RADAR_COMMUNICATION_RANGE, RADAR_RANGE } from '../game/engine'
import { projectFriendlyUnitAt, projectHostileUnitAt, sampleUnitTrack, unitTrackFor, type HostileUnitProjection } from '../game/executionProjection'
import { axialToPoint, HEX_RADIUS, snapToHex } from '../game/hex'
import { deriveFogMaskSize, MAPPED_RADIUS, updateLiveFogMask, updatePersistentFogMask } from '../game/fog'
import { deriveDiscoveredBoundaryLines } from '../game/knownWorld'
import { fighterEngagementPresentationAt } from '../game/engagementPresentation'
import { deriveFlightGlyph } from '../game/flightGlyph'
import { airfieldLabel, formationBaseGroups } from '../game/formationBasing'
import { fighterResponsibilityFor } from '../game/missionResponsibility'
import { cameraPresentationForPhase, commandMapFitZoom } from '../game/cameraPresentation'
import type { Asset, BoundarySegment, CampaignWorld, CombatEvent, CombatSequence, ConstructibleAssetKind, DefenseCue, EnemyFlight, Phase, Point, ReinforcementCall, RoundResult, Squadron, UnitFrame, WeaponEffect, WorldBounds } from '../game/types'
import type { FogMaskInput, MapObservation } from '../game/fog'

const friendly='#55d6df', amber='#d99a25', hostile='#de4f3f'
const EMPTY_BOUNDARIES:BoundarySegment[]=[]
const airLossTitles=new Set(['AIRCRAFT LOST','PURSUIT LOSS','ENEMY AIRCRAFT LOST','FIGHTER FORMATION LOST','OPENING-FIRE KILL','RECON DESTROYED'])
const airDamageTitles=new Set(['DAMAGE REPORTED','OVEREXTENSION DAMAGE'])
const groundDamageTitles=new Set(['WEAPONS IMPACT','TARGET DESTROYED','HOME BASE STRUCK','DEFENSE SITE DAMAGED'])
const to3=(p:Point,y=.13):[number,number,number]=>[p[0],y,p[1]]
const groundPlane=new THREE.Plane(new THREE.Vector3(0,1,0),0)
const flightCurve=(route:Point[],altitude:number)=>{const points=route.map(p=>new THREE.Vector3(p[0],altitude,p[1]));const path=new THREE.CurvePath<THREE.Vector3>();for(let index=1;index<points.length;index++)path.add(new THREE.LineCurve3(points[index-1],points[index]));return path}
const flightPoint=(curve:THREE.CurvePath<THREE.Vector3>,progress:number)=>{const normalized=Math.min(.999,Math.max(0,progress));const point=curve.getPointAt(normalized);const altitude=Math.min(1,normalized/.055,(1-normalized)/.085);point.y=.15+.45*Math.max(0,altitude);return point}
type FriendlyTerritory=CampaignWorld['friendlyTerritory']
const boundsCenter=(bounds:WorldBounds):Point=>[(bounds.minX+bounds.maxX)/2,(bounds.minZ+bounds.maxZ)/2]
const boundsWidth=(bounds:WorldBounds)=>bounds.maxX-bounds.minX
const boundsDepth=(bounds:WorldBounds)=>bounds.maxZ-bounds.minZ
const expandBounds=(bounds:WorldBounds,margin:number):WorldBounds=>({minX:bounds.minX-margin,maxX:bounds.maxX+margin,minZ:bounds.minZ-margin,maxZ:bounds.maxZ+margin})
const territoryBounds=(territory:FriendlyTerritory):WorldBounds=>({minX:territory.center[0]-territory.radius,maxX:territory.center[0]+territory.radius,minZ:territory.center[1]-territory.radius,maxZ:territory.center[1]+territory.radius})

function CameraRig({phase,friendlyTerritory,planningBounds,presentationBounds,focusPoint,followKey}:{phase:Phase;friendlyTerritory:FriendlyTerritory;planningBounds:WorldBounds;presentationBounds:WorldBounds;focusPoint?:Point;followKey?:string}){
  const {camera,size}=useThree(),controls=useRef<MapControlsImpl>(null)
  const {width:viewportWidth,height:viewportHeight}=size
  const presentation=cameraPresentationForPhase(phase)
  const minimumZoom=useMemo(()=>Math.max(viewportWidth/Math.max(1,boundsWidth(presentationBounds)-2),viewportHeight/Math.max(1,boundsDepth(presentationBounds)-2)),[presentationBounds,viewportHeight,viewportWidth])
  useEffect(()=>{const c=camera as THREE.OrthographicCamera,target=friendlyTerritory.center,{offset,up}=presentation;c.up.set(...up);c.position.set(target[0]+offset[0],offset[1],target[1]+offset[2]);c.lookAt(target[0],0,target[1]);c.zoom=presentation.kind==='command-map'?commandMapFitZoom({width:viewportWidth,height:viewportHeight},friendlyTerritory.radius,minimumZoom):Math.min(64,Math.max(minimumZoom,viewportHeight/presentation.worldHeight));c.updateProjectionMatrix();controls.current?.target.set(target[0],0,target[1]);controls.current?.update()},[camera,friendlyTerritory.center[0],friendlyTerritory.center[1],friendlyTerritory.radius,minimumZoom,presentation,viewportHeight,viewportWidth])
  useEffect(()=>{if(!followKey||presentation.kind==='command-map')return;const c=camera as THREE.OrthographicCamera;c.zoom=Math.min(64,Math.max(minimumZoom,viewportHeight/presentation.followWorldHeight));c.updateProjectionMatrix()},[camera,followKey,minimumZoom,presentation,viewportHeight])
  useFrame((_,delta)=>{const c=camera as THREE.OrthographicCamera,control=controls.current;if(!control)return;if(focusPoint){const desired=new THREE.Vector3(focusPoint[0],0,focusPoint[1]),shift=desired.sub(control.target).multiplyScalar(Math.min(1,delta*5));control.target.add(shift);c.position.add(shift)}const halfWidth=size.width/(2*c.zoom),halfDepth=size.height/(2*c.zoom),padding=.75,safeMinX=presentationBounds.minX+halfWidth+padding,safeMaxX=presentationBounds.maxX-halfWidth-padding,safeMinZ=presentationBounds.minZ+halfDepth+padding,safeMaxZ=presentationBounds.maxZ-halfDepth-padding,minX=Math.max(planningBounds.minX,Math.min(safeMinX,safeMaxX)),maxX=Math.min(planningBounds.maxX,Math.max(safeMinX,safeMaxX)),minZ=Math.max(planningBounds.minZ,Math.min(safeMinZ,safeMaxZ)),maxZ=Math.min(planningBounds.maxZ,Math.max(safeMinZ,safeMaxZ)),nextX=minX<=maxX?THREE.MathUtils.clamp(control.target.x,minX,maxX):(presentationBounds.minX+presentationBounds.maxX)/2,nextZ=minZ<=maxZ?THREE.MathUtils.clamp(control.target.z,minZ,maxZ):(presentationBounds.minZ+presentationBounds.maxZ)/2,shift=new THREE.Vector3(nextX-control.target.x,0,nextZ-control.target.z);if(shift.lengthSq()>0){control.target.add(shift);c.position.add(shift)}control.update()})
  return <MapControls ref={controls} makeDefault enableRotate={false} enableDamping dampingFactor={.12} screenSpacePanning minZoom={minimumZoom} maxZoom={64} mouseButtons={{LEFT:THREE.MOUSE.PAN,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.PAN}} touches={{ONE:THREE.TOUCH.PAN,TWO:THREE.TOUCH.DOLLY_PAN}}/>
}

function HexOverlay({opacity,bounds}:{opacity:number;bounds:WorldBounds}){
  const geometry=useMemo(()=>{const vertices:number[]=[];const extent=Math.max(Math.abs(bounds.minX),Math.abs(bounds.maxX),Math.abs(bounds.minZ),Math.abs(bounds.maxZ)),limit=Math.ceil(extent/HEX_RADIUS)+5;for(let r=-limit;r<=limit;r++){for(let q=-limit;q<=limit;q++){const [x,z]=axialToPoint(q,r);if(x<bounds.minX||x>bounds.maxX||z<bounds.minZ||z>bounds.maxZ)continue;for(let edge=0;edge<6;edge++){const a=Math.PI/6+edge*Math.PI/3,b=Math.PI/6+(edge+1)*Math.PI/3;vertices.push(x+Math.cos(a)*HEX_RADIUS,.075,z+Math.sin(a)*HEX_RADIUS,x+Math.cos(b)*HEX_RADIUS,.075,z+Math.sin(b)*HEX_RADIUS)}}}return new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(vertices,3))},[bounds])
  useEffect(()=>()=>geometry.dispose(),[geometry])
  return <lineSegments geometry={geometry}><lineBasicMaterial color="#d9dbc0" transparent opacity={opacity} depthWrite={false}/></lineSegments>
}

function PlacementHex({position}:{position:Point}){
  const outline=useMemo(()=>Array.from({length:7},(_,i)=>{const a=Math.PI/6+i*Math.PI/3;return [Math.cos(a)*HEX_RADIUS,.1,Math.sin(a)*HEX_RADIUS] as [number,number,number]}),[])
  return <group position={to3(position,.02)}><mesh rotation={[-Math.PI/2,0,Math.PI/6]}><circleGeometry args={[HEX_RADIUS*.88,6]}/><meshBasicMaterial color="#f1c65b" transparent opacity={.13} depthWrite={false}/></mesh><Line points={outline} color="#f1c65b" opacity={.95} transparent lineWidth={2}/></group>
}

const terrainUnit=(index:number,salt:number)=>{const value=Math.sin(index*91.17+salt*43.71)*43758.5453;return value-Math.floor(value)}
type TerrainRidge={index:number;x:number;z:number;s:number;h:number}
function TerrainRidges({ridges}:{ridges:TerrainRidge[]}){
  const muted=useRef<THREE.InstancedMesh>(null),warm=useRef<THREE.InstancedMesh>(null)
  const groups=useMemo(()=>[ridges.filter(ridge=>ridge.index%3!==0),ridges.filter(ridge=>ridge.index%3===0)],[ridges])
  useEffect(()=>{const dummy=new THREE.Object3D();for(const [group,ref] of [[groups[0],muted],[groups[1],warm]] as const){if(!ref.current)continue;group.forEach((ridge,instance)=>{dummy.position.set(ridge.x,ridge.h/2,ridge.z);dummy.rotation.set(0,ridge.index*.7,0);dummy.scale.set(ridge.s,ridge.h,ridge.s);dummy.updateMatrix();ref.current!.setMatrixAt(instance,dummy.matrix)});ref.current.instanceMatrix.needsUpdate=true}},[groups])
  return <><instancedMesh ref={muted} args={[undefined,undefined,groups[0].length]} castShadow receiveShadow><coneGeometry args={[1,1,5]}/><meshStandardMaterial color="#454c35" roughness={1}/></instancedMesh><instancedMesh ref={warm} args={[undefined,undefined,groups[1].length]} castShadow receiveShadow><coneGeometry args={[1,1,5]}/><meshStandardMaterial color="#6f6b48" roughness={1}/></instancedMesh></>
}
function Terrain({phase,presentationBounds,planningBounds}:{phase:Phase;presentationBounds:WorldBounds;planningBounds:WorldBounds}){
  const width=boundsWidth(presentationBounds),depth=boundsDepth(presentationBounds),center=boundsCenter(presentationBounds)
  const ridges=useMemo(()=>Array.from({length:Math.max(62,Math.ceil(width*depth/15))},(_,index)=>({index,x:presentationBounds.minX+terrainUnit(index,1)*width,z:presentationBounds.minZ+terrainUnit(index,2)*depth,s:.28+terrainUnit(index,3)*.64,h:.14+terrainUnit(index,4)*.7})),[depth,presentationBounds.minX,presentationBounds.minZ,width])
  const hexOpacity=phase==='deploy' ? .2 : 0
  return <group>
    <mesh receiveShadow position={[center[0],0,center[1]]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[width,depth]}/><meshStandardMaterial color="#596044" roughness={1}/></mesh>
    <mesh position={[center[0],.035,center[1]]} rotation={[-Math.PI/2,0,-.11]}><planeGeometry args={[1.55,depth+1]}/><meshStandardMaterial color="#233d42" roughness={.72}/></mesh>
    <TerrainRidges ridges={ridges}/>
    {hexOpacity>0?<HexOverlay opacity={hexOpacity} bounds={planningBounds}/>:null}
    <mesh position={[center[0],-.03,center[1]]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[width+.2,depth+.2]}/><meshBasicMaterial color="#0c0f0c" transparent opacity={.08}/></mesh>
  </group>
}

const fogVertexShader=`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`
const fogFragmentShader=`uniform sampler2D uPersistentMask;uniform sampler2D uLiveMask;uniform vec4 uWorldBounds;varying vec2 vUv;
float hash21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float valueNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);float a=hash21(i),b=hash21(i+vec2(1.0,0.0)),c=hash21(i+vec2(0.0,1.0)),d=hash21(i+vec2(1.0,1.0));return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
void main(){float persistent=texture2D(uPersistentMask,vUv).r;float live=texture2D(uLiveMask,vUv).r;float knowledge=max(persistent,live);float mapped=smoothstep(0.0,0.6,knowledge);float observed=smoothstep(0.6,1.0,knowledge);vec2 world=vec2(mix(uWorldBounds.x,uWorldBounds.y,vUv.x),mix(uWorldBounds.w,uWorldBounds.z,vUv.y));float noise=(valueNoise(world*0.285)+0.45*valueNoise(world*1.25))/1.45-0.5;float alpha=mix(0.54,0.22,mapped);alpha=mix(alpha,0.025,observed);alpha+=noise*mix(0.022,0.012,mapped)*(1.0-observed);vec3 color=mix(vec3(0.1059,0.1451,0.1137),vec3(0.1686,0.2039,0.1647),mapped);gl_FragColor=vec4(color,clamp(alpha,0.0,0.62));}`
const makeFogTexture=(data:Uint8Array,width:number,height:number)=>{const texture=new THREE.DataTexture(data,width,height,THREE.RedFormat,THREE.UnsignedByteType);texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;texture.wrapS=THREE.ClampToEdgeWrapping;texture.wrapT=THREE.ClampToEdgeWrapping;texture.generateMipmaps=false;return texture}
const FogOfWar=memo(function FogOfWar({mappedAreas,observations,presentationBounds,friendlyTerritory}:{mappedAreas:Point[];observations:MapObservation[];presentationBounds:WorldBounds;friendlyTerritory:FriendlyTerritory}){
  const size=useMemo(()=>deriveFogMaskSize(presentationBounds),[presentationBounds])
  const persistentData=useMemo(()=>new Uint8Array(size.width*size.height),[size.height,size.width])
  const liveData=useMemo(()=>new Uint8Array(size.width*size.height),[size.height,size.width])
  const persistentTexture=useMemo(()=>makeFogTexture(persistentData,size.width,size.height),[persistentData,size.height,size.width])
  const liveTexture=useMemo(()=>makeFogTexture(liveData,size.width,size.height),[liveData,size.height,size.width])
  const lastLiveUpdate=useRef(-Infinity)
  const persistentInput=useMemo<FogMaskInput>(()=>({mappedAreas,observations:[],width:size.width,height:size.height,presentationBounds,friendlyTerritory}),[friendlyTerritory.center[0],friendlyTerritory.center[1],friendlyTerritory.radius,mappedAreas,presentationBounds.maxX,presentationBounds.maxZ,presentationBounds.minX,presentationBounds.minZ,size.height,size.width])
  const latestLiveInput=useRef<FogMaskInput>({mappedAreas:[],observations:[],width:size.width,height:size.height,presentationBounds,friendlyTerritory})
  useEffect(()=>{latestLiveInput.current={mappedAreas:[],observations,width:size.width,height:size.height,presentationBounds,friendlyTerritory}},[friendlyTerritory,observations,presentationBounds,size.height,size.width])
  useEffect(()=>{updatePersistentFogMask(persistentInput,persistentData);persistentTexture.needsUpdate=true},[persistentData,persistentInput,persistentTexture])
  useFrame(({clock})=>{if(clock.elapsedTime-lastLiveUpdate.current<.05)return;lastLiveUpdate.current=clock.elapsedTime;updateLiveFogMask(latestLiveInput.current,liveData);liveTexture.needsUpdate=true})
  useEffect(()=>()=>{persistentTexture.dispose();liveTexture.dispose()},[persistentTexture,liveTexture])
  const width=boundsWidth(presentationBounds),depth=boundsDepth(presentationBounds),center=boundsCenter(presentationBounds)
  const uniforms=useMemo(()=>({uPersistentMask:{value:persistentTexture},uLiveMask:{value:liveTexture},uWorldBounds:{value:new THREE.Vector4(presentationBounds.minX,presentationBounds.maxX,presentationBounds.minZ,presentationBounds.maxZ)}}),[liveTexture,persistentTexture,presentationBounds])
  return <mesh position={[center[0],.095,center[1]]} rotation={[-Math.PI/2,0,0]} renderOrder={-8}>
    <planeGeometry args={[width,depth,1,1]}/>
    <shaderMaterial transparent depthWrite={false} depthTest toneMapped={false} uniforms={uniforms} vertexShader={fogVertexShader} fragmentShader={fogFragmentShader}/>
  </mesh>
})

function DiscoveredBoundaryLines({segments}:{segments:BoundarySegment[]}){const lines=useMemo(()=>deriveDiscoveredBoundaryLines(segments),[segments]);return <group>{lines.map((line,index)=><Line key={`${line.edge}-${index}`} points={[to3(line.from,.11),to3(line.to,.11)]} color="#c5b77a" transparent opacity={.58} lineWidth={1.15}/>)}</group>}

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

function Runway({asset,enemy=false,selected=false,onSelect}:{asset:Asset;enemy?:boolean;selected?:boolean;onSelect?:()=>void}){
  const severity=1-clamp01(asset.health/Math.max(1,asset.maxHealth))
  const position=asset.position
  const health=asset.health
  const forward=asset.kind==='fob'
  const length=forward?1.35:2
  return <group position={to3(position,.14)} rotation={[0,.2,0]} onClick={event=>{event.stopPropagation();onSelect?.()}}>
    {selected?<mesh position={[0,.01,0]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[forward?.62:.78,forward?.7:.86,32]}/><meshBasicMaterial color="#7ceaf0" depthTest={false}/></mesh>:null}
    <mesh castShadow><boxGeometry args={[length,.08,forward?.38:.5]}/><meshStandardMaterial color={health>0?'#343732':'#25221f'} roughness={.9}/></mesh>
    {(forward?[-.4,0,.4]:[-.65,0,.65]).map(x=><mesh key={x} position={[x,.05,0]}><boxGeometry args={[.2,.012,.035]}/><meshBasicMaterial color={enemy?'#bd5b4a':'#d2cfb5'}/></mesh>)}
    <mesh position={[0,.16,forward?-.34:-.46]} castShadow><boxGeometry args={[forward?.34:.48,.25,forward?.34:.45]}/><meshStandardMaterial color={enemy?'#5d4035':'#42585b'}/></mesh>
    {asset.struck?<HealthBar3D fraction={health/asset.maxHealth} label={`${Math.round(health)}%`} position={[0,.88,0]}/>:null}
    {asset.struck&&health<asset.maxHealth?<DamageSmoke severity={Math.max(.15,severity)} position={[0,.22,-.1]}/>:null}
  </group>
}

function ConstructionPlacementGhost({position,valid,kind}:{position:Point;valid:boolean;kind:ConstructibleAssetKind}){
  const color=valid?'#7ceaf0':'#de4f3f'
  return <group position={to3(position,.2)} rotation={[0,.2,0]}>
    {kind==='fob'||kind==='decoy'?<mesh><boxGeometry args={[kind==='fob'?1.35:2,.08,kind==='fob' ? .38 : .5]}/><meshBasicMaterial color={color} transparent opacity={.58} depthTest={false}/></mesh>:<mesh position={[0,.18,0]}><cylinderGeometry args={[kind==='sam' ? .28 : .22,.36,.36,6]}/><meshBasicMaterial color={color} transparent opacity={.58} depthTest={false}/></mesh>}
    <mesh position={[0,.01,0]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.7,.78,32]}/><meshBasicMaterial color={color} transparent opacity={.9} depthTest={false}/></mesh>
    <Text position={[0,.52,0]} fontSize={.2} color={color} anchorX="center" outlineWidth={.012} outlineColor="#080a08">{valid?`VALID ${kind.toUpperCase()} SITE`:'INVALID SITE'}</Text>
  </group>
}

function Radar({asset,enemy=false,selected=false,onSelect}:{asset:Asset,enemy?:boolean;selected?:boolean;onSelect?:()=>void}){
  const ref=useRef<THREE.Group>(null)
  useFrame((_,d)=>{if(ref.current)ref.current.rotation.y+=d*.45})
  return <group position={to3(asset.position,.15)} onClick={event=>{event.stopPropagation();onSelect?.()}}>{selected?<mesh position={[0,.01,0]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.56,.64,32]}/><meshBasicMaterial color="#7ceaf0" depthTest={false}/></mesh>:null}<mesh castShadow position={[0,.18,0]}><cylinderGeometry args={[.24,.3,.36,8]}/><meshStandardMaterial color={asset.health>0?'#55584d':'#292522'}/></mesh><group ref={ref} position={[0,.5,0]} rotation={[0,0,.2]}><mesh castShadow><sphereGeometry args={[.32,8,5,0,Math.PI]}/><meshStandardMaterial color={enemy?'#8f604d':'#b9c1ac'} side={THREE.DoubleSide}/></mesh></group>{asset.struck?<HealthBar3D fraction={asset.health/asset.maxHealth} label={`${Math.round(asset.health)}%`} position={[0,1.08,0]}/>:null}{asset.struck&&asset.health<asset.maxHealth?<DamageSmoke severity={1-asset.health/asset.maxHealth} position={[0,.45,0]}/>:null}</group>
}

function DefenseNetworkCue({cue,radar}:{cue:DefenseCue;radar:Point}){
  const ref=useRef<THREE.Group>(null)
  useFrame(({clock})=>{if(ref.current){const pulse=1+Math.sin(clock.elapsedTime*4)*.018;ref.current.scale.setScalar(pulse)}})
  return <group ref={ref} position={to3(radar,.2)}><Ring radius={RADAR_RANGE+cue.rangeBonus} color="#9ee6a8" opacity={.5}/><Text position={[0,.18,-RADAR_RANGE-cue.rangeBonus-.35]} rotation={[-Math.PI/2,0,0]} fontSize={.24} color="#9ee6a8">CUED DEFENSE +{cue.rangeBonus.toFixed(1)}</Text></group>
}

function Ring({radius,color,opacity=.32,dashSize=.18,gapSize=.12,lineWidth=1,dashed=true}:{radius:number,color:string,opacity?:number,dashSize?:number,gapSize?:number,lineWidth?:number,dashed?:boolean}){
  const pts=useMemo(()=>Array.from({length:49},(_,i)=>{const a=i/48*Math.PI*2;return [Math.cos(a)*radius,.07,Math.sin(a)*radius] as [number,number,number]}),[radius])
  return dashed?<Line points={pts} color={color} transparent opacity={opacity} dashed dashSize={dashSize} gapSize={gapSize} lineWidth={lineWidth} depthTest={false}/>:<Line points={pts} color={color} transparent opacity={opacity} lineWidth={lineWidth} depthTest={false}/>
}

function CoverageDome({radius,color='#4aa9e8',illuminated=false}:{radius:number;color?:string;illuminated?:boolean}){
  const material=useRef<THREE.MeshStandardMaterial>(null)
  useFrame(({clock})=>{if(!material.current)return;const pulse=illuminated?(Math.sin(clock.elapsedTime*5)+1)/2:0;material.current.opacity=illuminated?.18+pulse*.08:.095;material.current.emissiveIntensity=illuminated?.42+pulse*.48:0})
  return <mesh position={[0,.02,0]} renderOrder={0}>
    <sphereGeometry args={[radius,32,12,0,Math.PI*2,0,Math.PI/2]}/>
    <meshStandardMaterial ref={material} color={color} emissive={color} transparent opacity={.095} depthWrite={false} side={THREE.DoubleSide} roughness={.8}/>
  </mesh>
}

function SensorRangeOverlay({phase,radar,position,losRange,showLos}:{phase:Phase;radar?:Asset;position:Point;losRange:number;showLos:boolean}){
  const showGround=(phase==='deploy'||phase==='plan')&&radar?.health!>0
  return <group renderOrder={1}>
    {showGround?<group position={to3(radar!.position,.1)}><CoverageDome radius={RADAR_RANGE}/><Ring radius={RADAR_RANGE} color="#4aa9e8" opacity={.58} dashSize={.42} gapSize={.16} lineWidth={1.5}/><Ring radius={RADAR_COMMUNICATION_RANGE} color="#8bd6a2" opacity={.42} dashSize={.06} gapSize={.2} lineWidth={1.35}/></group>:null}
    {showLos?<group position={to3(position,.16)} renderOrder={7}><mesh rotation={[-Math.PI/2,0,0]} renderOrder={7}><circleGeometry args={[losRange,96]}/><meshBasicMaterial color="#4debf2" transparent opacity={phase==='plan'?.055:.025} depthTest={false} depthWrite={false}/></mesh><mesh rotation={[-Math.PI/2,0,0]} renderOrder={9}><ringGeometry args={[Math.max(.05,losRange-.055),losRange+.055,96]}/><meshBasicMaterial color="#65f2f6" transparent opacity={.96} depthTest={false} depthWrite={false}/></mesh><Text position={[0,.04,-losRange-.28]} rotation={[-Math.PI/2,0,0]} fontSize={.14} color="#9affff" anchorX="center" outlineWidth={.012} outlineColor="#0b2021">{phase==='plan'?'LOS':'DETECTION'} · {losRange.toFixed(1)}</Text></group>:null}
  </group>
}

function ActiveCoverageOverlay({asset}:{asset:Asset}){
  const radius=asset.kind==='sam'?3.2:1.9
  const color='#d99a25'
  return <group position={to3(asset.position,.1)}>
    {asset.kind!=='aaa'?<CoverageDome radius={radius} color={color} illuminated/>:null}
    <Ring radius={radius} color={color} opacity={.88} dashSize={.16} gapSize={.08} lineWidth={2}/>
  </group>
}

function Defense({asset,enemy=true,selected=false,showRange=true,onSelect}:{asset:Asset;enemy?:boolean;selected?:boolean;showRange?:boolean;onSelect?:()=>void}){
  const shown=!enemy||asset.intel!=='unknown'; if(!shown)return null
  if(asset.kind==='radar')return <Radar asset={asset} enemy={enemy} selected={selected} onSelect={onSelect}/>
  return <group position={to3(asset.position,.15)} onClick={event=>{event.stopPropagation();onSelect?.()}}>
    {selected?<mesh position={[0,.01,0]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.56,.64,32]}/><meshBasicMaterial color="#7ceaf0" depthTest={false}/></mesh>:null}
    <mesh castShadow><cylinderGeometry args={[.34,.42,.15,8]}/><meshStandardMaterial color={asset.health>0?'#7a493d':'#292522'}/></mesh>
    {asset.kind==='sam'?[-.18,.18].map(x=><mesh key={x} position={[x,.35,0]} rotation={[0,0,-.28]} castShadow><cylinderGeometry args={[.045,.065,.62,6]}/><meshStandardMaterial color="#aa9a75"/></mesh>):<mesh position={[0,.28,0]}><boxGeometry args={[.45,.28,.2]}/><meshStandardMaterial color="#4d4036"/></mesh>}
    {showRange?<Ring radius={asset.kind==='sam'?3.2:1.9} color="#d99a25" opacity={selected ? .65 : .32} dashSize={.16} gapSize={.08}/>:null}
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

const formationSlots:[number,number,number][]=[[-.34,0,.26],[.34,0,.26],[-.2,0,-.28],[.2,0,-.28]]
function AircraftFormation({role,aircraft,color=friendly,enemy=false}:{role:Squadron['role'];aircraft:number;color?:string;enemy?:boolean}){
  const count=Math.max(0,Math.min(formationSlots.length,Math.round(aircraft)))
  return <group>{formationSlots.slice(0,count).map((position,index)=><group key={index} position={position} scale={[.42,.42,.42]}><PlaneModel role={role} color={color} enemy={enemy}/></group>)}</group>
}

useGLTF.preload('/assets/f16.glb')
useGLTF.preload('/assets/mig-23_mld.glb')

function SearchAreaOverlay({points,selected}:{points:Point[];selected:boolean}){
  if(points.length<4)return null
  const minX=Math.min(...points.map(point=>point[0])),maxX=Math.max(...points.map(point=>point[0])),minZ=Math.min(...points.map(point=>point[1])),maxZ=Math.max(...points.map(point=>point[1]))
  const width=Math.max(.3,maxX-minX),height=Math.max(.3,maxZ-minZ),center:[number,number]=[(minX+maxX)/2,(minZ+maxZ)/2],color=selected?'#7ceaf0':'#348c93'
  const vertical=Array.from({length:6},(_,index)=>minX+width*index/5),horizontal=Array.from({length:6},(_,index)=>minZ+height*index/5)
  return <group renderOrder={2}><mesh position={to3(center,.026)} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[width,height]}/><meshBasicMaterial color={color} transparent opacity={selected ? .12 : .045} depthTest={false} depthWrite={false}/></mesh><Line points={[to3([minX,minZ],.034),to3([maxX,minZ],.034),to3([maxX,maxZ],.034),to3([minX,maxZ],.034),to3([minX,minZ],.034)]} color={color} transparent opacity={selected ? .9 : .32} lineWidth={selected?1.4:.8} depthTest={false}/>{vertical.map((x,index)=><Line key={`vertical-${index}`} points={[to3([x,minZ],.032),to3([x,maxZ],.032)]} color={color} transparent opacity={selected ? .5 : .16} lineWidth={.65} depthTest={false}/>) }{horizontal.map((z,index)=><Line key={`horizontal-${index}`} points={[to3([minX,z],.033),to3([maxX,z],.033)]} color={color} transparent opacity={selected ? .5 : .16} lineWidth={.65} depthTest={false}/>)}</group>
}

function ResponsibilityCircle({center,radius,selected}:{center:Point;radius:number;selected:boolean}){
  const points=useMemo(()=>Array.from({length:65},(_,index)=>{const angle=index*Math.PI*2/64;return to3([center[0]+Math.cos(angle)*radius,center[1]+Math.sin(angle)*radius],.042)}),[center,radius])
  return <group renderOrder={8}><Line points={points} color="#9ee6a8" transparent opacity={selected?.9:.25} dashed dashSize={.24} gapSize={.13} lineWidth={selected?1.7:.8} depthTest={false}/>{selected?<Text position={to3([center[0],center[1]-radius-.3],.09)} rotation={[-Math.PI/2,0,0]} fontSize={.14} color="#b9f2c1" anchorX="center" outlineWidth={.01} outlineColor="#102015">ENGAGE AREA</Text>:null}</group>
}

function ResponsibilityCorridor({path,halfWidth,selected}:{path:Point[];halfWidth:number;selected:boolean}){
  const [left,right]=useMemo(()=>{
    const closed=path.length>2&&Math.hypot(path[0][0]-path.at(-1)![0],path[0][1]-path.at(-1)![1])<.001
    const source=closed?path.slice(0,-1):path
    const offset=(side:number)=>{
      const points=source.map((point,index)=>{
        const previous=closed?source[(index+source.length-1)%source.length]:source[Math.max(0,index-1)]
        const next=closed?source[(index+1)%source.length]:source[Math.min(source.length-1,index+1)]
        const dx=next[0]-previous[0],dz=next[1]-previous[1],length=Math.hypot(dx,dz)||1
        return to3([point[0]+(-dz/length)*halfWidth*side,point[1]+(dx/length)*halfWidth*side],.044)
      })
      return closed?[...points,points[0]]:points
    }
    return [offset(-1),offset(1)] as const
  },[halfWidth,path])
  return <group renderOrder={8}><Line points={left} color="#9ee6a8" transparent opacity={selected?.82:.2} dashed dashSize={.28} gapSize={.13} lineWidth={selected?1.25:.7} depthTest={false}/><Line points={right} color="#9ee6a8" transparent opacity={selected?.82:.2} dashed dashSize={.28} gapSize={.13} lineWidth={selected?1.25:.7} depthTest={false}/></group>
}

const ResponsibilityOverlay=memo(function ResponsibilityOverlay({squadron,selected}:{squadron:Squadron;selected:boolean}){
  const responsibility=useMemo(()=>fighterResponsibilityFor(squadron),[squadron])
  if(!responsibility)return null
  return responsibility.kind==='circle'?<ResponsibilityCircle center={responsibility.center} radius={responsibility.radius} selected={selected}/>:<ResponsibilityCorridor path={responsibility.path} halfWidth={responsibility.halfWidth} selected={selected}/>
})

function RecoveryLatchCue({position,selected}:{position:Point;selected:boolean}){
  const pulse=useRef<THREE.Group>(null)
  useFrame(()=>{if(!pulse.current)return;const phase=(performance.now()/1000)%1.6;const scale=.65+phase/1.6*1.2;pulse.current.scale.setScalar(scale);pulse.current.children.forEach(child=>{const material=(child as THREE.Mesh).material as THREE.MeshBasicMaterial;if(material)material.opacity=(1-phase/1.6)*(selected?.72:.38)})})
  return <group position={to3(position,.06)}><group ref={pulse}><mesh rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.48,.56,32]}/><meshBasicMaterial color="#9ee6a8" transparent opacity={.65} depthWrite={false}/></mesh><mesh rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.12,.17,24]}/><meshBasicMaterial color="#d7ffe0" transparent opacity={.7} depthWrite={false}/></mesh></group><Billboard position={[0,.42,0]} follow lockZ={false}><Text fontSize={.17} color="#9ee6a8" anchorX="center" outlineWidth={.012} outlineColor="#102015">LATCHED · TRANSIT</Text></Billboard></group>
}

function Route({squadron,selected,packageReview=false,recoveryLabel}:{squadron:Squadron,selected:boolean,packageReview?:boolean;recoveryLabel?:string}){
  if(squadron.route.length<2)return null
  const ingressLength=Math.min(squadron.routeIngress.length,squadron.route.length),ingress=squadron.route.slice(0,ingressLength),station=squadron.route.slice(Math.max(0,ingressLength-1)),hasStation=station.length>1
  const ghostOpacity=packageReview?.62:.18
  const recovery=Boolean(squadron.plannedRecoveryFieldId||recoveryLabel),routeColor=recovery?'#9ee6a8':selected?'#7ceaf0':'#348c93'
  return <group>{ingress.length>1?<Line points={ingress.map(p=>to3(p,.065))} color={routeColor} opacity={selected||recovery?1:ghostOpacity} transparent lineWidth={selected||recovery?2.2:1} depthTest={false}/>:null}{hasStation&&!recovery?<Line points={station.map(p=>to3(p,.07))} color={selected?'#f1c65b':'#7a7250'} opacity={selected?.9:ghostOpacity} transparent lineWidth={selected?1.7:1} depthTest={false}/>:null}{squadron.mission==='search-area'&&!recovery?<SearchAreaOverlay points={station.slice(1)} selected={selected}/>:null}{selected?ingress.map((p,i)=><group key={i} position={to3(p,.08)}><mesh position={[0,.1,0]}><sphereGeometry args={[i===ingress.length-1?.15:.1,12,8]}/><meshBasicMaterial color={recovery?'#9ee6a8':friendly}/></mesh></group>):null}{recoveryLabel?<Billboard position={to3(squadron.route.at(-1)??[0,0],.82)} follow lockZ={false}><Text fontSize={.18} color="#9ee6a8" anchorX="center" outlineWidth={.012} outlineColor="#102015">RTB · {recoveryLabel}</Text></Billboard>:null}</group>
}

type FlightStatus={aircraft:number;damaged:number;fraction:number;hasDamage:boolean;strength:number;morale:number;action:string;landed:boolean}
const strengthToAircraft=(strength:number,maxAircraft:number)=>strength<=0?0:Math.max(1,Math.min(maxAircraft,Math.ceil(strength/25)))
const actionLabel=(status?:string)=>status==='dogfighting'?'DOGFIGHT':status==='attacking-recon'?'PURSUIT':status==='intercepting'?'INTERCEPT':status==='recovering'||status==='recovered'||status==='rtb'?'RTB':status==='destroyed'?'DESTROYED':status==='disengaging'?'BREAKING CONTACT':'ENROUTE'
function dogfightWeaponEffects(sequences:CombatSequence[],result:RoundResult|undefined):WeaponEffect[]{
  return sequences.flatMap(sequence=>sequence.kind==='dogfight'?sequence.exchanges.filter(exchange=>exchange.phase==='merged').flatMap(exchange=>{
    const start=Math.max(sequence.start,exchange.time-.18)
    const from=sampleUnitTrack(unitTrackFor(result,exchange.attackerId),start)?.position
    const to=sampleUnitTrack(unitTrackFor(result,exchange.defenderId),exchange.time)?.position
    return from&&to?[{id:`weapon-${sequence.id}-${exchange.id}`,kind:exchange.weapon,sourceId:exchange.attackerId,targetId:exchange.defenderId,start,end:exchange.time+.16,from,to,hit:exchange.hit,damage:exchange.damage}]:[]
  }):[])
}

function AircraftSmoke(){
  const ref=useRef<THREE.Group>(null)
  const age=useRef(0)
  useFrame((_,delta)=>{age.current+=delta;if(!ref.current)return;ref.current.children.forEach((child,index)=>{const cycle=(age.current*.5+index*.34)%1;child.position.z=.36+cycle*.8;child.position.y=.02+Math.sin(age.current*2+index)*.035;const scale=.12+cycle*.24;child.scale.setScalar(scale);((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity=(1-cycle)*.46})})
  return <group ref={ref}>{[0,1,2].map(i=><mesh key={i}><sphereGeometry args={[.18,6,4]}/><meshBasicMaterial color="#34342f" transparent opacity={.38} depthWrite={false}/></mesh>)}</group>
}

function ActivityGlyph3D({action,color,selected=false,radarLinkOpacity=0}:{action:string;color:string;selected?:boolean;radarLinkOpacity?:number}){
  const glyph=deriveFlightGlyph(action,selected,radarLinkOpacity)
  if(glyph.kind==='none'&&!glyph.selected&&glyph.radarLinkOpacity<=0)return null
  const plate=glyph.kind!=='none'||glyph.radarLinkOpacity>0
  const palette=glyph.kind==='engaged'?{plate:'#6a211d',accent:'#ff7466'}:glyph.kind==='pursuit'?{plate:'#604010',accent:'#ffd36a'}:glyph.kind==='returning'?{plate:'#25492e',accent:'#9ee6a8'}:glyph.kind==='intercept'?{plate:'#124d54',accent:'#70eff7'}:{plate:'#651d1a',accent:'#ff665b'}
  const foreground='#fffdf0'
  const lineProps={color:foreground,transparent:true,opacity:1,lineWidth:3,depthTest:false} as const
  return <Billboard position={[0,.82,0]} follow lockZ={false}><group>
    {plate?<><mesh renderOrder={34}><circleGeometry args={[.22,24]}/><meshBasicMaterial color={palette.plate} transparent opacity={.96} depthTest={false} depthWrite={false}/></mesh><mesh renderOrder={35}><ringGeometry args={[.19,.22,24]}/><meshBasicMaterial color={palette.accent} depthTest={false} depthWrite={false}/></mesh></>:null}
    {glyph.selected?<mesh renderOrder={35}><ringGeometry args={[.235,.258,28]}/><meshBasicMaterial color={color} depthTest={false} depthWrite={false}/></mesh>:null}
    {glyph.kind==='engaged'?<><mesh renderOrder={35}><ringGeometry args={[.105,.135,20]}/><meshBasicMaterial color={foreground} depthTest={false} depthWrite={false}/></mesh>{glyph.radarLinkOpacity<=0?<><Line points={[[ -.082,-.082,.006],[.082,.082,.006]]} {...lineProps}/><Line points={[[ -.082,.082,.006],[.082,-.082,.006]]} {...lineProps}/></>:null}</>:null}
    {glyph.kind==='intercept'?<Line points={[[ -.09,.12,.006],[.105,0,.006],[-.09,-.12,.006]]} {...lineProps}/>:null}
    {glyph.kind==='pursuit'?<Line points={[[ -.105,.13,.006],[.125,0,.006],[-.105,-.13,.006],[-.105,.13,.006]]} {...lineProps}/>:null}
    {glyph.kind==='returning'?<Line points={[[0,.14,.006],[.14,0,.006],[0,-.14,.006],[-.14,0,.006],[0,.14,.006]]} {...lineProps}/>:null}
    {glyph.radarLinkOpacity>0?<group position={[0,0,.012]}><mesh position={[0,.035,0]} renderOrder={36}><planeGeometry args={[.04,.12]}/><meshBasicMaterial color={foreground} transparent opacity={glyph.radarLinkOpacity} depthTest={false} depthWrite={false}/></mesh><mesh position={[0,-.075,.001]} renderOrder={36}><circleGeometry args={[.029,10]}/><meshBasicMaterial color={foreground} transparent opacity={glyph.radarLinkOpacity} depthTest={false} depthWrite={false}/></mesh></group>:null}
  </group></Billboard>
}

function Flight({squadron,route,frame,active,selected,status,activeEvent,radarLinkFade,recoveryLabel}:{squadron:Squadron;route:Point[];frame?:UnitFrame;active:boolean;selected:boolean;status:FlightStatus;activeEvent?:CombatEvent;radarLinkFade:number;recoveryLabel?:string}){
  const ref=useRef<THREE.Group>(null)
  const modelRef=useRef<THREE.Group>(null)
  const reaction=useRef({id:'',age:2,kind:'none' as 'none'|'damage'|'strike'})
  const curve=useMemo(()=>flightCurve(route,.6),[route])
  const reactionEvent=activeEvent?.detail.includes(squadron.callsign)&&(airLossTitles.has(activeEvent.title)||airDamageTitles.has(activeEvent.title)||activeEvent.title==='WEAPONS IMPACT')?activeEvent:undefined
  useEffect(()=>{if(reactionEvent&&reaction.current.id!==reactionEvent.id)reaction.current={id:reactionEvent.id,age:0,kind:reactionEvent.title==='WEAPONS IMPACT'?'strike':'damage'}},[reactionEvent])
  useFrame((_,delta)=>{if(ref.current&&active&&frame){ref.current.position.set(frame.position[0],.6,frame.position[1]);ref.current.lookAt(frame.facing[0],.6,frame.facing[1])}if(!modelRef.current)return;reaction.current.age+=delta;const age=reaction.current.age;if(age<1.35){const fade=1-age/1.35;if(reaction.current.kind==='damage'){modelRef.current.rotation.z=Math.sin(age*23)*.18*fade;modelRef.current.rotation.x=-Math.sin(age*9)*.08*fade;modelRef.current.position.y=Math.sin(age*18)*.055*fade}else{modelRef.current.rotation.z=Math.sin(age*8)*.12*fade;modelRef.current.position.y=-Math.sin(Math.min(1,age*2.5)*Math.PI)*.13*fade}}else{modelRef.current.rotation.set(0,0,0);modelRef.current.position.y=0}})
  const damageEvent=reactionEvent&&(airLossTitles.has(reactionEvent.title)||airDamageTitles.has(reactionEvent.title))?reactionEvent:undefined
  const formationLost=!!damageEvent&&airLossTitles.has(damageEvent.title)
  const calloutLabel=formationLost?'FORMATION LOST':damageEvent?'HIT · DAMAGE':''
  const initialPosition=active&&frame?new THREE.Vector3(frame.position[0],.6,frame.position[1]):flightPoint(curve,0)
  return <group ref={ref} visible={(!active||!!frame)&&!status.landed&&(status.aircraft>0||formationLost)} position={initialPosition}>
    <group ref={modelRef}><AircraftFormation role={squadron.role} aircraft={Math.max(1,status.aircraft)}/>{status.hasDamage?<AircraftSmoke/>:null}</group>
    <mesh position={[0,-.43,0]} rotation={[-Math.PI/2,0,0]}><circleGeometry args={[selected ? .55 : .42,16]}/><meshBasicMaterial color={selected?friendly:'#080a08'} transparent opacity={selected ? .18 : .22}/></mesh>
    {active?<>
      <ActivityGlyph3D action={status.action} color={friendly} selected={selected} radarLinkOpacity={radarLinkFade}/>
      {recoveryLabel&&!status.landed?<Billboard position={[0,.64,0]} follow lockZ={false}><Text fontSize={.16} color="#9ee6a8" anchorX="center" outlineWidth={.01} outlineColor="#102015">LANDING AT {recoveryLabel}</Text></Billboard>:null}
      {damageEvent?<HitCallout key={damageEvent.id} label={calloutLabel}/>:null}
    </>:null}
  </group>
}

function EnemyContact({flight,projection,status,activeEvent}:{flight:EnemyFlight;projection:HostileUnitProjection;status:FlightStatus;activeEvent?:CombatEvent}){
  const ref=useRef<THREE.Group>(null)
  const modelRef=useRef<THREE.Group>(null)
  const reaction=useRef({id:'',age:2})
  const hitEvent=flight.role==='fighter'&&activeEvent&&airLossTitles.has(activeEvent.title)&&activeEvent.detail.includes(flight.callsign)?activeEvent:undefined
  useEffect(()=>{if(hitEvent&&reaction.current.id!==hitEvent.id)reaction.current={id:hitEvent.id,age:0}},[hitEvent])
  const frame=projection.frame
  useFrame((_,delta)=>{if(ref.current){ref.current.position.set(frame.position[0],.6,frame.position[1]);ref.current.lookAt(frame.facing[0],.6,frame.facing[1])}if(!modelRef.current)return;reaction.current.age+=delta;const age=reaction.current.age;if(age<1.35){const fade=1-age/1.35;modelRef.current.rotation.z=Math.sin(age*24)*.22*fade;modelRef.current.rotation.x=-Math.sin(age*10)*.1*fade;modelRef.current.position.y=Math.sin(age*18)*.06*fade}else{modelRef.current.rotation.set(0,0,0);modelRef.current.position.y=0}})
  const visual=projection.visibility==='visual'
  const damageEvent=hitEvent&&status.hasDamage?hitEvent:undefined
  const contactColor=visual?hostile:amber
  const contactLabel=visual?`ENEMY · ${flight.callsign}`:projection.identityKnown?`${flight.callsign} · ${flight.role.toUpperCase()} · RADAR TRACK`:'ENEMY · RADAR CONTACT'
  const position=new THREE.Vector3(frame.position[0],.6,frame.position[1])
  if(!visual)return <group ref={ref} visible={status.aircraft>0||!!hitEvent} position={position}>
    <mesh rotation={[-Math.PI/2,0,Math.PI/4]}><planeGeometry args={[.72,.72]}/><meshBasicMaterial color={amber} transparent opacity={.58} depthWrite={false}/></mesh>
    <Billboard position={[0,.56,0]} follow lockZ={false}><Text fontSize={.18} color={contactColor} anchorX="center" outlineWidth={.012} outlineColor="#100a03">{contactLabel}</Text></Billboard>
    <group position={[0,-.6,0]}><Ring radius={1.1} color={amber} opacity={.18}/></group>
  </group>
  return <group ref={ref} visible={status.aircraft>0||!!hitEvent} position={position}>
    <group ref={modelRef}><AircraftFormation role={flight.role as Squadron['role']} aircraft={Math.max(1,status.aircraft)} color={contactColor} enemy/>{status.hasDamage?<AircraftSmoke/>:null}</group>
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
  const presentation=sequence.kind==='dogfight'?fighterEngagementPresentationAt(sequence,seconds):undefined
  if(seconds<sequence.start||seconds>sequence.end+(sequence.kind==='dogfight'?.7:0))return null
  if(sequence.kind==='pursuit')return <Billboard position={[sequence.location[0],1.35,sequence.location[1]]} follow lockZ={false}><Text fontSize={.22} color="#f4e7b1" anchorX="center" outlineWidth={.015} outlineColor="#080806">RECON UNDER PURSUIT</Text></Billboard>
  const merged=sequence.kind==='dogfight'?sequence.engagement.phases.find(phase=>phase.kind==='merged'):undefined
  if(sequence.kind==='dogfight'&&presentation?.stage==='opening-fire'){
    const eventColor=presentation.eventCueTone==='neutral'?'#d4d2c6':'#f1c65b'
    return <Billboard position={[sequence.location[0],1.48,sequence.location[1]]} follow lockZ={false}>
      {presentation.eventCue?<Text position={[0,.12,0]} fontSize={.25} color={eventColor} fillOpacity={presentation.eventCueOpacity} anchorX="center" outlineWidth={.017} outlineColor="#080806">{presentation.eventCue}</Text>:null}
      <Text position={[0,-.13,0]} fontSize={.17} color="#f4e7b1" anchorX="center" outlineWidth={.012} outlineColor="#080806">{presentation.label}</Text>
      {presentation.contextCue?<Text position={[0,-.34,0]} fontSize={.14} color="#f1c65b" anchorX="center" outlineWidth={.01} outlineColor="#080806">{presentation.contextCue}</Text>:null}
    </Billboard>
  }
  const visualStart=merged?.start??sequence.start
  const local=clamp01((seconds-visualStart)/Math.max(.01,sequence.end-visualStart))
  const radius=sequence.kind==='dogfight'?1.05:.5
  const loops=Array.from({length:32},(_,i)=>{const t=i/31*Math.PI*2+local*Math.PI*2;return [sequence.location[0]+Math.cos(t)*radius,.64+Math.sin(i*.7)*.05,sequence.location[1]+Math.sin(t)*radius*.62] as [number,number,number]})
  const label=presentation?.label??(sequence.kind==='defense'?'GROUND FIRE':'ATTACK RUN')
  const presentationOpacity=presentation?.presentationOpacity??1
  const eventColor=presentation?.eventCueTone==='friendly'?friendly:presentation?.eventCueTone==='hostile'?hostile:presentation?.eventCueTone==='warning'?'#f1c65b':'#d4d2c6'
  const contextColor=presentation?.numericalCue==='FRIENDLY ADVANTAGE'?friendly:presentation?.numericalCue==='HOSTILE ADVANTAGE'?hostile:'#d4d2c6'
  return <group>
    {presentation?.stage!=='resolved'?<><Line points={loops} color={sequence.kind==='dogfight'?hostile:amber} transparent opacity={.72*presentationOpacity} lineWidth={2}/><Line points={loops.map((p,i)=>[p[0]*.985+sequence.location[0]*.015,p[1]+.05,p[2]*.985+sequence.location[1]*.015] as [number,number,number])} color={friendly} transparent opacity={.58*presentationOpacity} lineWidth={1.4}/></>:null}
    <Billboard position={[sequence.location[0],1.48,sequence.location[1]]} follow lockZ={false}>
      {presentation?.eventCue?<Text position={[0,.12,0]} fontSize={.25} color={eventColor} fillOpacity={presentation.eventCueOpacity} anchorX="center" outlineWidth={.017} outlineColor="#080806">{presentation.eventCue}</Text>:null}
      <Text position={[0,-.13,0]} fontSize={.18} color="#f4e7b1" fillOpacity={presentationOpacity} anchorX="center" outlineWidth={.013} outlineColor="#080806">{label}</Text>
      {presentation?.contextCue?<Text position={[0,-.34,0]} fontSize={.14} color={contextColor} fillOpacity={presentationOpacity} anchorX="center" outlineWidth={.01} outlineColor="#080806">{presentation.contextCue}</Text>:null}
    </Billboard>
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

function friendlyStatusAt(squadron:Squadron,frame:UnitFrame|undefined,initialStrength?:number):FlightStatus{
  const strength=frame?.strength??squadron.strength??Math.max(0,(squadron.aircraft/Math.max(1,squadron.maxAircraft))*100)
  const morale=frame?.morale??squadron.morale??70
  const aircraft=frame?.aircraft??strengthToAircraft(strength,squadron.maxAircraft)
  const damaged=Math.max(0,Math.round((100-strength)/25)-(squadron.maxAircraft-aircraft))
  return {aircraft,damaged,fraction:clamp01(strength/100),strength,morale,action:actionLabel(frame?.mode??squadron.status),hasDamage:strength<(initialStrength??squadron.strength??100),landed:frame?.mode==='recovered'}
}

function enemyStatusAt(flight:EnemyFlight,frame:UnitFrame,initialStrength?:number):FlightStatus{
  const strength=frame.strength
  return {aircraft:frame.aircraft,damaged:0,fraction:clamp01(strength/100),strength,morale:frame.morale,action:actionLabel(frame.mode),hasDamage:strength<(initialStrength??100),landed:frame.mode==='recovered'}
}

function assetAtTime(asset:Asset,result:RoundResult|undefined,progress:number,enemy:boolean,phase:Phase):Asset{
  if(phase!=='execute'||!result)return asset
  const wasStruck=result.events.some(event=>event.time<=progress*EXECUTION_SECONDS&&groundDamageTitles.has(event.title)&&event.position&&distance2(event.position,asset.position)<.5)
  if(!wasStruck)return asset
  return (enemy?result.assets:result.playerAssets).find(candidate=>candidate.id===asset.id)??asset
}

export interface BattlefieldProps {squadrons:Squadron[]; assets:Asset[]; playerAssets:Asset[]; mappedAreas:Point[]; discoveredBoundaries?:BoundarySegment[]; presentationBounds?:WorldBounds; planningBounds?:WorldBounds; friendlyTerritory?:FriendlyTerritory; selectedId:string; followId?:string; focusPoint?:Point; placementId:string; planningBaseId?:string; executionBaseId?:string; planningRecoveryFieldId?:string; routeOrigin?:Point; routePlanningEnabled?:boolean; phase:Phase; progress:number; activeEvent?:CombatEvent; executionResult?:RoundResult; packageReview?:boolean; economySelectionId?:string; onPlanningBaseSelect?:(id:string)=>void; onExecutionBaseSelect?:(id:string)=>void; onEconomySelect?:(id:string)=>void; construction?:{kind:ConstructibleAssetKind;placement?:Point;isValid:(point:Point)=>boolean;onStage:(point:Point)=>void}; onRoute:(route:Point[])=>void; onPlace:(id:string,position:Point)=>void}
function BattlefieldScene({squadrons,assets,playerAssets,mappedAreas,discoveredBoundaries=EMPTY_BOUNDARIES,presentationBounds,planningBounds,friendlyTerritory,selectedId,followId,focusPoint,placementId,planningBaseId,executionBaseId,planningRecoveryFieldId,routeOrigin,routePlanningEnabled=false,phase,progress,activeEvent,executionResult,packageReview,economySelectionId,onPlanningBaseSelect,onExecutionBaseSelect,onEconomySelect,construction,onRoute,onPlace}:BattlefieldProps){
  const selected=squadrons.find(s=>s.id===selectedId)!
  const playerBase=playerAssets.find(a=>a.kind==='base')?.position??[-7.8,11.2];const playerRadar=playerAssets.find(a=>a.kind==='radar')?.position??[-6.7,5.8]
  const resolvedTerritory=useMemo<FriendlyTerritory>(()=>friendlyTerritory??{center:playerBase,radius:4.5},[friendlyTerritory,playerBase[0],playerBase[1]])
  const knownBounds=useMemo(()=>{const bounds=territoryBounds(resolvedTerritory);for(const point of mappedAreas){bounds.minX=Math.min(bounds.minX,point[0]-MAPPED_RADIUS);bounds.maxX=Math.max(bounds.maxX,point[0]+MAPPED_RADIUS);bounds.minZ=Math.min(bounds.minZ,point[1]-MAPPED_RADIUS);bounds.maxZ=Math.max(bounds.maxZ,point[1]+MAPPED_RADIUS)}return bounds},[mappedAreas,resolvedTerritory])
  const resolvedPlanningBounds=useMemo(()=>planningBounds??expandBounds(knownBounds,4),[knownBounds,planningBounds])
  const resolvedPresentationBounds=useMemo(()=>presentationBounds??expandBounds(resolvedPlanningBounds,6),[presentationBounds,resolvedPlanningBounds])
  const presentationCenter=boundsCenter(resolvedPresentationBounds)
  const placement=playerAssets.find(a=>a.id===placementId)
  const [drawing,setDrawing]=useState(false)
  const [constructionHover,setConstructionHover]=useState<Point>()
  useEffect(()=>{if(!construction)setConstructionHover(undefined)},[construction])
  const draft=useRef<Point[]>([])
  const seconds=progress*(executionResult?.duration??EXECUTION_SECONDS)
  const friendlyProjections=useMemo(()=>new globalThis.Map(phase==='execute'?squadrons.flatMap(squadron=>{const projection=projectFriendlyUnitAt(executionResult,squadron.id,seconds);return projection?[[squadron.id,projection] as const]:[]}):[]),[executionResult,phase,seconds,squadrons])
  const hostileProjections=useMemo(()=>new globalThis.Map(phase==='execute'?(executionResult?.enemyFlights??[]).flatMap(flight=>{const projection=projectHostileUnitAt(executionResult,flight.id,seconds);return projection?[[flight.id,projection] as const]:[]}):[]),[executionResult,phase,seconds])
  const selectedFrame=friendlyProjections.get(selected.id)?.frame
  const selectedPosition=selectedFrame?.position??(phase==='execute'?playerBase:selected.route[0]??playerBase)
  const selectedResponsibility=useMemo(()=>fighterResponsibilityFor(selected),[selected])
  const plannedStation=selected.routeIngress.at(-1)??selected.route.at(-1)??selectedPosition
  const planningLosPosition=phase==='plan'&&selected.role==='fighter'?(selectedResponsibility?.kind==='circle'?selectedResponsibility.center:plannedStation):selectedPosition
  const followSquadron=followId?squadrons.find(s=>s.id===followId):undefined
  const followFrame=followId?(friendlyProjections.get(followId)?.frame??hostileProjections.get(followId)?.frame):undefined
  const cameraFocus=focusPoint??(followId?(followFrame?.position??(phase==='execute'?undefined:followSquadron?.route[0])):undefined)
  const selectedRange=effectiveSensorRange({...selected,strength:selectedFrame?.strength??selected.strength})
  const selectedAirborne=phase==='execute'?!!selectedFrame&&selectedFrame.aircraft>0:selected.aircraft>0
  const friendlyRadar=playerAssets.find(asset=>asset.kind==='radar'&&asset.health>0)
  const friendlyRadarIds=new Set(playerAssets.filter(asset=>asset.kind==='radar').map(asset=>asset.id))
  const detectedEnemyIds=new Set(hostileProjections.keys())
  const enemyVisibleFor=(ids:string[])=>ids.filter(id=>id.startsWith('red-')).every(id=>detectedEnemyIds.has(id))
  const replayWeaponEffects=useMemo(()=>[...(executionResult?.weaponEffects??[]),...dogfightWeaponEffects(executionResult?.combatSequences??[],executionResult)],[executionResult])
  const eventEnemyIds=(executionResult?.enemyFlights??[]).filter(flight=>activeEvent?.detail.includes(flight.callsign)).map(flight=>flight.id)
  const visibleActiveEvent=activeEvent&&(eventEnemyIds.length===0||enemyVisibleFor(eventEnemyIds))?activeEvent:undefined
  const observedAssetIds=new Set((executionResult?.contactObservations??[]).filter(o=>phase==='execute'&&seconds>=o.start&&seconds<=o.end&&o.targetId.startsWith('e-')).map(o=>o.targetId))
  const liveMapObservations:MapObservation[]=phase==='execute'?squadrons.flatMap(squadron=>{
    const frame=friendlyProjections.get(squadron.id)?.frame
    if(!frame||frame.aircraft<=0||frame.mode==='recovered'||frame.mode==='trapped')return []
    return [{position:frame.position,radius:squadron.role==='recon'?2.7:1.45}]
  }):[]
  const displayedPlayerAssets=playerAssets.map(asset=>assetAtTime(asset,executionResult,progress,false,phase))
  const baseCounts=useMemo(()=>new globalThis.Map(formationBaseGroups(squadrons,playerAssets).map(group=>[group.base.id,group.formationIds.length])),[playerAssets,squadrons])
  const displayedEnemyAssets=assets.map(asset=>{const timed=assetAtTime(asset,executionResult,progress,true,phase);return observedAssetIds.has(asset.id)&&timed.intel==='unknown'?{...timed,intel:'probable' as const,confidence:70,hidden:false}:timed})
  const recoveryById=useMemo(()=>new globalThis.Map((executionResult?.recoveryOutcomes??[]).map(outcome=>[outcome.formationId,outcome])),[executionResult])
  const followedAircraftIsHostile=followId?.startsWith('red-')
  const activeCoverageAssets=phase==='execute'&&followId&&followFrame&&followFrame.aircraft>0?[...displayedPlayerAssets.map(asset=>({asset,friendlyOwner:true})),...displayedEnemyAssets.filter(asset=>asset.intel!=='unknown').map(asset=>({asset,friendlyOwner:false}))].filter(({asset,friendlyOwner})=>{
    if(asset.health<=0||asset.kind==='base'||asset.kind==='fob'||asset.kind==='decoy'||asset.kind==='radar')return false
    const range=asset.kind==='sam'?3.2:1.9
    return followedAircraftIsHostile===friendlyOwner&&distance2(asset.position,followFrame.position)<=range
  }):[]
  const mapPoint=(e:ThreeEvent<PointerEvent>):Point=>{
    const hit=e.ray.intersectPlane(groundPlane,new THREE.Vector3())
    return hit?[hit.x,hit.z]:[e.point.x,e.point.z]
  }
  const down=(e:ThreeEvent<PointerEvent>)=>{if(phase==='adapt'&&construction){const point=snapToHex(mapPoint(e));e.stopPropagation();construction.onStage(point);setConstructionHover(point);return}if(phase==='deploy'){const point=snapToHex(mapPoint(e));e.stopPropagation();onPlace(placementId,point);return}if(phase!=='plan'||!routePlanningEnabled)return;const point=mapPoint(e);e.stopPropagation();setDrawing(true);draft.current=[[...(routeOrigin??playerBase)] as Point,point];onRoute(draft.current)}
  const move=(e:ThreeEvent<PointerEvent>)=>{if(phase==='adapt'&&construction){setConstructionHover(snapToHex(mapPoint(e)));return}if(!drawing||phase!=='plan'||!routePlanningEnabled)return;const point=mapPoint(e);draft.current=[...draft.current,point];onRoute(draft.current)}
  const up=()=>setDrawing(false)
  const constructionPoint=constructionHover??construction?.placement
  return <>
    <CameraRig phase={phase} friendlyTerritory={resolvedTerritory} planningBounds={resolvedPlanningBounds} presentationBounds={resolvedPresentationBounds} focusPoint={cameraFocus} followKey={followId}/>
    <color attach="background" args={['#11140f']}/><fog attach="fog" args={['#11140f',34,60]}/>
    <ambientLight intensity={1.1}/><directionalLight position={[-5,10,5]} intensity={2.1} castShadow shadow-mapSize={[1024,1024]}/>
    <Terrain phase={phase} presentationBounds={resolvedPresentationBounds} planningBounds={resolvedPlanningBounds}/><FogOfWar mappedAreas={mappedAreas} observations={liveMapObservations} presentationBounds={resolvedPresentationBounds} friendlyTerritory={resolvedTerritory}/><DiscoveredBoundaryLines segments={discoveredBoundaries}/>{phase==='deploy'&&placement?<PlacementHex position={placement.position}/>:null}{construction&&constructionPoint?<ConstructionPlacementGhost kind={construction.kind} position={constructionPoint} valid={construction.isValid(constructionPoint)}/>:null}
    <SensorRangeOverlay phase={phase} radar={friendlyRadar} position={planningLosPosition} losRange={selectedRange} showLos={phase==='plan'||phase==='execute'&&selectedAirborne}/>
    {displayedPlayerAssets.map(a=>a.kind==='base'||a.kind==='fob'||a.kind==='decoy'?<Runway key={a.id} asset={a} selected={phase==='plan'&&a.id===planningBaseId||phase==='execute'&&a.id===executionBaseId||phase==='adapt'&&a.id===economySelectionId} onSelect={phase==='plan'&&(a.kind==='base'||a.kind==='fob')?()=>onPlanningBaseSelect?.(a.id):phase==='execute'&&(a.kind==='base'||a.kind==='fob')?()=>onExecutionBaseSelect?.(a.id):phase==='adapt'&&!construction&&a.kind!=='decoy'?()=>onEconomySelect?.(a.id):undefined}/>:<Defense key={a.id} asset={a} enemy={false} selected={phase==='deploy'&&a.id===placementId||phase==='adapt'&&a.id===economySelectionId} showRange={phase!=='execute'} onSelect={phase==='adapt'&&!construction?()=>onEconomySelect?.(a.id):undefined}/>) }
    {playerAssets.map(a=>{const label=a.kind==='base'||a.kind==='fob'?`${airfieldLabel(a)} · ${baseCounts.get(a.id)??0}`:a.name??a.kind.toUpperCase();return <Text key={`${a.id}-friendly-label`} position={[a.position[0],.25,a.position[1]-.62]} rotation={[-Math.PI/2,0,0]} fontSize={.21} color={a.id===placementId&&phase==='deploy'?'#f4d16f':a.id===planningBaseId&&phase==='plan'?'#b9ffff':friendly}>{label}</Text>})}
    {displayedEnemyAssets.map(a=>a.kind==='base'&&a.intel!=='unknown'?<Runway key={a.id} asset={a} enemy/>:a.kind==='decoy'&&a.intel!=='unknown'?<Runway key={a.id} asset={a} enemy/>:<Defense key={a.id} asset={a} showRange={phase!=='execute'}/>)}
    {displayedEnemyAssets.filter(a=>a.intel!=='unknown').map(a=><Text key={`${a.id}-label`} position={[a.position[0],.27,a.position[1]-.68]} rotation={[-Math.PI/2,0,0]} fontSize={.2} color={a.intel==='confirmed'?hostile:amber}>{observedAssetIds.has(a.id)&&assets.find(x=>x.id===a.id)?.intel==='unknown'?'OBSERVED':a.intel.toUpperCase()} {a.kind.toUpperCase()} · {a.confidence}%</Text>)}
    {activeCoverageAssets.map(({asset})=><ActiveCoverageOverlay key={`${asset.id}-active-coverage`} asset={asset}/>)}
    {phase==='plan'?squadrons.filter(s=>s.id!==selectedId||!planningRecoveryFieldId).map(s=><ResponsibilityOverlay key={`${s.id}-responsibility`} squadron={s} selected={s.id===selectedId}/>):phase==='execute'&&followId?squadrons.filter(s=>s.id===followId).map(s=><ResponsibilityOverlay key={`${s.id}-responsibility`} squadron={s} selected/>):null}
    {phase==='plan'&&planningRecoveryFieldId?(()=>{const field=playerAssets.find(asset=>asset.id===planningRecoveryFieldId);return field?<RecoveryLatchCue position={field.position} selected/>:null})():null}
    {phase==='plan'?squadrons.map(s=><Route key={s.id} squadron={s} selected={s.id===selectedId} packageReview={packageReview} recoveryLabel={s.id===selectedId&&planningRecoveryFieldId?playerAssets.find(asset=>asset.id===planningRecoveryFieldId)?.name??'HOME BASE':undefined}/>):phase==='execute'&&followId?squadrons.filter(s=>s.id===followId).map(s=><Route key={s.id} squadron={s} selected recoveryLabel={recoveryById.get(s.id)?.plannedFieldId?playerAssets.find(asset=>asset.id===recoveryById.get(s.id)?.plannedFieldId)?.name??'HOME BASE':undefined}/>):null}
    {squadrons.filter(s=>phase==='execute'?friendlyProjections.has(s.id):s.route.length>=2).map(s=>{const receipt=(executionResult?.radarTrackReceipts??[]).filter(item=>friendlyRadarIds.has(item.radarId)&&item.receiverId===s.id&&item.start<=seconds).at(-1);const radarLinkFade=receipt?clamp01((receipt.end+.8-seconds)/.8):0;const plannedFieldId=recoveryById.get(s.id)?.plannedFieldId;const recoveryLabel=plannedFieldId?playerAssets.find(asset=>asset.id===plannedFieldId)?.name??'HOME BASE':undefined;const frame=friendlyProjections.get(s.id)?.frame;const initialStrength=unitTrackFor(executionResult,s.id)?.frames[0]?.strength;return <Flight key={s.id} squadron={s} route={s.route} frame={frame} active={phase==='execute'} selected={s.id===selectedId} status={friendlyStatusAt(s,frame,initialStrength)} activeEvent={visibleActiveEvent} radarLinkFade={radarLinkFade} recoveryLabel={recoveryLabel}/>}) }
    {phase==='execute'?executionResult?.enemyFlights.flatMap(f=>{const projection=hostileProjections.get(f.id);if(!projection)return [];const initialStrength=unitTrackFor(executionResult,f.id)?.frames[0]?.strength;return [<EnemyContact key={f.id} flight={f} projection={projection} status={enemyStatusAt(f,projection.frame,initialStrength)} activeEvent={visibleActiveEvent}/>]}):null}
    {phase==='execute'?executionResult?.reinforcementCalls.map(call=><ReinforcementFlight key={call.id} call={call} progress={progress}/>):null}
    {phase==='execute'?executionResult?.defenseCues?.filter(c=>progress>=c.start&&progress<=c.end).map(c=><DefenseNetworkCue key={c.id} cue={c} radar={playerRadar}/>):null}
    {phase==='execute'?(executionResult?.combatSequences??[]).filter(seq=>enemyVisibleFor(seq.participantIds)).map(seq=><ActiveSequenceVisual key={seq.id} sequence={seq} seconds={seconds}/>):null}
    {phase==='execute'?replayWeaponEffects.filter(effect=>enemyVisibleFor([effect.sourceId,effect.targetId])).map(effect=><WeaponEffectVisual key={effect.id} effect={effect} seconds={seconds}/>):null}
    {phase==='debrief'&&executionResult?<HistoryOverlay result={executionResult}/>:null}
    {visibleActiveEvent?<CombatEffect key={visibleActiveEvent.id} event={visibleActiveEvent}/>:null}
    <mesh position={[presentationCenter[0],.001,presentationCenter[1]]} rotation={[-Math.PI/2,0,0]} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={()=>{up();setConstructionHover(undefined)}}><planeGeometry args={[boundsWidth(resolvedPresentationBounds),boundsDepth(resolvedPresentationBounds)]}/><meshBasicMaterial transparent opacity={0} depthWrite={false}/></mesh>
  </>
}
const distance2=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1])
const clamp01=(value:number)=>Math.max(0,Math.min(1,value))

export const Battlefield=memo(function Battlefield(props:BattlefieldProps){return <Canvas orthographic shadows="basic" dpr={[1,1.5]} gl={{antialias:true,powerPreference:'high-performance'}}><BattlefieldScene {...props}/></Canvas>})
