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
    const view={...match,phase:'debrief' as const,lastResult:result,squadrons:result.squadrons}
    const markup=renderToStaticMarkup(<Debrief match={view} onFocus={()=>{}} onAdapt={()=>{}}/>)

    expect(markup).toContain('ORDERS &amp; RESULTS')
    expect(markup).toContain('STRIKE CONFIRMED ENEMY BASE')
    expect(markup).toContain('CONFIRM THE ENEMY BASE BEFORE STRIKING')
  })
})
