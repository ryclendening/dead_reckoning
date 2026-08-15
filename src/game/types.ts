export type Phase = 'deploy' | 'plan' | 'execute' | 'debrief' | 'victory' | 'defeat'
export type Role = 'fighter' | 'recon'
export type Mission = 'CAP' | 'RECON'
export type Aggression = 'cautious' | 'balanced' | 'aggressive'
export type Risk = 'preserve' | 'normal' | 'press'
export type TargetPriority = 'opportunity'
export type IntelLevel = 'unknown' | 'suspected' | 'probable' | 'confirmed'
export type Point = [number, number]
export type ReinforcementType = 'alert-cap' | 'replacement-flight'

export interface Squadron {
  id: string; callsign: string; role: Role; mission: Mission; aggression: Aggression; risk: Risk
  targetPriority: TargetPriority; aircraft: number; maxAircraft: number; damaged: number; readiness: number; ammo: number; route: Point[]
  strength?: number; morale?: number; selectedTargetId?: string; status?: ExecutionStatus
}
export interface DetectionWindow {
  start: number; end: number; source: 'radar' | 'visual' | 'network'; observer?: string
}
export interface DefenseCue {
  id: string; flightId: string; start: number; end: number; observer: string
  strength: number; rangeBonus: number; damageReduction: number
}
export interface EnemyFlight {
  id: string; callsign: string; role: Role; aircraft: number; initialAircraft: number
  strength?: number; morale?: number; status?: ExecutionStatus
  route: Point[]; detectionWindows: DetectionWindow[]; target: 'base' | 'decoy'
}
export interface Asset {
  id: string; kind: 'base' | 'decoy' | 'radar' | 'sam' | 'aaa'; position: Point
  intel: IntelLevel; confidence: number; health: number; maxHealth: number; hidden: boolean; struck: boolean
}
export interface CombatEvent {
  id: string; time: number; tone: 'info' | 'friendly' | 'warning' | 'danger'; title: string; detail: string; position?: Point
}
export type ExecutionStatus = 'enroute' | 'dogfight' | 'disengaging' | 'rtb' | 'destroyed'
export type WeaponKind = 'gun' | 'air-to-air-missile' | 'sam' | 'aaa'
export interface CombatExchange {
  id: string; time: number; attackerId: string; defenderId: string; weapon: WeaponKind
  damage: number; moraleDamage: number; hit: boolean; position: Point; targetStrength: number; targetMorale: number
}
export interface CombatSequence {
  id: string; kind: 'dogfight' | 'pursuit' | 'strike' | 'defense'
  participantIds: string[]; location: Point; start: number; end: number
  exchanges: CombatExchange[]
  finalDisposition: Record<string, ExecutionStatus>
  moraleBreakReason?: string
}
export interface WeaponEffect {
  id: string; kind: WeaponKind; sourceId: string; targetId: string; start: number; end: number
  from: Point; to: Point; hit: boolean; damage: number
}
export interface ContactObservation {
  id: string; observerId: string; targetId: string; start: number; end: number
  source: 'radar' | 'visual'; confidence: number; position: Point; recovered: boolean
}
export interface IntelReport {
  id: string; observerId: string; assetId: string; confidence: number; recovered: boolean; detail: string
}
export interface DoctrineLesson {
  title: string; detail: string; tone: 'friendly' | 'warning' | 'danger'
}
export interface ReinforcementCall {
  id: string; type: ReinforcementType; time: number; scoreCost: number; title: string; detail: string
  route: Point[]; targetSquadronId?: string
}
export interface RoundResult {
  events: CombatEvent[]; squadrons: Squadron[]; assets: Asset[]; enemyLosses: number; friendlyLosses: number
  intelGained: string[]; baseDamage: number; enemyBaseDamage: number; logistics: number; command: number
  executionRoutes: Record<string, Point[]>; enemyFlights: EnemyFlight[]; defenseCues: DefenseCue[]
  defensiveAwareness: number; lessons: DoctrineLesson[]; playerAssets: Asset[]
  reinforcementCalls: ReinforcementCall[]; roundScore: number; baseExposure: number; baseExposureDelta: number
  combatSequences: CombatSequence[]; weaponEffects: WeaponEffect[]; contactObservations: ContactObservation[]; intelReports: IntelReport[]
}
export interface MatchState {
  round: number; phase: Phase; logistics: number; command: number; replacements: number; selectedId: string
  squadrons: Squadron[]; enemyAssets: Asset[]; playerAssets: Asset[]; playerBaseHealth: number; enemyBaseHealth: number
  baseExposure: number; campaignScore: number; lastResult?: RoundResult; seed: number
  debugScenario?: DebugScenario
}
export type DebugScenario = 'campaign' | 'fighter-duel' | 'recon-recovery' | 'recon-loss'
