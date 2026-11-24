import type { ConstructibleAssetKind, EconomyActionId, EconomyActionQuote, EconomyCommand, EconomyTarget, MatchState, Point, RoundResult, LogisticsIncome, LogisticsStatementEntry } from './types'
import { normalizeFormationBasing, formationField } from './forwardBasing'
import { campaignOutcome, campaignOutcomePhase, isCampaign } from './campaign'
import { maintainCpu, planNextCpuRound } from './cpu/settlement'
import { modifiedStat } from './upgrades'
import { LOGISTICS_EFFECTS } from './economyRules'
import { objectiveRewards } from './objectives'
import { sidePlanningContext, applySideContext } from './sideContext'
import * as shared from './sideEconomy'
export { LOGISTICS_COSTS, LOGISTICS_EFFECTS } from './economyRules'
export { FOB_INITIAL_CAPACITY, FOB_PLACEMENT_SPACING, FOB_PLACEMENT_MAX_TERRITORY_GAP, PROCUREMENT_CATALOG, AIRFIELD_UPGRADE_CATALOG, economyTargetsEqual, findMatchingEconomyQuote, createEconomyState } from './sideEconomy'
export function constructionPlacementValidator(state: MatchState, kind: ConstructibleAssetKind) {
  const context = sidePlanningContext(state, 'player')
  return shared.constructionPlacementValidator(context, kind)
}
export const validateAssetPlacement = (s: MatchState, k: ConstructibleAssetKind, p: Point | undefined) => constructionPlacementValidator(s, k)(p)
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
type IncomeResult = Pick<RoundResult, 'enemyLosses' | 'intelReports'> & Partial<Pick<RoundResult, 'assets' | 'combatSequences'>>

export function deriveLogisticsIncome(state: MatchState, result: IncomeResult): LogisticsIncome {
  const base = modifiedStat(baseAsset(state), 'economy.baseIncome', LOGISTICS_EFFECTS.baseIncome)
  const intel = result.intelReports.filter(report => report.recovered && report.kind !== 'defense-upgrade').length * LOGISTICS_EFFECTS.intelRecovery
  const enemyAircraft = result.enemyLosses * LOGISTICS_EFFECTS.confirmedEnemyAircraft
  const objectives = isCampaign(state) ? objectiveRewards(state.economy.completedObjectives,
    new Set(state.squadrons.map(formation => formation.id)), result.assets ?? [], result.combatSequences ?? [],
    result.intelReports.some(report => report.recovered && report.kind === 'defense-upgrade')) : []
  const total = base + intel + enemyAircraft + objectives.reduce((sum, reward) => sum + reward.amount, 0)
  return { base, intel, enemyAircraft, total, ...(objectives.length ? { objectives } : {}) }
}

export function applyRoundIncome(state: MatchState, round: number, income: LogisticsIncome, retainStatement = false) {
  if (state.economy.lastSettledRound === round) return state
  const entries: LogisticsStatementEntry[] = [
    ...(retainStatement ? state.economy.statement : []),
    { id: `income-${round}-base`, round, direction: 'income', amount: income.base, label: income.base > LOGISTICS_EFFECTS.baseIncome ? 'ROUND PAY · SUPPLY DEPOT' : 'ROUND PAY', source: 'round-income' },
    ...(income.intel ? [{ id: `income-${round}-intel`, round, direction: 'income' as const, amount: income.intel, label: 'INTELLIGENCE RECOVERY', source: 'intel-recovery' }] : []),
    ...(income.enemyAircraft ? [{ id: `income-${round}-enemy-aircraft`, round, direction: 'income' as const, amount: income.enemyAircraft, label: 'CONFIRMED ENEMY AIRCRAFT', source: 'enemy-aircraft' }] : []),
    ...(income.objectives ?? []).map(({ id, label, amount })=>({ id: `income-${round}-${id}`, round, label, amount, direction: 'income' as const, source: 'objective' })),
  ]
  const completed = new Set([...(state.economy.completedObjectives ?? []), ...(income.objectives ?? []).map(reward => reward.id)])
  return { ...state, logistics: state.logistics + income.total, economy: {
    lastSettledRound: round, statement: entries, ...(completed.size ? { completedObjectives: [...completed] } : {}),
  } }
}

export function settleLogisticsIncome(state: MatchState, result: RoundResult): MatchState {
  return applyRoundIncome(state, result.round, result.logisticsIncome)
}

/** Enter the visible Resupply phase before running the CPU's private adaptation work. */
export const openAdaptPhaseImmediately = (state: MatchState): MatchState => {
  if (state.phase !== 'debrief') return state
  const outcome = campaignOutcome(state)
  if (outcome) return { ...state, phase: campaignOutcomePhase(outcome) }
  return { ...state, phase: 'adapt' }
}

export const openAdaptPhase = (state: MatchState): MatchState => {
  const adapted = openAdaptPhaseImmediately(state)
  return adapted.phase === 'adapt' ? maintainCpu(adapted) : adapted
}
/** Publish the player's next-round planning state without waiting for CPU planning. */
const nextRoundState = (state: MatchState): MatchState => {
  const playerAssets = normalizeFormationBasing(state.squadrons, state.playerAssets)
  const squadrons = state.squadrons.map(squadron => {
    const field = formationField(playerAssets, squadron.id)
    if (!field || squadron.aircraft <= 0) return { ...squadron, recoveryWaypoints: undefined, plannedRecoveryFieldId: undefined, sortieOrdered: undefined }
    const trapped = field.kind === 'fob' && field.operational === false
    const origin = [...field.position] as [number, number]
    return { ...squadron, recoveryWaypoints: undefined, plannedRecoveryFieldId: undefined, sortieOrdered: undefined, status: trapped ? 'trapped' as const : 'rtb' as const, route: [origin], routeIngress: [origin] }
  })
  return { ...state, playerAssets, squadrons, round: state.round + 1, phase: 'plan', lastResult: undefined }
}

export const advanceToNextRound = (state: MatchState): MatchState => {
  if (state.phase !== 'adapt' || campaignOutcome(state)) return state
  return nextRoundState(state)
}

export const beginNextRound = (state: MatchState): MatchState => {
  if (state.phase !== 'adapt' || campaignOutcome(state)) return state
  const maintained = maintainCpu(state)
  return planNextCpuRound(nextRoundState(maintained))
}
