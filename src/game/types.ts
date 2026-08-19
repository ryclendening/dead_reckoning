export type Phase = 'deploy' | 'plan' | 'execute' | 'debrief' | 'victory' | 'defeat'
export type Role = 'fighter' | 'recon'
export type Mission = 'CAP' | 'RECON'
export type Aggression = 'conservative' | 'neutral' | 'aggressive'
export type TargetPriority = 'opportunity'
export type IntelLevel = 'unknown' | 'suspected' | 'probable' | 'confirmed'
export type Point = [number, number]
export type ReinforcementType = 'alert-cap' | 'replacement-flight'

export interface Squadron {
  id: string; callsign: string; role: Role; mission: Mission; aggression: Aggression
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
  route: Point[]; detectionWindows: DetectionWindow[]; identityLearnedAt?: number; target: 'base' | 'decoy'
}
export interface Asset {
  id: string; kind: 'base' | 'decoy' | 'radar' | 'sam' | 'aaa'; position: Point
  intel: IntelLevel; confidence: number; health: number; maxHealth: number; hidden: boolean; struck: boolean
}
export interface CombatEvent {
  id: string; time: number; tone: 'info' | 'friendly' | 'warning' | 'danger'; title: string; detail: string; position?: Point
}
export type ExecutionStatus = 'enroute' | 'dogfight' | 'disengaging' | 'rtb' | 'destroyed'
export type FlightMode = 'following-route' | 'intercepting' | 'pursuing-last-known' | 'dogfighting' | 'attacking-recon' | 'recovering' | 'recovered' | 'destroyed'
export interface UnitFrame { time: number; position: Point; facing: Point; mode: FlightMode; strength: number; morale: number; aircraft: number; traveledDistance: number }
export interface UnitTrack { unitId: string; frames: UnitFrame[] }
export interface ContactInterval { id: string; observerId: string; targetId: string; source: 'radar' | 'visual'; start: number; end: number; position: Point }
export interface BehaviorInterval { id: string; unitId: string; mode: FlightMode; start: number; end: number; targetId?: string; source?: 'radar' | 'visual'; reason: string }
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
export interface RadarTrackReceipt {
  id: string; radarId: string; receiverId: string; targetId: string; start: number; end: number
}
export interface InterceptPlan {
  squadronId: string; targetId: string; start: number; end: number; source: 'radar' | 'visual'; outcome: 'merge' | 'lost-contact'
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
  duration: number; tickSeconds: number; unitTracks: UnitTrack[]; contactIntervals: ContactInterval[]; behaviorIntervals: BehaviorInterval[]
  events: CombatEvent[]; squadrons: Squadron[]; assets: Asset[]; enemyLosses: number; friendlyLosses: number
  intelGained: string[]; baseDamage: number; enemyBaseDamage: number; logistics: number; command: number
  executionRoutes: Record<string, Point[]>; enemyFlights: EnemyFlight[]; defenseCues: DefenseCue[]
  defensiveAwareness: number; lessons: DoctrineLesson[]; playerAssets: Asset[]
  reinforcementCalls: ReinforcementCall[]; roundScore: number; baseExposure: number; baseExposureDelta: number
  combatSequences: CombatSequence[]; weaponEffects: WeaponEffect[]; contactObservations: ContactObservation[]; radarTrackReceipts: RadarTrackReceipt[]; interceptPlans: InterceptPlan[]; intelReports: IntelReport[]
  mappedAreas: Point[]
}
export interface MatchState {
  round: number; phase: Phase; logistics: number; command: number; replacements: number; selectedId: string
  squadrons: Squadron[]; enemyAssets: Asset[]; playerAssets: Asset[]; playerBaseHealth: number; enemyBaseHealth: number
  baseExposure: number; campaignScore: number; lastResult?: RoundResult; seed: number
  mappedAreas: Point[]
  debugScenario?: DebugScenario
}
export type DebugScenario = 'campaign' | 'fighter-duel' | 'neutral-los' | 'radar-intercept' | 'recon-recovery' | 'recon-loss'
