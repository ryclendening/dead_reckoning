import { isCampaign } from '../campaign'
import type { Asset, MatchState, Point, Squadron } from '../types'
import type { CpuDifficulty, CpuPlan, CpuSiteReport, CpuState } from './types'
import { generateActions } from './actions'
import { choosePackage } from './strategy'
import { cpuPlanningView, type CpuPlanningView } from './planningView'
export { cpuPlanningView } from './planningView'
export type { CpuPlanningView } from './planningView'
export { CPU_PROFILES, cpuRouteRisk } from './routes'
const copy=(p:Point):Point=>[...p]
export function createCpuState(home: Point, difficulty: CpuDifficulty = 'medium', seed = 7301): CpuState {
  const formation = (id: string, callsign: string, role: Squadron['role'], aircraft: number): Squadron => ({
    id, callsign, role, aircraft, maxAircraft: aircraft, damaged: 0, strength: 100, morale: 74,
    readiness: 90, ammo: 100, mission: role === 'fighter' ? 'defensive-cap' : 'search-area',
    route: [copy(home)], routeIngress: [copy(home)],
  })
  return { version: 2, difficulty, seed, formations: [formation('red-fighter', 'BOGEY 1', 'fighter', 4), formation('red-recon', 'SPECTER', 'recon', 2)],
    logistics: 10, reserves: 3, sites: [], traffic: [], searchIndex: 0, lastReconLost: false, spending: [] }
}


export function planCpu(view:CpuPlanningView):CpuPlan {
  const work={expansions:0,rejected:[] as string[]},packages=generateActions(view,work)
  const decision=choosePackage(view,packages,work.rejected,work.expansions),orders=decision.package.orders
  const fighter=orders.find(o=>o.role==='fighter')!
  const objective=fighter.mission==='base-strike'?'strike':fighter.protectedTargetId?'escort':fighter.mission==='forward-patrol'?'patrol':'defend'
  return { round:view.round,objective,intent:decision.intent,reason:decision.package.summary,orders,trace:decision.trace,
    candidates:decision.trace.alternatives.map(a=>({objective:a.intent==='strike-base'||a.intent==='suppress-defenses'?'strike':a.intent==='contest-air'?'patrol':'defend',score:a.bestPackageScore,reason:a.reason})) }
}
export function prepareCpuRound(state:MatchState):MatchState {
  if(!isCampaign(state)||!state.cpu||state.phase==='adapt'||state.phase==='debrief'||state.cpu.plan?.round===state.round)return state
  const view=cpuPlanningView(state);if(!view)return state
  const plan=planCpu(view)
  return {...state,cpu:{...state.cpu,version:2,intent:plan.intent,plan}}
}
export function cpuFlights(state:MatchState):import('../types').EnemyFlight[] {
  return prepareCpuRound(state).cpu!.plan!.orders.map(order=>({...order,initialAircraft:order.aircraft,target:order.strikeTargetId?'base':'decoy',detectionWindows:[]}))
}
export function cpuReportAt(asset:Asset,round:number,observedAt?:number):CpuSiteReport {
  return {id:asset.id,kind:asset.kind,position:copy(asset.position),health:asset.health,maxHealth:asset.maxHealth,observedRound:round,...(observedAt===undefined?{}:{observedAt})}
}
