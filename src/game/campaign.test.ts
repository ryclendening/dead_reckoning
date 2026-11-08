import { describe, expect, it } from 'vitest'
import { CAMPAIGN_ROUND_LIMIT, campaignOutcome, confirmedStrikeTarget, isCampaign } from './campaign'
import { applyRound, createRoundSimulation, resolveRound } from './engine'
import { beginNextRound, openAdaptPhase } from './economy'
import { buildGroundStrikeRoute, validateGroundStrikeOrder } from './routeTemplates'
import { createMatch } from './data'
import { createScenario } from './scenarios'
import type { MatchState } from './types'

describe('campaign outcomes',()=>{
  it('keeps debug fixtures isolated, draws simultaneous destruction, and waits for the settled deadline',()=>{
    const state=createMatch()
    expect(isCampaign(state)).toBe(true)
    expect(isCampaign({...state,debugScenario:'fighter-duel'})).toBe(false)
    expect(campaignOutcome({...state,enemyBaseHealth:0,playerBaseHealth:0})).toBe('mutual-destruction')
    expect(campaignOutcome({...state,squadrons:state.squadrons.map(squadron=>({...squadron,aircraft:0})),replacements:0})).toBe('forces-lost')
    expect(campaignOutcome({...state,round:CAMPAIGN_ROUND_LIMIT})).toBeUndefined()
    const settled={...state,round:CAMPAIGN_ROUND_LIMIT,lastResult:{round:CAMPAIGN_ROUND_LIMIT} as MatchState['lastResult']}
    expect(campaignOutcome(settled)).toBe('deadline')
    expect(campaignOutcome({...settled,debugScenario:'fighter-duel',enemyBaseHealth:0})).toBeUndefined()
    expect(openAdaptPhase({...settled,phase:'debrief'}).phase).toBe('draw')
    expect(beginNextRound({...settled,phase:'adapt'}).round).toBe(CAMPAIGN_ROUND_LIMIT)
  })

  it('builds a legal standoff route to naturally confirmed enemy bases across the four start regions',()=>{
    const regions=new Set<string>()
    for(let seed=1;seed<=100&&regions.size<4;seed++){
      const state=createMatch(seed);regions.add(state.world.startRegionId)
      const enemyAssets=state.enemyAssets.map(asset=>asset.kind==='base'?{...asset,intel:'confirmed' as const,confidence:100,hidden:false}:asset)
      const armed={...state,enemyAssets},fighter=armed.squadrons.find(squadron=>squadron.role==='fighter')!
      const route=buildGroundStrikeRoute(armed,fighter.id,'e-base')
      expect(route).toBeDefined()
      const planned={...fighter,mission:'base-strike' as const,strikeTargetId:'e-base',route:route!,routeIngress:route!,plannedRecoveryFieldId:'p-base'}
      expect(validateGroundStrikeOrder(armed,planned)).toBeUndefined()
      expect(Math.hypot(route!.at(-1)![0]-enemyAssets[0].position[0],route!.at(-1)![1]-enemyAssets[0].position[1])).toBeLessThanOrEqual(6)
    }
    expect(regions.size).toBe(4)
  })

  it('uses a short in-range waypoint when the launch field is already near the base',()=>{
    const state=createMatch(),home=state.playerAssets.find(asset=>asset.kind==='base')!,enemy=state.enemyAssets.find(asset=>asset.id==='e-base')!
    const armed={...state,enemyAssets:state.enemyAssets.map(asset=>asset.id===enemy.id?{...asset,position:[home.position[0]+5,home.position[1]] as [number,number],intel:'confirmed' as const,confidence:100,hidden:false}:asset)}
    const fighter=armed.squadrons.find(squadron=>squadron.role==='fighter')!,route=buildGroundStrikeRoute(armed,fighter.id,'e-base')!
    expect(route).toHaveLength(2)
    expect(Math.hypot(route[1][0]-home.position[0],route[1][1]-home.position[1])).toBeLessThanOrEqual(.25)
    expect(Math.hypot(route[1][0]-armed.enemyAssets[0].position[0],route[1][1]-armed.enemyAssets[0].position[1])).toBeLessThan(6)
  })

  it('keeps an already-in-range strike on its fixed release point rather than launching at takeoff',()=>{
    const original=createScenario('neutral-los'),home=original.playerAssets.find(asset=>asset.kind==='base')!.position
    const near={...original,enemyAssets:original.enemyAssets.map(asset=>asset.id==='e-base'?{...asset,position:[home[0]+5,home[1]] as [number,number],intel:'confirmed' as const,confidence:100,hidden:false}:asset)}
    const fighter=near.squadrons.find(squadron=>squadron.role==='fighter')!,route=buildGroundStrikeRoute(near,fighter.id,'e-base')!
    const state={...near,squadrons:near.squadrons.map(squadron=>squadron.id===fighter.id?{...squadron,mission:'base-strike' as const,strikeTargetId:'e-base',route,routeIngress:route,plannedRecoveryFieldId:'p-base',sortieOrdered:true}:{...squadron,sortieOrdered:false})}
    expect(validateGroundStrikeOrder(state,state.squadrons.find(squadron=>squadron.id===fighter.id)!)).toBeUndefined()
    const missile=resolveRound(state).weaponEffects.find(effect=>effect.kind==='air-to-ground-missile'&&effect.targetId==='e-base')
    expect(missile).toBeDefined()
    expect(missile!.from).toEqual(route.at(-1))
    expect(missile!.start).toBeGreaterThan(.1)
  })

  it('rejects a release point outside weapon range even when the ingress passes a valid release',()=>{
    const state=createMatch(),target=state.enemyAssets.find(asset=>asset.id==='e-base')!,home=state.playerAssets.find(asset=>asset.kind==='base')!.position
    const armed={...state,enemyAssets:state.enemyAssets.map(asset=>asset.id===target.id?{...asset,intel:'confirmed' as const,confidence:100,hidden:false}:asset)}
    const fighter=armed.squadrons.find(squadron=>squadron.id==='viper')!,route=buildGroundStrikeRoute(armed,fighter.id,target.id)!
    const edited=[home,route[1],home]
    expect(validateGroundStrikeOrder(armed,{...fighter,mission:'base-strike',strikeTargetId:target.id,route:edited,routeIngress:edited})).toBe('KEEP THE STRIKE POINT INSIDE THE 6-UNIT RELEASE CIRCLE')
  })

  it('queues one deterministic missile and applies health only after impact',()=>{
    const original={...createMatch(7302),cpu:undefined},target=original.enemyAssets.find(asset=>asset.id==='e-base')!
    const confirmed={...original,enemyAssets:original.enemyAssets.map(asset=>asset.id===target.id?{...asset,intel:'confirmed' as const,confidence:100,hidden:false}:asset)}
    const fighter=confirmed.squadrons.find(squadron=>squadron.id==='viper')!,route=buildGroundStrikeRoute(confirmed,fighter.id,'e-base')!
    const state={...confirmed,squadrons:confirmed.squadrons.map(squadron=>squadron.id===fighter.id?{...squadron,mission:'base-strike' as const,strikeTargetId:'e-base',route,routeIngress:route,plannedRecoveryFieldId:'p-base'}:{...squadron,aircraft:0,strength:0})}
    const simulation=createRoundSimulation(state)
    let launchedAt=-1
    while(!simulation.complete){
      const next=simulation.advance(),missile=next.weaponEffects.find(effect=>effect.kind==='air-to-ground-missile'&&effect.targetId==='e-base')
      if(missile){launchedAt=missile.start;expect(next.assets.find(asset=>asset.id==='e-base')?.health).toBe(100);break}
    }
    expect(launchedAt).toBeGreaterThan(0)
    while(!simulation.complete&&simulation.result.duration<launchedAt+.65)simulation.advance()
    expect(simulation.result.assets.find(asset=>asset.id==='e-base')?.health).toBeLessThan(100)
    expect(simulation.result.combatSequences.some(sequence=>sequence.kind==='strike'&&sequence.exchanges[0].damage>0)).toBe(true)
    const result=resolveRound(state),applied=applyRound(state,result)
    expect(applyRound(applied,result)).toBe(applied)

    const home=state.playerAssets.find(asset=>asset.kind==='base')!.position,base=state.enemyAssets.find(asset=>asset.id==='e-base')!.position
    const vector=[home[0]-base[0],home[1]-base[1]],length=Math.hypot(...vector),edge: [number,number]=[base[0]+vector[0]/length*6,base[1]+vector[1]/length*6]
    const boundaryState={...state,squadrons:state.squadrons.map(squadron=>squadron.id===fighter.id?{...squadron,route:[home,edge],routeIngress:[home,edge]}:squadron)}
    expect(validateGroundStrikeOrder(boundaryState,boundaryState.squadrons.find(squadron=>squadron.id===fighter.id)!)).toBeUndefined()
    expect(resolveRound(boundaryState).weaponEffects.some(effect=>effect.kind==='air-to-ground-missile'&&effect.targetId==='e-base')).toBe(true)
  })

  it('rejects a strike order without recovered enemy-base intelligence',()=>{
    const state=createMatch(),fighter=state.squadrons.find(squadron=>squadron.role==='fighter')!
    expect(confirmedStrikeTarget(state)).toBeUndefined()
    expect(validateGroundStrikeOrder({...state,squadrons:state.squadrons.map(squadron=>squadron.id===fighter.id?{...squadron,mission:'base-strike'}:squadron)},{...fighter,mission:'base-strike'})).toBe('SELECT A CONFIRMED GROUND TARGET')
  })

  it('validates optional waypoints between the canonical strike anchors',()=>{
    const state=createMatch(),target=state.enemyAssets.find(asset=>asset.id==='e-base')!,home=state.playerAssets.find(asset=>asset.kind==='base')!.position
    const armed={...state,enemyAssets:state.enemyAssets.map(asset=>asset.id===target.id?{...asset,intel:'confirmed' as const,confidence:100,hidden:false}:asset)}
    const fighter=armed.squadrons.find(squadron=>squadron.id==='viper')!,dx=home[0]-target.position[0],dz=home[1]-target.position[1],d=Math.hypot(dx,dz)
    const inRange: [number,number]=[target.position[0]+dx/d*5.8,target.position[1]+dz/d*5.8]
    const anchors=buildGroundStrikeRoute(armed,fighter.id,target.id)!
    const route=[home,inRange,anchors[1]]
    expect(validateGroundStrikeOrder(armed,{...fighter,mission:'base-strike',strikeTargetId:'e-base',route,routeIngress:route,plannedRecoveryFieldId:'p-base'})).toBeUndefined()
  })

  it('only raises exposure for recovered enemy recon that observes the real base',()=>{
    const initial={...createMatch(),cpu:undefined},state={...initial,squadrons:initial.squadrons.map(squadron=>squadron.role==='fighter'?{...squadron,aircraft:0,strength:0,status:'destroyed' as const}:squadron),playerAssets:initial.playerAssets.filter(asset=>asset.kind!=='decoy').map(asset=>asset.kind==='radar'?{...asset,health:0}:asset)},result=resolveRound(state)
    expect(result.enemyFlights.find(flight=>flight.id==='red-recon')?.route[1]).toEqual(state.world.friendlyTerritory.center)
    expect(result.baseExposureDelta).toBe(40)
    const base=state.playerAssets.find(asset=>asset.kind==='base')!
    const decoyOnly={...state,playerAssets:state.playerAssets.map(asset=>asset.id===base.id?{...asset,position:[base.position[0]+10,base.position[1]+10] as [number,number]}:asset.kind==='decoy'?{...asset,position:[state.world.friendlyTerritory.center[0]+1,state.world.friendlyTerritory.center[1]] as [number,number]}:asset)}
    expect(resolveRound(decoyOnly).baseExposureDelta).toBe(0)
  })

  it('reduces only the current report when any live decoy is also observed',()=>{
    const initial={...createMatch(),cpu:undefined},base=initial.world.friendlyTerritory.center,first=initial.playerAssets.find(asset=>asset.kind==='decoy')!
    const state={...initial,squadrons:initial.squadrons.map(squadron=>squadron.role==='fighter'?{...squadron,aircraft:0,strength:0,status:'destroyed' as const}:squadron),playerAssets:initial.playerAssets.map(asset=>asset.kind==='radar'?{...asset,health:0}:asset)}
    const withRemoteFirst={...state,playerAssets:state.playerAssets.map(asset=>asset.id===first.id?{...asset,position:[base[0]+12,base[1]+12] as [number,number]}:asset)}
    const second={...first,id:'p-decoy-2',position:[base[0]+1,base[1]] as [number,number]}
    const result=resolveRound({...withRemoteFirst,playerAssets:[...withRemoteFirst.playerAssets,second]})
    expect(result.baseExposureDelta).toBe(20)
  })

  it('uses the prior round exposure threshold and never plots lost unknown coordinates',()=>{
    const base={...createMatch(),cpu:undefined},below=resolveRound({...base,baseExposure:59}),atThreshold=resolveRound({...base,baseExposure:60})
    expect(below.enemyFlights.find(flight=>flight.id==='red-fighter')?.route).toHaveLength(7)
    expect(atThreshold.enemyFlights.find(flight=>flight.id==='red-fighter')?.target).toBe('base')
    const lost=resolveRound(createScenario('recon-loss'))
    const lostEvent=lost.events.find(event=>event.title==='INTEL LOST')
    if(lostEvent)expect(lostEvent.position).toBeUndefined()
  })
})
