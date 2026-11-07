import {describe,expect,it} from 'vitest'
import {authorizedWeaponTarget,combatManeuver,combatWindow,headingAngle,sampledBank,weaponPath,weaponTangent,weaponTrail,weaponVisibleAt,weaponVisualLifecycle} from './graphicsPresentation'
import type {UnitTrack,WeaponEffect} from '../game/types'

const effect=(kind:WeaponEffect['kind'],hit=true):WeaponEffect=>({id:`${kind}-${hit}`,kind,sourceId:'blue',targetId:'red',start:1,end:2,from:[0,0],to:[0,10],hit,damage:hit?10:0})

describe('frame-rate graphics math',()=>{
  it('uses both world heading axes and ignores zero-length facing vectors',()=>{
    expect(headingAngle([0,0],[0,1])).toBeCloseTo(0)
    expect(headingAngle([0,0],[0,-1])).toBeCloseTo(Math.PI)
    expect(headingAngle([0,0],[1,1])).toBeCloseTo(Math.PI/4)
    expect(headingAngle([2,2],[2,2],.7)).toBe(.7)
  })

  it('keeps deterministic combat maneuvers bounded and blended at engagement edges',()=>{
    expect(combatManeuver('viper',10,10,20)).toMatchObject({blend:0,x:0,z:0,bank:0,pitch:0})
    const a=combatManeuver('viper',12,10,20),b=combatManeuver('viper',12,10,20)
    expect(a).toEqual(b)
    expect(Math.abs(a.x)).toBeLessThanOrEqual(.19)
    expect(Math.abs(a.z)).toBeLessThanOrEqual(.13)
    expect(Math.abs(a.bank)).toBeLessThanOrEqual(.16)
    expect(combatManeuver('viper',20.55,10,20).blend).toBe(0)
  })

  it('keeps a live combat window open and selects later engagements independently',()=>{
    const frame=(time:number,mode:'following-route'|'dogfighting')=>({time,position:[0,0] as [number,number],facing:[Math.sin(time*.2),Math.cos(time*.2)] as [number,number],mode,strength:100,morale:80,aircraft:4,traveledDistance:0})
    expect(combatWindow([frame(0,'following-route'),frame(1,'dogfighting')],1)).toEqual({start:1,end:Infinity})
    const frames=[frame(0,'following-route'),frame(1,'dogfighting'),frame(2,'following-route'),frame(4,'dogfighting'),frame(5,'following-route')]
    expect(combatWindow(frames,4.2)).toEqual({start:4,end:5})
    expect(combatManeuver('viper',4.99,4,5).blend).toBe(1)
    expect(combatManeuver('viper',5,4,5).blend).toBeCloseTo(1)
    expect(combatManeuver('viper',5.275,4,5).blend).toBeCloseTo(.5)
    expect(combatManeuver('viper',5.55,4,5).blend).toBe(0)
    expect(Math.abs(sampledBank(frames,1.5))).toBeLessThanOrEqual(.18)
  })

  it('gives ground launches and strike launches opposite altitude profiles with misses offset',()=>{
    const sam=effect('sam'),strike=effect('air-to-ground-missile')
    expect(weaponPath(sam,0).height).toBeCloseTo(.12)
    expect(weaponPath(sam,1).height).toBeCloseTo(.76)
    expect(weaponPath(strike,0).height).toBeCloseTo(.76)
    expect(weaponPath(strike,1).height).toBeCloseTo(.1)
    expect(weaponPath(sam,1,[1,9]).position).toEqual([1,9])
    for(const kind of ['gun','air-to-air-missile','air-to-ground-missile','sam','aaa'] as const){
      const miss=weaponPath(effect(kind,false),1)
      expect(miss.position).not.toEqual([0,10])
      expect(weaponPath(effect(kind,true),1).position).toEqual([0,10])
    }
    for(const kind of ['gun','air-to-air-missile','air-to-ground-missile','sam','aaa'] as const){
      const tangent=weaponTangent(effect(kind),.5)[1],trailDeltaY=weaponTrail(effect(kind),.8)[0][1]
      if(kind==='sam'||kind==='aaa'){expect(tangent).toBeGreaterThan(0);expect(trailDeltaY).toBeLessThan(0)}
      else if(kind==='air-to-ground-missile'){expect(tangent).toBeLessThan(0);expect(trailDeltaY).toBeGreaterThan(0)}
      else {expect(tangent).toBeCloseTo(0);expect(trailDeltaY).toBeCloseTo(0)}
    }
    expect(weaponVisibleAt(effect('gun'),1.5)).toBe(true)
    expect(weaponVisibleAt(effect('gun'),2.4)).toBe(false)
  })

  it('gates impact flashes to the exact impact lifecycle and never flashes misses',()=>{
    const strike=effect('air-to-ground-missile')
    expect(weaponVisualLifecycle(strike,1.999).impactFlashVisible).toBe(false)
    expect(weaponVisualLifecycle(strike,2).impactFlashVisible).toBe(true)
    expect(weaponVisualLifecycle(strike,2.1).impactFlashVisible).toBe(true)
    expect(weaponVisualLifecycle(strike,2.25).impactFlashVisible).toBe(false)
    for(const kind of ['gun','air-to-air-missile','air-to-ground-missile','sam','aaa'] as const){
      expect(weaponVisualLifecycle(effect(kind,false),2).impactFlashVisible).toBe(false)
    }
    const gun={...effect('gun'),start:2,end:2}
    expect(weaponVisualLifecycle(gun,1.999).trailVisible).toBe(false)
    expect(weaponVisualLifecycle(gun,2).trailVisible).toBe(true)
    expect(weaponVisualLifecycle(gun,2.17).burstVisible).toBe(true)
    expect(weaponVisualLifecycle(gun,2.18).burstVisible).toBe(false)
    expect(weaponVisualLifecycle(gun,2.23).impactFlashVisible).toBe(true)
  })

  it('uses only authorized target tracks and never samples past contact start or impact time',()=>{
    const track:UnitTrack={unitId:'red-target',frames:[
      {time:0,position:[0,0],facing:[0,1],mode:'following-route',strength:100,morale:80,aircraft:4,traveledDistance:0},
      {time:2,position:[2,4],facing:[2,5],mode:'following-route',strength:100,morale:80,aircraft:4,traveledDistance:0},
      {time:3,position:[3,6],facing:[3,7],mode:'following-route',strength:100,morale:80,aircraft:4,traveledDistance:0},
    ]}
    const sam=effect('sam')
    expect(authorizedWeaponTarget(sam,3,3,track,undefined,true)).toEqual([2,4])
    expect(authorizedWeaponTarget(sam,3,3,track,2.1,true)).toEqual(sam.to)
    expect(authorizedWeaponTarget(sam,3,3,track,undefined,false)).toEqual(sam.to)
  })
})
