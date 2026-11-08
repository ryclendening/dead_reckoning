import { OPENING_CONDITION, OPENING_LOGISTICS, OPENING_RESERVES } from '../openingForces'
import { isCampaign } from '../campaign'
import type { Asset, MatchState, Point, Squadron } from '../types'
import type { CpuDifficulty, CpuPlan, CpuSiteReport, CpuState } from './types'
import { generateActions } from './actions'
import { choosePackage } from './strategy'
import type { RouteWork } from './routes'
import { cpuPlanningView, type CpuPlanningView } from './planningView'
export { cpuPlanningView } from './planningView'
export type { CpuPlanningView } from './planningView'
export { CPU_PROFILES, cpuRouteRisk } from './routes'
const copy=(p:Point):Point=>[...p]
export function createCpuState(home: Point, difficulty: CpuDifficulty = 'medium', seed = 7301): CpuState {
  const formation = (id: string, callsign: string, role: Squadron['role'], condition: keyof typeof OPENING_CONDITION): Squadron => ({
    id, callsign, role, ...OPENING_CONDITION[condition], aircraftTypeId:role==='fighter'?'f16':'recon',upgrades:[], mission: role === 'fighter' ? 'defensive-cap' : 'search-area',
    route: [copy(home)], routeIngress: [copy(home)],
  })
  return { version: 2, difficulty, seed, formations: [formation('red-fighter', 'BOGEY 1', 'fighter', 'fighter'), formation('red-recon', 'SPECTER', 'recon', 'recon'), formation('red-fighter-2', 'BOGEY 2', 'fighter', 'secondFighter')],
    logistics: OPENING_LOGISTICS, reserves: OPENING_RESERVES, sites: [], traffic: [], searchIndex: 0, lastReconLost: false, spending: [] }
}


export function planCpu(view:CpuPlanningView):CpuPlan {
  const work:RouteWork={expansions:0,rejected:[]},packages=generateActions(view,work)
  const decision=choosePackage(view,packages,work.rejected,work.expansions,work.routeCache?.values()),orders=decision.package.orders
  const fighter=orders.find(o=>o.role==='fighter'&&o.sortieOrdered!==false&&o.mission==='base-strike')??orders.find(o=>o.role==='fighter'&&o.sortieOrdered!==false)??orders.find(o=>o.role==='fighter')!
  const objective=fighter.mission==='base-strike'?'strike':fighter.protectedTargetId?'escort':fighter.mission==='forward-patrol'?'patrol':'defend'
  return { round:view.round,objective,intent:decision.intent,reason:decision.package.summary,orders,trace:decision.trace,
    candidates:decision.trace.alternatives.map(a=>({objective:a.intent==='strike-base'||a.intent==='suppress-defenses'?'strike':a.intent==='contest-air'?'patrol':'defend',score:a.bestPackageScore,reason:a.reason})) }
}
export function prepareCpuRound(state:MatchState):MatchState {
  if(!isCampaign(state)||!state.cpu||['adapt','debrief','victory','defeat','draw'].includes(state.phase)||state.cpu.plan?.round===state.round)return state
  const view=cpuPlanningView(state);if(!view)return state
  const plan=planCpu(view)
  return {...state,cpu:{...state.cpu,version:2,intent:plan.intent,plan}}
}
export function cpuFlights(state:MatchState):import('../types').EnemyFlight[] {
  return prepareCpuRound(state).cpu!.plan!.orders.map(order=>({...order,initialAircraft:order.aircraft,target:order.strikeTargetId?'base':'decoy',detectionWindows:[]}))
}
export function cpuReportAt(asset:Asset,round:number,observedAt?:number):CpuSiteReport {
  return {id:asset.id,kind:asset.kind,position:copy(asset.position),health:asset.health,maxHealth:asset.maxHealth,observedRound:round,...(observedAt===undefined?{}:{observedAt}),...(asset.upgrades?.length?{upgrades:[...asset.upgrades]}:{})}
}
