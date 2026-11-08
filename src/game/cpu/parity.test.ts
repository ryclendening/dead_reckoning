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
import { generateActions } from './actions'
import { discoveryAttackValue } from './strategy'
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
  })
})
