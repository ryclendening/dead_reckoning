import {describe,expect,it} from 'vitest'
import {contactTracksAt} from './contactTracks'
import {contactProjectionAt,projectHostileUnitAt} from './executionProjection'
import {resolveRound} from './engine'
import {createScenario} from './scenarios'
import type {RoundResult} from './types'

function contacts():RoundResult{
  const result=resolveRound(createScenario('fob-trapped'))
  result.duration=4
  result.enemyFlights=[{id:'red-one',callsign:'SECRET CALLSIGN',role:'fighter',aircraft:4,initialAircraft:4,route:[[10,0],[6,0]],detectionWindows:[],target:'base'},
    {id:'red-hidden',callsign:'HIDDEN',role:'recon',aircraft:2,initialAircraft:2,route:[[20,0],[16,0]],detectionWindows:[],target:'base'}]
  result.unitTracks=[{unitId:'red-one',frames:[0,.5,1,1.25,1.5,2,2.5,3,4].map(time=>({time,position:[10-time,0],facing:[9-time,0],mode:'following-route',strength:100-time*10,morale:70,aircraft:4,traveledDistance:time}))}]
  result.contactIntervals=[
    {id:'ground',observerId:'p-radar',targetId:'red-one',source:'radar',start:.5,end:1.5,position:[9.5,0]},
    {id:'receiver',observerId:'viper',targetId:'red-one',source:'radar',start:.5,end:1.5,position:[9.5,0]},
    {id:'visual',observerId:'raven',targetId:'red-one',source:'visual',start:1,end:1.25,position:[9,0]},
    {id:'reacquired',observerId:'p-radar',targetId:'red-one',source:'radar',start:2,end:2.5,position:[8,0]},
    {id:'later',observerId:'p-radar',targetId:'red-hidden',source:'radar',start:3,end:4,position:[17,0]},
  ]
  return result
}

describe('enemy contact knowledge',()=>{
  it('numbers only acquired formations and deduplicates sensors and fighter receipts',()=>{
    const result=contacts()
    expect(contactTracksAt(result,.4,[0,0])).toEqual([])
    expect(contactTracksAt(result,.5,[0,0])[0].course).toBe('COURSE UNKNOWN')
    const tracks=contactTracksAt(result,.75,[0,0])
    expect(tracks).toHaveLength(1)
    expect(tracks[0]).toMatchObject({trackId:'TRACK 01',identification:'UNKNOWN AIRCRAFT',visibility:'radar',course:'INBOUND'})
    expect(tracks[0].aircraft).toBeUndefined()
    expect(tracks[0].callsign).toBeUndefined()
    expect(contactProjectionAt(result,'red-one',.75)?.trackId).toBe('TRACK 01')
    expect(projectHostileUnitAt(result,'red-hidden',.75)).toBeUndefined()
    expect(contactProjectionAt(result,'red-hidden',3)?.trackId).toBe('TRACK 02')
  })

  it('reveals type and count only when authorized, retaining identity on radar reacquisition',()=>{
    const result=contacts()
    expect(contactTracksAt(result,1.1,[0,0])[0]).toMatchObject({trackId:'TRACK 01',identification:'MiG-23 · FIGHTER',visibility:'visual',aircraft:4})
    const reacquired=contactTracksAt(result,2.1,[0,0])[0]
    expect(reacquired).toMatchObject({trackId:'TRACK 01',identification:'MiG-23 · FIGHTER',visibility:'radar'})
    expect(reacquired.aircraft).toBeUndefined()
    expect(contactTracksAt(result,.75,[0,0])[0].identification).toBe('UNKNOWN AIRCRAFT')
  })

  it('freezes lost-contact reports at the last detected pose and ignores hidden live changes',()=>{
    const result=contacts()
    const lost=contactTracksAt(result,1.8,[0,0])[0]
    expect(lost).toMatchObject({visibility:'lost',lastSeen:1.5,position:[8.5,0],identification:'MiG-23 · FIGHTER'})
    expect(projectHostileUnitAt(result,'red-one',1.8)).toBeUndefined()
    for(const frame of result.unitTracks[0].frames.filter(frame=>frame.time>1.5)){frame.position=[999,999];frame.aircraft=0;frame.strength=0}
    expect(contactTracksAt(result,1.8,[0,0])[0]).toEqual(lost)
  })
})
