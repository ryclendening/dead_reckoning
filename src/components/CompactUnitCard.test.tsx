import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CompactUnitCard } from './CompactUnitCard'
import { aircraftCardData, assetCardData, usesCompactUnitCards } from '../game/unitCards'
import { createMatch } from '../game/data'
import type { UnitFrame } from '../game/types'

const noop=()=>{}

describe('phone unit labels',()=>{
  it('uses short ground labels, a missile count, and a health bar while retaining full accessible details',()=>{
    const asset={...createMatch().playerAssets.find(asset=>asset.kind==='sam')!,health:40}
    const data=assetCardData(asset)!
    const html=renderToStaticMarkup(<CompactUnitCard data={data} color="#55d6df" onSelect={noop}/>)
    expect(html).toContain('<b>SAM</b>')
    expect(html).toContain('<span>3/3</span>')
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-valuenow="40"')
    expect(html).toContain('aria-label="SAM SITE, SAM SITE · FRIENDLY, 40 / 100 health, 3/3 MSL · READY"')
    // These details remain in the accessible name and expanded inspector, not additional visible rows.
    expect(html).not.toContain('>40 / 100<')
    expect(html).not.toContain('>SAM SITE · FRIENDLY<')
    expect(html).not.toContain('>3/3 MSL · READY<')
  })

  it('retains the authoritative aircraft count without the long role/status row',()=>{
    const flight=createMatch().squadrons[0],frame:UnitFrame={time:1,position:[0,0],facing:[1,0],mode:'intercepting',strength:62,morale:70,aircraft:3,traveledDistance:2}
    const data=aircraftCardData(flight,frame,'friendly')!
    const html=renderToStaticMarkup(<CompactUnitCard data={data} color="#55d6df" onSelect={noop}/>)
    expect(html).toContain(`<b>${flight.callsign}</b>`)
    expect(html).toContain('<span>3 AC</span>')
    expect(html).not.toContain('>INTERCEPT<')
    expect(html).not.toContain('>FIGHTER · 3 / 4 AC<')
  })

  it('preserves direct tap-to-strike and selected-target cues in the compact card',()=>{
    let selected=false,stopped=false
    const data=assetCardData(createMatch().playerAssets.find(asset=>asset.kind==='sam')!)!
    const element=CompactUnitCard({data,color:'#55d6df',actionLabel:'CLICK TO STRIKE',onSelect:()=>{selected=true}})
    element.props.onClick({stopPropagation:()=>{stopped=true}})
    expect(selected).toBe(true)
    expect(stopped).toBe(true)
    expect(renderToStaticMarkup(element)).toContain('<span>STRIKE</span>')
    expect(renderToStaticMarkup(<CompactUnitCard data={data} color="#55d6df" actionLabel="STRIKE TARGET ASSIGNED" selected onSelect={noop}/>)).toContain('<span>✓</span>')
  })

  it('adapts to portrait and landscape phones while retaining detailed cards on larger canvases',()=>{
    expect(usesCompactUnitCards(390,844)).toBe(true)
    expect(usesCompactUnitCards(844,390)).toBe(true)
    expect(usesCompactUnitCards(375,667)).toBe(true)
    expect(usesCompactUnitCards(768,1024)).toBe(false)
    expect(usesCompactUnitCards(1440,1000)).toBe(false)
  })
})
