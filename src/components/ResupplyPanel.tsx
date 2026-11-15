import { useState } from 'react'
import { Check, ChevronRight, X } from 'lucide-react'
import { economyAttentionTargets, economyCommandForQuote, economyQuotesFor, findMatchingEconomyQuote } from '../game/economy'
import { upgradeDefinition } from '../game/upgrades'
import { defenseProfile } from '../game/equipmentRules'
import { assetCardData } from '../game/unitCards'
import type { EconomyActionId, EconomyActionQuote, EconomyCommand, EconomyTarget, MatchState } from '../game/types'

export type ProcurementMode = 'closed' | 'catalog' | 'placing'

const campaignTarget = { kind: 'campaign', id: 'campaign' } as const

interface ResupplyPanelProps {
  match: MatchState
  selectedTarget: EconomyTarget
  onSelectTarget: (target: EconomyTarget) => void
  onCloseTarget: () => void
  onPurchase: (command: EconomyCommand) => void
  onNextRound: () => void
  procurementMode: ProcurementMode
  procurementActionId?: EconomyActionId
  onProcurementMode: (mode: ProcurementMode) => void
  onProcurementAction: (actionId: EconomyActionId) => void
  hasPlacementPreview: boolean
  onConfirmPlacement: () => void
  onCancelPlacement: () => void
  busy?: boolean
}

function PurchaseButton({ quote, onBuy, disabled }: { quote: EconomyActionQuote; onBuy: () => void; disabled?: boolean }) {
  return <button type="button" disabled={disabled || !quote.eligible} onClick={onBuy}>
    <span><b>{quote.label}</b><small>{quote.detail}</small>{quote.reason ? <em>{quote.reason}</em> : null}</span>
    <strong>${quote.cost}</strong>
  </button>
}

