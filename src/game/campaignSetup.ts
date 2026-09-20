import type { Asset, CampaignSetupState, MatchState, Squadron } from './types'

export const SETUP_FORMATION_COUNT = 3
export const SETUP_OPTIONAL_ASSET_COUNT = 2
export const SETUP_REQUIRED_ASSET_IDS = ['p-base', 'p-radar'] as const
export const SETUP_OPTIONAL_ASSET_IDS = ['p-decoy', 'p-sam', 'p-aaa'] as const

export const createCampaignSetupState = (): CampaignSetupState => ({ stage: 'allocate', selectedFormationIds: [], selectedAssetIds: [...SETUP_REQUIRED_ASSET_IDS], placedAssetIds: [] })

export const setupFormationById = (state: MatchState, id: string) => state.squadrons.find(squadron => squadron.id === id)
export const setupAssetById = (state: MatchState, id: string) => state.playerAssets.find(asset => asset.id === id)

export function toggleSetupFormation(setup: CampaignSetupState, id: string): CampaignSetupState {
  const selected = setup.selectedFormationIds.includes(id)
  if (selected) return { ...setup, selectedFormationIds: setup.selectedFormationIds.filter(item => item !== id) }
  if (setup.selectedFormationIds.length >= SETUP_FORMATION_COUNT) return setup
  return { ...setup, selectedFormationIds: [...setup.selectedFormationIds, id] }
}

export function toggleSetupAsset(setup: CampaignSetupState, id: string): CampaignSetupState {
  if ((SETUP_REQUIRED_ASSET_IDS as readonly string[]).includes(id)) return setup
  if (!(SETUP_OPTIONAL_ASSET_IDS as readonly string[]).includes(id)) return setup
  const selected = setup.selectedAssetIds.includes(id)
  if (selected) return { ...setup, selectedAssetIds: setup.selectedAssetIds.filter(item => item !== id), placedAssetIds: setup.placedAssetIds.filter(item => item !== id) }
  if (setup.selectedAssetIds.filter(item => (SETUP_OPTIONAL_ASSET_IDS as readonly string[]).includes(item)).length >= SETUP_OPTIONAL_ASSET_COUNT) return setup
  return { ...setup, selectedAssetIds: [...setup.selectedAssetIds, id] }
}

export function markSetupAssetPlaced(setup: CampaignSetupState, id: string): CampaignSetupState {
  if (!setup.selectedAssetIds.includes(id) || setup.placedAssetIds.includes(id)) return setup
  return { ...setup, stage: 'place', placedAssetIds: [...setup.placedAssetIds, id] }
}

export function validateCampaignAllocation(state: MatchState, setup: CampaignSetupState): string[] {
  const errors: string[] = []
  if (setup.selectedFormationIds.length !== SETUP_FORMATION_COUNT) errors.push(`SELECT ${SETUP_FORMATION_COUNT} FORMATIONS`)
  const formations = setup.selectedFormationIds.map(id => setupFormationById(state, id)).filter((squadron): squadron is Squadron => !!squadron)
  if (formations.length !== setup.selectedFormationIds.length) errors.push('UNKNOWN FORMATION SELECTION')
  if (!formations.some(squadron => squadron.role === 'fighter')) errors.push('SELECT AT LEAST ONE FIGHTER')
  if (!formations.some(squadron => squadron.role === 'recon')) errors.push('SELECT AT LEAST ONE RECON')
  if (!SETUP_REQUIRED_ASSET_IDS.every(id => setup.selectedAssetIds.includes(id))) errors.push('AIRFIELD AND RADAR ARE REQUIRED')
  const optionalCount = setup.selectedAssetIds.filter(id => (SETUP_OPTIONAL_ASSET_IDS as readonly string[]).includes(id)).length
  if (optionalCount !== SETUP_OPTIONAL_ASSET_COUNT) errors.push(`SELECT ${SETUP_OPTIONAL_ASSET_COUNT} SUPPORT ASSETS`)
  if (setup.selectedAssetIds.some(id => !setupAssetById(state, id))) errors.push('UNKNOWN SUPPORT ASSET')
  return errors
}

export function validateCampaignSetup(state: MatchState, setup: CampaignSetupState): string[] {
  const errors = validateCampaignAllocation(state, setup)
  const selectedAssets = setup.selectedAssetIds.filter(id => !!setupAssetById(state, id))
  if (selectedAssets.some(id => !setup.placedAssetIds.includes(id))) errors.push('PLACE EVERY SELECTED ASSET')
  if (setup.stage !== 'review') errors.push('REVIEW THE OPENING PACKAGE')
  return errors
}

export function confirmCampaignSetup(state: MatchState): MatchState {
  if (!state.setup || validateCampaignSetup(state, state.setup).length) return state
  const base = state.playerAssets.find(asset => asset.id === 'p-base')
  if (!base) return state
  const selectedIds = new Set(state.setup.selectedFormationIds)
  const selectedAssets = new Set(state.setup.selectedAssetIds)
  const route = [ [...base.position] as [number, number] ]
  const squadrons = state.squadrons.filter(squadron => selectedIds.has(squadron.id)).map(squadron => ({ ...squadron, mission: squadron.role === 'fighter' ? 'defensive-cap' as const : 'search-area' as const, route, routeIngress: route }))
  return {
    ...state,
    phase: 'plan',
    setup: undefined,
    selectedId: squadrons[0]?.id ?? state.selectedId,
    squadrons,
    playerAssets: state.playerAssets.filter(asset => selectedAssets.has(asset.id)).map(asset => asset.kind === 'base' ? { ...asset, operational: true, basedFormationIds: squadrons.map(squadron => squadron.id) } : asset),
  }
}

export const setupAssetLabel = (asset: Asset | string) => {
  const kind = typeof asset === 'string' ? asset.replace(/^p-/, '') : asset.kind
  return kind === 'base' ? 'MAIN AIRFIELD' : kind.toUpperCase()
}
