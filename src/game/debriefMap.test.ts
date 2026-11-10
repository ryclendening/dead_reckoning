import { describe, expect, it } from 'vitest'
import { debriefMapEvents, debriefMapSites } from './debriefMap'
import { resolveRound } from './engine'
import { createScenario } from './scenarios'
import type { RoundResult, UnitFrame } from './types'

const frame=(time:number,aircraft:number,position:[number,number],mode:UnitFrame['mode']='following-route'):UnitFrame=>({time,aircraft,position,mode,facing:[1,1],strength:aircraft*25,morale:70,traveledDistance:time})
const quiet=():RoundResult=>({...resolveRound(createScenario('fighter-duel')),combatSequences:[],unitTracks:[],friendlyAttrition:[],enemyAttrition:[],intelReports:[]})

describe('after-action event map',()=>{
  it('reports recorded encounters rather than routine events and planned paths',()=>{
    const result=resolveRound(createScenario('fighter-duel'))
    const events=debriefMapEvents(result)
    expect(events.some(event=>event.kind==='dogfight')).toBe(true)
    expect(debriefMapEvents({...result,events:[],executionRoutes:{},enemyFlights:result.enemyFlights.map(f=>({...f,route:[[999,999]]}))})).toEqual(events)
    expect(events.every(event=>event.position.every(Number.isFinite))).toBe(true)
  })
  it('anchors reconciled dogfight losses to the last resolved hit, not the recovery position',()=>{
    const result=quiet(),id=result.squadrons[0].id
    result.friendlyAttrition=[{id,callsign:'VIPER',role:'fighter',startAircraft:4,endAircraft:2,aircraftLost:2,endStrength:50,finalStatus:'damaged',destroyed:false,confirmed:true}]
    result.unitTracks=[{unitId:id,frames:[frame(0,4,[0,0]),frame(2,4,[3,3],'dogfighting'),frame(3,4,[3,3],'dogfighting'),frame(5,2,[8,8],'recovering')]}]
    result.combatSequences=[{id:'combat',kind:'pursuit',start:1,end:4,location:[3,3],participantIds:[id,'enemy'],finalDisposition:{},exchanges:[{id:'hit',time:2,attackerId:'enemy',defenderId:id,weapon:'gun',hit:true,damage:50,moraleDamage:0,position:[3,3],targetStrength:50,targetMorale:70}]}]
    expect(debriefMapEvents(result).find(event=>event.kind==='loss')).toMatchObject({position:[3,3],time:2,count:2,side:'friendly'})
  })
  it('never places a confirmed enemy aggregate loss at an unseen crash location',()=>{
    const result=quiet(),id=result.enemyFlights[0].id
    result.enemyAttrition=[{id,callsign:'SECRET',role:'fighter',startAircraft:4,endAircraft:0,aircraftLost:4,endStrength:0,finalStatus:'destroyed',destroyed:true,confirmed:true}]
    result.unitTracks=[{unitId:id,frames:[frame(0,4,[0,0]),frame(5,0,[99,99],'destroyed')]}]
    result.contactIntervals=[]
    expect(debriefMapEvents(result)).toEqual([])
  })
  it('distinguishes fuel losses and keeps nearby reports in a shared numbered site',()=>{
    const result=quiet(),id=result.squadrons[0].id
    result.friendlyAttrition=[{id,callsign:'VIPER',role:'fighter',startAircraft:4,endAircraft:0,aircraftLost:4,endStrength:0,finalStatus:'destroyed',destroyed:true,confirmed:true}]
    result.unitTracks=[{unitId:id,frames:[frame(1,4,[1,1],'stranded'),frame(2,0,[1,1],'destroyed')]}]
    const asset=result.assets[0];asset.position=[1.1,1.1]
    result.intelReports=[{id:'a',assetId:asset.id,observerId:id,recovered:true,confidence:100,detail:'report'},{id:'b',assetId:asset.id,observerId:id,recovered:true,confidence:100,detail:'duplicate'}]
    const sites=debriefMapSites(result)
    expect(sites).toHaveLength(1)
    expect(sites[0].events).toHaveLength(2)
    expect(sites[0].events[0].detail).toContain('FUEL EXHAUSTED')
    expect(sites[0].number).toBe(1)
  })
  it('does not reveal enemy-only combat',()=>{
    const result=quiet()
    result.combatSequences=[{id:'hidden',kind:'pursuit',start:1,end:2,location:[99,99],participantIds:['secret-a','secret-b'],exchanges:[],finalDisposition:{}}]
    expect(debriefMapEvents(result)).toEqual([])
  })
})
