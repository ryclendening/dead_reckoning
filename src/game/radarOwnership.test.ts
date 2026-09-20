import {describe,expect,it} from 'vitest'
import {createMatch} from './data'
import {resolveRound} from './engine'
import type {Point} from './types'

describe('radar ownership',()=>{
  it('does not turn hostile radar coverage into friendly comms or a recon radar abort',()=>{
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
    expect(result.radarTrackReceipts.some(receipt=>receipt.receiverId==='raven')).toBe(false)
    expect(result.behaviorIntervals.some(interval=>interval.unitId==='raven'&&interval.reason==='persistent-radar-threat')).toBe(false)
  })
})
