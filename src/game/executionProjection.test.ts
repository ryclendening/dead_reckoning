import { describe, expect, it } from 'vitest'
import { contactProjectionAt, debriefHistoryFor, projectFriendlyUnitAt, projectHostileUnitAt, sampleUnitTrack, sampleUnitTrackForRender, unitTrackFor, visibleTrackSegments } from './executionProjection'
import { enemyBaseFor } from './data'
import { createRoundSimulation, resolveRound, TICK_SECONDS } from './engine'
import { createScenario } from './scenarios'
import type { RoundResult, SimulationCommand, UnitTrack } from './types'

const track: UnitTrack = {
  unitId: 'red-fighter',
  frames: [
    { time: 0, position: [0, 0], facing: [1, 0], mode: 'following-route', strength: 100, morale: 80, aircraft: 4, traveledDistance: 0 },
    { time: 1, position: [2, 4], facing: [3, 4], mode: 'intercepting', strength: 60, morale: 40, aircraft: 2, traveledDistance: 6 },
    { time: 2, position: [3, 6], facing: [4, 6], mode: 'dogfighting', strength: 40, morale: 30, aircraft: 2, traveledDistance: 8 },
  ],
}

function resultWithContacts(): RoundResult {
  return {
    round: 1,
    duration: 2,
    tickSeconds: .05,
    unitTracks: [track],
    contactIntervals: [
      { id: 'radar-1', observerId: 'viper', targetId: 'red-fighter', source: 'radar', start: .25, end: .75, position: [0, 0] },
      { id: 'visual-1', observerId: 'viper', targetId: 'red-fighter', source: 'visual', start: .5, end: 1, position: [0, 0] },
      { id: 'radar-2', observerId: 'falcon', targetId: 'red-fighter', source: 'radar', start: 1.25, end: 1.75, position: [0, 0] },
    ],
    behaviorIntervals: [], events: [], squadrons: [], assets: [], enemyLosses: 0, friendlyLosses: 0,
    friendlyAttrition: [], enemyAttrition: [], friendlyFormationsDestroyed: 0, enemyFormationsDestroyed: 0,
    intelGained: [], baseDamage: 0, enemyBaseDamage: 0, logisticsIncome: { base: 0, intel: 0, enemyAircraft: 0, total: 0 }, command: 0,
    executionRoutes: {}, enemyFlights: [], defenseCues: [], defensiveAwareness: 0, lessons: [], playerAssets: [], reinforcementCalls: [],
    roundScore: 0, baseExposure: 0, baseExposureDelta: 0, combatSequences: [], weaponEffects: [], contactObservations: [], interceptPlans: [], intelReports: [], mappedAreas: [], discoveredBoundaries: [], recoveryOutcomes: [],
  }
}

