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
import { executeCpuEconomyCommand } from './economy'
import { generateActions } from './actions'
import { covers, collectionScorer } from './search'
import { campaignOutcome } from '../campaign'
import { CPU_PROFILES, strikeOrders, orderRisk, routeThreats, type RouteWork } from './routes'
import { threatRouteCost } from './routeSearch'
import type { Asset, MatchState, Point } from '../types'

function setup(home:Point=[0,0],target:Point=[20,0]) {
  let s=createMatch(7301,'hard')
  s={...s,phase:'adapt',round:2,baseExposure:80,enemyBaseHealth:100,enemyAssets:s.enemyAssets.filter(a=>a.kind==='base').map(a=>({...a,position:home,health:100})),
    playerAssets:s.playerAssets.filter(a=>a.kind==='base').map(a=>({...a,position:target})),squadrons:s.squadrons.map(u=>({...u,sortieOrdered:false})),cpu:{...s.cpu!,plan:undefined,intent:undefined,logistics:16,mappedAreas:[],traffic:[]}}
  // Single-striker geometry fixture also covers continued legacy campaigns.
  s.cpu!.formations=s.cpu!.formations.filter(f=>f.id!=='red-fighter-2').map(f=>f.role==='recon'?{...f,maxAircraft:2,aircraft:2}:f)
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
  it('finishes a reachable base despite defensive pressure and preserves the attack estimate on reload',()=>{
    const s=setup();s.phase='plan';s.round=5;s.enemyBaseHealth=40;s.enemyAssets[0].health=40
    s.playerBaseHealth=40;s.playerAssets[0].health=40;s.cpu!.sites[0].health=40
    s.cpu!.intent='protect-base'
    s.cpu!.traffic=[{identity:'VIPER 1',role:'fighter',position:[8,0],observedRound:4,source:'visual',strength:100,bearing:0}]
    const ready=prepareCpuRound(s)
    expect(ready.cpu!.plan!.intent).toBe('strike-base')
    expect(ready.cpu!.plan!.trace!.chosenBaseAttack!.damageNow).toBeGreaterThan(0)
    const loaded=normalizeMatch(JSON.parse(JSON.stringify(ready)))
    expect(loaded.cpu!.plan).toEqual(ready.cpu!.plan)
    expect(campaignOutcome(applyRound(loaded,resolveRound(loaded)))).toBe('home-base-destroyed')
  })
  it('spends scarce cash restoring a two-sortie base kill instead of delaying it for a SAM',()=>{
    let s=setup();s.round=4;s.cpu!.logistics=8;s.cpu!.reserves=1
    s.cpu!.formations[0]={...s.cpu!.formations[0],strength:75,aircraft:3}
    s.cpu!.mappedAreas=[[8,0],[10,0]]
    s.cpu!.traffic=[{identity:'VIPER 1',role:'fighter',position:[8,0],observedRound:4,source:'visual',strength:100,bearing:0}]
    s=maintainCpu(s)
    expect(s.cpu!.formations[0].strength).toBe(100)
    expect(s.cpu!.spending.some(c=>c.action==='replace-aircraft')).toBe(true)
    expect(s.enemyAssets.some(a=>a.kind==='sam')).toBe(false)
    s=beginNextRound(s)
    expect(s.cpu!.plan!.orders[0].strikeTargetId).toBe('p-base')
    s=applyRound(s,resolveRound(s))
    expect(s.playerBaseHealth).toBe(40)
    s=beginNextRound(openAdaptPhase(s))
    s=applyRound(s,resolveRound(s))
    expect(s.round).toBe(6)
    expect(campaignOutcome(s)).toBe('home-base-destroyed')
  })
  it('retains feasible collection opportunities on both sides of a dense search prior',()=>{
    const s=setup([0,-12],[0,8]);s.phase='plan';s.round=1;s.baseExposure=6;s.cpu!.sites=[]
    const packages=generateActions(cpuPlanningView(s)!,{expansions:0,rejected:[]})
    // These are alternative unknown worlds, never inputs to candidate generation.
    for(const position of [[-8,8],[8,8]] as Point[]) {
      const candidate=packages.find(p=>p.orders.some(o=>o.sortieOrdered!==false&&covers(o.route,position)))
      expect(candidate).toBeDefined()
      const world={...s,playerAssets:s.playerAssets.map(a=>({...a,position})),cpu:{...s.cpu!,plan:{round:1,objective:'defend' as const,reason:'Inspect retained collection capability.',orders:candidate!.orders,candidates:[]}}}
      legal(world)
      expect(resolveRound(world).cpuReport!.sites.some(site=>site.id==='p-base')).toBe(true)
    }
  })

  it('delivers a strike at the exact legal release and fuel boundary',()=>{
    const s=setup([0,0],[26,0]);s.phase='plan';s.round=6
    const ready=prepareCpuRound(s)
    legal(ready)
    expect(ready.cpu!.plan!.orders[0].strikeTargetId).toBe('p-base')
    const release=ready.cpu!.plan!.orders[0].route.at(-1)!
    expect(Math.hypot(release[0]-20,release[1])).toBeLessThan(1e-6)
    const result=resolveRound(ready)
    expect(result.baseDamage).toBe(60)
    expect(result.cpuReport!.recoveredIds).toContain('red-fighter')
  })

  it.each([0,Math.PI/2,-Math.PI/2])('builds marginal SAM coverage facing the observed approach %s',angle=>{
    const s=setup(),home=s.enemyAssets[0].position
    s.cpu!.sites=[];s.enemyAssets[0].health=40;s.enemyBaseHealth=40
    s.cpu!.mappedAreas=[[Math.cos(angle)*8,Math.sin(angle)*8],[Math.cos(angle)*11,Math.sin(angle)*11]]
    s.cpu!.traffic=[{role:'fighter',position:[Math.cos(angle)*8,Math.sin(angle)*8],observedRound:2,source:'visual',bearing:angle,sector:(Math.round(angle/(Math.PI/4))+8)%8}]
    const before=cpuPlanningView(s)!,adapted=maintainCpu(s),sam=adapted.enemyAssets.find(a=>a.kind==='sam')
    expect(sam).toBeDefined()
    expect((sam!.position[0]-home[0])*Math.cos(angle)+(sam!.position[1]-home[1])*Math.sin(angle)).toBeGreaterThan(2)
    expect(defenseCoverage(before,sam!.position,'sam')).toBeGreaterThan(.1)
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
  it('places forward SAM fire early enough to affect a real inbound strike',()=>{
    const run=(placement:Point)=>{
      let s=setup([0,0],[-20,0]);s.cpu!.mappedAreas=[placement]
      s=executeCpuEconomyCommand(s,{actionId:'build-sam',target:{kind:'campaign',id:'campaign'},placement})
      expect(s.enemyAssets.some(a=>a.kind==='sam')).toBe(true)
      s.enemyAssets=s.enemyAssets.map(a=>a.kind==='base'?{...a,intel:'confirmed',hidden:false,confidence:100}:a)
      const route:Point[]=[[-20,0],[-5.9,0]]
      s.squadrons=s.squadrons.map(f=>({...f,sortieOrdered:f.id==='viper',...(f.id==='viper'?{mission:'base-strike' as const,strikeTargetId:'e-base',route,routeIngress:route,plannedRecoveryFieldId:'p-base'}:{})}))
      s={...s,phase:'plan',cpu:{...s.cpu!,plan:{round:s.round,objective:'defend',reason:'Isolate shared SAM timing.',candidates:[],orders:s.cpu!.formations.map(f=>({...f,sortieOrdered:false}))}}}
      return resolveRound(s)
    }
    const forward=run([-10.5,0]),rim=run([-4,0]),releaseDeadline=14.1/(40/22)+.05
    const timely=(r:ReturnType<typeof resolveRound>)=>r.weaponEffects.filter(e=>e.kind==='sam'&&e.end<releaseDeadline).length
    expect(timely(forward)).toBe(2)
    expect(timely(rim)).toBe(0)
    expect(forward.enemyBaseDamage).toBeLessThan(rim.enemyBaseDamage)
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
  it('retains the A* strike candidate, validates fuel/release, and reuses its bounded search',()=>{
    const s=setup(),sam:Asset={...s.playerAssets[0],id:'p-sam-1',kind:'sam',position:[5,2]}
    s.playerAssets.push(sam,{...sam,id:'p-sam-2',position:[9,-2]})
    s.cpu!.sites=s.playerAssets.map(a=>cpuReportAt(a,1))
    const v=cpuPlanningView(s)!,work:RouteWork={expansions:0,rejected:[]}
    const orders=strikeOrders(v,v.cpu.formations[0],v.cpu.sites[0],work)
    const search=[...work.routeCache!.values()][0]!
    expect(orders.some(o=>JSON.stringify(o.route)===JSON.stringify(search.route))).toBe(true)
    expect(work.expansions).toBeLessThanOrEqual(CPU_PROFILES.hard.expansions)
    const expansions=work.expansions
    expect(strikeOrders(v,v.cpu.formations[0],v.cpu.sites[0],work)).toEqual(orders)
    expect(work.expansions).toBe(expansions)
    const simple=strikeOrders(v,v.cpu.formations[0],v.cpu.sites[0],{expansions:CPU_PROFILES.hard.expansions,rejected:[]})
    const threats=routeThreats(v,'fighter'),cost=(o:typeof orders[number])=>threatRouteCost(o.route,v.home,threats)
    expect(search.cost).toBeLessThan(Math.min(...simple.map(cost)))
    const chosen=orders.find(o=>JSON.stringify(o.route)===JSON.stringify(search.route))!
    expect(orderRisk(v,chosen,v.cpu.sites,false)).toBe(0)
    const ready={...s,phase:'plan' as const,cpu:{...s.cpu!,plan:{round:2,objective:'strike' as const,reason:'Execute optimized route.',orders:[chosen,{...s.cpu!.formations[1],sortieOrdered:false}],candidates:[]}}}
    legal(ready)
    const result=resolveRound(ready)
    expect(result.weaponEffects.some(e=>e.kind==='air-to-ground-missile'&&e.targetId==='p-base')).toBe(true)
    expect(result.baseDamage).toBe(60)
  })
  it('does not optimize or issue strikes for destroyed or trapped aircraft',()=>{
    const s=setup(),sam:Asset={...s.playerAssets[0],id:'p-sam',kind:'sam',position:[8,0]}
    s.playerAssets.push(sam);s.cpu!.sites.push(cpuReportAt(sam,1))
    const v=cpuPlanningView(s)!,work:RouteWork={expansions:0,rejected:[]}
    for(const fighter of [{...v.cpu.formations[0],aircraft:0,strength:0,status:'destroyed' as const},{...v.cpu.formations[0],status:'trapped' as const}])expect(strikeOrders(v,fighter,v.cpu.sites[0],work)).toEqual([])
    expect(work.expansions).toBe(0)
  })
  it('suppresses a confirmed SAM when doing so measurably improves the following base strike',()=>{
    let s=setup([0,0],[25,0])
    const sam:Asset={...s.playerAssets[0],id:'p-sam',kind:'sam',position:[8,0],health:60,maxHealth:100}
    s.playerAssets.push(sam,...[-5,5].map(y=>({...sam,id:`p-flank-${y}`,position:[8,y] as Point,health:100})));s.cpu!.sites=s.playerAssets.map(a=>cpuReportAt(a,1))
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
  it('restores a striker for an already recovered target without waiting for pressure',()=>{
    const initial=setup();initial.round=1;initial.baseExposure=46;initial.cpu!.reserves=3
    initial.cpu!.formations=initial.cpu!.formations.map(f=>f.role==='fighter'?{...f,aircraft:0,strength:0,status:'destroyed'}:f)
    const blind=structuredClone(initial);blind.cpu!.sites=[]
    const blindAdapted=maintainCpu(blind)
    expect(blindAdapted.cpu!.formations[0]).toMatchObject({aircraft:3,strength:75})
    expect(blindAdapted.cpu!.sites).toEqual([])
    expect(beginNextRound(blindAdapted).cpu!.plan!.orders.some(o=>o.mission==='base-strike'&&o.sortieOrdered!==false)).toBe(false)
    const adapted=maintainCpu(initial)
    expect(adapted.cpu!.formations[0]).toMatchObject({aircraft:3,strength:75})
    expect(adapted.cpu!.logistics).toBe(4)
    expect(adapted.cpu!.reserves).toBe(0)
    let s=beginNextRound(adapted)
    for(let round=2;round<=6;round++) {
      legal(s)
      const result=resolveRound(s)
      if(round===2)expect(result.baseDamage).toBe(45)
      if(round===3)expect(result.baseDamage).toBe(45)
      s=applyRound(s,result)
      if(campaignOutcome(s))break
      s=beginNextRound(openAdaptPhase(s))
    }
    expect(campaignOutcome(s)).toBe('home-base-destroyed')
    expect(s.round).toBeLessThanOrEqual(5)
  })
  it('evaluates complete striker restoration even when useful SAM prefixes compete for the beam',()=>{
    const s=setup();s.round=1;s.baseExposure=46;s.cpu!.reserves=3;s.cpu!.logistics=24
    s.cpu!.formations[0]={...s.cpu!.formations[0],aircraft:0,strength:0,status:'destroyed'}
    s.cpu!.mappedAreas=[[8,0],[10,0],[8,3]]
    s.cpu!.traffic=[{identity:'VIPER 1',role:'fighter',position:[8,0],observedRound:1,source:'visual',strength:100,bearing:0}]
    const adapted=maintainCpu(s)
    expect(adapted.cpu!.formations[0]).toMatchObject({aircraft:3,strength:75})
    expect(adapted.cpu!.spending.filter(c=>c.action==='replace-aircraft')).toHaveLength(3)
    expect(adapted.cpu!.adaptTrace!.alternatives.some(a=>a.baseAttack?.damageNow&&a.baseAttack.damageNow>0)).toBe(true)
    expect(s.cpu!.formations[0].aircraft).toBe(0)
  })

  it('changes a damaging strike approach after repairs while retaining the same objective',()=>{
    const s=setup();s.playerAssets[0].health=40;s.playerBaseHealth=40;s.cpu!.sites[0].health=40
    const previous=planCpu(cpuPlanningView(s)!);previous.round=1
    s.cpu!.plan=previous;s.cpu!.intent='strike-base'
    s.cpu!.outcomes=[{round:1,formationId:'red-fighter',mission:'base-strike',targetId:'p-base',recovered:true,damage:22}]
    const restored=normalizeMatch(JSON.parse(JSON.stringify(s)))
    expect(restored.cpu!.outcomes![0].damage).toBe(22)
    const v=cpuPlanningView(restored)!,chosen=planCpu(v)
    expect(chosen.intent).toBe('strike-base')
    expect(chosen.orders[0].route).not.toEqual(previous.orders[0].route)
    expect(orderRisk(v,chosen.orders[0])).toBeLessThan(orderRisk(v,previous.orders[0]))
    const ready={...s,phase:'plan' as const,cpu:{...s.cpu!,plan:chosen}}
    legal(ready)
    expect(resolveRound(ready).playerAssets.find(a=>a.id==='p-base')!.health).toBe(0)
  })

  it('credits discovery only when an observer can return, without a second-report requirement',()=>{
    const v=cpuPlanningView(setup())!;v.cpu.sites=[]
    const prior=[{point:[20,0] as Point,weight:1}]
    const orders=v.cpu.formations.map(f=>({...f,sortieOrdered:true,route:[v.home,prior[0].point]}))
    const score=collectionScorer(v,prior)
    expect(score(orders,()=>0)).toBe(0)
    expect(score(orders,o=>o.role==='recon'?1:0)).toBe(1)
    expect(score(orders,o=>o.role==='recon'?.5:0)).toBe(.5)
  })

  it.each(['red-fighter','red-fighter-2'])('builds, transits and uses a FOB for %s to enable a previously unreachable strike',fighterId=>{
    let s=setup([0,0],[33,0]);s.round=1;s.cpu!.mappedAreas=[[9,0],[10,0]]
    if(fighterId==='red-fighter-2'){s.cpu!.formations.push({...s.cpu!.formations[0],id:fighterId,callsign:'BOGEY 2'});s.cpu!.formations[0]={...s.cpu!.formations[0],aircraft:0,strength:0,status:'destroyed'};s.cpu!.reserves=0}
    expect(planCpu(cpuPlanningView(s)!).orders.find(o=>o.id===fighterId)!.strikeTargetId).toBeUndefined()
    s=maintainCpu(s)
    const fob=s.enemyAssets.find(a=>a.kind==='fob')
    expect(fob).toBeDefined()
    s=beginNextRound(s)
    expect(s.cpu!.plan!.orders.find(o=>o.id===fighterId)!.mission).toBe('transit')
    legal(s)
    const r=resolveRound(s);s=applyRound(s,r)
    expect(formationField(s.enemyAssets,fighterId)!.id).toBe(fob!.id)
    s=beginNextRound(openAdaptPhase(s));legal(s)
    expect(s.cpu!.plan!.orders.find(o=>o.id===fighterId)!.route[0]).toEqual(fob!.position)
    expect(s.cpu!.plan!.orders.find(o=>o.id===fighterId)!.strikeTargetId).toBe('p-base')
    expect(resolveRound(s).baseDamage).toBe(60)
  })
})

describe('commitment and economic isolation',()=>{
  it('retains close feasible intent and switches for a substantial achievable improvement',async()=>{
    const {choosePackage}=await import('./strategy'),{emptyEffects}=await import('./actions')
    const v=cpuPlanningView(setup())!;v.cpu.intent='forward-position'
    const save={id:'save',summary:'Save',orders:v.cpu.formations,purchases:[],predicted:emptyEffects(),checks:[]}
    // One shared infrastructure package advances both intentions equally.
    // Persistence must break the tie rather than alphabetical intent order.
    const forward={...save,id:'forward',summary:'Stage with added coverage',orders:v.cpu.formations.map(f=>({...f,mission:'transit' as const})),predicted:{...emptyEffects(),futureStrikeAccessGain:.2,defenseCoverageGain:.3}}
    const attack={...save,id:'attack',summary:'Strike base',predicted:{...emptyEffects(),baseDamage:.9}}
    expect(choosePackage(v,[save,forward],[],0).intent).toBe('forward-position')
    const switched=choosePackage(v,[save,forward,attack],[],0)
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
