import { describe,it,expect } from 'vitest'
import { createMatch } from '../data'
import { resolveRound,applyRound } from '../engine'
import { normalizeMatch } from '../persistence'
import { validateRecoveryPackage } from '../forwardBasing'
import { flightRangeFor } from '../flightRules'
import type { Asset,MatchState,Point,ReconPosture,Squadron } from '../types'
import { cpuPlanningView } from './planningView'
import { cpuReportAt,planCpu,prepareCpuRound } from './planner'
import { generateActions,emptyEffects } from './actions'
import { choosePackage } from './strategy'
import { orderRisk,cpuRouteRisk } from './routes'
import { collectionScorer } from './search'
import { reconForecasts } from './recon'

function scenario(side:'player'|'cpu',posture:ReconPosture|undefined,threat:'sam'|'aaa'|'fighter'|'radar'|'none'='sam',fob=false):{state:MatchState;id:string} {
  let s=createMatch(7301,'medium')
  const own:Point=[0,0],other:Point=[20,0],launch:Point=fob?[0,2]:own
  const recon=side==='cpu'?s.cpu!.formations.find(f=>f.role==='recon')!:s.squadrons.find(f=>f.role==='recon')!
  const base=(id:string,position:Point):Asset=>({id,kind:'base',position,health:100,maxHealth:100,intel:'unknown',confidence:0,hidden:true,struck:false})
  const ownAssets=[base(side==='cpu'?'e-base':'p-base',own)],otherAssets=[base(side==='cpu'?'p-base':'e-base',other)]
  if(fob)ownAssets.push({...ownAssets[0],id:side==='cpu'?'e-fob':'p-fob',kind:'fob',position:launch,operational:true,capacity:2,basedFormationIds:[recon.id]})
  if(threat==='sam'||threat==='aaa'||threat==='radar')otherAssets.push({...otherAssets[0],id:'opponent-defense',kind:threat,position:[10,launch[1]]})
  const route:Point[]=[launch,[18,launch[1]],launch]
  const order=(f:Squadron,ours:boolean):Squadron=>ours&&f.id===recon.id?{...f,reconPosture:posture,sortieOrdered:true,mission:'search-area',route,routeIngress:route,plannedRecoveryFieldId:ownAssets.at(-1)!.id}
    :!ours&&threat==='fighter'&&f.role==='fighter'&&!f.id.endsWith('-2')&&f.id!=='falcon'?{...f,sortieOrdered:true,mission:'transit',route:[other,[8,launch[1]],other],routeIngress:[other,[8,launch[1]],other],plannedRecoveryFieldId:otherAssets[0].id}
    :{...f,sortieOrdered:false}
  s={...s,phase:'plan',round:2,playerAssets:side==='cpu'?otherAssets:ownAssets,enemyAssets:side==='cpu'?ownAssets:otherAssets,
    world:{...s.world,bounds:{minX:-40,maxX:40,minZ:-40,maxZ:40}},squadrons:s.squadrons.map(f=>order(f,side==='player')),
    cpu:{...s.cpu!,sites:[],traffic:[],mappedAreas:[],plan:undefined,formations:s.cpu!.formations.map(f=>({...f,route:[side==='cpu'?launch:other],routeIngress:[side==='cpu'?launch:other]}))}}
  s.cpu!.plan={round:2,objective:'defend',reason:'Committed posture parity.',candidates:[],orders:s.cpu!.formations.map(f=>order(f,side==='cpu'))}
  return {state:s,id:recon.id}
}
function planningView() {
  const {state}=scenario('cpu','aggressive','none')
  // A compatible legacy inventory keeps collection independent of a second scout.
  state.cpu!.formations=state.cpu!.formations.filter(f=>f.id!=='red-fighter-2').map(f=>f.role==='recon'?{...f,maxAircraft:2,aircraft:2}:f)
  state.cpu!.plan=undefined
  return cpuPlanningView(state)!
}

