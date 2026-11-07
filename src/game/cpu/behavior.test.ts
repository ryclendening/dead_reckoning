import { describe,it,expect } from 'vitest'
import { createMatch } from '../data'
import { cpuPlanningView, cpuReportAt, planCpu, prepareCpuRound } from './planner'
import { maintainCpu } from './settlement'
import { applyRound, resolveRound } from '../engine'
import { beginNextRound, openAdaptPhase } from '../economy'
import { normalizeMatch } from '../persistence'
import { formationField, validateRecoveryPackage } from '../forwardBasing'
import { MAX_FLIGHT_DISTANCE } from '../flightRules'
import { defenseCoverage } from './placement'
import { strikeOrders, orderRisk } from './routes'
import type { Asset, MatchState, Point } from '../types'

function setup(home:Point=[0,0],target:Point=[20,0]) {
  let s=createMatch(7301,'hard')
  s={...s,phase:'adapt',round:2,baseExposure:80,enemyBaseHealth:100,enemyAssets:s.enemyAssets.filter(a=>a.kind==='base').map(a=>({...a,position:home,health:100})),
    playerAssets:s.playerAssets.filter(a=>a.kind==='base').map(a=>({...a,position:target})),squadrons:s.squadrons.map(u=>({...u,sortieOrdered:false})),cpu:{...s.cpu!,plan:undefined,intent:undefined,logistics:16,mappedAreas:[],traffic:[]}}
  s.cpu!.formations=s.cpu!.formations.map(f=>({...f,route:[home],routeIngress:[home]}))
  s.cpu!.sites=s.playerAssets.map(a=>cpuReportAt(a,1))
  // Geometry fixtures disclose only the owned base and recovered target, with a broad execution world.
  s.world={...s.world,bounds:{minX:-45,maxX:45,minZ:-45,maxZ:45},friendlyTerritory:{center:target,radius:4.5}}
  return s
}
function legal(s:MatchState) {
  const orders=s.cpu!.plan!.orders, ids=new Set(orders.filter(o=>o.sortieOrdered!==false).map(o=>o.id))
  expect(validateRecoveryPackage({playerAssets:s.enemyAssets,squadrons:orders},MAX_FLIGHT_DISTANCE,ids).valid).toBe(true)
}
describe('CPU v2 behavioral acceptance',()=>{
  it('attacks a weak confirmed base promptly and switches from discovery after new information',()=>{
    const s=setup(),v=cpuPlanningView(s)!
    const blind={...v,cpu:{...v.cpu,sites:[]}}
    expect(planCpu(blind).intent).toBe('discover')
    const plan=planCpu(v)
    expect(plan.intent).toBe('strike-base')
    expect(plan.orders[0].strikeTargetId).toBe('p-base')
    const ready=prepareCpuRound({...s,phase:'plan'})
    legal(ready)
    expect(resolveRound(ready).baseDamage).toBe(60)
    expect(plan.trace!.observedEvidenceIds).toContain('site:p-base:r1')
  })
  it.each([0,Math.PI/2,-Math.PI/2])('builds marginal SAM coverage facing the observed approach %s',angle=>{
    const s=setup(),home=s.enemyAssets[0].position
    s.cpu!.sites=[];s.enemyAssets[0].health=40;s.enemyBaseHealth=40
    s.cpu!.traffic=[{role:'fighter',position:[Math.cos(angle)*8,Math.sin(angle)*8],observedRound:2,source:'visual',bearing:angle,sector:(Math.round(angle/(Math.PI/4))+8)%8}]
    const before=cpuPlanningView(s)!,adapted=maintainCpu(s),sam=adapted.enemyAssets.find(a=>a.kind==='sam')
    expect(sam).toBeDefined()
    expect((sam!.position[0]-home[0])*Math.cos(angle)+(sam!.position[1]-home[1])*Math.sin(angle)).toBeGreaterThan(2)
    expect(defenseCoverage(before,sam!.position,'sam')).toBeGreaterThan(.15)
    expect(adapted.cpu!.logistics).toBeGreaterThanOrEqual(0)
    expect(maintainCpu(adapted)).toBe(adapted)
    expect(normalizeMatch(JSON.parse(JSON.stringify(adapted))).cpu).toEqual(adapted.cpu)
  })
  it('saves cash without evidence or useful work and rejects late infrastructure',()=>{
    const s=setup();s.cpu!.sites=[]
    const adapted=maintainCpu(s)
    expect(adapted.cpu!.spending).toEqual([])
    expect(adapted.cpu!.logistics).toBe(16)
    const late=setup([0,0],[30,0]);late.round=5;late.cpu!.mappedAreas=[[10,0]]
    expect(maintainCpu(late).enemyAssets.some(a=>a.kind==='fob')).toBe(false)
  })
  it('bypasses a confirmed SAM when a feasible lower-exposure release exists',()=>{
    const s=setup([0,0],[20,0]),sam:Asset={...s.playerAssets[0],id:'p-sam',kind:'sam',position:[12,0]}
    s.playerAssets.push(sam);s.cpu!.sites.push(cpuReportAt(sam,1))
    const v=cpuPlanningView(s)!, orders=strikeOrders(v,v.cpu.formations[0],v.cpu.sites[0],{expansions:0,rejected:[]})
    expect(orders.length).toBeGreaterThan(0)
    const plan=planCpu(v)
    expect(plan.orders[0].strikeTargetId).toBe('p-base')
    expect(orderRisk(v,plan.orders[0])).toBe(0)
    expect(resolveRound(prepareCpuRound({...s,phase:'plan'})).baseDamage).toBe(60)
  })
  it('suppresses a confirmed SAM when doing so measurably improves the following base strike',()=>{
    let s=setup([0,0],[25,0])
    const sam:Asset={...s.playerAssets[0],id:'p-sam',kind:'sam',position:[8,0],health:60,maxHealth:100}
    s.playerAssets.push(sam);s.cpu!.sites.push(cpuReportAt(sam,1))
    s=prepareCpuRound({...s,phase:'plan'})
    const plan=s.cpu!.plan!,v=cpuPlanningView(s)!
    expect(plan.intent).toBe('suppress-defenses')
    expect(plan.orders[0].strikeTargetId).toBe('p-sam')
    const direct=strikeOrders(v,v.cpu.formations[0],v.cpu.sites[0],{expansions:0,rejected:[]})[0]
    expect(orderRisk(v,direct)).toBeGreaterThan(orderRisk(v,plan.orders[0])+20)
    const result=resolveRound(s)
    expect(result.playerAssets.find(a=>a.id==='p-sam')!.health).toBe(0)
    expect(result.baseDamage).toBe(0)
    s=beginNextRound(openAdaptPhase(applyRound(s,result)))
    expect(s.cpu!.plan!.orders[0].strikeTargetId).toBe('p-base')
    expect(resolveRound(s).baseDamage).toBe(60)
  })
  it('builds, transits and uses a FOB to enable a previously unreachable strike',()=>{
    let s=setup([0,0],[33,0]);s.round=1;s.cpu!.mappedAreas=[[9,0],[10,0]]
    expect(planCpu(cpuPlanningView(s)!).orders[0].strikeTargetId).toBeUndefined()
    s=maintainCpu(s)
    const fob=s.enemyAssets.find(a=>a.kind==='fob')
    expect(fob).toBeDefined()
    s=beginNextRound(s)
    expect(s.cpu!.plan!.orders[0].mission).toBe('transit')
    legal(s)
    const r=resolveRound(s);s=applyRound(s,r)
    expect(formationField(s.enemyAssets,'red-fighter')!.id).toBe(fob!.id)
    s=beginNextRound(openAdaptPhase(s));legal(s)
    expect(s.cpu!.plan!.orders[0].route[0]).toEqual(fob!.position)
    expect(s.cpu!.plan!.orders[0].strikeTargetId).toBe('p-base')
    expect(resolveRound(s).baseDamage).toBe(60)
  })
})

