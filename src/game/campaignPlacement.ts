import { MAPPED_RADIUS } from './fog'
import { ONLINE_RUNWAY_RADIUS, ONLINE_SPACED_START_REGION } from './campaignLayout'
import { markSetupAssetPlaced } from './campaignSetup'
import type { MatchState, Point } from './types'
import { territoryContains } from './territory'
import { groundFootprintIsClear, terrainKnownWithin } from './terrain'

export const INITIAL_PLACEMENT_SPACING = 1.15
export const INITIAL_PLACEMENT_EDGE_MARGIN = .75

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])

export function initialPlacementValidator(state: MatchState, assetId: string): (point: Point | undefined) => string[] {
  const asset = state.playerAssets.find(item => item.id === assetId)
  if (!asset) return () => ['UNKNOWN ASSET']
  const edgeMargin = asset.kind === 'base' ? INITIAL_PLACEMENT_EDGE_MARGIN : .35
  const territory = state.world.friendlyTerritory
  const terrain = terrainKnownWithin(state.world.terrain, state.mappedAreas, MAPPED_RADIUS, territory)
  const placed = state.playerAssets.filter(other =>
    other.id !== assetId && (!state.setup || state.setup.placedAssetIds.includes(other.id)))
  return point => {
    if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return ['SELECT A MAP LOCATION']
    if (!territoryContains(point, territory, edgeMargin)) return ['PLACE INSIDE FRIENDLY TERRITORY']
    if (asset.kind === 'base' && state.world.startRegionId === ONLINE_SPACED_START_REGION
      && distance(point, territory.center) > ONLINE_RUNWAY_RADIUS + 1e-7) return ['PLACE THE RUNWAY NEAR THE TERRITORY CENTER']
    if (!groundFootprintIsClear(point, terrain, asset.kind === 'base' || asset.kind === 'fob' ? 1.1 : .55)) return ['PLACE ON CLEAR, SURVEYED LAND']
    if (placed.some(other => distance(point, other.position) < INITIAL_PLACEMENT_SPACING)) return ['TOO CLOSE TO ANOTHER FRIENDLY ASSET']
    return []
  }
}

export function validateInitialPlacement(state: MatchState, assetId: string, point: Point | undefined): string[] {
  return initialPlacementValidator(state, assetId)(point)
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