describe('shared committed recon posture',()=>{
  it.each(['sam','aaa','fighter'] as const)('applies the same conservative %s trigger on both sides',threat=>{
    const retreats=[]
    for(const side of ['player','cpu'] as const) {
      const {state,id}=scenario(side,'conservative',threat)
      const before=JSON.stringify(state.cpu!.plan),result=resolveRound(state)
      const retreat=result.behaviorIntervals.find(i=>i.unitId===id&&i.reason==='recon-conservative-condition')
      expect(retreat).toBeDefined();retreats.push(retreat!.start)
      expect(JSON.stringify(state.cpu!.plan)).toBe(before)
      expect(result.simulationCommands).toEqual([])
      expect(result.behaviorIntervals.some(i=>i.reason==='cpu-preserve-recon')).toBe(false)
      if(side==='cpu') {
        expect(result.threatAlerts!.some(a=>a.unitId===id)).toBe(false)
        expect(result.events.some(e=>e.title==='RECON RTB CONDITION'&&e.detail.includes('SPECTER'))).toBe(false)
      }
      const aggressive=scenario(side,'aggressive',threat),full=resolveRound(aggressive.state)
      expect(full.behaviorIntervals.some(i=>i.unitId===aggressive.id&&i.reason==='recon-conservative-condition')).toBe(false)
      const farthest=(r:typeof result,unitId:string)=>Math.max(...r.unitTracks.find(t=>t.unitId===unitId)!.frames.map(f=>f.position[0]))
      expect(farthest(full,aggressive.id)).toBeGreaterThan(farthest(result,id))
    }
    expect(retreats[0]).toBeCloseTo(retreats[1],6)
  })

  it.each(['player','cpu'] as const)('returns %s conservative recon to its planned FOB, without a home override',side=>{
    const {state,id}=scenario(side,'conservative','sam',true),result=resolveRound(state)
    const outcomes=side==='cpu'?result.cpuReport!.recoveryOutcomes!:result.recoveryOutcomes!
    expect(outcomes.find(o=>o.formationId===id)?.actualFieldId).toBe(side==='cpu'?'e-fob':'p-fob')
  })

  it('does not give CPU recon extra RTB triggers for base collection, low strength or radar',()=>{
    for(const posture of ['aggressive',undefined] as const) {
      const {state,id}=scenario('cpu',posture,'radar')
      state.cpu!.plan!.orders=state.cpu!.plan!.orders.map(o=>o.id===id?{...o,strength:30,aircraft:2}:o)
      const result=resolveRound(state),track=result.unitTracks.find(t=>t.unitId===id)!
      expect(Math.max(...track.frames.map(f=>f.position[0]))).toBeGreaterThan(17)
      expect(result.cpuReport!.sites.some(s=>s.kind==='base')).toBe(true)
      expect(result.behaviorIntervals.some(i=>i.unitId===id&&i.reason==='recon-conservative-condition')).toBe(false)
    }
    const {state,id}=scenario('cpu','conservative','radar'),result=resolveRound(state)
    expect(Math.max(...result.unitTracks.find(t=>t.unitId===id)!.frames.map(f=>f.position[0]))).toBeGreaterThan(17)
  })
})

