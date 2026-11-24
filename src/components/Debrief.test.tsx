import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Debrief } from '../App'
import { createMatch } from '../game/data'
import { debriefMapSites } from '../game/debriefMap'
import { resolveRound } from '../game/engine'

describe('mission debrief surface',()=>{
  it('shows home base damage before losses, payouts, and round highlights',()=>{
    const match=createMatch()
    const result=resolveRound(match)
    const view={...match,phase:'debrief' as const,playerBaseHealth:20,lastResult:{...result,baseDamage:80}}
    const markup=renderToStaticMarkup(<Debrief match={view} onFocus={()=>{}} onResupply={()=>{}}/>)

    expect(markup).toContain('Home base <b>100 → 20 HP</b>')
    expect(markup.indexOf('100 → 20 HP')).toBeLessThan(markup.indexOf('Friendly lost'))
    expect(markup.indexOf('100 → 20 HP')).toBeLessThan(markup.indexOf('Round payout'))
    expect(markup.indexOf('100 → 20 HP')).toBeLessThan(markup.indexOf('Round events'))
  })

  it('shows strike purpose and concrete launch failure beside the existing summary',()=>{
    const match=createMatch(),fighter=match.squadrons.find(squadron=>squadron.role==='fighter')!
    match.squadrons=match.squadrons.map(squadron=>squadron.id===fighter.id?{...squadron,mission:'base-strike',sortieOrdered:true}:{...squadron,sortieOrdered:false})
    const result=resolveRound(match)
    const view={...match,phase:'debrief' as const,lastResult:{...result,logisticsIncome:{base:8,intel:2,enemyAircraft:1,total:11}},squadrons:result.squadrons}
    const site=debriefMapSites(result)[0]
    const event=site.events[0]
    const markup=renderToStaticMarkup(<Debrief match={view} focusedEvent={event.id} onFocus={()=>{}} onResupply={()=>{}}/>)

    expect(markup).toContain('+$110M')
    expect(markup).toContain('<dt>Round pay</dt><dd>+$80M</dd>')
    expect(markup).toContain('Recovered intel <small>$20M per new site</small></dt><dd>+$20M</dd>')
    expect(markup).toContain('Confirmed enemy losses <small>$10M per aircraft</small></dt><dd>+$10M</dd>')
    expect(markup).not.toContain('After action views')
    expect(markup).toContain('Round events')
    expect(markup).toContain(`class="debrief-site ${event.side}" aria-pressed="true"`)
    expect(markup).toContain(`<time dateTime="PT${event.time.toFixed(1)}S">${event.time.toFixed(1)}s</time>`)
    expect(markup).toContain(`<span>Site ${site.number}</span>`)
    expect(markup).toContain('>Orders</summary>')
    expect(markup).toContain('STRIKE UNSELECTED GROUND TARGET')
    expect(markup).toContain('SELECT A CONFIRMED GROUND TARGET')
  })
})
