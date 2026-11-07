import { describe, expect, it } from 'vitest'
import { createMatch } from './data'
import { confirmCampaignSetup, createCampaignSetupState, SETUP_FORMATION_COUNT, SETUP_FORMATION_IDS, SETUP_REQUIRED_ASSET_IDS, toggleSetupAsset, toggleSetupFormation, validateCampaignAllocation, validateCampaignSetup } from './campaignSetup'

const allocated = () => {
  const state = createMatch()
  const setup = createCampaignSetupState()
  return { state, setup }
}

describe('initial campaign setup rules', () => {
  it('starts with the fixed VIPER, FALCON, and RAVEN force', () => {
    expect(createCampaignSetupState().selectedFormationIds).toEqual(SETUP_FORMATION_IDS)
  })

  it('uses the fixed four-asset package and requires a mixed force', () => {
    const { state, setup } = allocated()
    expect(setup.selectedFormationIds).toHaveLength(SETUP_FORMATION_COUNT)
    expect(setup.selectedAssetIds).toEqual(SETUP_REQUIRED_ASSET_IDS)
    expect(validateCampaignAllocation(state, setup)).toEqual([])
    expect(toggleSetupFormation(setup, 'ghost')).toEqual(setup)
    expect(toggleSetupAsset(setup, 'p-decoy')).toEqual(setup)
    expect(validateCampaignAllocation(state, { ...setup, selectedAssetIds: [...setup.selectedAssetIds, 'p-decoy'] })).toContain('STARTING PACKAGE IS INCOMPLETE')
  })

  it('rejects one-role allocations and missing required assets', () => {
    const state = createMatch()
    const setup = { ...createCampaignSetupState(), selectedFormationIds: ['viper', 'falcon', 'ghost'] }
    expect(validateCampaignAllocation({ ...state, squadrons: state.squadrons.map(squadron => ({ ...squadron, role: 'fighter' as const })) }, setup)).toContain('SELECT AT LEAST ONE RECON')
    expect(validateCampaignAllocation(state, { ...setup, selectedAssetIds: ['p-sam', 'p-decoy'] })).toContain('STARTING PACKAGE IS INCOMPLETE')
  })

  it('requires all selected assets to be placed and an explicit review', () => {
    const { state, setup } = allocated()
    expect(validateCampaignSetup(state, setup)).toContain('PLACE EVERY SELECTED ASSET')
    const placed = { ...setup, stage: 'review' as const, placedAssetIds: [...setup.selectedAssetIds] }
    expect(validateCampaignSetup(state, placed)).toEqual([])
  })

  it('confirms a deterministic Round 1 package without spending Logistics', () => {
    const { state, setup } = allocated()
    const confirmed = confirmCampaignSetup({ ...state, setup: { ...setup, stage: 'review', placedAssetIds: [...setup.selectedAssetIds] }, phase: 'deploy' })
    expect(confirmed.phase).toBe('plan')
    expect(confirmed.setup).toBeUndefined()
    expect(confirmed.squadrons.map(squadron => squadron.id)).toEqual(['viper', 'falcon', 'raven'])
    expect(confirmed.playerAssets.map(asset => asset.id)).toEqual(['p-base', 'p-radar', 'p-sam', 'p-aaa'])
    expect(confirmed.squadrons.every(squadron => squadron.route.length === 1 && squadron.route[0][0] === confirmed.playerAssets[0].position[0] && squadron.route[0][1] === confirmed.playerAssets[0].position[1])).toBe(true)
    expect(confirmed.logistics).toBe(state.logistics)
  })
})
