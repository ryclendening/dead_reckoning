import { describe, it, expect } from 'vitest'
import { createCampaignDraft } from '../data'
import { confirmCampaignSetup } from '../campaignSetup'
import { campaignOutcome, campaignOutcomePhase } from '../campaign'
import { applyRound, resolveRound } from '../engine'
import { normalizeMatch } from '../persistence'
import { openAdaptPhase } from '../economy'
import { MAX_FLIGHT_DISTANCE } from '../flightRules'
import { validateRecoveryPackage } from '../forwardBasing'
import { cpuPlanningView, cpuReportAt, prepareCpuRound } from './planner'
import { generateActions, estimateBaseAttack } from './actions'
import { discoveryAttackValue } from './strategy'
import { collectionScorer, covers } from './search'
import type { Squadron } from '../types'
import type { CpuDifficulty } from './types'

function campaign(difficulty:CpuDifficulty='hard') {
  const draft=createCampaignDraft(7301,difficulty)
  draft.setup!.placedAssetIds=[...draft.setup!.selectedAssetIds]
  return confirmCampaignSetup(draft)
}
function strikeScenario() {
  const s=campaign(),home:[number,number]=[0,0],target:[number,number]=[20,0]
  s.phase='plan';s.round=2;s.baseExposure=0
  s.world={...s.world,bounds:{minX:-45,maxX:45,minZ:-45,maxZ:45},friendlyTerritory:{center:target,radius:4.5}}
  s.enemyAssets=s.enemyAssets.filter(a=>a.kind==='base').map(a=>({...a,position:home}))
  s.playerAssets=s.playerAssets.filter(a=>a.kind==='base').map(a=>({...a,position:target}))
  s.squadrons=s.squadrons.map(f=>({...f,sortieOrdered:false}))
  s.cpu={...s.cpu!,plan:undefined,sites:s.playerAssets.map(a=>cpuReportAt(a,1)),formations:s.cpu!.formations.map(f=>({...f,route:[home],routeIngress:[home]}))}
  return s
}