describe('execution projection', () => {
  it('interpolates continuous track fields and keeps discrete state authoritative', () => {
    expect(sampleUnitTrack(track, -.2)).toEqual(track.frames[0])
    expect(sampleUnitTrack(track, 3)).toEqual(track.frames[2])
    expect(sampleUnitTrack(track, .5)).toMatchObject({
      time: .5,
      position: [1, 2],
      facing: [2, 2],
      mode: 'following-route',
      strength: 80,
      morale: 60,
      aircraft: 4,
      traveledDistance: 3,
    })
    expect(sampleUnitTrack(track, 1)?.mode).toBe('intercepting')
    expect(sampleUnitTrack(track, 1)?.aircraft).toBe(2)
  })

  it('clamps frame interpolation to current authority and the active hostile contact window',()=>{
    expect(sampleUnitTrackForRender(track,.8,.6)?.position).toEqual([1.2,2.4])
    expect(sampleUnitTrackForRender(track,.3,.65,{contactStart:.5})?.position).toEqual([1,2])
    expect(sampleUnitTrackForRender(track,.8,.3,{contactStart:.5})).toBeUndefined()
    expect(sampleUnitTrackForRender(track,.8,.9,{contactStart:null})).toBeUndefined()
  })

  it('interpolates headings across the wrap boundary and keeps zero-length headings finite',()=>{
    const wrap:UnitTrack={unitId:'wrap',frames:[
      {...track.frames[0],time:0,position:[0,0],facing:[Math.sin(3.12),Math.cos(3.12)]},
      {...track.frames[0],time:1,position:[0,0],facing:[Math.sin(-3.12),Math.cos(-3.12)]},
    ]}
    const middle=sampleUnitTrack(wrap,.5)!
    expect(Math.abs(middle.facing[0])).toBeLessThan(.03)
    expect(middle.facing[1]).toBeLessThan(-.99)
    const zero:UnitTrack={unitId:'zero',frames:[{...track.frames[0],position:[1,1],facing:[1,1]},{...track.frames[0],time:1,position:[2,2],facing:[2,2]}]}
    expect(sampleUnitTrack(zero,.5)?.facing.every(Number.isFinite)).toBe(true)
  })

  it('uses visual contact over radar and remembers learned identity in simulated seconds', () => {
    const result = resultWithContacts()
    expect(contactProjectionAt(result, 'red-fighter', .3)).toMatchObject({ level: 'radar', identityKnown: false })
    expect(contactProjectionAt(result, 'red-fighter', .6)).toMatchObject({ level: 'visual', identityKnown: true, visibleSince: .5 })
    expect(contactProjectionAt(result, 'red-fighter', 1.1)).toBeUndefined()
    expect(contactProjectionAt(result, 'red-fighter', 1.5)).toMatchObject({ level: 'radar', identityKnown: true, visibleSince: 1.25 })
  })

  it('retains the incoming heading when a recorded arrival has zero-length facing',()=>{
    const arrival:UnitTrack={unitId:'arrival',frames:[
      {...track.frames[0],time:0,position:[0,0],facing:[1,0]},
      {...track.frames[0],time:1,position:[1,0],facing:[1,0]},
    ]}
    expect(sampleUnitTrack(arrival,.5)?.facing).toEqual([1.5,Math.cos(Math.PI/2)])
  })

  it('fails closed for hostile truth when no current contact exists', () => {
    const result = resultWithContacts()
    expect(projectHostileUnitAt(result, 'red-fighter', .1)).toBeUndefined()
    expect(projectHostileUnitAt(result, 'red-fighter', 1.1)).toBeUndefined()
    expect(projectHostileUnitAt(result, 'red-fighter', 1.5)).toMatchObject({
      visibility: 'radar',
      identityKnown: true,
      frame: { position: [2.5, 5], aircraft: 2 },
    })
    expect(projectFriendlyUnitAt(result, 'red-fighter', 1.1)?.frame.position).toEqual([2.1, 4.2])
    expect(projectHostileUnitAt({ ...result, unitTracks: [] }, 'red-fighter', .5)).toBeUndefined()
  })

  it('splits visible history at hidden gaps and contact-source transitions', () => {
    const segments = visibleTrackSegments(resultWithContacts(), 'red-fighter')
    expect(segments.map(segment => [segment.visibility, segment.identityKnown, segment.frames[0].time, segment.frames.at(-1)?.time])).toEqual([
      ['radar', false, .25, .5],
      ['visual', true, .5, 1],
      ['radar', true, 1.25, 1.75],
    ])
    expect(segments.some((segment, index) => index > 0 && segments[index - 1].frames.at(-1)!.time < segment.frames[0].time)).toBe(true)
  })

  it('builds history from recorded tracks and ignores scripted hostile routes',()=>{
    const result=resultWithContacts()
    result.enemyFlights=[{id:'red-fighter',callsign:'BOGEY 1',role:'fighter',aircraft:4,initialAircraft:4,route:[[100,100],[200,200]],detectionWindows:[],target:'base'}]
    const history=debriefHistoryFor(result)
    const hostile=history.hostile.find(item=>item.unitId==='red-fighter')

    expect(hostile?.segments.map(segment=>[segment.visibility,segment.frames[0].time,segment.frames.at(-1)?.time])).toEqual([
      ['radar',.25,.5],
      ['visual',.5,1],
      ['radar',1.25,1.75],
    ])
    expect(hostile?.segments[0].frames[0].position).toEqual(sampleUnitTrack(track,.25)?.position)
    expect(hostile?.segments[1].frames.at(-1)?.position).toEqual(sampleUnitTrack(track,1)?.position)

    const changedRoute=structuredClone(result)
    changedRoute.enemyFlights[0].route=[[-500,-500],[500,500]]
    changedRoute.enemyFlights[0].detectionWindows=[{start:0,end:1,source:'visual'}]
    expect(debriefHistoryFor(changedRoute).hostile).toEqual(history.hostile)
  })

  it('keeps reaction and parallel-engagement debrief paths on the recorded execution tracks',()=>{
    for(const scenario of ['reaction-interrupt','parallel-engagements','radar-intercept','fob-divert'] as const){
      const state=createScenario(scenario)
      if(scenario==='radar-intercept'){
        const enemyBase=enemyBaseFor(state.world)
        state.playerAssets=state.playerAssets.map(asset=>asset.kind==='radar'?{...asset,position:enemyBase}:asset)
      }
      const result=resolveRound(structuredClone(state))
      const repeated=resolveRound(structuredClone(state))
      const history=debriefHistoryFor(result)
      expect(debriefHistoryFor(repeated)).toEqual(history)

      for(const track of history.friendly){
        expect(track).toEqual(unitTrackFor(result,track.unitId))
        expect(result.executionRoutes[track.unitId]).toEqual(track.frames.map(frame=>frame.position))
      }
      for(const {unitId,segments} of history.hostile){
        const source=unitTrackFor(result,unitId)!
        for(const segment of segments){
          expect(segment.frames.every(frame=>result.contactIntervals.some(interval=>interval.targetId===unitId&&interval.start<=frame.time&&interval.end>=frame.time))).toBe(true)
          const projectedPositions=segment.frames.map(frame=>sampleUnitTrack(source,frame.time)?.position)
          expect(projectedPositions.every(Boolean)).toBe(true)
          expect(projectedPositions).toEqual(segment.frames.map(frame=>frame.position))
        }
      }

      if(scenario==='reaction-interrupt'){
        const dogfight=result.combatSequences.find(sequence=>sequence.kind==='dogfight')!
        const hostile=history.hostile.find(item=>item.unitId==='red-fighter')!
        expect(hostile.segments.some(segment=>segment.frames.some(frame=>frame.time===dogfight.start&&frame.mode==='dogfighting'))).toBe(true)
      }else if(scenario==='parallel-engagements'){
        const dogfights=result.combatSequences.filter(sequence=>sequence.kind==='dogfight')
        expect(dogfights).toHaveLength(2)
        for(const participantId of new Set(dogfights.flatMap(sequence=>sequence.participantIds))){
          const friendlyTrack=history.friendly.find(item=>item.unitId===participantId)
          const hostileTrack=history.hostile.find(item=>item.unitId===participantId)
          expect(Boolean(friendlyTrack||hostileTrack)).toBe(true)
        }
      }else if(scenario==='radar-intercept'){
        expect(result.contactIntervals.some(interval=>interval.source==='radar')).toBe(true)
        expect(history.hostile.length).toBeGreaterThan(0)
      }else{
        expect(result.events.some(event=>event.title==='RECOVERY DIVERSION')).toBe(true)
        expect(history.friendly.some(track=>track.unitId==='viper')).toBe(true)
        expect(result.behaviorIntervals.some(interval=>interval.unitId==='viper'&&interval.reason==='recovery-field-unusable')).toBe(true)
      }
    }
  })

  it('samples the recorded recovery track after recon RTB is ordered during pursuit',()=>{
    const simulation=createRoundSimulation(createScenario('recon-pursuit'))
    while(!simulation.complete&&!simulation.result.events.some(event=>event.title==='RECON UNDER PURSUIT'&&event.detail.includes('RAVEN')))simulation.advance()
    for(let tick=0;tick<5;tick+=1)simulation.advance()
    const command:SimulationCommand={id:'rtb-history',unitId:'raven',type:'rtb',issuedAtTick:simulation.nextTick()}
    simulation.advance([command])
    while(!simulation.complete)simulation.advance()

    const result=simulation.result
    const history=debriefHistoryFor(result)
    const raven=history.friendly.find(item=>item.unitId==='raven')!
    const rtb=result.behaviorIntervals.find(interval=>interval.unitId==='raven'&&interval.reason==='player-rtb')!
    const sampleTime=rtb.start+TICK_SECONDS
    const expected=sampleUnitTrack(unitTrackFor(result,'raven'),sampleTime)
    expect(raven.frames).toEqual(unitTrackFor(result,'raven')?.frames)
    expect(sampleUnitTrack(raven,sampleTime)).toEqual(expected)
  })

  it('projects reaction-interruption positions directly from recorded tracks', () => {
    const result = resolveRound(createScenario('reaction-interrupt'))
    const dogfight = result.combatSequences.find(sequence => sequence.kind === 'dogfight')
    expect(dogfight).toBeDefined()
    const seconds = dogfight!.start
    const friendly = projectFriendlyUnitAt(result, 'viper', seconds)
    const hostile = projectHostileUnitAt(result, 'red-fighter', seconds)
    expect(friendly?.frame).toEqual(sampleUnitTrack(unitTrackFor(result, 'viper'), seconds))
    expect(hostile?.frame).toEqual(sampleUnitTrack(unitTrackFor(result, 'red-fighter'), seconds))
    expect(friendly?.frame.mode).toBe('dogfighting')
    expect(hostile?.frame.mode).toBe('dogfighting')
  })
})
