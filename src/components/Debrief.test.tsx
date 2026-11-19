import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Debrief } from '../App'
import { createMatch } from '../game/data'
import { resolveRound } from '../game/engine'

describe('mission debrief surface',()=>{
  it('shows home base damage before losses, payouts, and round highlights',()=>{
    const match=createMatch()
    const result=resolveRound(match)
    const view={...match,phase:'debrief' as const,playerBaseHealth:20,lastResult:{...result,baseDamage:80}}
    const markup=renderToStaticMarkup(<Debrief match={view} onFocus={()=>{}} onResupply={()=>{}}/>)

    expect(markup).toContain('HOME BASE <b>100 → 20 HP</b>')
    expect(markup.indexOf('100 → 20 HP')).toBeLessThan(markup.indexOf('FRIENDLY LOST'))
    expect(markup.indexOf('100 → 20 HP')).toBeLessThan(markup.indexOf('Cash earned this round'))
    expect(markup.indexOf('100 → 20 HP')).toBeLessThan(markup.indexOf('Round highlights'))
  })

  it('shows strike purpose and concrete launch failure beside the existing summary',()=>{
    const match=createMatch(),fighter=match.squadrons.find(squadron=>squadron.role==='fighter')!
    match.squadrons=match.squadrons.map(squadron=>squadron.id===fighter.id?{...squadron,mission:'base-strike',sortieOrdered:true}:{...squadron,sortieOrdered:false})
    const result=resolveRound(match)
    const view={...match,phase:'debrief' as const,lastResult:{...result,logisticsIncome:{base:8,intel:2,enemyAircraft:1,total:11}},squadrons:result.squadrons}
    const markup=renderToStaticMarkup(<Debrief match={view} onFocus={()=>{}} onResupply={()=>{}}/>)

    expect(markup).toContain('+$110M')
    expect(markup).toContain('<dt>Round pay</dt><dd>+$80M</dd>')
    expect(markup).toContain('Recovered intel <small>$20M per new site</small></dt><dd>+$20M</dd>')
    expect(markup).toContain('Confirmed enemy losses <small>$10M per aircraft</small></dt><dd>+$10M</dd>')
    expect(markup).toContain('Round map key')
    expect(markup).toContain('Round highlights')
    expect(markup).toContain('debrief-symbol')
    expect(markup).toContain('Orders &amp; Results')
    expect(markup).toContain('STRIKE UNSELECTED GROUND TARGET')
    expect(markup).toContain('SELECT A CONFIRMED GROUND TARGET')
  })
})
