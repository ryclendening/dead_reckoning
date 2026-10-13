import {describe,expect,it} from 'vitest'
import {createMatch,enemyBaseFor} from './data'
import {resolveRound} from './engine'
import {createScenario} from './scenarios'
import type {Point} from './types'

describe('mission-based aircraft behavior',()=>{
  it('records why an ordered base strike fails to launch',()=>{
    const state=createMatch()
    const fighter=state.squadrons.find(squadron=>squadron.role==='fighter')!
    state.squadrons=state.squadrons.map(squadron=>squadron.id===fighter.id?{...squadron,mission:'base-strike',sortieOrdered:true}: {...squadron,sortieOrdered:false})

    const result=resolveRound(state)

    expect(result.events.filter(event=>event.title==='BASE STRIKE FAILED')).toHaveLength(1)
    expect(result.events.find(event=>event.title==='BASE STRIKE FAILED')?.detail).toContain('CONFIRM THE ENEMY BASE BEFORE STRIKING')
  })

  it('distributes a radar track without a receiver-distance gate',()=>{
    const state=createScenario('radar-intercept')
    const base=state.world.friendlyTerritory.center
    const enemyStart=enemyBaseFor(state.world)
    expect(Math.hypot(enemyStart[0]-base[0],enemyStart[1]-base[1])).toBeGreaterThan(11)
    state.playerAssets=state.playerAssets.map(asset=>asset.kind==='radar'?{...asset,position:enemyStart}:asset)

    const result=resolveRound(state)

    expect(result.contactIntervals.some(contact=>contact.observerId==='viper'&&contact.targetId==='red-fighter'&&contact.source==='radar')).toBe(true)
  })

  it('shares radar tracks with fighters but steers only inside mission responsibility',()=>{
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
    expect(insideResult.contactIntervals.some(contact=>contact.observerId==='viper'&&contact.targetId===radarPlan?.targetId&&contact.source==='radar')).toBe(true)
    expect(insideResult.contactIntervals.some(contact=>contact.observerId==='falcon'&&contact.targetId===radarPlan?.targetId&&contact.source==='radar')).toBe(true)
    expect(insideResult.interceptPlans.some(plan=>plan.squadronId==='falcon')).toBe(false)

    const outside=structuredClone(inside)
    outside.squadrons=outside.squadrons.map(squadron=>squadron.id==='viper'?{...squadron,mission:'defensive-cap',routeIngress:[base,[base[0]-10,base[1]]] as Point[]}:squadron)
    const outsideResult=resolveRound(outside)
    expect(outsideResult.contactIntervals.some(contact=>contact.observerId==='viper'&&contact.source==='radar')).toBe(true)
    expect(outsideResult.interceptPlans.some(plan=>plan.squadronId==='viper')).toBe(false)
  })

  it('does not voluntarily intercept a visual fighter outside responsibility',()=>{
    const state=createScenario('fighter-tail'),base=state.world.friendlyTerritory.center
    state.squadrons=state.squadrons.map(squadron=>squadron.id==='viper'?{...squadron,mission:'defensive-cap',routeIngress:[base,[base[0]-10,base[1]]] as Point[]}:squadron)
    const result=resolveRound(state)
    expect(result.contactIntervals.some(interval=>interval.observerId==='viper'&&interval.targetId==='red-fighter'&&interval.source==='visual')).toBe(true)
    expect(result.interceptPlans.some(plan=>plan.squadronId==='viper')).toBe(false)
  })

  it('breaks a CAP chase when the target leaves the defended area',()=>{
    const state=createScenario('fighter-recon')
    const base=state.world.friendlyTerritory.center,enemy=enemyBaseFor(state.world)
    const center:Point=[enemy[0]+(base[0]-enemy[0])*.3,enemy[1]+(base[1]-enemy[1])*.3]
    state.playerAssets=state.playerAssets.map(asset=>asset.kind==='radar'?{...asset,position:center}:asset)
    state.squadrons=state.squadrons.map(squadron=>squadron.id==='viper'
      ?{...squadron,mission:'defensive-cap',route:[base,center,base],routeIngress:[base,center]}
      :squadron)

    const result=resolveRound(state)

    expect(result.interceptPlans.some(plan=>plan.squadronId==='viper'&&plan.targetId==='red-recon')).toBe(true)
    expect(result.events.some(event=>event.title==='PROTECT BREAKS PURSUIT')).toBe(true)
    expect(result.behaviorIntervals.some(interval=>interval.unitId==='viper'&&interval.mode==='following-route'&&interval.reason==='mission-pursuit-limit')).toBe(true)
    expect(result.combatSequences.some(sequence=>sequence.kind==='dogfight'&&sequence.participantIds.includes('viper'))).toBe(false)
  })

  it('tracks an escorted formation and ends protection when that flight recovers',()=>{
    const state=createScenario('recon-recovery')
    const base=state.world.friendlyTerritory.center
    state.squadrons=state.squadrons.map(squadron=>squadron.id==='viper'
      ?{...squadron,aircraft:4,strength:100,mission:'defensive-cap',route:[base,[base[0]+1,base[1]]],routeIngress:[base,[base[0]+1,base[1]]],protectedTargetId:'raven',sortieOrdered:true}
      :squadron.id==='raven'?{...squadron,sortieOrdered:true}: {...squadron,sortieOrdered:false})

    const result=resolveRound(state)

    expect(result.events.filter(event=>event.title==='PROTECT ORDER ENDS'&&event.detail.includes('RAVEN 3'))).toHaveLength(1)
    const fighter=result.unitTracks.find(track=>track.unitId==='viper')!
    const recon=result.unitTracks.find(track=>track.unitId==='raven')!
    expect(fighter.frames.some((frame,index)=>index>0&&frame.position[0]!==fighter.frames[index-1].position[0]&&Math.hypot(frame.position[0]-recon.frames[index].position[0],frame.position[1]-recon.frames[index].position[1])<4.5)).toBe(true)
    expect(result.behaviorIntervals.some(interval=>interval.unitId==='viper'&&interval.reason==='protected-flight-ended')).toBe(true)
  })

  it('does not divert a transit fighter for an actionable radar contact',()=>{
    const state=createScenario('radar-intercept')
    const base=state.world.friendlyTerritory.center,enemyBase=enemyBaseFor(state.world)
    const contactArea:Point=[enemyBase[0]+(base[0]-enemyBase[0])*.56,enemyBase[1]+(base[1]-enemyBase[1])*.56]
    state.playerAssets=state.playerAssets.map(asset=>asset.kind==='radar'?{...asset,position:contactArea}:asset)
    state.squadrons=state.squadrons.map(squadron=>squadron.id==='viper'?{...squadron,mission:'transit',route:[base,contactArea,base],routeIngress:[base,contactArea]}:squadron)
    const result=resolveRound(state)
    expect(result.contactIntervals.some(contact=>contact.observerId==='viper'&&contact.source==='radar')).toBe(true)
    expect(result.interceptPlans.some(plan=>plan.squadronId==='viper')).toBe(false)
  })

  it('still resolves direct fighter contact during Transit',()=>{
    const state=createScenario('fighter-duel')
    state.squadrons=state.squadrons.map(squadron=>squadron.id==='viper'?{...squadron,mission:'transit'}:squadron)
    const result=resolveRound(state)
    expect(result.interceptPlans.some(plan=>plan.squadronId==='viper')).toBe(false)
    expect(result.combatSequences.some(sequence=>sequence.kind==='dogfight'&&sequence.participantIds.includes('viper'))).toBe(true)
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
