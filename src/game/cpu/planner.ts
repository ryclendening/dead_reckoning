import { BASE_STRIKE_RANGE, ENEMY_TARGETING_THRESHOLD, isCampaign } from '../campaign'
import { FLIGHT_SPEED, MAX_FLIGHT_DISTANCE, missionDistance, routeDistance } from '../flightRules'
import { estimateEscortCoverage } from '../missionResponsibility'
import { generateRouteTemplate } from '../routeTemplates'
import type { Asset, MatchState, Point, Squadron } from '../types'
import type { CpuDifficulty, CpuObjective, CpuPlan, CpuSiteReport, CpuState } from './types'

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])
const copy = (p: Point): Point => [...p]
const SEARCH_SECTORS: Point[] = [[0, 0], [-6, 8], [0, 8], [6, 8], [-6, 0], [6, 0], [-6, -8], [0, -8], [6, -8]]
export const CPU_PROFILES = {
  easy: { offsets: [0], riskWeight: .45, escortValue: 16 },
  medium: { offsets: [0, 4, -4], riskWeight: 1.2, escortValue: 35 },
  hard: { offsets: [0, 4, -4, 7, -7], riskWeight: 1.8, escortValue: 43 },
} satisfies Record<CpuDifficulty, { offsets: number[]; riskWeight: number; escortValue: number }>

export function createCpuState(home: Point, difficulty: CpuDifficulty = 'medium', seed = 7301): CpuState {
  const formation = (id: string, callsign: string, role: Squadron['role'], aircraft: number): Squadron => ({
    id, callsign, role, aircraft, maxAircraft: aircraft, damaged: 0, strength: 100, morale: 74,
    readiness: 90, ammo: 100, mission: role === 'fighter' ? 'defensive-cap' : 'search-area',
    route: [copy(home)], routeIngress: [copy(home)],
  })
  return { version: 1, difficulty, seed, formations: [formation('red-fighter', 'BOGEY 1', 'fighter', 4), formation('red-recon', 'SPECTER', 'recon', 2)],
    logistics: 10, reserves: 3, sites: [], traffic: [], searchIndex: 0, lastReconLost: false, spending: [] }
}

/** This is the only campaign adapter. Player assets, routes, budgets and true bounds are deliberately absent. */
export interface CpuPlanningView {
  cpu: CpuState; home: Point; homeHealth: number; round: number; exposure: number
}
export function cpuPlanningView(state: Pick<MatchState, 'cpu' | 'enemyAssets' | 'round' | 'baseExposure'>): CpuPlanningView | undefined {
  const base = state.enemyAssets.find(asset => asset.kind === 'base')
  return state.cpu && base ? { cpu: structuredClone(state.cpu), home: copy(base.position), homeHealth: base.health, round: state.round, exposure: state.baseExposure } : undefined
}

/** Expected exposure, integrated along segments, using recovered reports rather than live hidden assets. */
export function cpuRouteRisk(route: Point[], role: Squadron['role'], sites: CpuSiteReport[]): number {
  let risk = 0
  for (const site of sites.filter(site => site.health > 0 && ['sam', 'aaa', 'radar'].includes(site.kind))) {
    const radius = site.kind === 'sam' ? 3.2 : site.kind === 'aaa' ? 1.9 : 6.4
    let inside = 0
    for (let i = 1; i < route.length; i++) {
      const from = route[i - 1], to = route[i], length = distance(from, to), samples = Math.max(1, Math.ceil(length / .4))
      for (let j = 0; j < samples; j++) {
        const t = (j + .5) / samples, p: Point = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]
        if (distance(p, site.position) <= radius) inside += length / samples
      }
    }
    const seconds = inside / FLIGHT_SPEED[role]
    risk += site.kind === 'sam' ? (seconds > 0 ? Math.min(3, Math.ceil(seconds / 3)) * .64 * 38 : 0)
      : site.kind === 'aaa' ? (seconds > 0 ? .42 * 10 * 5 : 0) : seconds * 1.5
  }
  return risk
}

function ingressAlternatives(home: Point, point: Point, offsets: number[]): Point[][] {
  const length = Math.max(.001, distance(home, point)), side: Point = [-(point[1] - home[1]) / length, (point[0] - home[0]) / length]
  return offsets.map(offset => offset === 0 ? [copy(home), copy(point)] : [copy(home), [(home[0] + point[0]) / 2 + side[0] * offset, (home[1] + point[1]) / 2 + side[1] * offset], copy(point)])
}

