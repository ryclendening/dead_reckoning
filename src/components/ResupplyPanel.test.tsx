import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createMatch } from '../game/data'
import { economyQuotesFor, purchaseEconomyAction } from '../game/economy'
import type { EconomyTarget, MatchState } from '../game/types'
import { PurchaseCatalog, type PurchaseCategory } from './PurchaseCatalog'
import { ResupplyPanel } from './ResupplyPanel'

const noop=()=>{}
const state=()=>({...createMatch(),phase:'adapt' as const,logistics:20})
function render(match=state(),selectedTarget:EconomyTarget={kind:'campaign',id:'campaign'}, mode:'closed'|'catalog'='closed'){
  return renderToStaticMarkup(<ResupplyPanel match={match} selectedTarget={selectedTarget} purchaseCategory="Aircraft" onPurchaseCategoryChange={noop} onCloseTarget={noop} onPurchase={noop} onNextRound={noop} procurementMode={mode} onProcurementMode={noop} onProcurementAction={noop} hasPlacementPreview={false} onConfirmPlacement={noop} onCancelPlacement={noop}/> )
}

function renderCatalog(category: PurchaseCategory, match: MatchState = state(), initialUpgradeTarget?: EconomyTarget) {
  const quotes = economyQuotesFor(match, { kind: 'campaign', id: 'campaign' })
  return renderToStaticMarkup(<PurchaseCatalog category={category} quotes={quotes} match={match} busy={false} initialUpgradeTarget={initialUpgradeTarget}
    onCategoryChange={noop} onChoose={noop} onClose={noop}/>)
}

describe('Resupply',()=>{
  it('keeps the compact Resupply bar when a ground site is selected',()=>{
    const match=state()
    for(const id of ['p-base','p-sam','e-base']){
      const html=render(match,{kind:'asset',id})
      expect(html).toContain('resupply-panel resupply-bar')
      expect(html).not.toContain('adapt-drawer')
      expect(html).not.toContain('MAINTENANCE WING')
    }
  })

  it('names damage, price, and exact repair gain on the selected formation',()=>{
    const match=state()
    match.squadrons=match.squadrons.map(squadron=>squadron.id==='viper'?{...squadron,aircraft:2,strength:30}:squadron)
    match.playerAssets=match.playerAssets.map(asset=>asset.id==='p-base'?{...asset,upgrades:['maintenance-wing']}:asset)
    const flight=render(match,{kind:'squadron',id:'viper'})
    expect(flight).toContain('resupply-panel resupply-bar')
    expect(flight).toContain('aria-label="Selected aircraft"')
    expect(flight).toContain('Strength 30 → 50 (+20)')
    expect(flight).toContain('Repair · $10M')
    expect(flight).not.toContain('adapt-drawer')
  })

  it('keeps repair pricing and strength visible when the player cannot afford service', () => {
    const match = state()
    match.logistics = 0
    match.squadrons = match.squadrons.map(flight => flight.id === 'viper' ? { ...flight, strength: 50 } : flight)
    const flight = render(match, { kind: 'squadron', id: 'viper' })
    expect(flight).toContain('Strength 50 → 75 (+25)')
    expect(flight).toContain('class="formation-repair" disabled="">Repair · $20M')
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
    expect(catalog).toContain('<b>Fighter</b></span><span class="store-offer-price">$160M</span>')
    expect(catalog).toContain('<b>Recon</b></span><span class="store-offer-price">$120M</span>')
    expect(catalog).toMatch(/<b>Bomber<\/b><\/span><span class="store-offer-price">.*?<\/svg>\$240M<\/span>/)
    expect(catalog).toContain('4 aircraft · Home base next round')
    expect(catalog).not.toContain('<b>SAM</b>')
  })

  it('lists all ground offers and deployment limits in the full-screen store',()=>{
    const catalog = renderCatalog('Ground')
    expect(catalog).toContain('aria-pressed="true">Ground</button>')
    expect(catalog).toContain('<dialog')
    expect(catalog).toContain('<b>Forward base</b></span><span class="store-offer-price">$80M</span>')
    expect(catalog).toContain('<b>Decoy</b></span><span class="store-offer-price">$40M</span>')
    expect(catalog).toContain('<b>AAA</b></span><span class="store-offer-price">$60M</span>')
    expect(catalog).toContain('<b>SAM</b><small>1/3 operational</small></span><span class="store-offer-price">$140M')
    expect(catalog).toContain('<b>Radar</b><small>1/2 operational</small></span><span class="store-offer-price">$180M')
    expect(catalog).not.toContain('<b>Fighter</b>')
  })

  it('shows both upgrade branches and locks the other choice after installing one', () => {
    const match = state()
    const initial = renderCatalog('Upgrades', match)
    expect(initial).toContain('Main airfield')
    expect(initial).toContain('Choose one permanent upgrade')
    expect(initial).toContain('No further tiers')
    expect(initial).toContain('class="store-action" disabled="">Select an upgrade')
    expect(initial).toContain('<optgroup label="Aircraft formations">')
    expect(initial).toContain('<b>maintenance wing</b><small>Formation repairs cost $10M less.</small>')
    expect(initial).toMatch(/<b>supply depot<\/b><small>Future completed rounds pay an extra .*?<\/small><\/span><span class="store-offer-price">\$120M<\/span>/)
    const installed = purchaseEconomyAction(match, 'install-supply-depot', { kind: 'asset', id: 'p-base' })
    const upgraded = renderCatalog('Upgrades', installed)
    expect(upgraded).toMatch(/data-status="installed"[^>]*>.*?<b>supply depot<\/b>.*?Installed/)
    expect(upgraded).toMatch(/data-status="locked"[^>]*>.*?<b>maintenance wing<\/b>.*?Locked/)
    expect(upgraded).toContain('Main airfield · Upgraded')
    expect(upgraded).toContain('Fully upgraded')
    expect(upgraded).not.toContain('class="store-action"')
  })

  it('opens a formation’s branch directly from its service card target', () => {
    const markup = renderCatalog('Upgrades', state(), { kind: 'squadron', id: 'viper' })

    expect(markup).toContain('value="viper" selected=""')
    expect(markup).toContain('<b>extended tanks</b><small>Flight range +20%.</small>')
    expect(markup).toContain('<b>precision ordnance</b>')
    expect(markup).not.toContain('<b>maintenance wing</b>')
  })

  it('totals current-round purchases and leaves past spending and income out', () => {
    const match = purchaseEconomyAction(state(), 'buy-recon', { kind: 'campaign', id: 'campaign' })
    match.economy.statement.push(
      { id: 'old', round: 0, direction: 'spend', amount: 16, label: 'Buy fighter formation', source: 'buy-fighter' },
      { id: 'income', round: match.round, direction: 'income', amount: 8, label: 'Round pay', source: 'base' },
    )
    expect(renderCatalog('Aircraft', match)).toContain('1 purchase · $120M')
  })

})
