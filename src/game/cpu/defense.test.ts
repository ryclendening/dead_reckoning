import { describe, it, expect } from 'vitest'
import { createMatch } from '../data'
import { resolveRound, applyRound } from '../engine'
import { normalizeMatch } from '../persistence'
import { validateAssetPlacement } from '../sideEconomy'
import { friendlyTerritoryForAssets, territoryContains } from '../territory'
import { cpuPlanningView } from './planningView'
import { maintainCpu } from './settlement'
import { defenseBenefits, defenseCoverage, legalPlacements } from './placement'
import { contribution } from './strategy'
import { emptyEffects } from './actions'
import type { MatchState, Point } from '../types'

function fixture(angle=0, role:'fighter'|'recon'='fighter', seed=7301):MatchState {
  const s=createMatch(seed,'hard'),p=(r:number):Point=>[Math.cos(angle)*r,Math.sin(angle)*r]
  return {...s,round:2,phase:'adapt',enemyBaseHealth:40,playerBaseHealth:100,
    enemyAssets:s.enemyAssets.filter(a=>a.kind==='base').map(a=>({...a,position:[0,0],health:40})),
    playerAssets:s.playerAssets.filter(a=>a.kind==='base').map(a=>({...a,position:p(20)})),
    squadrons:s.squadrons.map(f=>({...f,sortieOrdered:false,route:[p(20)],routeIngress:[p(20)]})),
    world:{...s.world,bounds:{minX:-45,maxX:45,minZ:-45,maxZ:45}},
    cpu:{...s.cpu!,plan:undefined,intent:undefined,logistics:16,reserves:0,sites:[],mappedAreas:[p(8),p(11)],
      formations:s.cpu!.formations.map(f=>({...f,route:[[0,0]],routeIngress:[[0,0]]})),
      traffic:[{identity:'observed',role,position:p(8),source:'visual',strength:100,aircraft:4,observedRound:2,bearing:angle}]}}
}
function holdCpu(s:MatchState):MatchState {
  return {...s,phase:'plan',cpu:{...s.cpu!,plan:{round:s.round,objective:'defend',reason:'Ground defense execution.',candidates:[],orders:s.cpu!.formations.map(f=>({...f,sortieOrdered:false}))}}}
}
function strike(s:MatchState):MatchState {
  const home=s.playerAssets[0].position,angle=Math.atan2(home[1],home[0]),release:Point=[6*Math.cos(angle),6*Math.sin(angle)]
  return {...holdCpu(s),enemyAssets:s.enemyAssets.map(a=>a.kind==='base'?{...a,intel:'confirmed',hidden:false,confidence:100}:a),squadrons:s.squadrons.map((f,i)=>i===0?{...f,mission:'base-strike',sortieOrdered:true,strikeTargetId:s.enemyAssets[0].id,route:[home,release],routeIngress:[home,release],plannedRecoveryFieldId:s.playerAssets[0].id}:{...f,sortieOrdered:false})}
}

