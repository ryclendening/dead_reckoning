import { Children, isValidElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AircraftInspector, AssetInspector } from './UnitInspector'
import { planGroundStrike } from '../game/groundStrikePlanning'
import { createMatch } from '../game/data'
import type { EnemyFlight, UnitFrame } from '../game/types'

const noop=()=>{}
const frame:UnitFrame={time:2,position:[0,0],facing:[1,0],mode:'recovering',strength:62,morale:70,aircraft:3,traveledDistance:2}

describe('expanded tactical cards',()=>{
  it('shows the same identity, health, and status layout for a selected ground site',()=>{
    const asset={...createMatch().playerAssets.find(asset=>asset.kind==='radar')!,name:'WATCH',health:40}
    const html=renderToStaticMarkup(<AssetInspector asset={asset} phase="adapt" seconds={0} onClose={noop}/>)
    expect(html).toContain('WATCH')
    expect(html).toContain('RADAR SITE')
    expect(html).toContain('40 / 100')
    expect(html).toContain('DAMAGED')
    expect(html).toContain('DETECTION RANGE 6.4')
    expect(html).not.toContain('MISSILES')
  })

  it('assigns Ground Strike from the clicked site details, without the task menu',()=>{
    const state=createMatch(),fighter=state.squadrons[0]
    const asset={...state.enemyAssets.find(asset=>asset.id==='e-sam')!,intel:'confirmed' as const,hidden:false}
    state.enemyAssets=state.enemyAssets.map(item=>item.id===asset.id?asset:item)
    let assigned:ReturnType<typeof planGroundStrike>
    const props={asset,enemy:true,phase:'plan' as const,seconds:0,onClose:noop,groundStrikeAction:{callsign:fighter.callsign,onSelect:()=>{assigned=planGroundStrike(state,fighter.id,asset.id)}}}
    const element=AssetInspector(props)!
    const action=Children.toArray(element.props.children).find(child=>isValidElement(child)&&child.type==='button')
    expect(isValidElement(action)).toBe(true)
    if(!isValidElement<{onClick:()=>void}>(action))throw new Error('Missing site strike action')
    action.props.onClick()
    expect(assigned).toMatchObject({mission:'base-strike',strikeTargetId:asset.id})
    expect(renderToStaticMarkup(<AssetInspector {...props}/>)).toContain(`GROUND STRIKE · ${fighter.callsign}`)
    expect(renderToStaticMarkup(<AssetInspector {...props} phase="execute"/>)).not.toContain('ground-strike-action')
    expect(renderToStaticMarkup(<AssetInspector {...props} enemy={false}/>)).not.toContain('ground-strike-action')
    expect(renderToStaticMarkup(<AssetInspector {...props} groundStrikeAction={{...props.groundStrikeAction,disabledReason:'OUT OF RANGE'}}/>)).toContain('disabled=""')
  })

  it('keeps friendly aircraft count, activity, and morale in the selected card',()=>{
    const flight=createMatch().squadrons[0]
    const html=renderToStaticMarkup(<AircraftInspector flight={flight} frame={frame} visibility="friendly" onClose={noop}/>)
    expect(html).toContain(flight.callsign)
    expect(html).toContain('FIGHTER · 3 / 4 AC')
    expect(html).toContain('62 / 100')
    expect(html).toContain('RTB')
    expect(html).toContain('MORALE')
  })

  it('does not render a radar-only health card or hidden ground-site details',()=>{
    const flight:EnemyFlight={id:'red-fighter',callsign:'BOGEY 1',role:'fighter',aircraft:4,initialAircraft:4,route:[[0,0],[1,0]],detectionWindows:[],target:'base'}
    expect(renderToStaticMarkup(<AircraftInspector flight={flight} frame={frame} visibility="radar" onClose={noop}/>)).toBe('')
    const visual=renderToStaticMarkup(<AircraftInspector flight={flight} frame={frame} visibility="visual" trackId="TRACK 01" onClose={noop}/>)
    expect(visual).toContain('TRACK 01 · MiG-23 · 3 AC')
    expect(visual).toContain('hostile')
    expect(visual).not.toContain('MORALE')
    const hidden=createMatch().enemyAssets[0]
    expect(renderToStaticMarkup(<AssetInspector asset={hidden} enemy phase="execute" seconds={2} onClose={noop}/>)).toBe('')
  })
})