describe('route and posture valuation',()=>{
  it('does not credit observations beyond a conservative launch-triggered turnback, or erase the triggering shot',()=>{
    const view=planningView(),recon=view.cpu.formations.find(f=>f.role==='recon')!
    view.cpu.sites=[{id:'known-sam',kind:'sam',position:[10,0],health:100,maxHealth:100,observedRound:1}]
    const route:Point[]=[[0,0],[18,0],[0,0]],order={...recon,reconPosture:'conservative' as const,route,routeIngress:route,plannedRecoveryFieldId:'e-base',sortieOrdered:true}
    const forecasts=reconForecasts(view),paths=forecasts.paths(order)
    expect(paths).toHaveLength(1)
    expect(forecasts.launchRisk(paths[0].order)).toBeCloseTo(.64*38)
    expect(paths[0].order.route[1][0]).toBeCloseTo(6.8)
    expect(order.route).toEqual(route)
    const score=collectionScorer(view,[{point:[16,0] as Point,weight:1}],forecasts.paths)
    expect(score([order])).toBe(0)
    expect(score([{...order,reconPosture:'aggressive'}])).toBe(1)
  })

  it('treats stale fighter sectors as uncertain mutually exclusive turnbacks for one observer',()=>{
    const view=planningView(),recon=view.cpu.formations.find(f=>f.role==='recon')!
    view.cpu.traffic=[{identity:'seen-fighter',role:'fighter',source:'visual',position:[10,0],strength:100,aircraft:4,observedRound:2}]
    const order={...recon,reconPosture:'conservative' as const,sortieOrdered:true,route:[[0,0],[18,0],[0,0]] as Point[],plannedRecoveryFieldId:'e-base'}
    const forecast=reconForecasts(view),paths=forecast.paths(order)
    expect(paths).toHaveLength(2);expect(paths.reduce((n,f)=>n+f.probability,0)).toBeCloseTo(1)
    const score=collectionScorer(view,[{point:[16,0] as Point,weight:1}],forecast.paths)
    expect(score([order])).toBeCloseTo(.5)
    view.cpu.traffic.push({...view.cpu.traffic[0],position:[11,0]})
    expect(reconForecasts(view).paths(order)).toHaveLength(2)
    view.cpu.traffic=view.cpu.traffic.map(t=>({...t,observedRound:1}))
    expect(collectionScorer(view,[{point:[16,0] as Point,weight:1}],reconForecasts(view).paths)([order])).toBeCloseTo(2/3)
  })

  it('offers both postures in shared packages and saves a deterministic pre-run choice',()=>{
    const view=planningView(),packages=generateActions(view,{expansions:0,rejected:[]})
    const active=packages.flatMap(p=>p.orders.filter(o=>o.role==='recon'&&o.sortieOrdered!==false))
    expect(new Set(active.map(o=>o.reconPosture))).toEqual(new Set(['aggressive','conservative']))
    const plan=planCpu(view),recon=plan.orders.find(o=>o.role==='recon')!
    expect(recon.reconPosture).toBe('aggressive')
    expect(plan.trace!.chosenReconPosture).toBe(recon.reconPosture)
    expect(planCpu(view)).toEqual(plan)
    const {state}=scenario('cpu','aggressive','none')
    state.cpu={...view.cpu,plan};state.cpu.formations=state.cpu.formations.map(f=>({...f,route:[[0,0]],routeIngress:[[0,0]]}))
    const loaded=normalizeMatch(JSON.parse(JSON.stringify(state)))
    expect(loaded.cpu!.plan).toEqual(plan)
    expect(prepareCpuRound(loaded).cpu!.plan).toEqual(plan)
    expect(validateRecoveryPackage({playerAssets:view.assets,squadrons:plan.orders},flightRangeFor,new Set(plan.orders.filter(o=>o.sortieOrdered!==false).map(o=>o.id))).valid).toBe(true)
    const result=resolveRound(loaded),settled=applyRound(loaded,result)
    expect(applyRound(settled,result)).toBe(settled)
  })

  it('prefers conservative collection when a route earns useful information before the known threat',()=>{
    const view=planningView(),recon=view.cpu.formations.find(f=>f.role==='recon')!
    view.cpu.sites=[{id:'known-sam',kind:'sam',position:[18,6],health:100,maxHealth:100,observedRound:1}]
    const forecasts=reconForecasts(view),collect=collectionScorer(view,[{point:[10,0],weight:1}],forecasts.paths)
    const options=(['aggressive','conservative'] as const).map(reconPosture=>{
      const order={...recon,reconPosture,sortieOrdered:true,route:[[0,0],[12,0],[12,6],[18,6],[0,0]] as Point[],plannedRecoveryFieldId:'e-base'}
      const risk=(o:Squadron)=>orderRisk(view,o)+Math.max(0,forecasts.launchRisk(o)-cpuRouteRisk(o.route,'recon',view.cpu.sites,o))
      const informationGain=collect([order],o=>Math.max(0,1-risk(o)/120))
      const expectedAircraftLoss=forecasts.paths(order).reduce((n,f)=>n+f.probability*Math.min(order.aircraft,risk(f.order)/100*order.maxAircraft),0)
      return {id:reconPosture,summary:reconPosture,checks:[],orders:[order],purchases:[],predicted:{...emptyEffects(),informationGain,expectedAircraftLoss}}
    })
    expect(options[1].predicted.informationGain).toBeGreaterThan(options[0].predicted.informationGain)
    expect(options[1].predicted.expectedAircraftLoss).toBeLessThan(options[0].predicted.expectedAircraftLoss)
    expect(choosePackage(view,options,[],0).package.orders[0].reconPosture).toBe('conservative')
  })
})
