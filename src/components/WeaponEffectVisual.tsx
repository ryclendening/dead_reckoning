import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { ConeGeometry, CylinderGeometry, IcosahedronGeometry, MathUtils, type BufferGeometry, type Mesh, type MeshBasicMaterial, OrthographicCamera, RingGeometry, Vector3 } from 'three'
import type { FrameClock } from '../game/frameClock'
import { sampleUnitTrackForRender } from '../game/executionProjection'
import type { Point, UnitTrack, WeaponEffect } from '../game/types'
import { authorizedWeaponTarget, clamp01, weaponPath, weaponTangent, weaponTrail, weaponVisualLifecycle, type WeaponDisplay } from './graphicsPresentation'

const tracerGeometry = new CylinderGeometry(.65, 1, 1, 6, 1, true)
const projectileGeometry = new ConeGeometry(.075, .3, 6)
const flashGeometry = new IcosahedronGeometry(1)
const impactGeometry = new RingGeometry(.75, 1, 18)
const up = new Vector3(0, 1, 0)

interface WeaponEffectVisualProps {
  effect: WeaponEffect
  seconds: number
  sceneClock: FrameClock
  targetTrack?: UnitTrack
  targetContactStart?: number
  display: WeaponDisplay
  hostile: boolean
}

type EffectMesh = Mesh<BufferGeometry, MeshBasicMaterial>

export function WeaponEffectVisual({ effect, seconds, sceneClock, targetTrack, targetContactStart, display, hostile }: WeaponEffectVisualProps) {
  const tracer = useRef<EffectMesh>(null)
  const projectile = useRef<EffectMesh>(null)
  const plume = useRef<EffectMesh>(null)
  const flash = useRef<EffectMesh>(null)
  const ring = useRef<EffectMesh>(null)
  const [direction] = useState(() => new Vector3())
  const { kind } = effect
  const hitscan = kind === 'gun'
  const flak = kind === 'aaa'
  const groundImpact = kind === 'bomb' || kind === 'air-to-ground-missile'
  const color = hitscan || flak ? '#ffe2a0' : kind === 'bomb' ? '#ffe6a9' : hostile ? '#ff9174' : '#8decef'

  useFrame(({ camera, size }) => {
    const time = sceneClock.time
    const lifecycle = weaponVisualLifecycle(effect, time, display)
    const pixelsPerUnit = camera instanceof OrthographicCamera ? size.height * camera.zoom / (camera.top - camera.bottom) : 30
    const cueScale = MathUtils.clamp(24 / pixelsPerUnit, 1, 2.4)

    if (plume.current) {
      plume.current.visible = lifecycle.launchVisible
      if (lifecycle.launchVisible) {
        const age = lifecycle.launchProgress
        plume.current.position.set(effect.from[0], (flak || kind === 'sam' ? .25 : .76) + age * .18, effect.from[1])
        plume.current.scale.set((.10 + age * .12) * cueScale, (.16 + age * .21) * cueScale, (.10 + age * .12) * cueScale)
        plume.current.material.opacity = 1 - age
      }
    }

    if (tracer.current) tracer.current.visible = lifecycle.trailVisible
    if (projectile.current) projectile.current.visible = lifecycle.inFlight
    if (flash.current) flash.current.visible = lifecycle.impactFlashVisible
    if (ring.current) ring.current.visible = lifecycle.impactFlashVisible
    if (!lifecycle.trailVisible && !lifecycle.inFlight && !lifecycle.impactFlashVisible) return

    const trackedTarget = targetTrack ? authorizedWeaponTarget(effect, time, seconds, targetTrack, targetContactStart) : effect.to
    const launchTarget = flak && targetTrack
      ? sampleUnitTrackForRender(targetTrack, effect.start, seconds, targetContactStart === undefined ? undefined : { contactStart: targetContactStart })?.position
      : undefined
    const target: Point = launchTarget
      ? [trackedTarget[0] + effect.to[0] - launchTarget[0], trackedTarget[1] + effect.to[1] - launchTarget[1]]
      : trackedTarget
    const local = hitscan ? 1 : clamp01((time - effect.start) / Math.max(.01, effect.end - effect.start))
    const { position: [x, z], height: y } = weaponPath(effect, local, target)

    if (tracer.current && lifecycle.trailVisible) {
      const [[dx, dy, dz]] = weaponTrail(effect, local, target)
      direction.set(dx, dy, dz)
      const length = direction.length()
      tracer.current.visible = length > .001
      if (tracer.current.visible) {
        const radius = (flak ? .025 : .017) * cueScale
        tracer.current.position.set(x + dx / 2, y + dy / 2, z + dz / 2)
        tracer.current.quaternion.setFromUnitVectors(up, direction.multiplyScalar(-1 / length))
        tracer.current.scale.set(radius, length, radius)
        tracer.current.material.opacity = lifecycle.trailOpacity * (hitscan || flak ? .98 : .8)
      }
    }
    if (projectile.current && lifecycle.inFlight) {
      projectile.current.position.set(x, y, z)
      projectile.current.scale.setScalar((kind === 'bomb' ? .087 : 1) * Math.min(1.45, cueScale))
      projectile.current.quaternion.setFromUnitVectors(up, direction.set(...weaponTangent(effect, local, target)))
    }
    if (flash.current && ring.current && lifecycle.impactFlashVisible) {
      const age = lifecycle.impactProgress
      flash.current.position.set(x, y, z)
      flash.current.scale.setScalar((groundImpact ? .17 : .123) * cueScale * (1 + age * .38))
      flash.current.material.opacity = (1 - age) ** 2
      ring.current.position.set(x, y, z)
      if (!groundImpact) ring.current.quaternion.copy(camera.quaternion)
      ring.current.scale.setScalar((groundImpact ? .24 : .16) * cueScale * (1 + age * 1.25))
      ring.current.material.opacity = (1 - age) * .8
    }
  })

  return <group>
    {display !== 'impact' && (flak || kind === 'sam' || kind === 'air-to-ground-missile' || kind === 'air-to-air-missile') ?
      <mesh ref={plume} geometry={flashGeometry} visible={false}>
        <meshBasicMaterial color="#ffd087" transparent depthTest={false} depthWrite={false} toneMapped={false}/>
      </mesh> : null}
    {display === 'full' ? <>
      <mesh ref={tracer} geometry={tracerGeometry} visible={false}>
        <meshBasicMaterial color={color} transparent depthTest={false} depthWrite={false} toneMapped={false}/>
      </mesh>
      {!hitscan && !flak ?
        <mesh ref={projectile} geometry={kind === 'bomb' ? flashGeometry : projectileGeometry} visible={false}>
          <meshBasicMaterial color={color} toneMapped={false}/>
        </mesh> : null}
    </> : null}
    {display !== 'launch' && effect.hit ? <>
      <mesh ref={flash} geometry={flashGeometry} visible={false}>
        <meshBasicMaterial color="#fff2c4" transparent depthTest={false} depthWrite={false} toneMapped={false}/>
      </mesh>
      <mesh ref={ring} geometry={impactGeometry} rotation={groundImpact ? [-Math.PI / 2, 0, 0] : undefined} visible={false}>
        <meshBasicMaterial color="#ffb760" transparent depthTest={false} depthWrite={false} toneMapped={false}/>
      </mesh>
    </> : null}
  </group>
}
