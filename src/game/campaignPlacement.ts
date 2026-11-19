import { MAPPED_RADIUS } from './fog'
import { markSetupAssetPlaced } from './campaignSetup'
import type { MatchState, Point } from './types'
import { territoryContains } from './territory'
import { groundFootprintIsClear, terrainKnownWithin } from './terrain'

export const INITIAL_PLACEMENT_SPACING = 1.15
export const INITIAL_PLACEMENT_EDGE_MARGIN = .75

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])
const finitePoint = (point: Point | undefined) => !!point && Number.isFinite(point[0]) && Number.isFinite(point[1])

export function validateInitialPlacement(state: MatchState, assetId: string, point: Point | undefined): string[] {
  const asset = state.playerAssets.find(item => item.id === assetId)
  if (!asset) return ['UNKNOWN ASSET']
  if (!finitePoint(point)) return ['SELECT A MAP LOCATION']
  const edgeMargin = asset.kind === 'base' ? INITIAL_PLACEMENT_EDGE_MARGIN : .35
  if (!territoryContains(point!,state.world.friendlyTerritory,edgeMargin)) return ['PLACE INSIDE FRIENDLY TERRITORY']
  const terrain=terrainKnownWithin(state.world.terrain,state.mappedAreas,2.65,state.world.friendlyTerritory)
  if (!groundFootprintIsClear(point!,terrain,asset.kind==='base'||asset.kind==='fob'?1.1:.55)) return ['PLACE ON CLEAR, SURVEYED LAND']
  const selectedIds = state.setup ? state.setup.placedAssetIds : state.playerAssets.map(item => item.id)
  const tooClose = state.playerAssets.some(other => other.id !== assetId && selectedIds.includes(other.id) && distance(point!, other.position) < INITIAL_PLACEMENT_SPACING)
  if (tooClose) return ['TOO CLOSE TO ANOTHER FRIENDLY ASSET']
  return []
}

export function placeInitialAsset(state: MatchState, assetId: string, point: Point): MatchState {
  if (validateInitialPlacement(state, assetId, point).length) return state
  const playerAssets = state.playerAssets.map(asset => asset.id === assetId ? { ...asset, position: [...point] as Point } : asset)
  const setup = state.setup ? markSetupAssetPlaced(state.setup, assetId) : undefined
  return { ...state, playerAssets, ...(setup ? { setup } : {}) }
}

export const placementKnownForPlanning = (state: MatchState, point: Point) => {
  return territoryContains(point,state.world.friendlyTerritory) || state.mappedAreas.some(area => distance(point, area) <= MAPPED_RADIUS)
}
