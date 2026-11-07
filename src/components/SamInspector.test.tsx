import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SamInspector } from './SamInspector'
import { CommandShelf } from './Hud'
import { createMatch } from '../game/data'
import { resolveRound } from '../game/engine'
import type { WeaponEffect } from '../game/types'

const noop=()=>{}

describe('SAM and ground strike controls',()=>{
  it('shows health, all three missiles before launch, cooldown after launch, and an empty rack after three shots',()=>{
    const state=createMatch(),asset=state.playerAssets.find(asset=>asset.kind==='sam')!,result=resolveRound(state)
    result.weaponEffects=[]
    let html=renderToStaticMarkup(<SamInspector asset={asset} result={result} seconds={0} onClose={noop}/>)
    expect(html).toContain('3 / 3')
    expect(html).toContain('100 / 100')
    expect(html).toContain('READY TO FIRE')
    const shot:WeaponEffect={id:'sam-1',kind:'sam',sourceId:asset.id,targetId:'red-fighter',start:2,end:3.05,from:asset.position,to:[0,0],hit:false,damage:0}
    result.weaponEffects=[shot]
    html=renderToStaticMarkup(<SamInspector asset={{...asset,health:40}} result={result} seconds={2.5} onClose={noop}/>)
    expect(html).toContain('2 / 3')
    expect(html).toContain('READY IN 2.5s')
    expect(html).toContain('40 / 100')
    result.weaponEffects=[shot,{...shot,id:'sam-2',start:5},{...shot,id:'sam-3',start:8}]
    html=renderToStaticMarkup(<SamInspector asset={asset} result={result} seconds={8} onClose={noop}/>)
    expect(html).toContain('0 / 3')
    expect(html).toContain('EMPTY · RELOADS NEXT ROUND')
    html=renderToStaticMarkup(<SamInspector asset={{...asset,health:0}} result={result} seconds={8} onClose={noop}/>)
    expect(html).toContain('DESTROYED')
  })

  it('shows an explicit site selection step followed by fixed-anchor route instructions',()=>{
    const state=createMatch(),squadron={...state.squadrons[0],mission:'base-strike' as const,strikeTargetId:'e-sam'}
    const target={...state.enemyAssets.find(asset=>asset.id==='e-sam')!,name:'SAM ALPHA',intel:'confirmed' as const,hidden:false}
    const props={squadrons:state.squadrons,bases:state.playerAssets,activeBaseId:'p-base',rosterMode:'closed' as const,squadron,routeDistance:12,maxDistance:40,onSelect:noop,onBaseSelect:noop,onRosterMode:noop,onMission:noop,onClear:noop,onCommit:noop,onClose:noop,reviewedIds:new Set<string>(),reviewedCount:0,totalCount:3,groundTargets:[target],onGroundTarget:noop,onChangeGroundTarget:noop}
    const choose=renderToStaticMarkup(<CommandShelf {...props} step="target"/>)
    expect(choose).toContain('CHOOSE GROUND TARGET')
    expect(choose).toContain('SAM ALPHA')
    expect(choose).toContain('Select a confirmed site here or on the map.')
    const route=renderToStaticMarkup(<CommandShelf {...props} step="route"/>)
    expect(route).toContain('Takeoff and strike points are fixed.')
    expect(route).toContain('CLEAR WAYPOINTS')
    expect(route).toContain('CHANGE TARGET')
    expect(route).toContain('SAM ALPHA')
  })
})
