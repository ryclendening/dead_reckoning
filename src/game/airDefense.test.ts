import { describe, expect, it } from 'vitest'
import { samStatusAt } from './airDefense'
import { createRoundSimulation, resolveRound } from './engine'
import { createScenario } from './scenarios'
import type { MatchState, Point } from './types'

function defenseFixture(twoFlights=false):MatchState{
  const state=createScenario('recon-recovery'),home=state.playerAssets.find(asset=>asset.kind==='base')!.position
  state.playerAssets=state.playerAssets.map(asset=>asset.kind==='base'?asset:{...asset,health:0})
  state.enemyAssets=state.enemyAssets.map(asset=>asset.kind==='sam'?{...asset,position:[home[0]+.5,home[1]] as Point}:asset.kind==='aaa'?{...asset,health:0}:asset)
  const route:Point[]=[home,...Array.from({length:24},(_,index)=>[home[0]+(index%2?1:-1),home[1]+(index%4<2?1:-1)] as Point)]
  state.squadrons=state.squadrons.map(squadron=>({...squadron,aircraft:4,strength:100,sortieOrdered:squadron.id==='raven'||twoFlights&&squadron.id==='ghost',route,routeIngress:route,plannedRecoveryFieldId:'p-base'}))
  return state
}

describe('finite SAM salvos',()=>{
  it('can repeatedly shoot the same formation, spends misses, and waits three seconds between all launches',()=>{
    const state=defenseFixture(),result=resolveRound(state),shots=result.weaponEffects.filter(effect=>effect.kind==='sam'&&effect.sourceId==='e-sam')
    expect(shots).toHaveLength(3)
    expect(new Set(shots.map(shot=>shot.targetId))).toEqual(new Set(['raven']))
    for(let index=1;index<shots.length;index++)expect(shots[index].start-shots[index-1].start).toBeCloseTo(3,6)
    expect(samStatusAt('e-sam',shots,shots[0].start-.001).remaining).toBe(3)
    expect(samStatusAt('e-sam',shots,shots[0].start)).toMatchObject({remaining:2,cooldown:3})
    expect(samStatusAt('e-sam',shots,result.duration).remaining).toBe(0)
    const miss={...shots[0],hit:false,damage:0}
    expect(samStatusAt('e-sam',[miss],miss.start).remaining).toBe(2)
    expect(result.contactIntervals.filter(contact=>contact.source==='radar')).toHaveLength(0)
  })

  it('shares the ammo and cooldown across formations instead of granting three shots per target',()=>{
    const state=defenseFixture(true),result=resolveRound(state),shots=result.weaponEffects.filter(effect=>effect.kind==='sam'&&effect.sourceId==='e-sam')
    expect(shots).toHaveLength(3)
    for(let index=1;index<shots.length;index++)expect(shots[index].start-shots[index-1].start).toBeGreaterThanOrEqual(3-.000001)
    expect(resolveRound(state)).toEqual(result)
    expect(samStatusAt('other-site',shots,result.duration).remaining).toBe(3)
  })

  it('resets ammunition on each round and agrees between live and batch simulation',()=>{
    const state=defenseFixture(),batch=resolveRound(state),simulation=createRoundSimulation(state)
    expect(samStatusAt('e-sam',simulation.result.weaponEffects,0).remaining).toBe(3)
    while(!simulation.complete)simulation.advance()
    expect(simulation.result).toEqual(batch)
    const next=createRoundSimulation({...state,round:state.round+1,lastResult:batch})
    expect(samStatusAt('e-sam',next.result.weaponEffects,0).remaining).toBe(3)
  })

  it.each([{health:0},{operational:false}])('prevents launches by a destroyed or disabled SAM (%j)',overrides=>{
    const state=defenseFixture();Object.assign(state.enemyAssets.find(asset=>asset.id==='e-sam')!,overrides)
    expect(resolveRound(state).weaponEffects.filter(effect=>effect.kind==='sam'&&effect.sourceId==='e-sam')).toHaveLength(0)
  })
})
