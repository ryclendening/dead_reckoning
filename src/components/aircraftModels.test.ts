import { Box3, NotEqualStencilFunc, OrthographicCamera, ReplaceStencilOp, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { ANGLED_BATTLEFIELD_CAMERA } from '../game/cameraPresentation'
import type { Role } from '../game/types'
import { aircraftModel, aircraftSilhouetteAtScale, reinforcementSilhouetteMaterial } from './aircraftModels'
import { flightLineLayer } from './flightRenderLayers'
import { radarBase, radarPanel, runwayModels, samModel } from './groundModels'

const airframes = ([false, true] as const).flatMap(hostile =>
  (['fighter', 'recon', 'bomber'] as const).map(role => ({ role, hostile })))

function screenBounds(geometry: ReturnType<typeof aircraftModel>['model'], yaw: number, zoom: number) {
  const camera = new OrthographicCamera(-195, 195, 180, -180)
  camera.position.set(...ANGLED_BATTLEFIELD_CAMERA.offset)
  camera.lookAt(0, 0, 0)
  camera.zoom = zoom
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
  const box = new Box3()
  const vertex = new Vector3()
  const vertical = new Vector3(0, 1, 0)
  const position = geometry.getAttribute('position')
  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position, i).applyAxisAngle(vertical, yaw).project(camera)
    box.expandByPoint(vertex.set(vertex.x * 195, vertex.y * 180, vertex.z))
  }
  return box.getSize(new Vector3())
}

describe('battlefield model geometry', () => {
  it.each(airframes)('keeps the $role (hostile=$hostile) within a cheap one-mesh budget', ({ role, hostile }) => {
    const { model, silhouette } = aircraftModel(role, hostile)
    const detailedTriangles = model.getAttribute('position').count / 3
    expect(detailedTriangles).toBeLessThan(240)
    expect(silhouette.getAttribute('position').count / 3).toBeLessThan(40)
    expect(model.groups.length).toBe(0)
    expect(silhouette.groups.length).toBe(0)
    model.computeBoundingBox()
    silhouette.computeBoundingBox()
    for (const limit of ['min', 'max'] as const) {
      expect(model.boundingBox![limit].x).toBeCloseTo(silhouette.boundingBox![limit].x, 2)
      expect(model.boundingBox![limit].z).toBeCloseTo(silhouette.boundingBox![limit].z, 2)
    }
  })

  it.each(airframes)('keeps the $role (hostile=$hostile) visible at the angled battlefield camera', ({ role, hostile }) => {
    const { silhouette } = aircraftModel(role, hostile)
    for (let heading = 0; heading < 8; heading++) {
      const size = screenBounds(silhouette, heading * Math.PI / 4, 20)
      expect(Math.max(size.x, size.y)).toBeGreaterThan(9)
      expect(Math.min(size.x, size.y)).toBeGreaterThan(5)
    }
  })

  it('preserves the long U-2 wing and distinctly wider hostile recon compared with the MiG-23', () => {
    function wingSpan(role: Role, hostile: boolean) {
      const geometry = aircraftModel(role, hostile).silhouette
      geometry.computeBoundingBox()
      return geometry.boundingBox!.getSize(new Vector3()).x
    }
    expect(wingSpan('recon', false)).toBeGreaterThan(wingSpan('fighter', false) * 1.7)
    expect(wingSpan('recon', true)).toBeGreaterThan(wingSpan('fighter', true) * 1.1)
  })

  it('changes representation in both zoom directions with a stable transition band', () => {
    expect(aircraftSilhouetteAtScale(19, false)).toBe(true)
    expect(aircraftSilhouetteAtScale(21, false)).toBe(false)
    expect(aircraftSilhouetteAtScale(21, true)).toBe(true)
    expect(aircraftSilhouetteAtScale(23, true)).toBe(false)
  })

  it('draws opaque aircraft into the same stencil bit that flight lines exclude', () => {
    const { material, silhouetteMaterial } = aircraftModel('fighter', false)
    for (const airframeMaterial of [material, silhouetteMaterial, reinforcementSilhouetteMaterial]) {
      expect(airframeMaterial).toMatchObject({
        transparent: false,
        stencilWrite: true,
        stencilRef: flightLineLayer.stencilRef,
        stencilWriteMask: flightLineLayer.stencilFuncMask,
        stencilZPass: ReplaceStencilOp,
      })
    }
    expect(flightLineLayer).toMatchObject({
      depthTest: false, depthWrite: false, stencilFunc: NotEqualStencilFunc, stencilWriteMask: 0,
    })
  })

  it('batches small site parts and represents SAM ammunition in the rack geometry', () => {
    const empty = samModel(3, 0)
    const full = samModel(3, 3)
    for (const geometry of [runwayModels.base, radarBase, radarPanel, full, empty]) {
      expect(geometry.getAttribute('position').count / 3).toBeLessThan(300)
      expect(geometry.groups.length).toBe(0)
    }
    const oneMissileVertices = samModel(3, 1).getAttribute('position').count - empty.getAttribute('position').count
    expect(oneMissileVertices).toBeGreaterThan(0)
    expect(full.getAttribute('position').count).toBe(empty.getAttribute('position').count + 3 * oneMissileVertices)
    expect(samModel(3, 3)).toBe(full)
  })
})
