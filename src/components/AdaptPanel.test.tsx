import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createMatch } from '../game/data'
import type { EconomyTarget } from '../game/types'
import { AdaptPanel } from './AdaptPanel'

const noop=()=>{}
const state=()=>({...createMatch(),phase:'adapt' as const,logistics:20})
function render(match=state(),selectedTarget:EconomyTarget={kind:'campaign',id:'campaign'}){
  return renderToStaticMarkup(<AdaptPanel match={match} selectedTarget={selectedTarget} onSelectTarget={noop} onCloseTarget={noop} onPurchase={noop} onNextRound={noop} procurementMode="closed" onProcurementMode={noop} onProcurementAction={noop} hasPlacementPreview={false} onConfirmPlacement={noop} onCancelPlacement={noop}/> )
}

describe('Adapt context',()=>{
  it('shows upgrades only for the selected main airfield, outside the repair shortcut',()=>{
    const match=state()
    expect(render(match)).not.toContain('MAINTENANCE WING')
    expect(render(match)).not.toContain('Selected unit')
    expect(render(match)).not.toContain('Repairs and replacements')
    const airfield=render(match,{kind:'asset',id:'p-base'})
    expect(airfield).toContain('MAINTENANCE WING')
    expect(airfield).toContain('SUPPLY DEPOT')
    expect(airfield).toContain('Based formations')
    expect(airfield).toContain('VIPER 1')
    expect(airfield).not.toContain('Repairs and replacements')
  })

  it('puts current site health, rearmed missiles, and repair action in the same compact selection',()=>{
    const match=state()
    match.playerAssets=match.playerAssets.map(asset=>asset.id==='p-sam'?{...asset,health:75}:asset)
    const sam=render(match,{kind:'asset',id:'p-sam'})
    expect(sam).toContain('75 / 100 HP')
    expect(sam).toContain('3/3 MSL')
    expect(sam).toContain('REPAIR SAM')
    expect(sam).toContain('Repairs and replacements (1)')
    expect(sam).not.toContain('MAINTENANCE WING')
    expect(sam).not.toContain('NEED ATTENTION')
  })

  it('counts formations requiring replacements and displays installed upgrades after purchase',()=>{
    const match=state()
    match.squadrons=match.squadrons.map(squadron=>squadron.id==='viper'?{...squadron,aircraft:2,strength:50}:squadron)
    match.playerAssets=match.playerAssets.map(asset=>asset.id==='p-base'?{...asset,upgrades:['maintenance-wing']}:asset)
    const airfield=render(match,{kind:'asset',id:'p-base'})
    expect(airfield).toContain('MAINTENANCE WING INSTALLED')
    expect(airfield).not.toContain('SUPPLY DEPOT')
    expect(airfield).toContain('Repairs and replacements (1)')
    const flight=render(match,{kind:'squadron',id:'viper'})
    expect(flight).toContain('REPLACE AIRCRAFT')
    expect(flight).not.toContain('UPGRADES')
  })

  it('never exposes unknown enemy site details or enemy upgrade and basing controls',()=>{
    const match=state()
    expect(render(match,{kind:'asset',id:'e-base'})).not.toContain('Selected unit')
    match.enemyAssets=match.enemyAssets.map(asset=>asset.id==='e-base'?{...asset,hidden:false,intel:'confirmed'}:asset)
    const enemy=render(match,{kind:'asset',id:'e-base'})
    expect(enemy).toContain('ENEMY')
    expect(enemy).not.toContain('SUPPLY DEPOT')
    expect(enemy).not.toContain('Based formations')
  })
})
