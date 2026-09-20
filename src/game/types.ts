export type Phase = 'deploy' | 'plan' | 'execute' | 'debrief' | 'adapt' | 'victory' | 'defeat'
export type Role = 'fighter' | 'recon'
export type MissionId = 'defensive-cap' | 'forward-patrol' | 'search-area'
export type IntelLevel = 'unknown' | 'suspected' | 'probable' | 'confirmed'
export type Point = [number, number]
export type ReinforcementType = 'alert-cap' | 'replacement-flight'
export type WorldEdge = 'north' | 'east' | 'south' | 'west'

export interface WorldBounds { minX:number; maxX:number; minZ:number; maxZ:number }
export interface BoundarySegment { edge:WorldEdge; coordinate:number; from:number; to:number }
export interface TerritoryRegion { id:string; kind:'home'|'fob'; center:Point; radius:number }
export interface FriendlyTerritory { center:Point; radius:number; regions?:TerritoryRegion[] }
export interface CampaignWorld {
  seed:number
  bounds:WorldBounds
  presentationBounds:WorldBounds
  startRegionId:string
  friendlyTerritory:FriendlyTerritory
}

export interface Squadron {
  id: string; callsign: string; role: Role; mission: MissionId
  aircraft: number; maxAircraft: number; damaged: number; readiness: number; ammo: number; route: Point[]; routeIngress: Point[]
  strength?: number; morale?: number; status?: ExecutionStatus; plannedRecoveryFieldId?: string
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
export type AssetKind = 'base' | 'fob' | 'decoy' | 'radar' | 'sam' | 'aaa'
export type ConstructibleAssetKind = 'fob' | 'decoy' | 'sam' | 'aaa'
export interface Asset {
  id: string; kind: AssetKind; position: Point
  intel: IntelLevel; confidence: number; health: number; maxHealth: number; hidden: boolean; struck: boolean
  name?: string; operational?: boolean; capacity?: number; basedFormationIds?: string[]; upgrades?: AssetUpgradeId[]
}
export type AssetUpgradeId = 'maintenance-wing' | 'supply-depot'
export type EconomyActionId = 'repair-formation' | 'replace-aircraft' | 'repair-defense' | 'repair-fob' | 'install-maintenance-wing' | 'install-supply-depot' | 'build-fob' | 'build-decoy' | 'build-sam' | 'build-aaa'
export type EconomyTarget = { kind: 'campaign'; id: 'campaign' } | { kind: 'squadron' | 'asset'; id: string }
export type CampaignSetupStage = 'allocate' | 'place' | 'review'
export interface CampaignSetupState {
  stage: CampaignSetupStage
  selectedFormationIds: string[]
  selectedAssetIds: string[]
  placedAssetIds: string[]
}
export type EconomyEffect =
  | { kind: 'formation-strength'; before: number; after: number }
  | { kind: 'aircraft-replacement'; aircraftBefore: number; aircraftAfter: number; strengthBefore: number; strengthAfter: number }
  | { kind: 'asset-health'; before: number; after: number }
  | { kind: 'asset-operational'; before: boolean; after: boolean }
  | { kind: 'airfield-upgrade'; upgrade: AssetUpgradeId }
  | { kind: 'asset-construction'; assetKind: ConstructibleAssetKind; name: string; capacity?: number }
export interface EconomyProjection { logistics: number; reserveAircraft: number }
export interface EconomyCommand {
  actionId: EconomyActionId; target: EconomyTarget
  placement?: Point
  expectedCost?: number; expectedReserveCost?: number; expectedLogistics?: number; expectedReserveAircraft?: number
}
export interface LogisticsIncome { base: number; intel: number; enemyAircraft: number; total: number }
export interface LogisticsStatementEntry {
  id: string; round: number; direction: 'income' | 'spend'; amount: number; label: string
  source: string; target?: EconomyTarget
}
export interface EconomyState { lastSettledRound?: number; statement: LogisticsStatementEntry[] }
export interface EconomyActionQuote {
  id: EconomyActionId; target: EconomyTarget; label: string; detail: string; cost: number
  reserveCost?: number; effect: EconomyEffect; projected: EconomyProjection; eligible: boolean; reason?: string
}
export interface CombatEvent {
  id: string; time: number; tone: 'info' | 'friendly' | 'warning' | 'danger'; title: string; detail: string; position?: Point
}
export type ExecutionStatus = 'enroute' | 'dogfight' | 'disengaging' | 'rtb' | 'trapped' | 'destroyed'
export type FlightMode = 'following-route' | 'intercepting' | 'dogfighting' | 'attacking-recon' | 'recovering' | 'stranded' | 'trapped' | 'recovered' | 'destroyed'
export interface UnitFrame { time: number; position: Point; facing: Point; mode: FlightMode; strength: number; morale: number; aircraft: number; traveledDistance: number }
export interface UnitTrack { unitId: string; frames: UnitFrame[] }
export interface ContactInterval { id: string; observerId: string; targetId: string; source: 'radar' | 'visual'; start: number; end: number; position: Point }
export interface BehaviorInterval { id: string; unitId: string; mode: FlightMode; start: number; end: number; targetId?: string; source?: 'radar' | 'visual'; reason: string }
export type WeaponKind = 'gun' | 'air-to-air-missile' | 'sam' | 'aaa'
export type FighterEngagementSide = 'friendly' | 'hostile'
export type FighterEngagementPhaseKind = 'approach' | 'opening-fire' | 'merged' | 'resolved'
export type FighterPositionalAdvantage = 'dominant' | 'favorable' | 'neutral' | 'disadvantaged'
export type FighterNumericalAdvantage = 'overwhelming' | 'advantaged' | 'even' | 'disadvantaged' | 'overmatched'
export interface FighterPositionalEvaluation {
  classification: FighterPositionalAdvantage
  score: number
  approachAlignment: number
  targetRearAspect: number
  usableHeadings: boolean
}
export interface CombatProbabilityRecord {
  baseHitProbability: number
  modifiers: Array<{source:'position'|'numbers'|'formation-condition';key:string;delta:number}>
  unclampedHitProbability: number
  finalHitProbability: number
  roll: number
}
export interface FighterNumericalAssessment {
  attackerPower: number; defenderPower: number; forceRatio: number
  classification: FighterNumericalAdvantage; hitProbabilityDelta: number
}
export interface CombatExchange {
  id: string; time: number; attackerId: string; defenderId: string; weapon: WeaponKind
  damage: number; moraleDamage: number; hit: boolean; position: Point; targetStrength: number; targetMorale: number
  probability?: CombatProbabilityRecord
  numericalAssessment?: FighterNumericalAssessment
  resolution?: 'probability'
  phase?: 'opening-fire' | 'merged'
}
export interface FighterEngagementParticipant {
  id: string; side: FighterEngagementSide; joinedAt: number; exitedAt: number
  initialStrength: number; finalStrength: number; initialAircraft: number; finalAircraft: number
  finalDisposition: ExecutionStatus
}
export interface FighterEngagementPhase {kind:FighterEngagementPhaseKind;start:number;end:number}
export interface FighterPositionalAssessment {
  evaluatedAt: number; participantId: string; opponentId: string; classification: FighterPositionalAdvantage
  participantPosition: Point; participantHeading: Point; opponentPosition: Point; opponentHeading: Point
  evaluation: FighterPositionalEvaluation
}
export interface FighterEngagementRecord {
  schemaVersion: 1
  sides: Record<FighterEngagementSide,string[]>
  participants: FighterEngagementParticipant[]
  phases: FighterEngagementPhase[]
  positionalAssessments: FighterPositionalAssessment[]
}
interface CombatSequenceBase {
  id: string
  participantIds: string[]; location: Point; start: number; end: number
  exchanges: CombatExchange[]
  finalDisposition: Record<string, ExecutionStatus>
  moraleBreakReason?: string
}
export interface FighterCombatSequence extends CombatSequenceBase {kind:'dogfight';engagement:FighterEngagementRecord}
export interface OtherCombatSequence extends CombatSequenceBase {kind:'pursuit'|'strike'|'defense';engagement?:never}
export type CombatSequence = FighterCombatSequence | OtherCombatSequence
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
export interface SimulationCommand {id:string;unitId:string;type:'rtb';issuedAtTick:number}
export interface ThreatAlert {id:string;unitId:string;time:number;kind:'fighter-contact'|'sam-launch'|'aaa-launch';sourceId:string}
export interface IntelReport {
  id: string; observerId: string; assetId: string; confidence: number; recovered: boolean; detail: string
}
export interface OperationalFinding {
  title: string; detail: string; tone: 'friendly' | 'warning' | 'danger'
}
export interface FormationAttrition {
  id: string; callsign: string; role: Role
  startAircraft: number; endAircraft: number; aircraftLost: number
  endStrength: number; finalStatus: 'returned' | 'damaged' | 'destroyed' | 'not-deployed'; destroyed: boolean; confirmed: boolean
}
export interface FormationRecoveryOutcome {
  formationId: string
  launchFieldId: string
  plannedFieldId: string
  actualFieldId?: string
  outcome: 'recovered' | 'diverted' | 'lost' | 'destroyed' | 'trapped'
  reason: string
}
export interface ReinforcementCall {
  id: string; type: ReinforcementType; time: number; scoreCost: number; title: string; detail: string
  route: Point[]; targetSquadronId?: string
}
export interface RoundResult {
  round: number; duration: number; tickSeconds: number; unitTracks: UnitTrack[]; contactIntervals: ContactInterval[]; behaviorIntervals: BehaviorInterval[]
  events: CombatEvent[]; squadrons: Squadron[]; assets: Asset[]; enemyLosses: number; friendlyLosses: number
  friendlyAttrition: FormationAttrition[]; enemyAttrition: FormationAttrition[]; friendlyFormationsDestroyed: number; enemyFormationsDestroyed: number
  intelGained: string[]; baseDamage: number; enemyBaseDamage: number; logisticsIncome: LogisticsIncome; command: number
  executionRoutes: Record<string, Point[]>; enemyFlights: EnemyFlight[]; defenseCues: DefenseCue[]
  defensiveAwareness: number; lessons: OperationalFinding[]; playerAssets: Asset[]
  reinforcementCalls: ReinforcementCall[]; roundScore: number; baseExposure: number; baseExposureDelta: number
  combatSequences: CombatSequence[]; weaponEffects: WeaponEffect[]; contactObservations: ContactObservation[]; radarTrackReceipts: RadarTrackReceipt[]; interceptPlans: InterceptPlan[]; intelReports: IntelReport[]
  mappedAreas: Point[]
  discoveredBoundaries: BoundarySegment[]
  recoveryOutcomes: FormationRecoveryOutcome[]
  simulationCommands?: SimulationCommand[]
  threatAlerts?: ThreatAlert[]
}
export interface MatchState {
  round: number; phase: Phase; logistics: number; command: number; replacements: number; selectedId: string
  squadrons: Squadron[]; enemyAssets: Asset[]; playerAssets: Asset[]; playerBaseHealth: number; enemyBaseHealth: number
  baseExposure: number; campaignScore: number; lastResult?: RoundResult; seed: number; world: CampaignWorld
  mappedAreas: Point[]
  discoveredBoundaries: BoundarySegment[]
  economy: EconomyState
  setup?: CampaignSetupState
  debugScenario?: DebugScenario
}
export type DebugScenario = 'campaign' | 'fighter-duel' | 'fighter-2v1' | 'fighter-tail' | 'fighter-head-on' | 'fighter-reversed' | 'fighter-recon' | 'neutral-los' | 'radar-intercept' | 'reaction-interrupt' | 'parallel-engagements' | 'recon-pursuit' | 'recon-recovery' | 'recon-edge' | 'recon-loss' | 'fob-recovery' | 'fob-divert' | 'fob-stranded' | 'fob-trapped'