export function ResupplyPanel({
  match, selectedTarget, onSelectTarget, onCloseTarget, onPurchase, onNextRound, procurementMode,
  procurementActionId, onProcurementMode, onProcurementAction, hasPlacementPreview, onConfirmPlacement,
  onCancelPlacement, busy = false,
}: ResupplyPanelProps) {
  const [showRepairs, setShowRepairs] = useState(false)
  const [upgradePending, setUpgradePending] = useState<EconomyCommand>()
  const quotes = economyQuotesFor(match, selectedTarget)
  const catalog = economyQuotesFor(match, campaignTarget)
  const placement = catalog.find(quote => quote.id === procurementActionId && quote.effect.kind === 'asset-construction')
  const repairTargets = economyAttentionTargets(match)
  const friendlyAsset = selectedTarget.kind === 'asset' ? match.playerAssets.find(asset => asset.id === selectedTarget.id) : undefined
  const selectedAsset = friendlyAsset ?? (selectedTarget.kind === 'asset'
    ? match.enemyAssets.find(asset => asset.id === selectedTarget.id && !asset.hidden && asset.intel !== 'unknown')
    : undefined)
  const assetData = selectedAsset ? assetCardData(selectedAsset, !friendlyAsset, 'adapt') : undefined
  const formation = selectedTarget.kind === 'squadron' ? match.squadrons.find(item => item.id === selectedTarget.id) : undefined
  const based = friendlyAsset ? match.squadrons.filter(item => friendlyAsset.basedFormationIds?.includes(item.id) && item.aircraft > 0) : []
  const installed = (formation?.upgrades ?? selectedAsset?.upgrades ?? []).map(upgradeDefinition)
  const pending = findMatchingEconomyQuote(quotes, upgradePending)
  const needsFormation = !match.squadrons.some(item => item.aircraft > 0)
  const repairsOpen = showRepairs && selectedTarget.kind === 'campaign' && procurementMode === 'closed'

  function chooseTarget(target: EconomyTarget) {
    setShowRepairs(false)
    setUpgradePending(undefined)
    onSelectTarget(target)
  }

  function buy(quote: EconomyActionQuote) {
    onPurchase(economyCommandForQuote(match, quote))
  }

  function chooseAction(quote: EconomyActionQuote) {
    if (quote.upgradeId) setUpgradePending(economyCommandForQuote(match, quote))
    else buy(quote)
  }

  const defense = selectedAsset ? defenseProfile(selectedAsset) : undefined
  const repairUnavailable = friendlyAsset && friendlyAsset.health < friendlyAsset.maxHealth && !quotes.some(quote => quote.id.startsWith('repair-'))
    ? friendlyAsset.kind === 'sam' ? 'SAM damage is permanent.' : 'This site has no available repairs.'
    : undefined

  return <section className="adapt-panel resupply-panel" aria-label="Resupply">
    <div className="adapt-content">
      {procurementMode === 'catalog' ? <div className="adapt-drawer" aria-label="Purchase catalog">
        <header className="adapt-build-heading"><b>Buy units or sites</b><button type="button" aria-label="Close purchases" onClick={() => onProcurementMode('closed')}><X/></button></header>
        <div className="adapt-actions">
          {catalog.filter(quote => quote.effect.kind === 'formation-purchase').map(quote =>
            <PurchaseButton key={quote.id} quote={quote} disabled={busy} onBuy={() => buy(quote)}/>)}
          {catalog.filter(quote => quote.effect.kind === 'asset-construction').map(quote =>
            <PurchaseButton key={quote.id} quote={quote} disabled={busy} onBuy={() => onProcurementAction(quote.id)}/>)}
        </div>
      </div> : null}

      {procurementMode === 'placing' && placement ? <div className="adapt-drawer adapt-placement-drawer" aria-label="Place site">
        <header className="adapt-build-heading"><b>{placement.label} · ${placement.cost}</b><button type="button" aria-label="Cancel placement" onClick={() => onProcurementMode('closed')}><X/></button></header>
        <p className="procure-instruction">{hasPlacementPreview ? 'Tap another hex to move the site.' : 'Tap a highlighted hex to place the site.'}</p>
        {hasPlacementPreview ? <div className="campaign-placement-confirm"><button type="button" onClick={onCancelPlacement}>Clear site</button><button type="button" className="confirm" disabled={busy} onClick={onConfirmPlacement}>Confirm build <Check/></button></div> : null}
      </div> : null}

      {repairsOpen ? <div className="adapt-drawer" aria-label="Systems needing repair">
        <header className="adapt-build-heading"><b>Needs repair</b><button type="button" aria-label="Close repair list" onClick={() => setShowRepairs(false)}><X/></button></header>
        <div className="adapt-actions">{repairTargets.map(target => {
          const system = match.playerAssets.find(asset => asset.id === target.id)
          const aircraft = match.squadrons.find(item => item.id === target.id)
          const repair = economyQuotesFor(match, target).find(quote => quote.id.startsWith('repair-'))
          return <button type="button" key={target.id} onClick={() => chooseTarget(target)}>
            <span><b>{system?.name ?? system?.kind.toUpperCase() ?? aircraft?.callsign}</b><small>{repair?.detail}</small></span>
            <strong>${repair?.cost}</strong>
          </button>
        })}</div>
      </div> : null}

      {procurementMode === 'closed' && (assetData || formation) ? <div className="adapt-drawer adapt-selection" aria-label="Selected system">
        <header className="adapt-drawer-title">
          <b>{assetData?.title ?? formation?.callsign}</b>
          <small>{assetData ? `${Math.round(assetData.health)} / ${assetData.maxHealth} HP` : `${formation!.aircraft}/${formation!.maxAircraft} aircraft · ${Math.round(formation!.strength ?? 0)}%`}</small>
          <button type="button" aria-label="Close selected system" onClick={() => { setUpgradePending(undefined); onCloseTarget() }}><X/></button>
        </header>
        {assetData ? <progress value={assetData.health} max={assetData.maxHealth} aria-label="Site health"/> : null}
        {assetData ? <p className="adapt-site-status">
          {friendlyAsset ? '' : 'Enemy · '}{assetData.status}{defense ? ` · Range ${defense.range.toFixed(1)}` : ''}
        </p> : null}
        {repairUnavailable ? <p className="adapt-site-status">{repairUnavailable}</p> : null}
        {based.length ? <div className="adapt-based-flights" aria-label="Based formations">{based.map(item =>
          <button type="button" key={item.id} onClick={() => chooseTarget({kind:'squadron',id:item.id})}>{item.callsign} <span>{item.aircraft}/{item.maxAircraft}</span></button>
        )}</div> : null}
        {installed.map(upgrade => upgrade ? <p key={upgrade.id} className="adapt-installed"><Check/>{upgrade.label} installed</p> : null)}
        {quotes.length ? <div className="adapt-actions">{quotes.map(quote =>
          <PurchaseButton key={quote.id} quote={quote} disabled={busy} onBuy={() => chooseAction(quote)}/>
        )}</div> : null}
        {pending ? <div className="adapt-confirm">
          <div><b>{pending.label}</b><small>${pending.projected.logistics} after purchase</small></div>
          <button type="button" onClick={() => setUpgradePending(undefined)}>Cancel</button>
          <button type="button" className="confirm" disabled={busy || !pending.eligible} onClick={() => { buy(pending); setUpgradePending(undefined) }}>Confirm <Check/></button>
        </div> : null}
      </div> : null}
    </div>
    <div className="resupply-controls">
      <span className="adapt-balance" aria-label="Cash balance"><b>${match.logistics}</b></span>
      <button type="button" aria-expanded={procurementMode === 'catalog'} onClick={() => {
        setShowRepairs(false)
        setUpgradePending(undefined)
        onProcurementMode(procurementMode === 'catalog' ? 'closed' : 'catalog')
      }}>Buy</button>
      {repairTargets.length ? <button type="button" aria-expanded={repairsOpen} onClick={() => {
        onCloseTarget()
        setUpgradePending(undefined)
        setShowRepairs(!repairsOpen)
      }}>Repairs <span>{repairTargets.length}</span></button> : null}
      <button type="button" className="adapt-next" disabled={busy || needsFormation} onClick={onNextRound}>{needsFormation ? 'Buy a formation' : `Plan round ${match.round + 1}`} <ChevronRight/></button>
    </div>
  </section>
}