describe('symmetric campaign rules',()=>{
  it.each(['easy','medium','hard'] as const)('gives %s the same full opening package and condition as the player',difficulty=>{
    const s=campaign(difficulty)
    const condition=(f:typeof s.squadrons[number])=>[f.role,f.aircraft,f.maxAircraft,f.strength,f.readiness,f.morale,f.ammo,f.damaged]
    expect(s.cpu!.formations.map(condition).sort()).toEqual(s.squadrons.map(condition).sort())
    const assets=(list:typeof s.playerAssets)=>list.map(a=>[a.kind,a.health,a.maxHealth]).sort()
    expect(assets(s.enemyAssets)).toEqual(assets(s.playerAssets))
    expect(s.cpu!.logistics).toBe(s.logistics)
    expect(s.cpu!.reserves).toBe(s.replacements)
    expect(s.cpu!.plan!.orders).toHaveLength(3)
  })
  it('executes both fighters against a recovered base at zero pressure, settles once, and reloads the committed package',()=>{
    const ready=prepareCpuRound(strikeScenario()),plan=ready.cpu!.plan!
    expect(plan.intent).toBe('strike-base')
    expect(plan.orders.filter(o=>o.mission==='base-strike'&&o.sortieOrdered!==false)).toHaveLength(2)
    expect(plan.trace!.chosenBaseAttack!.damageNow).toBeGreaterThan(60)
    expect(validateRecoveryPackage({playerAssets:ready.enemyAssets,squadrons:plan.orders},MAX_FLIGHT_DISTANCE,new Set(plan.orders.filter(o=>o.sortieOrdered!==false).map(o=>o.id))).valid).toBe(true)
    const loaded=normalizeMatch(JSON.parse(JSON.stringify(ready)))
    expect(loaded.cpu!.plan).toEqual(plan)
    const result=resolveRound(loaded)
    expect(result.weaponEffects.filter(e=>e.kind==='air-to-ground-missile'&&e.targetId==='p-base')).toHaveLength(2)
    expect(result.baseDamage).toBe(100)
    expect(result.cpuReport!.recoveredIds).toEqual(expect.arrayContaining(['red-fighter','red-fighter-2']))
    const settled=applyRound(loaded,result)
    expect(applyRound(settled,result)).toBe(settled)
    expect(campaignOutcome(settled)).toBe('home-base-destroyed')
    expect(normalizeMatch(JSON.parse(JSON.stringify(settled))).cpu).toEqual(settled.cpu)
  })
  it('offers legal strike plus defense and independent staging capabilities in the shared library',()=>{
    const s=strikeScenario(),view=cpuPlanningView(s)!
    const packages=generateActions(view,{expansions:0,rejected:[]})
    expect(packages.some(p=>p.orders.some(o=>o.sortieOrdered!==false&&o.mission==='base-strike')&&p.orders.some(o=>o.role==='fighter'&&o.sortieOrdered!==false&&o.mission==='defensive-cap'))).toBe(true)
    for(const p of packages)expect(new Set(p.orders.map(o=>o.id)).size).toBe(3)
  })
  it('retains independent collection regions until the complete aircraft package is scored',()=>{
    const s=strikeScenario();s.cpu!.sites=[]
    const packages=generateActions(cpuPlanningView(s)!,{expansions:0,rejected:[]})
    expect(packages.some(p=>{
      const scouts=p.orders.filter(o=>o.role==='fighter'&&o.sortieOrdered!==false&&o.mission==='transit')
      if(scouts.length!==2)return false
      const station=(o:typeof scouts[number])=>o.route.reduce((a,b)=>Math.hypot(b[0],b[1])>Math.hypot(a[0],a[1])?b:a)
      const a=station(scouts[0]),b=station(scouts[1])
      return Math.hypot(a[0]-b[0],a[1]-b[1])>3.5
    })).toBe(true)
  })
  it('values discovery by surviving strike capability and the remaining deadline',()=>{
    const view=cpuPlanningView(strikeScenario())!;view.cpu.sites=[]
    const coordinated=discoveryAttackValue(view)
    view.cpu.formations=view.cpu.formations.filter(f=>f.id!=='red-fighter-2')
    expect(discoveryAttackValue(view)).toBeLessThan(coordinated)
    expect(discoveryAttackValue(view)).toBeGreaterThan(0)
    view.round=6
    expect(discoveryAttackValue(view)).toBe(0)
    view.round=2;view.assets=view.assets.map(a=>({...a,health:0}))
    expect(discoveryAttackValue(view)).toBe(0)
  })
  it('returns on an observed incoming fighter shot before impact without knowing its hit roll',()=>{
    const s=strikeScenario();s.cpu!.sites=[]
    s.playerAssets=s.playerAssets.map(a=>({...a,position:[30,0]}))
    s.squadrons=s.squadrons.map(f=>({...f,sortieOrdered:f.id==='viper',mission:'forward-patrol',route:[[30,0],[8,0],[30,0]],routeIngress:[[30,0],[8,0]],plannedRecoveryFieldId:'p-base'}))
    s.cpu!.plan={round:2,objective:'defend',reason:'Collect under a locally observed threat.',candidates:[],orders:s.cpu!.formations.map(f=>({...f,sortieOrdered:f.role==='recon',route:[[0,0],[20,0],[0,0]],routeIngress:[[0,0],[20,0]],plannedRecoveryFieldId:'e-base'}))}
    const result=resolveRound(s)
    const shot=result.weaponEffects.find(e=>e.kind==='air-to-air-missile'&&e.targetId==='red-recon')!
    const retreat=result.behaviorIntervals.find(i=>i.unitId==='red-recon'&&i.reason==='cpu-preserve-recon')!
    expect(shot).toBeDefined();expect(retreat).toBeDefined()
    expect(retreat.start).toBeGreaterThan(shot.start)
    expect(retreat.start).toBeLessThan(shot.end)
    expect(result.cpuReport!.sites.some(s=>s.kind==='base')).toBe(false)
  })
  it('matches exhaustive returned-report outcomes with direct coverage probability',()=>{
    const view=cpuPlanningView(strikeScenario())!
    const ends:Array<[number,number]>=[[12,0],[12,6],[12,-6]]
    const orders=view.cpu.formations.map((f,i)=>({...f,sortieOrdered:true,route:[[0,0] as [number,number],ends[i],[0,0] as [number,number]]}))
    const probabilities=[.2,.45,.9],confidence=(o:Squadron)=>probabilities[orders.findIndex(f=>f.id===o.id)]
    for(const refresh of [false,true]) {
      view.cpu.sites=refresh?[{id:'p-base',kind:'base',position:[12,0],health:100,maxHealth:100,observedRound:1}]:[]
      const points=refresh?Array.from({length:8},(_,i)=>({point:[12+Math.cos(i*Math.PI/4)*3.2,Math.sin(i*Math.PI/4)*3.2] as [number,number],weight:1})):[{point:[8,0] as [number,number],weight:1},{point:[10,4] as [number,number],weight:2},{point:[12,-4] as [number,number],weight:3}]
      let exhaustive=0
      for(let mask=0;mask<8;mask++) {
        let probability=1
        for(let i=0;i<3;i++)probability*=mask&(1<<i)?probabilities[i]:1-probabilities[i]
        const covered=points.filter(p=>orders.some((o,i)=>(mask&(1<<i))&&covers(o.route,p.point))).reduce((n,p)=>n+p.weight,0)
        exhaustive+=probability*covered/points.reduce((n,p)=>n+p.weight,0)
      }
      expect(collectionScorer(view,points)(orders,confidence)).toBeCloseTo(exhaustive*(refresh?.1:1),12)
    }
  })
  it('charges both sides the same sortie readiness and ammunition and settles that condition once',()=>{
    const s=strikeScenario()
    s.squadrons=s.squadrons.map(f=>({...f,mission:f.role==='fighter'?'transit':'search-area',sortieOrdered:true,route:[[20,0],[21,0],[20,0]],routeIngress:[[20,0],[21,0]],plannedRecoveryFieldId:'p-base'}))
    s.cpu!.plan={round:2,objective:'defend',reason:'Symmetric local sorties.',candidates:[],orders:s.cpu!.formations.map(f=>({...f,mission:f.role==='fighter'?'transit':'search-area',sortieOrdered:true,route:[[0,0],[-1,0],[0,0]],routeIngress:[[0,0],[-1,0]],plannedRecoveryFieldId:'e-base'}))}
    const result=resolveRound(s),settled=applyRound(s,result)
    const conditions=(list:Squadron[])=>list.map(f=>[f.role,f.readiness,f.ammo]).sort()
    expect(conditions(settled.cpu!.formations)).toEqual(conditions(settled.squadrons))
    expect(settled.cpu!.formations.find(f=>f.id==='red-fighter')!.ammo).toBe(72)
    expect(applyRound(settled,result)).toBe(settled)
    expect(normalizeMatch(JSON.parse(JSON.stringify(settled))).cpu).toEqual(settled.cpu)
  })
  it.each([['sam',17,true],['sam',8,false],['aaa',15.7,true],['aaa',8,false]] as const)('counts %s impacts at %s before release: late=%s',(kind,x,late)=>{
    const s=strikeScenario()
    const defense={...s.playerAssets[0],id:'p-defense',kind,position:[x,0] as [number,number],health:100,maxHealth:100}
    s.playerAssets.push(defense);s.cpu!.sites.push(cpuReportAt(defense,1))
    const fighter=s.cpu!.formations[0],order={...fighter,mission:'base-strike' as const,strikeTargetId:'p-base',sortieOrdered:true,route:[[0,0],[14,0]] as Array<[number,number]>,routeIngress:[[0,0],[14,0]] as Array<[number,number]>,plannedRecoveryFieldId:'e-base'}
    s.cpu!.plan={round:2,objective:'strike',reason:'Verify ingress impact timing.',candidates:[],orders:s.cpu!.formations.map(f=>f.id===fighter.id?order:{...f,sortieOrdered:false})}
    const forecast=estimateBaseAttack(cpuPlanningView(s)!,order)
    const result=resolveRound(s),strike=result.weaponEffects.find(e=>e.kind==='air-to-ground-missile'&&e.sourceId===fighter.id)!
    const shot=result.weaponEffects.find(e=>e.kind===kind&&e.targetId===fighter.id)!
    expect(strike).toBeDefined();expect(shot).toBeDefined()
    if(late){expect(shot.end).toBeGreaterThan(strike.start);expect(forecast.damageNow).toBe(60);expect(strike.damage).toBe(60)}
    else {expect(shot.end).toBeLessThan(strike.start);expect(forecast.damageNow).toBeLessThan(60)}
  })
  it('retains fast coordinated finishers and values return losses after a decisive release separately',()=>{
    const s=strikeScenario(),defense={...s.playerAssets[0],id:'p-sam',kind:'sam' as const,position:[17,0] as [number,number],health:100,maxHealth:100}
    s.playerAssets.push(defense);s.cpu!.sites.push(cpuReportAt(defense,1))
    const ready=prepareCpuRound(s),orders=ready.cpu!.plan!.orders.filter(o=>o.mission==='base-strike'&&o.sortieOrdered!==false)
    expect(orders).toHaveLength(2)
    for(const o of orders)expect(o.route.reduce((n,p,i)=>n+(i?Math.hypot(p[0]-o.route[i-1][0],p[1]-o.route[i-1][1]):0),0)).toBeCloseTo(14,4)
    const effects=ready.cpu!.plan!.trace!.chosenEffects!
    expect(effects.expectedAircraftLoss).toBeGreaterThan(effects.ingressAircraftLoss!)
    const result=resolveRound(ready)
    expect(result.baseDamage).toBe(100)
    expect(campaignOutcome(applyRound(ready,result))).toBe('home-base-destroyed')
  })
  it('preserves a legacy two-formation save without granting aircraft, condition or money',()=>{
    const s=campaign()
    s.cpu!.formations=s.cpu!.formations.filter(f=>f.id!=='red-fighter-2').map(f=>f.role==='recon'?{...f,aircraft:1,maxAircraft:2,strength:50}:f)
    s.cpu!.plan!.orders=s.cpu!.plan!.orders.filter(f=>f.id!=='red-fighter-2').map(f=>f.role==='recon'?{...f,aircraft:1,maxAircraft:2,strength:50}:f)
    s.cpu!.logistics=2;s.cpu!.reserves=0
    expect(normalizeMatch(JSON.parse(JSON.stringify(s))).cpu).toEqual(s.cpu)
    const broken=structuredClone(s);broken.cpu!.formations.push({...broken.cpu!.formations[0]})
    expect(normalizeMatch(broken).phase).toBe('deploy')
  })
  it('draws deadline and simultaneous base or force destruction, and recognizes elimination for either side',()=>{
    const s=campaign()
    expect(campaignOutcome({...s,playerBaseHealth:0,enemyBaseHealth:0})).toBe('mutual-destruction')
    const cpuLost={...s,cpu:{...s.cpu!,reserves:0,formations:s.cpu!.formations.map(f=>({...f,aircraft:0,strength:0}))}}
    expect(campaignOutcome(cpuLost)).toBe('enemy-forces-lost')
    expect(campaignOutcomePhase(campaignOutcome(cpuLost)!)).toBe('victory')
    expect(campaignOutcome({...cpuLost,replacements:0,squadrons:s.squadrons.map(f=>({...f,aircraft:0,strength:0}))})).toBe('mutual-forces-lost')
    const result=resolveRound({...s,squadrons:s.squadrons.map(f=>({...f,sortieOrdered:false}))})
    const deadline={...applyRound(s,result),round:6,lastResult:{...result,round:6}}
    expect(openAdaptPhase(deadline).phase).toBe('draw')
    const oldEnding={...deadline,phase:'defeat' as const}
    const loaded=normalizeMatch(JSON.parse(JSON.stringify(oldEnding)))
    expect(loaded.phase).toBe('draw')
    expect(loaded.cpu).toEqual(oldEnding.cpu)
    const legacyDefeat={...oldEnding,cpu:{...oldEnding.cpu!,reserves:0,formations:oldEnding.cpu!.formations.map(f=>({...f,aircraft:0,strength:0}))}}
    const migrated=normalizeMatch(JSON.parse(JSON.stringify(legacyDefeat)))
    expect(migrated.phase).toBe('victory')
    expect(migrated.cpu).toEqual(legacyDefeat.cpu)
  })
})
