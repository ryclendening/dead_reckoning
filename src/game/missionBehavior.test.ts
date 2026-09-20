import {describe,expect,it} from 'vitest'
import {enemyBaseFor} from './data'
import {resolveRound} from './engine'
import {createScenario} from './scenarios'
import type {Point} from './types'

describe('mission-based aircraft behavior',()=>{
  it('uses a radar track to steer a fighter only when it is inside mission responsibility',()=>{
    const inside=createScenario('radar-intercept')
    const base=inside.world.friendlyTerritory.center,enemyBase=enemyBaseFor(inside.world),contactArea:Point=[enemyBase[0]+(base[0]-enemyBase[0])*.56,enemyBase[1]+(base[1]-enemyBase[1])*.56]
    inside.playerAssets=inside.playerAssets.map(asset=>asset.kind==='radar'?{...asset,position:contactArea}:asset)
    const remoteArea:Point=[base[0]+10,base[1]]
    inside.squadrons=inside.squadrons.map(squadron=>squadron.id==='viper'
      ?{...squadron,mission:'defensive-cap',route:[base,contactArea,base],routeIngress:[base,contactArea]}
      :squadron.id==='falcon'
        ?{...squadron,aircraft:4,strength:100,mission:'defensive-cap',route:[base,contactArea,base],routeIngress:[base,remoteArea]}
        :squadron)
    const insideResult=resolveRound(inside)
    const radarPlan=insideResult.interceptPlans.find(plan=>plan.squadronId==='viper'&&plan.source==='radar')
    expect(radarPlan).toBeDefined()
    expect(insideResult.radarTrackReceipts.some(receipt=>receipt.receiverId==='viper'&&receipt.targetId===radarPlan?.targetId)).toBe(true)
    expect(insideResult.radarTrackReceipts.some(receipt=>receipt.receiverId==='falcon'&&receipt.targetId===radarPlan?.targetId)).toBe(true)
    expect(insideResult.interceptPlans.some(plan=>plan.squadronId==='falcon')).toBe(false)

    const outside=structuredClone(inside)
    outside.squadrons=outside.squadrons.map(squadron=>squadron.id==='viper'?{...squadron,mission:'defensive-cap',routeIngress:[base,[base[0]-10,base[1]]] as Point[]}:squadron)
    const outsideResult=resolveRound(outside)
    expect(outsideResult.radarTrackReceipts.some(receipt=>receipt.receiverId==='viper')).toBe(true)
    expect(outsideResult.interceptPlans.some(plan=>plan.squadronId==='viper')).toBe(false)
  })

  it('does not voluntarily intercept a visual fighter outside responsibility',()=>{
    const state=createScenario('fighter-tail'),base=state.world.friendlyTerritory.center
    state.squadrons=state.squadrons.map(squadron=>squadron.id==='viper'?{...squadron,mission:'defensive-cap',routeIngress:[base,[base[0]-10,base[1]]] as Point[]}:squadron)
    const result=resolveRound(state)
    expect(result.contactIntervals.some(interval=>interval.observerId==='viper'&&interval.targetId==='red-fighter'&&interval.source==='visual')).toBe(true)
    expect(result.interceptPlans.some(plan=>plan.squadronId==='viper')).toBe(false)
  })

  it('flags direct fighter contact while recon continues without an RTB order',()=>{
    const state=createScenario('neutral-los')
    state.squadrons=state.squadrons.map(squadron=>squadron.id==='viper'?{...squadron,role:'recon' as const,mission:'search-area' as const}:squadron)
    const result=resolveRound(state)
    expect(result.threatAlerts?.some(alert=>alert.unitId==='viper'&&alert.kind==='fighter-contact')).toBe(true)
    expect(result.behaviorIntervals.some(interval=>interval.unitId==='viper'&&interval.reason==='direct-fighter-contact')).toBe(false)
  })

  it('is byte-deterministic with mission responsibility state',()=>{
    const state=createScenario('fighter-duel')
    expect(JSON.stringify(resolveRound(state))).toBe(JSON.stringify(resolveRound(structuredClone(state))))
  })
})
