import type { AssetKind, Point, Role, Squadron, UpgradeId } from '../types'

export type CpuDifficulty = 'easy' | 'medium' | 'hard'
export type CpuObjective = 'defend' | 'patrol' | 'escort' | 'strike'
export interface CpuSiteReport {
  id: string; kind: AssetKind; position: Point; health: number; maxHealth: number; observedRound: number; upgrades?: UpgradeId[]
}
export interface CpuTraffic { position: Point; role: Role; observedRound: number }
export interface CpuPlan {
  round: number; objective: CpuObjective; reason: string; orders: Squadron[]
  candidates: Array<{ objective: CpuObjective; score: number; reason: string }>
}
export interface CpuState {
  version: 1; difficulty: CpuDifficulty; seed: number; formations: Squadron[]
  logistics: number; reserves: number; sites: CpuSiteReport[]; traffic: CpuTraffic[]
  searchIndex: number; lastReconLost: boolean; lastSettledRound?: number; lastAdaptedRound?: number
  spending: Array<{ round: number; action: 'repair' | 'replace' | 'repair-defense'; targetId: string; cost: number }>
  plan?: CpuPlan
}
export interface CpuRoundReport { sites: CpuSiteReport[]; traffic: CpuTraffic[]; recoveredIds: string[] }
