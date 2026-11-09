import type { AssetKind, EconomyActionId, EconomyCommand, FormationRecoveryOutcome, Point, Role, Squadron, UpgradeId } from '../types'

export type CpuDifficulty = 'easy' | 'medium' | 'hard'
export type CpuIntent = 'discover' | 'protect-base' | 'expand-defense' | 'forward-position' | 'suppress-defenses' | 'strike-base' | 'contest-air'
export interface PredictedEffects { informationGain: number; baseDamage: number; ownBaseRiskReduced: number; defenseCoverageGain: number; futureStrikeAccessGain: number; expectedAircraftLoss: number; ingressAircraftLoss?:number; reconDenial?:number; opponentAttrition?:number; logisticsSpent: number; roundsUntilPayoff: number }
/** An analytic own-capability estimate, not an opponent rollout. Damage is in HP. */
export interface BaseAttackEstimate { damageNow: number; followupDamage: number; preparationRounds: number; releaseSeconds: number; confidence?: number }
export interface TacticalPackage { id: string; summary: string; orders: Squadron[]; purchases: EconomyCommand[]; predicted: PredictedEffects; baseAttack?: BaseAttackEstimate; discoveryPayoff?: number; checks: string[] }
export interface CpuDecisionTrace { round: number; observedEvidenceIds: string[]; alternatives: Array<{ intent: CpuIntent; bestPackageScore: number; reason: string; components: Record<string, number>; baseAttack?: BaseAttackEstimate }>; selected: CpuIntent; previous?: CpuIntent; switchReason?: string; scoreDelta?: number; chosenEffects?: PredictedEffects; chosenBaseAttack?: BaseAttackEstimate; chosenChecks?: string[]; chosenPackageSummary: string; rejected: string[]; work: { packages: number; routeExpansions: number; routeSearches?: number; optimalRouteSearches?: number } }
export type CpuObjective = 'defend' | 'patrol' | 'escort' | 'strike'
export interface CpuSiteReport {
  id: string; kind: AssetKind; position: Point; health: number; maxHealth: number; observedRound: number; observedAt?: number; estimatedDamage?: number; upgrades?: UpgradeId[]
}
export interface CpuTraffic { trackId?: string; identity?: string; strength?: number; aircraft?: number; position: Point; role: Role | 'unknown'; observedRound: number; source?: 'visual' | 'radar'; observedAt?: number; bearing?: number; sector?: number }
export interface CpuPlan {
  intent?: CpuIntent; trace?: CpuDecisionTrace; round: number; objective: CpuObjective; reason: string; orders: Squadron[]
  candidates: Array<{ objective: CpuObjective; score: number; reason: string }>
}
export interface CpuState {
  version: 1 | 2; difficulty: CpuDifficulty; seed: number; formations: Squadron[]
  logistics: number; reserves: number; sites: CpuSiteReport[]; traffic: CpuTraffic[]
  searchIndex: number; lastReconLost: boolean; lastSettledRound?: number; lastAdaptedRound?: number
  spending: Array<{ round: number; action: 'repair' | 'replace' | EconomyActionId; targetId: string; cost: number }>
  intent?: CpuIntent; adaptTrace?: CpuDecisionTrace; outcomes?: Array<{ round: number; formationId: string; mission: Squadron['mission']; recovered: boolean; damage?: number; targetId?: string }>; mappedAreas?: Point[]; plan?: CpuPlan
}
export interface CpuRoundReport { sites: CpuSiteReport[]; traffic: CpuTraffic[]; recoveredIds: string[]; mappedAreas?: Point[]; recoveryOutcomes?: FormationRecoveryOutcome[]; confirmedKills?: number; strikes?: Array<{ targetId: string; damage: number; releasedAt: number; sourceId: string }> }
