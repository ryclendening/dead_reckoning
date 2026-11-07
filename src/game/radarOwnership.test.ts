import {describe,expect,it} from 'vitest'
import {createMatch,enemyBaseFor} from './data'
import {createRoundSimulation,resolveRound,TICK_SECONDS} from './engine'
import {projectHostileUnitAt} from './executionProjection'
import {createScenario} from './scenarios'
import type {Point} from './types'

describe('radar ownership',()=>{
  it('detects unique unknown tracks with all friendly aircraft grounded',()=>{
    const state=createScenario('radar-intercept'),enemy=enemyBaseFor(state.world)
    state.squadrons=state.squadrons.map(squadron=>({...squadron,sortieOrdered:false}))
    state.playerAssets=state.playerAssets.map(asset=>asset.kind==='radar'?{...asset,position:enemy}:asset)
    const simulation=createRoundSimulation(state)
    simulation.advance()
    expect(simulation.result.unitTracks.filter(track=>state.squadrons.some(squadron=>squadron.id===track.unitId)).every(track=>track.frames.at(-1)?.mode==='grounded'||track.frames.at(-1)?.mode==='destroyed')).toBe(true)
    expect(simulation.result.contactIntervals.some(contact=>contact.observerId==='p-radar'&&contact.source==='radar')).toBe(true)
    expect(simulation.result.contactIntervals.every(contact=>contact.source==='radar'&&contact.observerId==='p-radar')).toBe(true)
    expect(projectHostileUnitAt(simulation.result,'red-fighter',TICK_SECONDS)).toMatchObject({visibility:'radar',identityKnown:false,trackId:'TRACK 01'})
  })

  it.each(['destroyed','disabled'] as const)('does not detect through a %s ground radar',condition=>{
    const state=createScenario('radar-intercept'),enemy=enemyBaseFor(state.world)
    state.squadrons=state.squadrons.map(squadron=>({...squadron,sortieOrdered:false}))
    state.playerAssets=state.playerAssets.map(asset=>asset.kind==='radar'?{...asset,position:enemy,...(condition==='destroyed'?{health:0}:{operational:false})}:asset)
    const simulation=createRoundSimulation(state);simulation.advance()
    expect(simulation.result.contactIntervals).toEqual([])
  })

  it('closes visual receipts when the last airborne observer recovers',()=>{
    const state=createScenario('recon-pursuit'),home=state.world.friendlyTerritory.center
    state.playerAssets=state.playerAssets.map(asset=>asset.kind==='radar'?{...asset,health:0}:asset)
    const recon=state.squadrons.find(squadron=>squadron.id==='raven')!
    recon.route=[home,home];recon.routeIngress=recon.route
    const result=resolveRound(state)
    const recovered=result.unitTracks.find(track=>track.unitId==='raven')!.frames.find(frame=>frame.mode==='recovered')!
    const visual=result.contactIntervals.filter(contact=>contact.source==='visual')
    expect(visual.length).toBeGreaterThan(0)
    expect(visual.every(contact=>contact.end<=recovered.time)).toBe(true)
    expect(projectHostileUnitAt(result,'red-fighter',recovered.time+TICK_SECONDS)).toBeUndefined()
  })

  it('does not turn hostile radar coverage into a friendly track or recon abort',()=>{
    const initial=createMatch(7301)
    const base=initial.world.friendlyTerritory.center
    const hostileRadar=initial.enemyAssets.find(asset=>asset.kind==='radar')!
    const route:Point[]=[base,hostileRadar.position,[base[0],base[1]+1],base]
    const match={
      ...initial,
      playerAssets:initial.playerAssets.map(asset=>asset.kind==='radar'?{...asset,health:0}:asset),
      squadrons:initial.squadrons.map(squadron=>squadron.id==='raven'
        ?{...squadron,mission:'search-area' as const,route,routeIngress:route}
        :{...squadron,aircraft:0,strength:0}),
    }
    const result=resolveRound(match)
    expect(result.contactIntervals.some(contact=>contact.observerId==='raven'&&contact.source==='radar')).toBe(false)
    expect(result.behaviorIntervals.some(interval=>interval.unitId==='raven'&&interval.reason==='persistent-radar-threat')).toBe(false)
  })
})
