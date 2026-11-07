import { useEffect, useRef } from 'react'
import { Billboard, Text } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { usesCompactUnitCards } from '../game/unitCards'
import type { UnitCardData } from '../game/unitCards'

interface UnitCard3DProps {actionLabel?:string;data:UnitCardData;color:string;position?:[number,number,number];selected?:boolean;onSelect?:()=>void}

export function UnitCard3D(props:UnitCard3DProps){
  const compact=useThree(state=>usesCompactUnitCards(state.size.width,state.size.height))
  return <WorldUnitCard {...props} compact={compact}/>
}

/** Both layouts stay in map units so labels shrink with the battlefield instead of covering it. */
function WorldUnitCard({data,color,position=[0,1.15,0],selected=false,actionLabel,onSelect,compact}:{compact:boolean}&UnitCard3DProps){
  const value=Math.max(0,Math.min(1,data.health/Math.max(1,data.maxHealth))),width=compact?1.15:1.9
  const fill=useRef<THREE.Mesh>(null),trail=useRef<THREE.Mesh>(null),flash=useRef<THREE.Mesh>(null)
  const shown=useRef(value),delayed=useRef(value),previous=useRef(value),hitAge=useRef(2)
  useEffect(()=>{if(value<previous.current-.001)hitAge.current=0;previous.current=value},[value])
  useFrame((_,delta)=>{
    shown.current=THREE.MathUtils.damp(shown.current,value,18,delta)
    delayed.current=THREE.MathUtils.damp(delayed.current,value,4.5,delta)
    for(const [mesh,fraction] of [[fill.current,shown.current],[trail.current,Math.max(shown.current,delayed.current)]] as const){if(mesh){mesh.scale.x=Math.max(.0001,fraction);mesh.position.x=-width*(1-fraction)/2}}
    hitAge.current+=delta
    if(flash.current)(flash.current.material as THREE.MeshBasicMaterial).opacity=Math.max(0,1-hitAge.current/.45)*.55
  })
  const height=compact?.27:actionLabel?.92:.66,centerY=compact?0:actionLabel?-.13:0
  const barY=compact?-.085:-.095,barHeight=compact?.055:.1
  const shortLabel=`${actionLabel?(actionLabel==='STRIKE TARGET ASSIGNED'?'✓ ':'⌖ '):''}${data.mapLabel??data.title}`
  return <Billboard position={position} follow lockZ={false}>
    <group onClick={event=>{event.stopPropagation();onSelect?.()}}>
      {compact?<mesh><planeGeometry args={[width+.1,height]}/><meshBasicMaterial transparent opacity={0} depthWrite={false}/></mesh>:null}
      {!compact?<mesh position={[0,centerY,-.003]} renderOrder={29}><planeGeometry args={[width+.14,height]}/><meshBasicMaterial color={selected?color:'#314038'} depthTest={false} depthWrite={false}/></mesh>:null}
      {!compact?<mesh position={[0,centerY,0]} renderOrder={30}><planeGeometry args={[width+.1,height-.04]}/><meshBasicMaterial color="#080e0b" transparent opacity={.97} depthTest={false} depthWrite={false}/></mesh>:null}
      <mesh ref={flash} position={[0,centerY,.002]} renderOrder={31}><planeGeometry args={[width+.1,height-.04]}/><meshBasicMaterial color="#ff6653" transparent opacity={0} depthTest={false} depthWrite={false}/></mesh>
      <Text position={[compact?0:-width/2,compact?.04:.21,.01]} fontSize={compact?.115:.13} maxWidth={width} color={compact&&actionLabel?'#edc16d':compact&&selected?color:'#f2efdc'} outlineWidth={compact?.008:0} outlineColor="#050806" anchorX={compact?'center':'left'} anchorY="middle" renderOrder={34}>{compact?shortLabel:data.title}</Text>
      {!compact?<Text position={[-width/2,.055,.01]} fontSize={.095} maxWidth={width} color={color} anchorX="left" anchorY="middle" renderOrder={34}>{data.subtitle}</Text>:null}
      <mesh position={[0,barY,.004]} renderOrder={31}><planeGeometry args={[width,barHeight]}/><meshBasicMaterial color="#25332c" depthTest={false} depthWrite={false}/></mesh>
      <mesh ref={trail} position={[-width*(1-value)/2,barY,.006]} scale={[Math.max(.0001,value),1,1]} renderOrder={32}><planeGeometry args={[width,barHeight]}/><meshBasicMaterial color="#edc16d" depthTest={false} depthWrite={false}/></mesh>
      <mesh ref={fill} position={[-width*(1-value)/2,barY,.008]} scale={[Math.max(.0001,value),1,1]} renderOrder={33}><planeGeometry args={[width,barHeight]}/><meshBasicMaterial color={color} depthTest={false} depthWrite={false}/></mesh>
      {!compact?<Text position={[-width/2,-.235,.01]} fontSize={.09} color="#f2efdc" anchorX="left" anchorY="middle" renderOrder={34}>{`${Math.round(data.health)} / ${data.maxHealth}`}</Text>:null}
      {!compact?<Text position={[width/2,-.235,.01]} fontSize={.08} maxWidth={1.25} color={color} anchorX="right" anchorY="middle" renderOrder={34}>{data.status}</Text>:null}
      {!compact&&actionLabel?<Text position={[0,-.43,.01]} fontSize={.105} color="#edc16d" anchorX="center" anchorY="middle" renderOrder={34}>{actionLabel}</Text>:null}
    </group>
  </Billboard>
}
