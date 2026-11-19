import type { FriendlyTerritory, Point, WorldBounds } from './types'
import { territoryRegions } from './territory'

export interface MapObservation {
  position: Point
  radius: number
}

export interface FogMaskInput {
  mappedAreas: Point[]
  observations: MapObservation[]
  width: number
  height: number
  presentationBounds: WorldBounds
  friendlyTerritory: FriendlyTerritory
}

export interface FogMaskSize { width:number; height:number }
export const MAPPED_RADIUS = 2.65

const TEXELS_PER_MAP_UNIT=4
const MAX_MASK_WIDTH=192
const MAX_MASK_HEIGHT=256
const LIVE_FEATHER = 0.45
const MAPPED_FEATHER = 0.65
const FRIENDLY_FEATHER = 0.65
const EDGE_VARIATION = 0.12

export const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])
export const nearAny = (point: Point, areas: Point[], radius: number) => areas.some(area => distance(point, area) <= radius)
export const underObservation = (point: Point, observations: MapObservation[]) => observations.some(observation => distance(point, observation.position) <= observation.radius)
export const knownFriendlyTerritory=(point:Point,territory:FriendlyTerritory)=>territoryRegions(territory).some(region=>distance(point,region.center)<=region.radius)

export function deriveFogMaskSize(bounds:WorldBounds):FogMaskSize{return {width:Math.max(8,Math.min(MAX_MASK_WIDTH,Math.ceil((bounds.maxX-bounds.minX)*TEXELS_PER_MAP_UNIT))),height:Math.max(8,Math.min(MAX_MASK_HEIGHT,Math.ceil((bounds.maxZ-bounds.minZ)*TEXELS_PER_MAP_UNIT)))}}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp01((value - edge0) / Math.max(0.0001, edge1 - edge0))
  return t * t * (3 - 2 * t)
}

const hash = (x: number, z: number) => {
  const value = Math.sin(x * 127.1 + z * 311.7) * 43758.5453
  return value - Math.floor(value)
}

const edgeVariation = (point: Point) => hash(Math.floor(point[0] * 0.65), Math.floor(point[1] * 0.65)) * EDGE_VARIATION
const pointForPixel = (x: number, y: number, input: FogMaskInput): Point => [
  input.presentationBounds.minX + ((x + 0.5) / input.width) * (input.presentationBounds.maxX - input.presentationBounds.minX),
  input.presentationBounds.maxZ - ((y + 0.5) / input.height) * (input.presentationBounds.maxZ - input.presentationBounds.minZ),
]

/** Outside the circle's bounding box its contribution is always zero. */
function stampCoverage(input: FogMaskInput, target: Uint8Array, center: Point, radius: number, feather: number, opacity = 1) {
  const { width, height, presentationBounds: bounds } = input
  const [centerX, centerZ] = center
  const spanX = bounds.maxX - bounds.minX
  const spanZ = bounds.maxZ - bounds.minZ
  const left = spanX > 0 ? Math.max(0, Math.floor((centerX - radius - bounds.minX) / spanX * width)) : 0
  const right = spanX > 0 ? Math.min(width, Math.ceil((centerX + radius - bounds.minX) / spanX * width)) : width
  const top = spanZ > 0 ? Math.max(0, Math.floor((bounds.maxZ - centerZ - radius) / spanZ * height)) : 0
  const bottom = spanZ > 0 ? Math.min(height, Math.ceil((bounds.maxZ - centerZ + radius) / spanZ * height)) : height
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    const point = pointForPixel(x, y, input)
    const coverage = smoothstep(0, feather, radius - edgeVariation(point) - distance(point, center))
    const index = y * width + x
    target[index] = Math.max(target[index], Math.round(coverage * opacity * 255))
  }
}

export function updatePersistentFogMask(input: FogMaskInput, target: Uint8Array) {
  const expectedLength = input.width * input.height
  if (target.length !== expectedLength) throw new Error(`Persistent fog mask requires ${expectedLength} bytes`)
  target.fill(0)
  for (const region of territoryRegions(input.friendlyTerritory)) stampCoverage(input, target, region.center, region.radius, FRIENDLY_FEATHER)
  for (const area of input.mappedAreas) stampCoverage(input, target, area, MAPPED_RADIUS, MAPPED_FEATHER, 0.6)
}

export function updateLiveFogMask(input: FogMaskInput, target: Uint8Array) {
  const expectedLength = input.width * input.height
  if (target.length !== expectedLength) throw new Error(`Live fog mask requires ${expectedLength} bytes`)
  target.fill(0)
  for (const { position, radius } of input.observations) stampCoverage(input, target, position, radius, LIVE_FEATHER)
}
