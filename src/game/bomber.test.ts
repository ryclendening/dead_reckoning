import { describe, expect, it } from 'vitest'
import { createScenario } from './scenarios'
import { applyRound, FLIGHT_SPEED, MAX_FLIGHT_DISTANCE, resolveRound } from './engine'
import { normalizeMatch } from './persistence'
import { validateBomberOrderForPlayer } from './routeTemplates'
import { planBombingTarget, removeBombingTarget } from './groundStrikePlanning'
import { FORMATION_PRICES } from './economyRules'
import { economyQuotesFor } from './economy'
import type { Asset, MatchState, Point, Squadron } from './types'

function bomberFixture(targetKinds:Asset['kind'][]=['sam']):MatchState {
  const state=createScenario('recon-recovery'),home=state.playerAssets.find(asset=>asset.kind==='base')!.position
  state.cpu=undefined
  state.enemyAssets=state.enemyAssets.map(asset=>asset.kind==='sam'||asset.kind==='aaa'?{...asset,health:0}:asset)
  const sites:Asset[]=targetKinds.map((kind,index)=>{
    const id=`target-${index}`
    const position:[number,number]=[home[0],home[1]+(home[1]>=0?-1:1)*(8+index*4)]
    const original=state.enemyAssets.find(asset=>asset.id==='e-sam')!
    return {...original,id,kind,position,intel:'confirmed',confidence:100,hidden:false,health:100,maxHealth:100,name:id,operational:false}
  })
  state.enemyAssets=[...state.enemyAssets.filter(asset=>asset.id!=='e-sam'),...sites]
  const flight=state.squadrons.find(squadron=>squadron.id==='viper')!
  const route:Point[]=[home,...sites.map(asset=>asset.position)]
  const bombingTargets=sites.map((asset,index)=>({targetId:asset.id,routeIndex:index+1}))
  state.squadrons=state.squadrons.map(squadron=>squadron.id===flight.id?{
    ...squadron,role:'bomber',aircraftTypeId:'bomber',mission:'bomb',aircraft:4,strength:100,sortieOrdered:true,
    route,routeIngress:route,bombingTargets,plannedRecoveryFieldId:'p-base',
  }:{...squadron,sortieOrdered:false})
  return state
}

