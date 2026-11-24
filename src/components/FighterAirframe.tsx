import { useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import type { Material, Mesh } from 'three'
import { aircraftStencil } from './flightRenderLayers'

const flightMaterials = new WeakMap<Material, Material>()

function flightMaterial(source: Material) {
  const existing = flightMaterials.get(source)
  if (existing) return existing
  const material = source.clone()
  material.setValues(aircraftStencil)
  flightMaterials.set(source, material)
  return material
}

interface FighterAirframeProps {
  enemy: boolean
  silhouette: boolean
  silhouetteMaterial: Material
}

export function FighterAirframe({ enemy, silhouette, silhouetteMaterial }: FighterAirframeProps) {
  const filename = enemy ? 'mig23' : 'f16'
  const { nodes } = useGLTF(`/assets/aircraft/${filename}.glb`, false, false)
  const model = useMemo(() => {
    const airframe = nodes.Airframe.clone()
    airframe.traverse(object => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(flightMaterial) : flightMaterial(mesh.material)
    })
    return airframe
  }, [nodes.Airframe])
  const outline = nodes.Silhouette as Mesh

  return silhouette
    ? <mesh geometry={outline.geometry} material={silhouetteMaterial} dispose={null}/>
    : <primitive object={model} dispose={null}/>
}
