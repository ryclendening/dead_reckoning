import { describe, expect, it } from 'vitest'
import { createMatch } from './data'
import { resolveRound } from './engine'
import { projectGroundAssetAt } from './executionProjection'
import type { CombatSequence } from './types'

describe('ground target impact presentation',()=>{
  it('changes health only at each resolved impact, without exposing a later strike',()=>{
    const state=createMatch(),asset={...state.enemyAssets.find(asset=>asset.kind==='sam')!,health:100},result=resolveRound(state)
    const sequence=(id:string,time:number,damage:number):CombatSequence=>({id,kind:'strike',participantIds:['viper',asset.id],location:asset.position,start:time-.6,end:time,exchanges:[{id,time,attackerId:'viper',defenderId:asset.id,weapon:'air-to-ground-missile',damage,moraleDamage:0,hit:true,position:asset.position,targetStrength:0,targetMorale:0}],finalDisposition:{viper:'enroute'}})
    result.combatSequences=[sequence('first',2,60),sequence('second',5,40)]
    result.assets=result.assets.map(item=>item.id===asset.id?{...item,health:0}:item)
    expect(projectGroundAssetAt(asset,result,1.99).health).toBe(100)
    expect(projectGroundAssetAt(asset,result,2)).toMatchObject({health:40,struck:true})
    expect(projectGroundAssetAt(asset,result,4.99).health).toBe(40)
    expect(projectGroundAssetAt(asset,result,5).health).toBe(0)
  })
})