describe('territory-aware defensive capabilities',()=>{
  it('values home SAM return attrition without crediting it as stopping the released missile',()=>{
    const s=fixture(),view=cpuPlanningView(s)!,point:Point=[4.05,0]
    const effects=defenseBenefits(view,point,'sam')
    expect(validateAssetPlacement(view.context,'sam',point).valid).toBe(true)
    expect(effects.coverage).toBe(0);expect(effects.opponentAttrition).toBeGreaterThan(0)
    const pack={id:'test',summary:'test',checks:[],orders:[],purchases:[],predicted:{...emptyEffects(),opponentAttrition:effects.opponentAttrition}}
    expect(contribution(view,pack).survival).toBe(0)
    expect(contribution(view,pack).enemyAttrition).toBeGreaterThan(0)
    expect(contribution({...view,round:6},pack).enemyAttrition).toBe(0)
    // These are real engine outcomes, including the launched payload surviving
    // damage to its shooter. Both full base health and sufficient range matter.
    const combat={...s,enemyBaseHealth:100,enemyAssets:s.enemyAssets.map(a=>({...a,health:100}))}
    const base=strike(combat),sam={...combat.enemyAssets[0],id:'e-sam-test',kind:'sam' as const,position:point}
    const result=resolveRound({...base,enemyAssets:[...base.enemyAssets,sam]})
    const missile=result.weaponEffects.find(e=>e.kind==='air-to-ground-missile')!
    const shot=result.weaponEffects.find(e=>e.kind==='sam')!
    expect(shot.end).toBeGreaterThan(missile.start)
    expect(result.enemyBaseDamage).toBe(60)
    expect(result.weaponEffects.some(e=>e.kind==='sam'&&e.damage>0)).toBe(true)
  })

  it.each([0,Math.PI/2,-Math.PI/2])('selects a complete defensive FOB and weapon on observed bearing %s',angle=>{
    const s=fixture(angle),before=cpuPlanningView(s)!,adapted=maintainCpu(s)
    const fob=adapted.enemyAssets.find(a=>a.kind==='fob'),weapon=adapted.enemyAssets.find(a=>a.kind==='sam'||a.kind==='aaa')
    expect(fob).toBeDefined();expect(weapon).toBeDefined()
    expect(before.cpu.sites).toEqual([]) // No known offensive target justifies this FOB.
    expect(validateAssetPlacement(before.context,weapon!.kind as 'sam'|'aaa',weapon!.position).valid).toBe(false)
    expect(territoryContains(weapon!.position,friendlyTerritoryForAssets(before.context.territory,adapted.enemyAssets))).toBe(true)
    expect(defenseCoverage(before,weapon!.position,weapon!.kind as 'sam'|'aaa')).toBeGreaterThan(0)
    expect(weapon!.position[0]*Math.cos(angle)+weapon!.position[1]*Math.sin(angle)).toBeGreaterThan(4.5)
    expect(adapted.cpu!.logistics).toBeGreaterThanOrEqual(0)
    expect(adapted.cpu!.formations).toEqual(s.cpu!.formations) // Ground construction does not stage aircraft.
    expect(maintainCpu(adapted)).toBe(adapted)
    expect(normalizeMatch(JSON.parse(JSON.stringify(adapted))).cpu).toEqual(adapted.cpu)
    expect(maintainCpu(s)).toEqual(adapted)
    const unprotected=resolveRound(strike(s)),protectedResult=resolveRound(strike(adapted))
    expect(protectedResult.enemyBaseDamage).toBeLessThan(unprotected.enemyBaseDamage)
    const missile=protectedResult.weaponEffects.find(e=>e.kind==='air-to-ground-missile')
    expect(protectedResult.weaponEffects.some(e=>(e.kind==='sam'||e.kind==='aaa')&&e.damage>0&&(!missile||e.end<missile.start))).toBe(true)
    expect(applyRound(applyRound(strike(adapted),protectedResult),protectedResult).cpu!.logistics).toBe(applyRound(strike(adapted),protectedResult).cpu!.logistics)
  })

  it('buys a legal home defense against recon and denies actual recovered reports',()=>{
    let lost=0,baselineReports=0
    // Fixed geometry with several combat seeds; no campaign benchmark seed is used.
    for(const seed of [2,17,43,67]) {
      let s=fixture(0,'recon',seed)
      s={...s,enemyBaseHealth:100,enemyAssets:s.enemyAssets.map(a=>({...a,health:100})),cpu:{...s.cpu!,logistics:8,mappedAreas:[],traffic:s.cpu!.traffic.map(t=>({...t,strength:35,aircraft:2}))}}
      const adapted=maintainCpu(s),weapon=adapted.enemyAssets.find(a=>a.kind==='sam'||a.kind==='aaa')!
      expect(weapon).toBeDefined();expect(weapon.kind).toBe('sam')
      const view=cpuPlanningView(s)!,effects=defenseBenefits(view,weapon.position,weapon.kind as 'sam')
      expect(effects.coverage).toBe(0);expect(effects.reconDenial).toBeGreaterThan(0)
      expect(adapted.cpu!.adaptTrace!.chosenEffects!.reconDenial).toBeGreaterThan(0)
      const run=(state:MatchState)=>{
        const order=state.squadrons.find(f=>f.role==='recon')!,home=state.playerAssets[0].position
        const route:Point[]=[home,[3.7,0],home]
        return resolveRound({...holdCpu(state),squadrons:state.squadrons.map(f=>f.id===order.id?{...f,strength:35,aircraft:2,mission:'search-area',sortieOrdered:true,route,routeIngress:route,plannedRecoveryFieldId:state.playerAssets[0].id}:{...f,sortieOrdered:false})})
      }
      baselineReports+=run(s).intelReports.filter(r=>r.assetId==='e-base'&&r.recovered).length
      lost+=run(adapted).intelReports.filter(r=>r.assetId==='e-base'&&r.recovered).length
    }
    expect(baselineReports).toBe(4);expect(lost).toBeLessThan(baselineReports)
  })

  it('does not fund empty territory, assume hidden reconnaissance, or reward future effects after round six',()=>{
    const s=fixture(),quiet={...s,enemyBaseHealth:100,enemyAssets:s.enemyAssets.map(a=>({...a,health:100})),cpu:{...s.cpu!,traffic:[]}}
    expect(maintainCpu(quiet).enemyAssets).toEqual(quiet.enemyAssets)
    expect(maintainCpu({...s,cpu:{...s.cpu!,logistics:13}}).enemyAssets.some(a=>a.kind==='fob')).toBe(false)
    const recon=fixture(0,'recon'),view=cpuPlanningView(recon)!
    const e=defenseBenefits(view,[4.05,0],'sam')
    const pack={id:'test',summary:'test',checks:[],orders:[],purchases:[],predicted:{...emptyEffects(),reconDenial:e.reconDenial}}
    expect(contribution({...view,round:6},pack).denial).toBe(0)
    const finisher={...pack,baseAttack:{damageNow:100,followupDamage:0,preparationRounds:0,releaseSeconds:5},predicted:{...pack.predicted,baseDamage:1,opponentAttrition:.5}}
    const known={...view,cpu:{...view.cpu,sites:[{id:'known-base',kind:'base' as const,position:[20,0] as Point,health:100,maxHealth:100,observedRound:1}]}}
    expect(contribution(known,finisher).denial).toBe(0)
    expect(contribution(known,finisher).enemyAttrition).toBe(0)
    const contact={...view.cpu.traffic[0],trackId:'observed-track'}
    const radar={...contact,role:'unknown' as const,source:'radar' as const,identity:undefined,strength:undefined,aircraft:undefined}
    expect(defenseBenefits({...view,homeHealth:100,cpu:{...view.cpu,traffic:[contact,radar]}},[4.05,0],'sam').opponentAttrition).toBe(0)
    const hidden={...quiet,playerAssets:quiet.playerAssets.map(a=>({...a,position:[-19,5] as Point})),squadrons:quiet.squadrons.map(f=>({...f,strength:1,aircraft:1}))}
    expect(maintainCpu(hidden).cpu!.adaptTrace).toEqual(maintainCpu(quiet).cpu!.adaptTrace)
    const covered={...view,assets:[...view.assets,{...view.assets[0],id:'existing-a',kind:'sam' as const,position:[4.05,0] as Point},{...view.assets[0],id:'existing-b',kind:'sam' as const,position:[4.05,1.5] as Point}]}
    expect(defenseBenefits(covered,[4.05,-1.5],'sam').reconDenial).toBeLessThan(e.reconDenial)
    expect(legalPlacements(view,'sam').every(p=>validateAssetPlacement(view.context,'sam',p).valid)).toBe(true)
  })
})
