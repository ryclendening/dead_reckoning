import type { ConstructibleAssetKind, EconomyActionId, EconomyActionQuote, EconomyCommand, EconomyTarget, MatchState, Point, RoundResult, LogisticsIncome, LogisticsStatementEntry } from './types'
import { normalizeFormationBasing, formationField } from './forwardBasing'
import { campaignOutcome, campaignOutcomePhase } from './campaign'
import { maintainCpu, planNextCpuRound } from './cpu/settlement'
import { modifiedStat } from './upgrades'
import { LOGISTICS_EFFECTS } from './economyRules'
import { sidePlanningContext, applySideContext } from './sideContext'
import * as shared from './sideEconomy'
export { LOGISTICS_COSTS, LOGISTICS_EFFECTS } from './economyRules'
export { FOB_INITIAL_CAPACITY, FOB_PLACEMENT_SPACING, FOB_PLACEMENT_MAX_TERRITORY_GAP, PROCUREMENT_CATALOG, AIRFIELD_UPGRADE_CATALOG, economyTargetsEqual, findMatchingEconomyQuote, createEconomyState } from './sideEconomy'
export const validateAssetPlacement = (s: MatchState, k: ConstructibleAssetKind, p: Point | undefined) => shared.validateAssetPlacement(sidePlanningContext(s, 'player'), k, p)
export const validateFobPlacement = (s: MatchState, p: Point | undefined) => validateAssetPlacement(s, 'fob', p)
export const economyQuotesFor = (s: MatchState, t: EconomyTarget) => shared.economyQuotesFor(sidePlanningContext(s, 'player'), t)
export const economyAttentionTargets = (s: MatchState) => shared.economyAttentionTargets(sidePlanningContext(s, 'player'))
export const economyCommandForQuote = (s: MatchState, q: EconomyActionQuote) => shared.economyCommandForQuote(sidePlanningContext(s, 'player'), q)
export function executeEconomyCommand(s: MatchState, c: EconomyCommand): MatchState {
  const ctx = sidePlanningContext(s, 'player'), next = shared.executeEconomyCommand(ctx, c)
  return ctx === next ? s : applySideContext(s, next)
}
export const purchaseEconomyAction = (s: MatchState, actionId: EconomyActionId, target: EconomyTarget) => executeEconomyCommand(s, { actionId, target })
const baseAsset=(state:MatchState)=>state.playerAssets.find(a=>a.kind==='base')
export function deriveLogisticsIncome(state: MatchState, result: Pick<RoundResult, 'enemyLosses' | 'intelReports'>): LogisticsIncome {
  const base = modifiedStat(baseAsset(state), 'economy.baseIncome', LOGISTICS_EFFECTS.baseIncome)
  const intel = result.intelReports.filter(report => report.recovered).length * LOGISTICS_EFFECTS.intelRecovery
  const enemyAircraft = result.enemyLosses * LOGISTICS_EFFECTS.confirmedEnemyAircraft
  return { base, intel, enemyAircraft, total: base + intel + enemyAircraft }
}

export function settleLogisticsIncome(state: MatchState, result: RoundResult): MatchState {
  if (state.economy.lastSettledRound === result.round) return state
  const income = result.logisticsIncome
  const entries: LogisticsStatementEntry[] = [
    { id: `income-${result.round}-base`, round: result.round, direction: 'income', amount: income.base, label: income.base > LOGISTICS_EFFECTS.baseIncome ? 'ROUND LOGISTICS · SUPPLY DEPOT' : 'ROUND LOGISTICS', source: 'round-income' },
    ...(income.intel ? [{ id: `income-${result.round}-intel`, round: result.round, direction: 'income' as const, amount: income.intel, label: 'INTELLIGENCE RECOVERY', source: 'intel-recovery' }] : []),
    ...(income.enemyAircraft ? [{ id: `income-${result.round}-enemy-aircraft`, round: result.round, direction: 'income' as const, amount: income.enemyAircraft, label: 'CONFIRMED ENEMY AIRCRAFT', source: 'enemy-aircraft' }] : []),
  ]
  return { ...state, logistics: state.logistics + income.total, economy: { lastSettledRound: result.round, statement: entries } }
}

export const openAdaptPhase = (state: MatchState): MatchState => {
  if (state.phase !== 'debrief') return state
  const outcome = campaignOutcome(state)
  if (outcome) return { ...state, phase: campaignOutcomePhase(outcome) }
  return maintainCpu({ ...state, phase: 'adapt' })
}
export const beginNextRound = (state: MatchState): MatchState => {
  if (state.phase !== 'adapt' || campaignOutcome(state)) return state
  const playerAssets = normalizeFormationBasing(state.squadrons, state.playerAssets)
  const squadrons = state.squadrons.map(squadron => {
    const field = formationField(playerAssets, squadron.id)
    if (!field || squadron.aircraft <= 0) return { ...squadron, plannedRecoveryFieldId: undefined, sortieOrdered: undefined }
    const trapped = field.kind === 'fob' && field.operational === false
    const origin = [...field.position] as [number, number]
    return { ...squadron, plannedRecoveryFieldId: undefined, sortieOrdered: undefined, status: trapped ? 'trapped' as const : 'rtb' as const, route: [origin], routeIngress: [origin] }
  })
  const maintained = maintainCpu(state)
  return planNextCpuRound({ ...maintained, playerAssets, squadrons, round: state.round + 1, phase: 'plan', lastResult: undefined })
}
