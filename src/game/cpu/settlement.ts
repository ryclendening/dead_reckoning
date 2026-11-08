import { isCampaign } from '../campaign'
import { LOGISTICS_EFFECTS } from '../economyRules'
import type { MatchState, RoundResult } from '../types'
import { applyRecoveryOutcomesToBasing } from '../forwardBasing'
import { prepareCpuRound, cpuPlanningView } from './planner'
import { planPurchases } from './purchases'
import { executeCpuEconomyCommand } from './economy'

export function settleCpuRound(state: MatchState, result: RoundResult): MatchState {
  if (!isCampaign(state) || !state.cpu || !result.cpuReport || state.cpu.lastSettledRound === result.round) return state
  const cpu = structuredClone(state.cpu), report = result.cpuReport
  const priorIds = new Set(cpu.sites.map(site => site.id))
  const sites = new Map(cpu.sites.map(site => [site.id, site]))
  for (const site of report.sites) sites.set(site.id, site)
  for (const strike of report.strikes ?? []) {
    const site=sites.get(strike.targetId)
    if(site&&(site.observedRound<result.round||(site.observedAt??0)<strike.releasedAt+.6))site.estimatedDamage=Math.min(site.health,(site.estimatedDamage??0)+strike.damage)
  }
  cpu.sites = [...sites.values()]
  const recovered = new Set(report.recoveredIds)
  cpu.formations = cpu.formations.map(formation => {
    const flight = result.enemyFlights.find(flight => flight.id === formation.id)
    const ordered = (cpu.plan?.orders.find(order => order.id === formation.id)??flight)?.sortieOrdered !== false
    const outcome = report.recoveryOutcomes?.find(item => item.formationId === formation.id)
    if (!ordered || outcome?.reason === 'not-launched' || outcome?.outcome === 'trapped') return { ...formation, status: outcome?.outcome === 'trapped' ? 'trapped' as const : formation.status }
    return { ...formation, aircraft: recovered.has(formation.id) ? flight?.aircraft ?? 0 : 0,
      strength: recovered.has(formation.id) ? flight?.strength ?? 0 : 0, morale: flight?.morale ?? formation.morale, status: recovered.has(formation.id) ? 'rtb' : 'destroyed' }
  })
  cpu.lastReconLost = cpu.plan?.orders.some(order => order.role === 'recon' && order.sortieOrdered !== false && !recovered.has(order.id) && !report.recoveryOutcomes?.some(o=>o.formationId===order.id&&o.outcome==='trapped')) ?? false
  cpu.outcomes=[...(cpu.outcomes??[]),...(cpu.plan?.orders.filter(o=>o.sortieOrdered!==false&&!report.recoveryOutcomes?.some(r=>r.formationId===o.id&&(r.reason==='not-launched'||r.outcome==='trapped'))).map(o=>({round:result.round,formationId:o.id,mission:o.mission,targetId:o.strikeTargetId,recovered:recovered.has(o.id),damage:recovered.has(o.id)?Math.max(0,(o.strength??100)-(result.enemyFlights.find(f=>f.id===o.id)?.strength??o.strength??100)):undefined}))??[])].slice(-12)
  cpu.searchIndex += 1
  cpu.traffic = [...cpu.traffic.filter(contact => result.round - contact.observedRound < 2), ...report.traffic].slice(-32)
  cpu.logistics += LOGISTICS_EFFECTS.baseIncome + (state.enemyAssets.find(a=>a.kind==='base')?.upgrades?.includes('supply-depot')?2:0) + report.sites.filter(site => !priorIds.has(site.id)).length * LOGISTICS_EFFECTS.intelRecovery + (report.confirmedKills??0)
  cpu.mappedAreas = [...(cpu.mappedAreas ?? [])]
  for (const point of report.mappedAreas ?? []) if (!cpu.mappedAreas.some(p => Math.hypot(p[0]-point[0],p[1]-point[1]) < 1)) cpu.mappedAreas.push(point)
  cpu.lastSettledRound = result.round
  return { ...state, cpu, enemyAssets: applyRecoveryOutcomesToBasing(state.enemyAssets, report.recoveryOutcomes ?? [], cpu.formations) }
}

/** Evaluate isolated packages; only the selected sequence reaches authoritative shared commands. */
export function maintainCpu(state: MatchState): MatchState {
  if (!isCampaign(state) || !state.cpu || state.phase !== 'adapt' || state.cpu.lastAdaptedRound === state.round) return state
  const view=cpuPlanningView(state)!
  const decision=planPurchases(view)
  let next=state
  for(const command of decision.package.purchases) next=executeCpuEconomyCommand(next,command)
  return {...next,cpu:{...next.cpu!,version:2,lastAdaptedRound:state.round,intent:decision.intent,adaptTrace:decision.trace}}
}

export const planNextCpuRound = (state: MatchState) => prepareCpuRound(state)
