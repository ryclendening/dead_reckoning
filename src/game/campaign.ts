import type { Asset, MatchState } from './types'

export const CAMPAIGN_ROUND_LIMIT = 6
export const BASE_STRIKE_RANGE = 6
export const BASE_STRIKE_DAMAGE = 60
export const ENEMY_TARGETING_THRESHOLD = 60

export const isCampaign = (state: Pick<MatchState, 'debugScenario'>): boolean =>
  state.debugScenario === undefined || state.debugScenario === 'campaign'

export function confirmedStrikeTarget(state: Pick<MatchState, 'enemyAssets'>): Asset | undefined {
  return state.enemyAssets.find(asset => asset.kind === 'base' && asset.health > 0 && asset.intel === 'confirmed' && !asset.hidden)
}

export type CampaignOutcome = 'enemy-base-destroyed' | 'home-base-destroyed' | 'deadline' | 'forces-lost'

export function campaignOutcome(state: MatchState): CampaignOutcome | undefined {
  if (!isCampaign(state)) return undefined
  const homeHealth = Math.min(state.playerBaseHealth, state.playerAssets.find(asset => asset.kind === 'base')?.health ?? state.playerBaseHealth)
  const enemyHealth = Math.min(state.enemyBaseHealth, state.enemyAssets.find(asset => asset.kind === 'base')?.health ?? state.enemyBaseHealth)
  if (homeHealth <= 0 && enemyHealth <= 0) return 'home-base-destroyed'
  if (enemyHealth <= 0) return 'enemy-base-destroyed'
  if (homeHealth <= 0) return 'home-base-destroyed'
  if (state.squadrons.every(squadron => squadron.aircraft <= 0) && state.replacements <= 0) return 'forces-lost'
  if (state.round >= CAMPAIGN_ROUND_LIMIT && state.lastResult?.round === state.round) return 'deadline'
  return undefined
}
