import { useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import type { Material, Mesh } from 'three'

interface FighterAirframeProps {
  enemy: boolean
  silhouette: boolean
  silhouetteMaterial: Material
}

export function FighterAirframe({ enemy, silhouette, silhouetteMaterial }: FighterAirframeProps) {
  const filename = enemy ? 'mig23' : 'f16'
  const { nodes } = useGLTF(`/assets/aircraft/${filename}.glb`, false, false)
  const model = useMemo(() => nodes.Airframe.clone(), [nodes.Airframe])
  const outline = nodes.Silhouette as Mesh

  return silhouette
    ? <mesh geometry={outline.geometry} material={silhouetteMaterial} dispose={null}/>
    : <primitive object={model} dispose={null}/>
}
