import { useEffect, useRef } from 'react'
import { Billboard, Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { UnitCardData } from '../game/unitCards'

/** One damage presentation for aircraft and fixed assets; transforms animate without React frame updates. */
export function UnitCard3D({data,color,position=[0,1.15,0],selected=false,onSelect}:{data:UnitCardData;color:string;position?:[number,number,number];selected?:boolean;onSelect?:()=>void}){
  const value=Math.max(0,Math.min(1,data.health/Math.max(1,data.maxHealth))),width=1.9
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
  return <Billboard position={position} follow lockZ={false}>
    <group onClick={event=>{event.stopPropagation();onSelect?.()}}>
      <mesh position={[0,0,-.003]} renderOrder={29}><planeGeometry args={[width+.14,.66]}/><meshBasicMaterial color={selected?color:'#314038'} depthTest={false} depthWrite={false}/></mesh>
      <mesh renderOrder={30}><planeGeometry args={[width+.1,.62]}/><meshBasicMaterial color="#080e0b" transparent opacity={.97} depthTest={false} depthWrite={false}/></mesh>
      <mesh ref={flash} position={[0,0,.002]} renderOrder={31}><planeGeometry args={[width+.1,.62]}/><meshBasicMaterial color="#ff6653" transparent opacity={0} depthTest={false} depthWrite={false}/></mesh>
      <Text position={[-width/2,.21,.01]} fontSize={.13} maxWidth={width} color="#f2efdc" anchorX="left" anchorY="middle" renderOrder={34}>{data.title}</Text>
      <Text position={[-width/2,.055,.01]} fontSize={.095} maxWidth={width} color={color} anchorX="left" anchorY="middle" renderOrder={34}>{data.subtitle}</Text>
      <mesh position={[0,-.095,.004]} renderOrder={31}><planeGeometry args={[width,.1]}/><meshBasicMaterial color="#25332c" depthTest={false} depthWrite={false}/></mesh>
      <mesh ref={trail} position={[-width*(1-value)/2,-.095,.006]} scale={[Math.max(.0001,value),1,1]} renderOrder={32}><planeGeometry args={[width,.1]}/><meshBasicMaterial color="#edc16d" depthTest={false} depthWrite={false}/></mesh>
      <mesh ref={fill} position={[-width*(1-value)/2,-.095,.008]} scale={[Math.max(.0001,value),1,1]} renderOrder={33}><planeGeometry args={[width,.1]}/><meshBasicMaterial color={color} depthTest={false} depthWrite={false}/></mesh>
      <Text position={[-width/2,-.235,.01]} fontSize={.09} color="#f2efdc" anchorX="left" anchorY="middle" renderOrder={34}>{`${Math.round(data.health)} / ${data.maxHealth}`}</Text>
      <Text position={[width/2,-.235,.01]} fontSize={.08} maxWidth={1.25} color={color} anchorX="right" anchorY="middle" renderOrder={34}>{data.status}</Text>
    </group>
  </Billboard>
}
