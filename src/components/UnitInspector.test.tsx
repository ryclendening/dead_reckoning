import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AircraftInspector, AssetInspector } from './UnitInspector'
import { createMatch } from '../game/data'
import type { EnemyFlight, UnitFrame } from '../game/types'

const noop=()=>{}
const frame:UnitFrame={time:2,position:[0,0],facing:[1,0],mode:'recovering',strength:62,morale:70,aircraft:3,traveledDistance:2}

describe('expanded tactical cards',()=>{
  it('shows a compact status card for a selected ground site',()=>{
    const asset={...createMatch().playerAssets.find(asset=>asset.kind==='radar')!,name:'WATCH',health:40}
    const html=renderToStaticMarkup(<AssetInspector asset={asset} phase="adapt" seconds={0} onClose={noop}/>)
    expect(html).toContain('WATCH')
    expect(html).toContain('class="site-readout"')
    expect(html).toContain('40/100 HP')
    expect(html).toContain('Scan 6.4')
    expect(html).not.toContain('unit-inspector')
    expect(html).not.toContain('MISSILES')
  })

  it('keeps site details informational instead of providing another strike-order entry point',()=>{
    const asset={...createMatch().enemyAssets.find(asset=>asset.id==='e-sam')!,intel:'confirmed' as const,hidden:false}
    const html=renderToStaticMarkup(<AssetInspector asset={asset} enemy phase="plan" seconds={0} onClose={noop}/>)
    expect(html).toContain('SAM SITE')
    expect(html).not.toContain('ground-strike-action')
    expect(html).not.toContain('GROUND STRIKE')
  })

  it('requires a recovered pod measurement and displays its dated range', () => {
    const asset={...createMatch().enemyAssets.find(asset=>asset.kind==='aaa')!,intel:'confirmed' as const,hidden:false}
    const render=(report: NonNullable<typeof asset.defenseSurvey>) =>
      renderToStaticMarkup(<AssetInspector asset={{...asset,defenseSurvey:report}} enemy phase="plan" seconds={0} onClose={noop}/>)
    expect(render({round:2,upgrades:['aaa-range']})).toContain('Survey Pod required for range')
    expect(render({round:3,upgrades:[],range:2.85})).toContain('Range 2.85 · Surveyed R3')
  })

  it('shows the current range and whether it is radar linked',()=>{
    const assets=createMatch().playerAssets
    const aaa={...assets.find(asset=>asset.kind==='aaa')!,position:[0,0] as [number,number]}
    const radar={...assets.find(asset=>asset.kind==='radar')!,position:[1,0] as [number,number],name:'WATCH'}
    const render=(health:number)=>renderToStaticMarkup(<AssetInspector asset={aaa} sites={[aaa,{...radar,health}]} phase="execute" seconds={0} onClose={noop}/>)
    expect(render(100)).toContain('Range 2.85 · Radar linked')
    expect(render(0)).toContain('Range 1.9')
  })

  it('shows both missile inventory and radar guidance for a linked SAM',()=>{
    const assets=createMatch().playerAssets
    const sam={...assets.find(asset=>asset.kind==='sam')!,position:[0,0] as [number,number]}
    const radar={...assets.find(asset=>asset.kind==='radar')!,position:[5,0] as [number,number],name:'WATCH'}
    const html=renderToStaticMarkup(<AssetInspector asset={sam} sites={[sam,radar]} phase="plan" seconds={0} onClose={noop}/>)
    expect(html).toContain('3/3 missiles · Radar guided')
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
