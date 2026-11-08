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

export type CampaignOutcome = 'enemy-base-destroyed' | 'home-base-destroyed' | 'deadline' | 'forces-lost' | 'enemy-forces-lost' | 'mutual-destruction' | 'mutual-forces-lost'

export function campaignOutcome(state: MatchState): CampaignOutcome | undefined {
  if (!isCampaign(state)) return undefined
  const homeHealth = Math.min(state.playerBaseHealth, state.playerAssets.find(asset => asset.kind === 'base')?.health ?? state.playerBaseHealth)
  const enemyHealth = Math.min(state.enemyBaseHealth, state.enemyAssets.find(asset => asset.kind === 'base')?.health ?? state.enemyBaseHealth)
  if (homeHealth <= 0 && enemyHealth <= 0) return 'mutual-destruction'
  if (enemyHealth <= 0) return 'enemy-base-destroyed'
  if (homeHealth <= 0) return 'home-base-destroyed'
  const playerLost=state.squadrons.every(squadron=>squadron.aircraft<=0)&&state.replacements<=0
  const cpuLost=!!state.cpu&&state.cpu.formations.length>0&&state.cpu.formations.every(f=>f.aircraft<=0)&&state.cpu.reserves<=0
  if(playerLost&&cpuLost)return 'mutual-forces-lost'
  if(playerLost)return 'forces-lost'
  if(cpuLost)return 'enemy-forces-lost'
  if (state.round >= CAMPAIGN_ROUND_LIMIT && state.lastResult?.round === state.round) return 'deadline'
  return undefined
}

/** Only recovered, confirmed intelligence can authorize a new ground strike. */
export function groundStrikeTargets(state: Pick<MatchState, 'enemyAssets'>): Asset[] {
  return state.enemyAssets.filter(asset => asset.health > 0 && asset.intel === 'confirmed' && !asset.hidden)
}
export function selectedStrikeTarget(state: Pick<MatchState, 'enemyAssets'>, targetId?: string): Asset | undefined {
  return groundStrikeTargets(state).find(asset => asset.id === targetId)
}

/** End-state meaning is shared by settlement, saves, UI and evaluation. */
export function campaignOutcomePhase(outcome:CampaignOutcome):'victory'|'defeat'|'draw' {
  if(outcome==='enemy-base-destroyed'||outcome==='enemy-forces-lost')return 'victory'
  if(outcome==='home-base-destroyed'||outcome==='forces-lost')return 'defeat'
  return 'draw'
}