function bestOrder(view: CpuPlanningView, formation: Squadron, mission: Squadron['mission'], station: Point, budget = MAX_FLIGHT_DISTANCE[formation.role]): Squadron {
  const profile = CPU_PROFILES[view.cpu.difficulty]
  const bounds = { minX: Math.min(view.home[0], station[0]) - 6, maxX: Math.max(view.home[0], station[0]) + 6,
    minZ: Math.min(view.home[1], station[1]) - 6, maxZ: Math.max(view.home[1], station[1]) + 6 }
  const alternatives = ingressAlternatives(view.home, station, profile.offsets).map(ingress => {
    const generated = generateRouteTemplate({ template: mission, ingress, maxDistance: budget, bounds })
    const total = [...generated.route, view.home]
    return { ...generated, cost: routeDistance(total) + cpuRouteRisk(total, formation.role, view.cpu.sites) * profile.riskWeight }
  }).sort((a, b) => a.cost - b.cost)
  const chosen = alternatives[0]
  return { ...formation, mission, route: chosen.route, routeIngress: chosen.ingress, plannedRecoveryFieldId: 'e-base',
    protectedPoint: mission === 'defensive-cap' ? copy(station) : undefined, protectedTargetId: undefined, strikeTargetId: undefined,
    sortieOrdered: formation.aircraft > 0 && view.homeHealth > 0 }
}

function strikeOrders(view: CpuPlanningView, fighter: Squadron, target: CpuSiteReport): Squadron[] {
  const profile = CPU_PROFILES[view.cpu.difficulty], length = Math.max(.001, distance(view.home, target.position))
  const angle = Math.atan2(view.home[1] - target.position[1], view.home[0] - target.position[0])
  const angles = view.cpu.difficulty === 'hard' ? [0, .65, -.65] : [0]
  const nearRelease: Point = length <= .001 ? [view.home[0] + .05, view.home[1]]
    : [view.home[0] + (target.position[0] - view.home[0]) * Math.min(.25, length) / length, view.home[1] + (target.position[1] - view.home[1]) * Math.min(.25, length) / length]
  const releases: Point[] = length < BASE_STRIKE_RANGE ? [nearRelease] : angles.map(turn => [target.position[0] + Math.cos(angle + turn) * 5.9, target.position[1] + Math.sin(angle + turn) * 5.9])
  return releases.flatMap(release => ingressAlternatives(view.home, release, profile.offsets))
    .filter(route => missionDistance(route, view.home) <= MAX_FLIGHT_DISTANCE.fighter + .001)
    .map(route => ({ ...fighter, mission: 'base-strike', strikeTargetId: target.id, protectedPoint: undefined, protectedTargetId: undefined,
      route, routeIngress: route, sortieOrdered: fighter.aircraft > 0, plannedRecoveryFieldId: 'e-base' }))
}