describe('bomber ground attack',()=>{
  it('uses the short, slower bomber profile and persists purchased bomber identity',()=>{
    const state=createScenario('campaign'),quote=economyQuotesFor(state,{kind:'campaign',id:'campaign'}).find(item=>item.id==='buy-bomber')
    expect(FORMATION_PRICES.bomber).toBeGreaterThan(FORMATION_PRICES.fighter)
    expect(FLIGHT_SPEED.bomber).toBeLessThan(FLIGHT_SPEED.fighter)
    expect(FLIGHT_SPEED.bomber).toBeLessThan(FLIGHT_SPEED.recon)
    expect(MAX_FLIGHT_DISTANCE.bomber).toBeLessThan(MAX_FLIGHT_DISTANCE.fighter)
    expect(quote).toMatchObject({cost:24,effect:{kind:'formation-purchase',role:'bomber'}})
    const loaded=normalizeMatch(JSON.parse(JSON.stringify(bomberFixture())))
    expect(loaded.squadrons[0]).toMatchObject({role:'bomber',aircraftTypeId:'bomber',mission:'bomb',bombingTargets:[{targetId:'target-0',routeIndex:1}]})
  })

  it('hits multiple confirmed target anchors in order; site bombs deal 100 and base bombs deal 50',()=>{
    const state=bomberFixture(['sam','aaa','base'])
    const bomber=state.squadrons[0],home=bomber.route[0]
    const route:Point[]=[home,state.enemyAssets.find(asset=>asset.id==='target-2')!.position,state.enemyAssets.find(asset=>asset.id==='target-1')!.position,state.enemyAssets.find(asset=>asset.id==='target-0')!.position]
    bomber.route=route;bomber.routeIngress=route;bomber.bombingTargets=[{targetId:'target-2',routeIndex:1},{targetId:'target-1',routeIndex:2},{targetId:'target-0',routeIndex:3}]
    const result=resolveRound(state)
    const releases=result.weaponEffects.filter(effect=>effect.kind==='bomb')
    expect(releases.map(effect=>effect.targetId)).toEqual(['target-2','target-1','target-0'])
    expect(releases.map(effect=>effect.damage)).toEqual([50,100,100])
    expect(new Set(releases.map(effect=>effect.id)).size).toBe(3)
    expect(result.assets.find(asset=>asset.id==='target-0')?.health).toBe(0)
    expect(result.assets.find(asset=>asset.id==='target-1')?.health).toBe(0)
    expect(result.enemyBaseDamage).toBe(50)
    expect(applyRound(state,result).enemyAssets.find(asset=>asset.id==='target-2')?.health).toBe(50)
  })

  it('two full-strength payloads destroy a full-health base',()=>{
    const state=bomberFixture(['base']),home=state.playerAssets.find(asset=>asset.kind==='base')!.position,target=state.enemyAssets.find(asset=>asset.id==='target-0')!
    const second:Squadron={...state.squadrons[0],id:'bomber-2',callsign:'BISON 2',route:[[...home],target.position],routeIngress:[[...home],target.position],bombingTargets:[{targetId:target.id,routeIndex:1}]}
    state.squadrons=[{...state.squadrons[0],route:[[...home],target.position],routeIngress:[[...home],target.position],bombingTargets:[{targetId:target.id,routeIndex:1}]},second,...state.squadrons.slice(1)]
    state.playerAssets=state.playerAssets.map(asset=>asset.kind==='base'?{...asset,basedFormationIds:['viper','bomber-2']}:asset)
    const result=resolveRound(state)
    expect(result.weaponEffects.filter(effect=>effect.kind==='bomb'&&effect.targetId===target.id)).toHaveLength(2)
    expect(result.enemyBaseDamage).toBe(100)
  })

  it('marks a missed release window as terminal and does not drop a bomb on the return crossing',()=>{
    const state=bomberFixture(['sam']),bomber=state.squadrons[0],target=state.enemyAssets.find(asset=>asset.id==='target-0')!
    const home=bomber.route[0],outside:Point=[target.position[0]+5,target.position[1]]
    bomber.route=[home,outside];bomber.routeIngress=bomber.route;bomber.bombingTargets=[{targetId:target.id,routeIndex:1}]
    const result=resolveRound(state)
    expect(result.weaponEffects.filter(effect=>effect.kind==='bomb')).toHaveLength(0)
    expect(result.events.some(event=>event.title==='BOMB RELEASE MISSED')).toBe(true)
  })

  it('rejects provisional targets, over-capacity payloads, bad release indices, and insufficient fuel',()=>{
    const state=bomberFixture(['sam','aaa','radar']),bomber=state.squadrons[0]
    const provisional={...state,enemyAssets:state.enemyAssets.map(asset=>asset.id==='target-0'?{...asset,intel:'probable' as const}:asset)}
    expect(validateBomberOrderForPlayer(provisional,bomber)).toBe('BOMBING TARGET MUST BE ALIVE AND CONFIRMED')
    expect(validateBomberOrderForPlayer(state,{...bomber,bombingTargets:[...bomber.bombingTargets!,{targetId:'extra',routeIndex:4}]})).toBe('A BOMBER CARRIES ONLY THREE PAYLOADS')
    expect(validateBomberOrderForPlayer(state,{...bomber,bombingTargets:[{targetId:'target-0',routeIndex:5}]})).toBe('BOMB RELEASES MUST FOLLOW ROUTE ORDER')
    const overBudgetRoute:Point[]=[bomber.route[0],[bomber.route[0][0]+30,bomber.route[0][1]],...bomber.route.slice(1)]
    const fuelLimited={...bomber,route:overBudgetRoute,routeIngress:overBudgetRoute,bombingTargets:bomber.bombingTargets!.map(target=>({...target,routeIndex:target.routeIndex+1}))}
    expect(validateBomberOrderForPlayer(state,fuelLimited)).toBe('BOMBING ROUTE EXCEEDS AVAILABLE RANGE')
  })

  it('appends a confirmed target once and maintains anchors when removing it',()=>{
    const state=bomberFixture(['sam']),bomber=state.squadrons[0]
    const target=state.enemyAssets.find(asset=>asset.id==='target-0')!
    bomber.mission='bomb';bomber.route=[bomber.route[0]];bomber.routeIngress=bomber.route;bomber.bombingTargets=[]
    const order=planBombingTarget(state,bomber.id,target.id)!
    expect(order.bombingTargets).toEqual([{targetId:'target-0',routeIndex:1}])
    expect(removeBombingTarget(order,'target-0').bombingTargets).toBeUndefined()
  })
})
