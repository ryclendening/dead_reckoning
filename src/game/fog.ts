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

const friendlyCoverage = (point: Point, territory:FriendlyTerritory) => territoryRegions(territory).reduce((coverage,region)=>Math.max(coverage,smoothstep(0,FRIENDLY_FEATHER,region.radius-edgeVariation(point)-distance(point,region.center))),0)
const mappedCoverage = (point: Point, areas: Point[]) => areas.reduce((coverage, area) => Math.max(coverage, smoothstep(0, MAPPED_FEATHER, MAPPED_RADIUS - edgeVariation(point) - distance(point, area))), 0)
const liveCoverage = (point: Point, observations: MapObservation[]) => observations.reduce((coverage, observation) => Math.max(coverage, smoothstep(0, LIVE_FEATHER, observation.radius - edgeVariation(point) - distance(point, observation.position))), 0)

export function updatePersistentFogMask(input: FogMaskInput, target: Uint8Array) {
  const expectedLength = input.width * input.height
  if (target.length !== expectedLength) throw new Error(`Persistent fog mask requires ${expectedLength} bytes`)
  for (let y = 0; y < input.height; y += 1) for (let x = 0; x < input.width; x += 1) {
    const point = pointForPixel(x, y, input)
    target[y * input.width + x] = Math.round(Math.max(friendlyCoverage(point,input.friendlyTerritory), mappedCoverage(point, input.mappedAreas) * 0.6) * 255)
  }
}

export function updateLiveFogMask(input: FogMaskInput, target: Uint8Array) {
  const expectedLength = input.width * input.height
  if (target.length !== expectedLength) throw new Error(`Live fog mask requires ${expectedLength} bytes`)
  for (let y = 0; y < input.height; y += 1) for (let x = 0; x < input.width; x += 1) {
    target[y * input.width + x] = Math.round(liveCoverage(pointForPixel(x, y, input), input.observations) * 255)
  }
}
