export type Phase = 'deploy' | 'plan' | 'execute' | 'debrief' | 'victory' | 'defeat'
export type Role = 'interceptor' | 'fighter' | 'strike' | 'recon'
export type Mission = 'CAP' | 'ESCORT' | 'STRIKE' | 'RECON'
export type Aggression = 'cautious' | 'balanced' | 'aggressive'
export type Risk = 'preserve' | 'normal' | 'press'
export type IntelLevel = 'unknown' | 'suspected' | 'probable' | 'confirmed'
export type Point = [number, number]

export interface Squadron {
  id: string; callsign: string; role: Role; mission: Mission; aggression: Aggression; risk: Risk
  aircraft: number; maxAircraft: number; damaged: number; readiness: number; ammo: number; route: Point[]
}
export interface DetectionWindow {
  start: number; end: number; source: 'radar' | 'visual' | 'network'; observer?: string
}
export interface DefenseCue {
  id: string; flightId: string; start: number; end: number; observer: string
  strength: number; rangeBonus: number; damageReduction: number
}
export interface EnemyFlight {
  id: string; callsign: string; role: 'fighter' | 'strike'; aircraft: number
  route: Point[]; detectionWindows: DetectionWindow[]; target: 'base' | 'decoy'
}
export interface Asset {
  id: string; kind: 'base' | 'decoy' | 'radar' | 'sam' | 'aaa'; position: Point
  intel: IntelLevel; confidence: number; health: number; hidden: boolean
}
export interface CombatEvent {
  id: string; time: number; tone: 'info' | 'friendly' | 'warning' | 'danger'; title: string; detail: string; position?: Point
}
export interface DoctrineLesson {
  title: string; detail: string; tone: 'friendly' | 'warning' | 'danger'
}
export interface RoundResult {
  events: CombatEvent[]; squadrons: Squadron[]; assets: Asset[]; enemyLosses: number; friendlyLosses: number
  intelGained: string[]; baseDamage: number; enemyBaseDamage: number; logistics: number; command: number
  executionRoutes: Record<string, Point[]>; enemyFlights: EnemyFlight[]; defenseCues: DefenseCue[]
  defensiveAwareness: number; lessons: DoctrineLesson[]; playerAssets: Asset[]
}
export interface MatchState {
  round: number; phase: Phase; logistics: number; command: number; replacements: number; selectedId: string
  squadrons: Squadron[]; enemyAssets: Asset[]; playerAssets: Asset[]; playerBaseHealth: number; enemyBaseHealth: number
  lastResult?: RoundResult; seed: number
}
