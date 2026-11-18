import type { Asset, MatchState, Squadron } from './types'
import { canAffordFormation } from './economyRules'

export const CAMPAIGN_ROUND_LIMIT = 10
export const BASE_STRIKE_RANGE = 6
export const BASE_STRIKE_DAMAGE = 40
export const ENEMY_TARGETING_THRESHOLD = 60

export const isCampaign = (state: Pick<MatchState, 'debugScenario'>): boolean =>
  state.debugScenario === undefined || state.debugScenario === 'campaign'

export function confirmedStrikeTarget(state: Pick<MatchState, 'enemyAssets'>): Asset | undefined {
  return state.enemyAssets.find(asset => asset.kind === 'base' && asset.health > 0 && asset.intel === 'confirmed' && !asset.hidden)
}

export type CampaignOutcome = 'enemy-base-destroyed' | 'home-base-destroyed' | 'deadline' | 'forces-lost' | 'enemy-forces-lost' | 'mutual-destruction' | 'mutual-forces-lost'

const forcesEliminated = (formations: Squadron[], cash: number): boolean =>
  formations.every(formation => formation.aircraft <= 0) && !canAffordFormation(cash)

export function campaignOutcome(state: MatchState): CampaignOutcome | undefined {
  const current = outcomeUnderRules(state)
  const completed = state.phase === 'victory' || state.phase === 'defeat' || state.phase === 'draw'
  if (!completed || state.onlineOutcome || current && campaignOutcomePhase(current) === state.phase) return current
  // Preserve finished campaigns recorded under either earlier elimination rule.
  return outcomeUnderRules(state, 'cash') ?? legacyCampaignOutcome(state) ?? current
}

export const legacyCampaignOutcome = (state: MatchState): CampaignOutcome | undefined => outcomeUnderRules(state, 'reserves')

function outcomeUnderRules(state: MatchState, legacy?: 'cash' | 'reserves'): CampaignOutcome | undefined {
  if (!isCampaign(state)) return undefined
  if (state.onlineOutcome) return state.onlineOutcome
  const homeHealth = Math.min(state.playerBaseHealth, state.playerAssets.find(asset => asset.kind === 'base')?.health ?? state.playerBaseHealth)
  const enemyHealth = Math.min(state.enemyBaseHealth, state.enemyAssets.find(asset => asset.kind === 'base')?.health ?? state.enemyBaseHealth)
  if (homeHealth <= 0 && enemyHealth <= 0) return 'mutual-destruction'
  if (enemyHealth <= 0) return 'enemy-base-destroyed'
  if (homeHealth <= 0) return 'home-base-destroyed'
  if (legacy) {
    const eliminated = (formations: Squadron[], cash: number, reserves: number) => legacy === 'cash'
      ? forcesEliminated(formations, cash)
      : formations.every(formation => formation.aircraft <= 0) && reserves <= 0
    const playerLost = eliminated(state.squadrons, state.logistics, state.replacements)
    const cpuLost = state.cpu && eliminated(state.cpu.formations, state.cpu.logistics, state.cpu.reserves)
    if (playerLost && cpuLost) return 'mutual-forces-lost'
    if (playerLost) return 'forces-lost'
    if (cpuLost) return 'enemy-forces-lost'
  }
  if (state.round >= (legacy === 'reserves' ? 6 : CAMPAIGN_ROUND_LIMIT) && state.lastResult?.round === state.round) return 'deadline'
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
