import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Debrief } from '../App'
import { createMatch } from '../game/data'
import { resolveRound } from '../game/engine'

describe('mission debrief surface',()=>{
  it('shows strike purpose and concrete launch failure beside the existing summary',()=>{
    const match=createMatch(),fighter=match.squadrons.find(squadron=>squadron.role==='fighter')!
    match.squadrons=match.squadrons.map(squadron=>squadron.id===fighter.id?{...squadron,mission:'base-strike',sortieOrdered:true}:{...squadron,sortieOrdered:false})
    const result=resolveRound(match)
    const view={...match,phase:'debrief' as const,lastResult:{...result,logisticsIncome:{base:8,intel:2,enemyAircraft:1,total:11}},squadrons:result.squadrons}
    const markup=renderToStaticMarkup(<Debrief match={view} onFocus={()=>{}} onResupply={()=>{}}/>)

    expect(markup).toContain('+$110M')
    expect(markup).toContain('Round pay <b>$80M</b>')
    expect(markup).toContain('Recovered intel <b>$20M</b>')
    expect(markup).toContain('Confirmed enemy losses <b>$10M</b>')
    expect(markup).toContain('Round map key')
    expect(markup).toContain('Round highlights')
    expect(markup).toContain('debrief-symbol')
    expect(markup).toContain('ORDERS &amp; RESULTS')
    expect(markup).toContain('STRIKE UNSELECTED GROUND TARGET')
    expect(markup).toContain('SELECT A CONFIRMED GROUND TARGET')
  })
})
