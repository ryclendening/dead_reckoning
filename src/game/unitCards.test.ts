import { describe, expect, it } from 'vitest'
import { createMatch } from './data'
import { resolveRound } from './engine'
import { aircraftCardData, aircraftInspectionAt, assetCardData, usesCompactUnitCards } from './unitCards'
import type { Asset, EnemyFlight, UnitFrame } from './types'

const frame:UnitFrame={time:2,position:[0,0],facing:[1,0],mode:'intercepting',strength:62,morale:70,aircraft:3,traveledDistance:2}
const hostile:EnemyFlight={id:'red-fighter',callsign:'BOGEY 1',role:'fighter',aircraft:4,initialAircraft:4,route:[[0,0],[1,0]],detectionWindows:[],target:'base'}

describe('shared tactical unit cards',()=>{
  it.each(['base','fob','radar','sam','aaa','decoy'] as const)('uses health over maximum and a condition for every %s',kind=>{
    const asset:Asset={id:kind,kind,name:'ALPHA',position:[0,0],health:40,maxHealth:65,intel:'confirmed',confidence:100,hidden:false,struck:false}
    const data=assetCardData(asset)!
    expect(data).toMatchObject({title:'ALPHA',health:40,maxHealth:65})
    expect(data.subtitle).toContain('FRIENDLY')
    if(kind!=='sam')expect(data.status).toBe('DAMAGED')
    expect(assetCardData({...asset,health:0})?.status).toBe('DESTROYED')
    expect(assetCardData({...asset,operational:false})?.status).toBe('OFFLINE')
  })

  it('does not generate an enemy card until the site is authorized by intelligence or observation',()=>{
    const asset=createMatch().enemyAssets.find(asset=>asset.kind==='sam')!
    expect(assetCardData(asset,true)).toBeUndefined()
    expect(assetCardData({...asset,intel:'confirmed'},true)).toBeUndefined()
    expect(assetCardData({...asset,intel:'probable',hidden:false},true)?.detail).toContain('PROBABLE INTELLIGENCE')
  })

  it('reports aircraft count, role, and activity from the current frame instead of the initial flight',()=>{
    const friendly=createMatch().squadrons[0]
    expect(aircraftCardData(friendly,frame,'friendly')).toMatchObject({title:friendly.callsign,subtitle:'FIGHTER · 3 / 4 AC',health:62,status:'INTERCEPT'})
    expect(aircraftCardData(hostile,{...frame,mode:'dogfighting'},'visual','TRACK 01')).toMatchObject({title:'BOGEY 1',subtitle:'TRACK 01 · MiG-23 · 3 AC',health:62,status:'DOGFIGHT'})
    expect(aircraftCardData(hostile,frame,'radar','TRACK 01')).toBeUndefined()
    expect(aircraftCardData(friendly,{...frame,strength:0,aircraft:0,mode:'destroyed'},'friendly')).toMatchObject({health:0,status:'DESTROYED'})
  })

  it('uses the minimal label layout on portrait and landscape phones',()=>{
    expect(usesCompactUnitCards(390,844)).toBe(true)
    expect(usesCompactUnitCards(844,390)).toBe(true)
    expect(usesCompactUnitCards(1440,1000)).toBe(false)
    const sam=createMatch().playerAssets.find(asset=>asset.kind==='sam')!
    expect(assetCardData(sam)?.mapLabel).toBe('SAM')
    expect(assetCardData({...sam,name:'SAM ALPHA'})?.mapLabel).toBe('SAM ALPHA')
  })

  it('closes hostile details when visual contact ends even if radar still knows the identity',()=>{
    const state=createMatch(),result=resolveRound(state)
    result.enemyFlights=[hostile]
    result.unitTracks=[{unitId:hostile.id,frames:[{...frame,time:0},{...frame,time:5}]}]
    result.contactIntervals=[{id:'visual',observerId:'viper',targetId:hostile.id,source:'visual',start:0,end:2,position:[0,0]},{id:'radar',observerId:'p-radar',targetId:hostile.id,source:'radar',start:0,end:4,position:[0,0]}]
    expect(aircraftInspectionAt(result,hostile.id,1)).toMatchObject({flight:{id:hostile.id},visibility:'visual'})
    expect(aircraftInspectionAt(result,hostile.id,3)).toBeUndefined()
    expect(aircraftInspectionAt(result,hostile.id,5)).toBeUndefined()
    expect(aircraftInspectionAt(result,'missing',1)).toBeUndefined()
  })
})