describe('commitment and economic isolation',()=>{
  it('retains close feasible intent and switches for a substantial achievable improvement',async()=>{
    const {choosePackage}=await import('./strategy'),{emptyEffects}=await import('./actions')
    const v=cpuPlanningView(setup())!;v.cpu.intent='protect-base';v.cpu.sites=[]
    const save={id:'save',summary:'Save',orders:[],purchases:[],predicted:emptyEffects(),checks:[]}
    const defend={...save,id:'defend',summary:'Protect home',predicted:{...emptyEffects(),ownBaseRiskReduced:.49}}
    const attack={...save,id:'attack',summary:'Strike base',predicted:{...emptyEffects(),baseDamage:.5}}
    expect(choosePackage(v,[save,defend,attack],[],0).intent).toBe('protect-base')
    attack.predicted.baseDamage=.9
    const switched=choosePackage(v,[save,defend,attack],[],0)
    expect(switched.intent).toBe('strike-base')
    expect(switched.trace.scoreDelta).toBeGreaterThan(.3)
    expect(choosePackage(v,[save,attack],[],0).intent).toBe('strike-base')
  })
  it('evaluation never spends resources or mutates the supplied inventory',async()=>{
    const {planPurchases}=await import('./purchases'),s=setup(),v=cpuPlanningView(s)!,before=structuredClone(v)
    const a=planPurchases(v),b=planPurchases(v)
    expect(v).toEqual(before)
    expect(a).toEqual(b)
    expect(s.cpu!.logistics).toBe(16)
    expect(s.cpu!.spending).toEqual([])
  })
})

describe('capability and evidence boundaries',()=>{
  it('does not treat a distant fighter sector as evidence of a home-base approach',()=>{
    const s=setup();s.cpu!.sites=[]
    s.cpu!.traffic=[{position:[24,0],role:'fighter',observedRound:2,source:'visual',bearing:0,sector:0}]
    expect(maintainCpu(s).cpu!.spending).toEqual([])
  })
  it('repairs a disabled owned FOB when doing so restores an executable strike',()=>{
    const s=setup(),position:Point=[8,0]
    s.enemyAssets.push({...s.enemyAssets[0],id:'e-fob-1',kind:'fob',position,health:0,operational:false,capacity:2,basedFormationIds:['red-fighter']})
    s.cpu!.formations[0].status='trapped'
    const adapted=maintainCpu(s)
    expect(adapted.enemyAssets.find(a=>a.id==='e-fob-1')!.operational).toBe(true)
    expect(adapted.cpu!.spending.some(p=>p.action==='repair-fob')).toBe(true)
    const next=beginNextRound(adapted)
    expect(next.cpu!.plan!.orders[0].route[0]).toEqual(position)
    expect(next.cpu!.plan!.orders[0].strikeTargetId).toBe('p-base')
  })
})
