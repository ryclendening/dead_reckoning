import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createMatch } from '../game/data'
import { economyQuotesFor } from '../game/economy'
import type { EconomyTarget } from '../game/types'
import { PurchaseCatalog, ResupplyPanel } from './ResupplyPanel'

const noop=()=>{}
const state=()=>({...createMatch(),phase:'adapt' as const,logistics:20})
function render(match=state(),selectedTarget:EconomyTarget={kind:'campaign',id:'campaign'}, mode:'closed'|'catalog'='closed'){
  return renderToStaticMarkup(<ResupplyPanel match={match} selectedTarget={selectedTarget} onSelectTarget={noop} onCloseTarget={noop} onPurchase={noop} onNextRound={noop} procurementMode={mode} onProcurementMode={noop} onProcurementAction={noop} hasPlacementPreview={false} onConfirmPlacement={noop} onCancelPlacement={noop}/> )
}

describe('Resupply',()=>{
  it('shows upgrades only for the selected main airfield, outside the repair shortcut',()=>{
    const match=state()
    expect(render(match)).not.toContain('MAINTENANCE WING')
    expect(render(match)).not.toContain('Selected system')
    expect(render(match)).not.toContain('Repairs and replacements')
    const airfield=render(match,{kind:'asset',id:'p-base'})
    expect(airfield).toContain('MAINTENANCE WING')
    expect(airfield).toContain('SUPPLY DEPOT')
    expect(airfield).toContain('Based formations')
    expect(airfield).toContain('VIPER 1')
    expect(airfield).not.toContain('Repairs and replacements')
  })

  it('shows current SAM health and rearmed missiles without offering repair',()=>{
    const match=state()
    match.playerAssets=match.playerAssets.map(asset=>asset.id==='p-sam'?{...asset,health:75}:asset)
    const sam=render(match,{kind:'asset',id:'p-sam'})
    expect(sam).toContain('75 / 100 HP')
    expect(sam).toContain('3/3 MSL')
    expect(sam).not.toContain('REPAIR SAM')
    expect(sam).not.toContain('Repairs and replacements')
    expect(sam).not.toContain('MAINTENANCE WING')
    expect(sam).not.toContain('NEED ATTENTION')
  })

  it('names damage, price, and exact repair gain on the selected formation',()=>{
    const match=state()
    match.squadrons=match.squadrons.map(squadron=>squadron.id==='viper'?{...squadron,aircraft:2,strength:30}:squadron)
    match.playerAssets=match.playerAssets.map(asset=>asset.id==='p-base'?{...asset,upgrades:['maintenance-wing']}:asset)
    const airfield=render(match,{kind:'asset',id:'p-base'})
    expect(airfield).toContain('MAINTENANCE WING installed')
    expect(airfield).not.toContain('SUPPLY DEPOT')
    expect(airfield).toContain('Repairs <span>1</span>')
    const flight=render(match,{kind:'squadron',id:'viper'})
    expect(flight).toContain('REPAIR FORMATION')
    expect(flight).toContain('Strength 30 → 50 (+20)')
    expect(flight).toContain('$10M</strong>')
    expect(flight).not.toContain('UPGRADES')
  })

  it('allows planning with no aircraft and no cash',()=>{
    const match=state()
    match.logistics=0
    match.squadrons=match.squadrons.map(formation=>({...formation,aircraft:0,strength:0}))
    const nextButton = render(match).match(/<button[^>]*class="adapt-next"[^>]*>Plan round 2/)?.[0]
    expect(nextButton).toBeDefined()
    expect(nextButton).not.toContain('disabled')
  })

  it('opens the purchase catalog on Aircraft and lists reinforcement prices',()=>{
    const catalog=render(state(),{kind:'campaign',id:'campaign'},'catalog')
    expect(catalog).toContain('aria-pressed="true">Aircraft</button>')
    expect(catalog).toContain('aria-pressed="false">Ground</button>')
    expect(catalog).toContain('Buy fighter formation')
    expect(catalog).toContain('Buy recon formation')
    expect(catalog).toContain('$160M</strong>')
    expect(catalog).toContain('$120M</strong>')
    expect(catalog).toContain('Available at home base next round')
    expect(catalog).not.toContain('BUILD SAM')
  })

  it('lists ground construction when Ground is selected',()=>{
    const quotes=economyQuotesFor(state(),{kind:'campaign',id:'campaign'})
    const catalog=renderToStaticMarkup(<PurchaseCatalog
      category="ground" quotes={quotes} busy={false} onCategoryChange={noop} onChoose={noop} onClose={noop}
    />)
    expect(catalog).toContain('aria-pressed="true">Ground</button>')
    expect(catalog).toContain('BUILD FOB')
    expect(catalog).toContain('BUILD DECOY')
    expect(catalog).toContain('BUILD AAA')
    expect(catalog).toContain('BUILD SAM')
    expect(catalog).toContain('BUILD RADAR')
    expect(catalog).toMatch(/BUILD SAM[^<]*<\/b><small>1\/3 operational<\/small>/)
    expect(catalog).toMatch(/BUILD RADAR[^<]*<\/b><small>1\/2 operational<\/small>/)
    expect(catalog).toContain('$180M</strong>')
    expect(catalog).not.toContain('Buy fighter formation')
    expect(catalog).not.toContain('Buy recon formation')
  })

  it('never exposes unknown enemy site details or enemy upgrade and basing controls',()=>{
    const match=state()
    expect(render(match,{kind:'asset',id:'e-base'})).not.toContain('Selected system')
    match.enemyAssets=match.enemyAssets.map(asset=>asset.id==='e-base'?{...asset,hidden:false,intel:'confirmed'}:asset)
    const enemy=render(match,{kind:'asset',id:'e-base'})
    expect(enemy).toContain('Enemy ·')
    expect(enemy).not.toContain('SUPPLY DEPOT')
    expect(enemy).not.toContain('Based formations')
  })
})