export function planCpu(view: CpuPlanningView): CpuPlan {
  const { cpu, home, round } = view, fighter = cpu.formations.find(unit => unit.role === 'fighter')!, recon = cpu.formations.find(unit => unit.role === 'recon')!
  const profile = CPU_PROFILES[cpu.difficulty]
  const knownBase = cpu.sites.find(site => site.kind === 'base' && site.health > 0)
  // Public geographic prior, ordered only from our own home. Never reconstruct
  // an opposing start from the campaign seed or inspect hidden placements.
  const sectors = SEARCH_SECTORS.filter(point => distance(point, home) >= 10)
    .sort((a, b) => Math.abs(distance(a, home) - 18) - Math.abs(distance(b, home) - 18))
  const search = knownBase && view.exposure < ENEMY_TARGETING_THRESHOLD ? knownBase.position : sectors[cpu.searchIndex % sectors.length]
  const recentTraffic = cpu.traffic.filter(contact => round - contact.observedRound <= 2)
  const wantsEscort = cpu.difficulty !== 'easy' && (cpu.lastReconLost || recentTraffic.some(contact => contact.role === 'fighter'))
  const reconOrder = bestOrder(view, recon, 'search-area', search, wantsEscort ? 36 : MAX_FLIGHT_DISTANCE.recon)
  const homeThreat = recentTraffic.filter(contact => distance(contact.position, home) < 9).length
  const defend = bestOrder(view, fighter, 'defensive-cap', home)
  const toward: Point = [home[0] * .5, home[1] * .5]
  const patrol = bestOrder(view, fighter, 'forward-patrol', recentTraffic.at(-1)?.position ?? toward)
  const candidates: Array<{ objective: CpuObjective; score: number; reason: string; order: Squadron }> = [
    { objective: 'defend', score: 26 + (100 - view.homeHealth) * .85 + homeThreat * 8 + (round >= 5 ? 10 : 0), reason: view.homeHealth < 100 ? 'Home base damaged; protect the remaining health.' : 'Preserve home and deny enemy reconnaissance.', order: defend },
    { objective: 'patrol', score: 34 + recentTraffic.length * 3, reason: recentTraffic.length ? 'Patrol an approach witnessed on a recovered sortie.' : 'Patrol the central approach while recon searches.', order: patrol },
  ]
  if (reconOrder.sortieOrdered && fighter.aircraft > 0) {
    const coverage = estimateEscortCoverage({ escortRoute: [home], protectedRoute: [...reconOrder.route, home], escortSpeed: FLIGHT_SPEED.fighter, protectedSpeed: FLIGHT_SPEED.recon, recoveryPoint: home, maxDistance: MAX_FLIGHT_DISTANCE.fighter })
    if (coverage.recoveryFeasible && coverage.percent >= 30) candidates.push({ objective: 'escort', score: profile.escortValue + (cpu.lastReconLost ? 25 : 0) + (recentTraffic.some(contact => contact.role === 'fighter') ? 15 : 0),
      reason: cpu.lastReconLost ? 'Previous recon failed to return; cover the next collection attempt.' : 'Keep fighter cover near the collection flight.',
      order: { ...fighter, mission: 'defensive-cap', route: reconOrder.route, routeIngress: reconOrder.routeIngress, protectedTargetId: recon.id, protectedPoint: undefined, strikeTargetId: undefined, plannedRecoveryFieldId: 'e-base', sortieOrdered: true } })
  }
  for (const site of cpu.sites.filter(site => site.health > 0 && site.kind !== 'decoy' && (site.kind !== 'base' || view.exposure >= ENEMY_TARGETING_THRESHOLD))) {
    for (const order of strikeOrders(view, fighter, site)) {
      const risk = cpuRouteRisk([...order.route, home], 'fighter', cpu.sites)
      const value = site.kind === 'base' ? 72 + round * 3 + (site.health <= 60 * (fighter.strength ?? 100) / 100 ? 30 : 0)
        : site.kind === 'sam' ? 54 : site.kind === 'fob' ? 48 : site.kind === 'radar' ? 40 : 30
      candidates.push({ objective: 'strike', score: value - risk * profile.riskWeight - missionDistance(order.route, home) * .3,
        reason: `Strike recovered ${site.kind} report from round ${site.observedRound}; compare effect with exposure.`, order })
    }
  }
  const feasible = candidates.filter(candidate => missionDistance(candidate.order.route, home) <= 40 + .001)
    .map(candidate => ({ ...candidate, score: candidate.score + (cpu.plan?.objective === candidate.objective ? 2 : 0) }))
    .sort((a, b) => b.score - a.score || a.objective.localeCompare(b.objective))
  const near = feasible.filter(candidate => feasible[0].score - candidate.score <= 8)
  const chosen = cpu.difficulty === 'easy' ? near[Math.abs(Math.imul(cpu.seed + round, 31)) % near.length] : feasible[0]
  const fighterOrder = { ...chosen.order, sortieOrdered: fighter.aircraft > 0 && view.homeHealth > 0 }
  return { round, objective: chosen.objective, reason: chosen.reason, orders: [fighterOrder, reconOrder],
    candidates: feasible.map(({ objective, score, reason }) => ({ objective, score: Math.round(score * 100) / 100, reason })) }
}

export function prepareCpuRound(state: MatchState): MatchState {
  if (!isCampaign(state) || !state.cpu || state.cpu.plan?.round === state.round) return state
  const view = cpuPlanningView(state)
  return view ? { ...state, cpu: { ...state.cpu, plan: planCpu(view) } } : state
}

export function cpuFlights(state: MatchState): import('../types').EnemyFlight[] {
  return prepareCpuRound(state).cpu!.plan!.orders.map(order => ({ ...order, initialAircraft: order.aircraft,
    target: order.strikeTargetId ? 'base' : 'decoy', detectionWindows: [] }))
}

export function cpuReportAt(asset: Asset, round: number): CpuSiteReport {
  return { id: asset.id, kind: asset.kind, position: copy(asset.position), health: asset.health, maxHealth: asset.maxHealth, observedRound: round }
}
