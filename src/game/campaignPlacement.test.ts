import { describe, expect, it } from 'vitest'
import { createMatch } from './data'
import { createCampaignSetupState } from './campaignSetup'
import { INITIAL_PLACEMENT_EDGE_MARGIN, INITIAL_PLACEMENT_SPACING, placeInitialAsset, validateInitialPlacement } from './campaignPlacement'
import type { Point } from './types'

describe('initial campaign placement', () => {
  it('accepts deterministic in-territory placement and marks the setup asset placed', () => {
    const initial = createMatch()
    const center = initial.world.friendlyTerritory.center
    const state = { ...initial, setup: { ...createCampaignSetupState(), selectedAssetIds: ['p-base', 'p-radar'], placedAssetIds: [] } }
    const point: Point = [center[0] - 2, center[1] + 1]
    expect(validateInitialPlacement(state, 'p-base', point)).toEqual([])
    const placed = placeInitialAsset(state, 'p-base', point)
    expect(placed.playerAssets.find(asset => asset.id === 'p-base')?.position).toEqual(point)
    expect(placed.setup?.placedAssetIds).toEqual(['p-base'])
  })

  it('rejects unknown, outside, edge-margin, and overlapping placements', () => {
    const state = createMatch()
    const center = state.world.friendlyTerritory.center
    expect(validateInitialPlacement(state, 'missing', center)).toContain('UNKNOWN ASSET')
    expect(validateInitialPlacement(state, 'p-base', [center[0] + state.world.friendlyTerritory.radius + 1, center[1]])).toContain('PLACE INSIDE FRIENDLY TERRITORY')
    expect(validateInitialPlacement(state, 'p-base', [center[0] + state.world.friendlyTerritory.radius - INITIAL_PLACEMENT_EDGE_MARGIN / 2, center[1]])).toContain('PLACE INSIDE FRIENDLY TERRITORY')
    const radar = state.playerAssets.find(asset => asset.id === 'p-radar')!
    expect(validateInitialPlacement(state, 'p-base', [radar.position[0] + INITIAL_PLACEMENT_SPACING / 2, radar.position[1]])).toContain('TOO CLOSE TO ANOTHER FRIENDLY ASSET')
  })

  it('ignores hidden enemy positions and undiscovered world bounds', () => {
    const state = createMatch()
    const center = state.world.friendlyTerritory.center
    const point: Point = [center[0] + 1, center[1] + 1]
    const enemyMoved = { ...state, enemyAssets: state.enemyAssets.map((asset, index) => index === 0 ? { ...asset, position: point } : asset) }
    expect(validateInitialPlacement(enemyMoved, 'p-base', point)).not.toContain('ENEMY')
  })
})
