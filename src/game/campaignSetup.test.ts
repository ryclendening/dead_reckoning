import { describe, expect, it } from 'vitest'
import { createMatch } from './data'
import { confirmCampaignSetup, createCampaignSetupState, SETUP_FORMATION_COUNT, SETUP_OPTIONAL_ASSET_COUNT, toggleSetupAsset, toggleSetupFormation, validateCampaignAllocation, validateCampaignSetup } from './campaignSetup'

const allocated = () => {
  const state = createMatch()
  let setup = createCampaignSetupState()
  for (const id of ['viper', 'falcon', 'raven']) setup = toggleSetupFormation(setup, id)
  for (const id of ['p-sam', 'p-decoy']) setup = toggleSetupAsset(setup, id)
  return { state, setup }
}

describe('initial campaign setup rules', () => {
  it('limits opening selections and requires a mixed force', () => {
    const { state, setup } = allocated()
    expect(setup.selectedFormationIds).toHaveLength(SETUP_FORMATION_COUNT)
    expect(setup.selectedAssetIds.filter(id => id !== 'p-base' && id !== 'p-radar')).toHaveLength(SETUP_OPTIONAL_ASSET_COUNT)
    expect(validateCampaignAllocation(state, setup)).toEqual([])
    expect(toggleSetupFormation(setup, 'ghost')).toEqual(setup)
    expect(toggleSetupAsset(setup, 'p-aaa')).toEqual(setup)
  })

  it('rejects one-role allocations and missing required assets', () => {
    const state = createMatch()
    let setup = createCampaignSetupState()
    for (const id of ['viper', 'falcon', 'ghost']) setup = toggleSetupFormation(setup, id)
    setup = toggleSetupAsset(setup, 'p-sam')
    setup = toggleSetupAsset(setup, 'p-decoy')
    expect(validateCampaignAllocation({ ...state, squadrons: state.squadrons.map(squadron => ({ ...squadron, role: 'fighter' as const })) }, setup)).toContain('SELECT AT LEAST ONE RECON')
    expect(validateCampaignAllocation(state, { ...setup, selectedAssetIds: ['p-sam', 'p-decoy'] })).toContain('AIRFIELD AND RADAR ARE REQUIRED')
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
    expect(confirmed.playerAssets.map(asset => asset.id)).toEqual(['p-base', 'p-decoy', 'p-radar', 'p-sam'])
    expect(confirmed.squadrons.every(squadron => squadron.route.length === 1 && squadron.route[0][0] === confirmed.playerAssets[0].position[0] && squadron.route[0][1] === confirmed.playerAssets[0].position[1])).toBe(true)
    expect(confirmed.logistics).toBe(state.logistics)
  })
})
