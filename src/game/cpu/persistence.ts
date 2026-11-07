import type { Squadron } from '../types'
import type { CpuRoundReport, CpuState } from './types'

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const integer = (v: unknown): v is number => number(v) && Number.isInteger(v)
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const point = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every(n => typeof n === 'number' && Number.isFinite(n))
const site = (v: unknown) => record(v) && text(v.id) && ['base', 'fob', 'sam', 'aaa', 'radar', 'decoy'].includes(String(v.kind))
  && point(v.position) && number(v.health) && number(v.maxHealth) && v.maxHealth > 0 && v.health <= v.maxHealth && integer(v.observedRound) && v.observedRound > 0
  && (v.observedAt === undefined || number(v.observedAt)) && (v.estimatedDamage === undefined || number(v.estimatedDamage) && v.estimatedDamage <= v.health)
const traffic = (v: unknown) => record(v) && point(v.position) && ['fighter', 'recon', 'unknown'].includes(String(v.role)) && integer(v.observedRound)
  && (v.source === undefined || ['visual','radar'].includes(String(v.source)))
  && (v.bearing === undefined || typeof v.bearing === 'number' && Number.isFinite(v.bearing))
  && (v.sector === undefined || integer(v.sector) && v.sector < 8)

const intent = (v: unknown) => ['discover','protect-base','expand-defense','forward-position','suppress-defenses','strike-base','contest-air'].includes(String(v))
const trace = (v: unknown) => record(v) && integer(v.round) && intent(v.selected) && text(v.chosenPackageSummary)
  && Array.isArray(v.observedEvidenceIds) && v.observedEvidenceIds.every(text) && Array.isArray(v.rejected) && v.rejected.every(text)
  && Array.isArray(v.alternatives) && v.alternatives.every(a=>record(a)&&intent(a.intent)&&typeof a.bestPackageScore==='number'&&Number.isFinite(a.bestPackageScore)&&text(a.reason)&&record(a.components)&&Object.values(a.components).every(n=>typeof n==='number'&&Number.isFinite(n)))
  && record(v.work) && integer(v.work.packages) && integer(v.work.routeExpansions)
export function validCpuReport(v: unknown): v is CpuRoundReport {
  return record(v) && Array.isArray(v.sites) && v.sites.every(site) && Array.isArray(v.traffic) && v.traffic.every(traffic)
    && Array.isArray(v.recoveredIds) && v.recoveredIds.every(id => id === 'red-fighter' || id === 'red-recon')
    && (v.mappedAreas === undefined || Array.isArray(v.mappedAreas) && v.mappedAreas.every(point))
    && (v.confirmedKills === undefined || integer(v.confirmedKills))
    && (v.recoveryOutcomes === undefined || Array.isArray(v.recoveryOutcomes) && v.recoveryOutcomes.every(o=>record(o)&&text(o.formationId)&&text(o.launchFieldId)&&text(o.plannedFieldId)&&['recovered','diverted','lost','destroyed','trapped'].includes(String(o.outcome))))
    && (v.strikes === undefined || Array.isArray(v.strikes) && v.strikes.every(s=>record(s)&&text(s.sourceId)&&text(s.targetId)&&number(s.damage)&&s.damage<=60&&number(s.releasedAt)))
}

export function validCpuState(v: unknown, validFormation: (v: unknown) => v is Squadron, round: number): v is CpuState {
  if (!record(v) || (v.version !== 1 && v.version !== 2) || !['easy', 'medium', 'hard'].includes(String(v.difficulty)) || !Number.isInteger(v.seed)
    || !integer(v.reserves) || !number(v.logistics) || !integer(v.searchIndex) || typeof v.lastReconLost !== 'boolean'
    || !Array.isArray(v.formations) || v.formations.length !== 2 || !v.formations.every(validFormation)
    || !v.formations.some(f => f.id === 'red-fighter' && f.role === 'fighter' && f.maxAircraft === 4)
    || !v.formations.some(f => f.id === 'red-recon' && f.role === 'recon' && f.maxAircraft === 2)
    || !Array.isArray(v.sites) || !v.sites.every(s => site(s) && (s as { observedRound: number }).observedRound <= round)
    || !Array.isArray(v.traffic) || !v.traffic.every(t => traffic(t) && (t as { observedRound: number }).observedRound <= round)
    || !Array.isArray(v.spending) || !v.spending.every(s => record(s) && integer(s.round) && s.round <= round && text(s.targetId) && number(s.cost) && ['repair', 'replace', 'repair-defense', 'repair-formation', 'replace-aircraft', 'repair-fob', 'build-sam', 'build-aaa', 'build-fob', 'install-maintenance-wing', 'install-supply-depot'].includes(String(s.action)))
    || [v.lastSettledRound, v.lastAdaptedRound].some(n => n !== undefined && (!integer(n) || n > round))) return false
  if (v.mappedAreas !== undefined && (!Array.isArray(v.mappedAreas) || !v.mappedAreas.every(point))) return false
  if (v.intent !== undefined && !intent(v.intent) || v.adaptTrace !== undefined && !trace(v.adaptTrace)) return false
  if (v.outcomes !== undefined && (!Array.isArray(v.outcomes) || !v.outcomes.every(o=>record(o)&&integer(o.round)&&o.round<=round&&text(o.formationId)&&['search-area','defensive-cap','base-strike','forward-patrol','transit'].includes(String(o.mission))&&typeof o.recovered==='boolean'))) return false
  const formations = v.formations, sites = v.sites
  if (v.plan === undefined) return true
  const p = v.plan
  if (!record(p) || !integer(p.round) || p.round > round || !['defend', 'escort', 'patrol', 'strike'].includes(String(p.objective)) || !text(p.reason)
    || !Array.isArray(p.orders) || p.orders.length !== 2 || !p.orders.every(validFormation)
    || new Set(p.orders.map(order => order.id)).size !== 2
    || !Array.isArray(p.candidates) || !p.candidates.every(c => record(c) && typeof c.score === 'number' && Number.isFinite(c.score) && text(c.reason) && ['defend', 'escort', 'patrol', 'strike'].includes(String(c.objective)))) return false
  if (p.intent !== undefined && !intent(p.intent) || p.trace !== undefined && !trace(p.trace)) return false
  return p.orders.every(order => formations.some(f => f.id === order.id && f.role === order.role && f.maxAircraft === order.maxAircraft)
    && order.route.length > 0 && order.routeIngress.length > 0
    && (order.protectedTargetId === undefined || order.protectedTargetId === 'red-recon' && order.role === 'fighter')
    && (order.mission !== 'base-strike' || sites.some(s => record(s) && s.id === order.strikeTargetId)))
}
