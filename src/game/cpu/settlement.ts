import { isCampaign } from '../campaign'
import { LOGISTICS_COSTS, LOGISTICS_EFFECTS } from '../economyRules'
import type { MatchState, RoundResult } from '../types'
import { prepareCpuRound } from './planner'

export function settleCpuRound(state: MatchState, result: RoundResult): MatchState {
  if (!isCampaign(state) || !state.cpu || !result.cpuReport || state.cpu.lastSettledRound === result.round) return state
  const cpu = structuredClone(state.cpu), report = result.cpuReport
  const priorIds = new Set(cpu.sites.map(site => site.id))
  const sites = new Map(cpu.sites.map(site => [site.id, site]))
  for (const site of report.sites) sites.set(site.id, site)
  cpu.sites = [...sites.values()]
  const recovered = new Set(report.recoveredIds)
  cpu.formations = cpu.formations.map(formation => {
    const flight = result.enemyFlights.find(flight => flight.id === formation.id)
    const ordered = cpu.plan?.orders.find(order => order.id === formation.id)?.sortieOrdered !== false
    if (!ordered) return formation
    return { ...formation, aircraft: recovered.has(formation.id) ? flight?.aircraft ?? 0 : 0,
      strength: recovered.has(formation.id) ? flight?.strength ?? 0 : 0, morale: flight?.morale ?? formation.morale, status: recovered.has(formation.id) ? 'rtb' : 'destroyed' }
  })
  cpu.lastReconLost = cpu.plan?.orders.some(order => order.role === 'recon' && order.sortieOrdered !== false && !recovered.has(order.id)) ?? false
  cpu.searchIndex += 1
  cpu.traffic = [...cpu.traffic.filter(contact => result.round - contact.observedRound < 2), ...report.traffic].slice(-12)
  cpu.logistics += LOGISTICS_EFFECTS.baseIncome + report.sites.filter(site => !priorIds.has(site.id)).length * LOGISTICS_EFFECTS.intelRecovery
  cpu.lastSettledRound = result.round
  return { ...state, cpu }
}

/** Finite maintenance only in this slice. Uses shared prices and formation-relative aircraft capacity. */
export function maintainCpu(state: MatchState): MatchState {
  if (!isCampaign(state) || !state.cpu || state.phase !== 'adapt' || state.cpu.lastAdaptedRound === state.round) return state
  const cpu = structuredClone(state.cpu), assets = structuredClone(state.enemyAssets)
  const spend = (action: 'repair' | 'replace' | 'repair-defense', targetId: string, cost: number) => {
    cpu.logistics -= cost; cpu.spending.push({ round: state.round, action, targetId, cost })
  }
  for (const formation of cpu.formations) {
    while (formation.aircraft < formation.maxAircraft && cpu.reserves > 0 && cpu.logistics >= LOGISTICS_COSTS.aircraftReplacement) {
      spend('replace', formation.id, LOGISTICS_COSTS.aircraftReplacement); cpu.reserves -= 1; formation.aircraft += 1
      formation.strength = Math.min(100, (formation.strength ?? 0) + 100 / formation.maxAircraft); formation.status = 'rtb'
    }
    const capacity = formation.aircraft / formation.maxAircraft * 100
    while ((formation.strength ?? 0) < capacity - .001 && cpu.logistics >= LOGISTICS_COSTS.formationRepair) {
      spend('repair', formation.id, LOGISTICS_COSTS.formationRepair)
      formation.strength = Math.min(capacity, (formation.strength ?? 0) + LOGISTICS_EFFECTS.formationRepair)
    }
  }
  for (const asset of assets.filter(asset => ['aaa', 'radar'].includes(asset.kind))) {
    while (asset.health < asset.maxHealth && cpu.logistics >= LOGISTICS_COSTS.defenseRepair) {
      spend('repair-defense', asset.id, LOGISTICS_COSTS.defenseRepair)
      asset.health = Math.min(asset.maxHealth, asset.health + LOGISTICS_EFFECTS.defenseRepair)
    }
  }
  cpu.lastAdaptedRound = state.round
  return { ...state, cpu, enemyAssets: assets }
}

export const planNextCpuRound = (state: MatchState) => prepareCpuRound(state)
